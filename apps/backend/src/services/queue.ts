import { Queue, Worker } from 'bullmq';
import { config } from '../config.js';
import { redis } from './redis.js';

// Connection config
const connection = {
    host: config.redisHost,
    port: config.redisPort
};

// Queues
export const encodingQueue = new Queue('encoding', {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 1000,
    }
});

export const thumbnailQueue = new Queue('thumbnail', {
    connection,
    defaultJobOptions: {
        attempts: 2,
        removeOnComplete: true,
        removeOnFail: 100,
    }
});

export const mediaRefreshQueue = new Queue('media-refresh', {
    connection,
    defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 100,
    }
});

export const compressionQueue = new Queue('compression', {
    connection,
    defaultJobOptions: {
        attempts: 2, // retry once on stall/crash
        removeOnComplete: 50,
        removeOnFail: 100,
    }
});

export const addToCompressionQueue = (data: CompressJobData) =>
    compressionQueue.add('compress', data);

// Map of in-flight compression jobs → AbortController, keyed by CompressJobData.jobId.
// Used by the cancel endpoint to stop ffmpeg mid-run and break the per-file loop.
export const activeCompressionAborts = new Map<string, AbortController>();

const MEDIA_REFRESH_COOLDOWN_MS = 30 * 1000;
let lastMediaRefreshEnqueueAt = 0;

export interface EncodingJobData {
    filePath: string;
    assetId: string;
    type?: 'mp4' | 'hls';
}

export interface ThumbnailJobData {
    filePath: string;
    assetId?: string; // If present, update DB thumbnail_path
    mediaType?: 'image' | 'video'; // For priority-based processing
    sessionId?: string; // Folder-visit token; lets the client cancel jobs queued for an abandoned page
}

// In-flight thumbnail jobs → AbortController, keyed by BullMQ jobId.
// Used by cancelThumbnailSession to kill ffmpeg mid-screenshot for active video thumbnails.
export const activeThumbnailAborts = new Map<string, AbortController>();

const THUMBNAIL_SESSION_TTL_SECONDS = 3600;
const THUMBNAIL_SESSION_KEY = (sessionId: string) => `thumb_session:${sessionId}`;
const THUMBNAIL_SESSION_CANCELLED_KEY = (sessionId: string) => `thumb_session_cancelled:${sessionId}`;

// Priority levels for thumbnail queue (higher = processed first)
const THUMBNAIL_PRIORITY = {
    IMAGE: 10,    // High priority: fast to generate (~50ms)
    VIDEO: 1      // Low priority: slow to generate (~5-30s, process in background)
};

export interface MediaRefreshJobData {
    requestedByUserId: number;
}

export interface CompressAssetData {
    id: string;
    fileName: string;
    fileSize: string;
    mimeType: string;
    filePath: string; // absolute path resolved at enqueue time
}

export interface CompressJobData {
    userId: string;
    jobId: string; // matches CompressJob.id in the frontend
    assets: CompressAssetData[];
    options: { resolution: string; quality: number };
}

export interface TranscodeJobData {
    userId: string;
    jobId: string;
    assets: CompressAssetData[];
}

// Runs on the compression queue (same worker, concurrency 1) so at most one
// heavy ffmpeg pipeline runs at a time on constrained hardware.
export const addToTranscodeQueue = (data: TranscodeJobData) =>
    compressionQueue.add('transcode', data);

async function runTranscodeJob(data: TranscodeJobData): Promise<void> {
    const { userId, jobId, assets } = data;
    const queueKey = `compress_queue:${userId}`;

    const abortController = new AbortController();
    activeCompressionAborts.set(jobId, abortController);
    const signal = abortController.signal;

    const updateJob = async (updater: (j: any) => any) => {
        const raw = await redis.get(queueKey);
        const queue: any[] = raw ? JSON.parse(raw) : [];
        const idx = queue.findIndex((j: any) => j.id === jobId);
        if (idx >= 0) {
            queue[idx] = updater(queue[idx]);
            await redis.set(queueKey, JSON.stringify(queue), 'EX', 604800);
        }
    };

    try {
        // Skip work entirely if the user cancelled before the worker started.
        const currentRaw = await redis.get(queueKey);
        const currentQueue: any[] = currentRaw ? JSON.parse(currentRaw) : [];
        if (currentQueue.find((j: any) => j.id === jobId)?.status === 'cancelled') {
            console.log(`[Worker] Skipping cancelled transcode job ${jobId}`);
            return;
        }

        await updateJob(j => ({ ...j, status: 'transcoding', progress: {}, currentFileId: null }));

        const { transcodeVideo, checkVideoCompatibility } = await import('./video-transcode.js');
        const { db } = await import('../db/index.js');

        for (const asset of assets) {
            if (signal.aborted) break;
            await updateJob(j => ({ ...j, currentFileId: asset.id }));

            try {
                let needsTranscoding = true;
                try {
                    needsTranscoding = (await checkVideoCompatibility(asset.filePath)).needsTranscoding;
                } catch {
                    // Probe failed — attempt the transcode anyway.
                }

                if (!needsTranscoding) {
                    // Already web-compatible: nothing to do for this file.
                    await updateJob(j => ({
                        ...j,
                        progress: { ...j.progress, [asset.id]: { percent: 100, etaSeconds: null } },
                    }));
                    continue;
                }

                let lastSent = 0;
                const fileStartTime = Date.now();
                const transcodedPath = await transcodeVideo(asset.filePath, asset.id, {
                    signal,
                    onProgress: (percent: number) => {
                        if (percent - lastSent >= 2 || percent >= 100) {
                            lastSent = percent;
                            const elapsed = (Date.now() - fileStartTime) / 1000;
                            const etaSeconds = percent > 0 ? Math.round((elapsed / percent) * (100 - percent)) : null;
                            updateJob(j => ({
                                ...j,
                                progress: { ...j.progress, [asset.id]: { percent, etaSeconds } },
                            })).catch(() => {});
                        }
                    },
                });
                if (signal.aborted) break;

                // Persist so playback finds the cached transcode instantly.
                await db.query(
                    'UPDATE media_assets SET transcoded_path = $1 WHERE id = $2',
                    [transcodedPath, asset.id]
                );
                await updateJob(j => ({
                    ...j,
                    progress: { ...j.progress, [asset.id]: { percent: 100, etaSeconds: null } },
                }));
            } catch (err: any) {
                if (signal.aborted) break;
                console.error(`[Worker] Error transcoding asset ${asset.id}: ${err.message}`);
                await updateJob(j => ({
                    ...j,
                    progress: { ...j.progress, [asset.id]: { percent: 0, etaSeconds: null } },
                }));
            }
        }

        if (signal.aborted) {
            await updateJob(j => ({ ...j, status: 'cancelled', currentFileId: null }));
            console.log(`[Worker] Transcode job ${jobId} cancelled`);
            return;
        }

        await updateJob(j => ({ ...j, status: 'done', currentFileId: null }));
        console.log(`[Worker] Finished transcode job ${jobId}`);
    } finally {
        activeCompressionAborts.delete(jobId);
    }
}

export function startWorkers() {
    const encodingWorker = new Worker<EncodingJobData>('encoding', async (job) => {
        console.log(`[Worker] Sarting encoding job ${job.id} for ${job.data.filePath}`);
        // Dynamic import to avoid circular dependencies
        const { transcodeVideo, transcodeToHLS } = await import('./video-transcode.js');
        const path = await import('node:path');
        const { config } = await import('../config.js');

        if (job.data.type === 'hls') {
            const progressKey = `video_progress:${job.data.assetId}`;
            await redis.set(progressKey, JSON.stringify({ percent: 0, status: 'transcoding' }), 'EX', 3600);

            const hlsDir = path.default.join(path.default.dirname(config.thumbnailCachePath), 'hls', job.data.assetId);
            try {
                await transcodeToHLS(job.data.filePath, hlsDir, {
                    onProgress: (percent: number) => {
                        // fire-and-forget: ffmpeg progress callback is synchronous
                        redis.set(
                            progressKey,
                            JSON.stringify({ percent, status: 'transcoding' }),
                            'EX',
                            3600,
                        ).catch(() => {});
                    },
                });
                await redis.set(progressKey, JSON.stringify({ percent: 100, status: 'ready' }), 'EX', 3600);
            } catch (err: any) {
                await redis.set(
                    progressKey,
                    JSON.stringify({ percent: 0, status: 'error', error: err?.message ?? 'Transcoding failed' }),
                    'EX',
                    3600,
                ).catch(() => {});
                throw err;
            }
        } else {
            await transcodeVideo(job.data.filePath, job.data.assetId);
        }
        console.log(`[Worker] Finished encoding job ${job.id}`);
    }, {
        connection,
        concurrency: 1 // Process max 1 video at a time (video transcoding is very CPU-intensive on 4-core RPi)
    });

    const thumbnailWorker = new Worker<ThumbnailJobData>('thumbnail', async (job) => {
        const sessionId = job.data.sessionId;

        // Skip jobs whose session was cancelled before this worker picked them up.
        // remove() races against the worker pulling jobs into 'active' state, so this
        // flag catches the small window where a job was already promoted past 'waiting'.
        if (sessionId) {
            const isCancelled = await redis.get(THUMBNAIL_SESSION_CANCELLED_KEY(sessionId));
            if (isCancelled) {
                console.log(`[Worker] Skipping cancelled thumbnail job ${job.id} (session ${sessionId})`);
                return;
            }
        }

        const abortController = new AbortController();
        if (job.id) activeThumbnailAborts.set(job.id, abortController);

        try {
            const { generateAndSaveThumbnail, generateThumbnail } = await import('./thumbnail/index.js');
            if (job.data.assetId) {
                await generateAndSaveThumbnail(job.data.filePath, job.data.assetId, { signal: abortController.signal });
            } else {
                await generateThumbnail(job.data.filePath, { signal: abortController.signal });
            }
        } finally {
            if (job.id) activeThumbnailAborts.delete(job.id);
        }
    }, {
        connection,
        concurrency: 2 // Process max 2 thumbnails at a time (optimized for 4-core Raspberry Pi)
    });

    const mediaRefreshWorker = new Worker<MediaRefreshJobData>('media-refresh', async (job) => {
        console.log(`[Worker] Starting media refresh job ${job.id}`);
        const { indexMediaLibrary } = await import('./media-indexer.js');
        const { logAudit } = await import('./audit.js');

        await indexMediaLibrary();
        await logAudit(job.data.requestedByUserId, 'REFRESH_MEDIA_LIBRARY', 'media_library');
        console.log(`[Worker] Finished media refresh job ${job.id}`);
    }, {
        connection,
        concurrency: 1
    });

    const compressionWorker = new Worker<CompressJobData | TranscodeJobData>('compression', async (job) => {
        if (job.name === 'transcode') {
            console.log(`[Worker] Starting transcode job ${job.id} (jobId=${job.data.jobId})`);
            await runTranscodeJob(job.data as TranscodeJobData);
            return;
        }
        console.log(`[Worker] Starting compression job ${job.id} (jobId=${job.data.jobId})`);
        const { userId, jobId, assets, options } = job.data as CompressJobData;
        const queueKey = `compress_queue:${userId}`;

        const abortController = new AbortController();
        activeCompressionAborts.set(jobId, abortController);
        const signal = abortController.signal;

        // Helper: read queue from Redis, apply updater, write back (7-day TTL)
        const updateJob = async (updater: (j: any) => any) => {
            const raw = await redis.get(queueKey);
            const queue: any[] = raw ? JSON.parse(raw) : [];
            const idx = queue.findIndex((j: any) => j.id === jobId);
            if (idx >= 0) {
                queue[idx] = updater(queue[idx]);
                await redis.set(queueKey, JSON.stringify(queue), 'EX', 604800);
            }
        };

        // Skip work entirely if the user cancelled before the worker started.
        const currentRaw = await redis.get(queueKey);
        const currentQueue: any[] = currentRaw ? JSON.parse(currentRaw) : [];
        const jobEntry = currentQueue.find((j: any) => j.id === jobId);
        if (jobEntry?.status === 'cancelled') {
            activeCompressionAborts.delete(jobId);
            console.log(`[Worker] Skipping cancelled compression job ${jobId}`);
            return;
        }

        await updateJob(j => ({ ...j, status: 'compressing', progress: {}, currentFileId: null }));

        const pathMod = await import('node:path');
        const fsMod = await import('node:fs');
        const { config: cfg } = await import('../config.js');
        const { compressImageAdvanced, compressVideoAdvanced, compressPdfAdvanced } = await import('./thumbnail/index.js');
        const { canCompressFile } = await import('./file-types.js');

        const previewDir = pathMod.default.resolve(pathMod.default.dirname(cfg.thumbnailCachePath), 'compress-preview');
        await fsMod.promises.mkdir(previewDir, { recursive: true });

        const previews: Array<{ assetId: string; originalSize: string; compressedSize: string; previewUrl: string }> = [];
        const writtenPreviewPaths: string[] = [];

        try {
            for (const asset of assets) {
                if (signal.aborted) break;
                await updateJob(j => ({ ...j, currentFileId: asset.id }));

                try {
                    const ext = pathMod.default.extname(asset.filePath).toLowerCase();
                    const previewExt = ext === '.heic' ? '.jpg' : ext;
                    const previewFileName = `${asset.id}_preview${previewExt}`;
                    const previewPath = pathMod.default.join(previewDir, previewFileName);
                    const originalStats = await fsMod.promises.stat(asset.filePath);

                    if (asset.mimeType.startsWith('image/')) {
                        await compressImageAdvanced(asset.filePath, previewPath, {
                            resolution: options.resolution,
                            quality: options.quality,
                        });
                        if (signal.aborted) {
                            await fsMod.promises.unlink(previewPath).catch(() => {});
                            break;
                        }
                        await updateJob(j => ({
                            ...j,
                            progress: { ...j.progress, [asset.id]: { percent: 100, etaSeconds: null } },
                        }));
                    } else if (asset.mimeType.startsWith('video/')) {
                        let lastSent = 0;
                        const fileStartTime = Date.now();
                        await compressVideoAdvanced(asset.filePath, previewPath, {
                            resolution: options.resolution,
                            quality: options.quality,
                            signal,
                            onProgress: (percent: number) => {
                                if (percent - lastSent >= 2 || percent >= 100) {
                                    lastSent = percent;
                                    const elapsed = (Date.now() - fileStartTime) / 1000;
                                    const etaSeconds = percent > 0 ? Math.round((elapsed / percent) * (100 - percent)) : null;
                                    // fire-and-forget: onProgress callback is synchronous, can't await
                                    updateJob(j => ({
                                        ...j,
                                        progress: { ...j.progress, [asset.id]: { percent, etaSeconds } },
                                    })).catch(() => {});
                                }
                            },
                        });
                        if (signal.aborted) {
                            await fsMod.promises.unlink(previewPath).catch(() => {});
                            break;
                        }
                    } else if (canCompressFile(asset.fileName, asset.mimeType)) {
                        await compressPdfAdvanced(asset.filePath, previewPath, {
                            quality: options.quality,
                            signal,
                        });
                        if (signal.aborted) {
                            await fsMod.promises.unlink(previewPath).catch(() => {});
                            break;
                        }
                        await updateJob(j => ({
                            ...j,
                            progress: { ...j.progress, [asset.id]: { percent: 100, etaSeconds: null } },
                        }));
                    } else {
                        console.warn(`[Worker] Skipping unsupported mime type: ${asset.mimeType}`);
                        continue;
                    }

                    const compressedStats = await fsMod.promises.stat(previewPath);
                    const preview = {
                        assetId: asset.id,
                        originalSize: originalStats.size.toString(),
                        compressedSize: compressedStats.size.toString(),
                        previewUrl: `/compress-preview/${previewFileName}`,
                    };
                    previews.push(preview);
                    writtenPreviewPaths.push(previewPath);
                    await updateJob(j => ({ ...j, previews: [...(j.previews ?? []), preview] }));
                } catch (err: any) {
                    if (signal.aborted) break;
                    console.error(`[Worker] Error compressing asset ${asset.id}: ${err.message}`);
                    await updateJob(j => ({
                        ...j,
                        progress: { ...j.progress, [asset.id]: { percent: 0, etaSeconds: null } },
                    }));
                }
            }

            if (signal.aborted) {
                // Remove any previews created before cancel landed so disk isn't left with orphans.
                await Promise.all(writtenPreviewPaths.map(p => fsMod.promises.unlink(p).catch(() => {})));
                await updateJob(j => ({ ...j, status: 'cancelled', currentFileId: null, previews: [] }));
                console.log(`[Worker] Compression job ${jobId} cancelled`);
                return;
            }

            await updateJob(j => ({ ...j, status: 'preview_ready', currentFileId: null }));
            console.log(`[Worker] Finished compression job ${job.id}`);
        } finally {
            activeCompressionAborts.delete(jobId);
        }
    }, {
        connection,
        concurrency: 1, // one compression at a time — CPU-intensive
    });

    encodingWorker.on('error', (err) => console.error('[Worker] Encoding worker error:', err));
    thumbnailWorker.on('error', (err) => console.error('[Worker] Thumbnail worker error:', err));
    mediaRefreshWorker.on('error', (err) => console.error('[Worker] Media refresh worker error:', err));
    compressionWorker.on('error', (err) => console.error('[Worker] Compression worker error:', err));
    compressionWorker.on('failed', async (job, err) => {
        if (!job) return;
        const { userId, jobId } = job.data;
        const queueKey = `compress_queue:${userId}`;
        const raw = await redis.get(queueKey).catch(() => null);
        const queue: any[] = raw ? JSON.parse(raw) : [];
        const idx = queue.findIndex((j: any) => j.id === jobId);
        if (idx >= 0) {
            // Don't overwrite a cancelled status with 'error' if the user just cancelled.
            if (queue[idx].status === 'cancelled') return;
            queue[idx] = { ...queue[idx], status: 'error', errorMessage: err.message, currentFileId: null };
            await redis.set(queueKey, JSON.stringify(queue), 'EX', 604800).catch(() => {});
        }
    });

    console.log('Background task workers started');

    return { encodingWorker, thumbnailWorker, mediaRefreshWorker, compressionWorker };
}

export const addToEncodingQueue = (data: EncodingJobData) => encodingQueue.add('transcode', data);

/**
 * Add thumbnail job with priority-based ordering (Bull priority queue)
 * Images: priority 10 (high) - processed first, fast (~50ms)
 * Videos: priority 1 (low) - processed in background, can take 5-30s
 *
 * If sessionId is provided, the job id is tracked in a Redis set so the client
 * can later cancel every job queued during that folder visit.
 */
export const addToThumbnailQueue = async (data: ThumbnailJobData) => {
    const priority = data.mediaType === 'video' ? THUMBNAIL_PRIORITY.VIDEO : THUMBNAIL_PRIORITY.IMAGE;
    const job = await thumbnailQueue.add('generate', data, { priority });
    if (data.sessionId && job.id) {
        const key = THUMBNAIL_SESSION_KEY(data.sessionId);
        try {
            await redis.sadd(key, job.id);
            await redis.expire(key, THUMBNAIL_SESSION_TTL_SECONDS);
        } catch (err) {
            console.warn('[Queue] Failed to track thumbnail session id:', err);
        }
    }
    return job;
};

/**
 * Cancel every thumbnail job queued under this session id.
 * - Sets a Redis flag so workers skip jobs that race ahead of remove().
 * - Removes waiting/delayed jobs from BullMQ.
 * - Aborts any active job (kills ffmpeg for video thumbnails).
 *
 * Returns the count of jobs that were actually cancelled (waiting removals + active aborts).
 */
export async function cancelThumbnailSession(sessionId: string): Promise<number> {
    if (!sessionId) return 0;
    const sessionKey = THUMBNAIL_SESSION_KEY(sessionId);
    const cancelKey = THUMBNAIL_SESSION_CANCELLED_KEY(sessionId);

    // Flag must land before remove() so any job that gets pulled into 'active'
    // between now and remove() returning will short-circuit at the worker entry.
    await redis.set(cancelKey, '1', 'EX', THUMBNAIL_SESSION_TTL_SECONDS);

    const jobIds = await redis.smembers(sessionKey);
    if (jobIds.length === 0) {
        return 0;
    }

    let cancelledCount = 0;
    await Promise.all(jobIds.map(async (jobId) => {
        try {
            const job = await thumbnailQueue.getJob(jobId);
            if (!job) return;
            const state = await job.getState();
            if (state === 'waiting' || state === 'delayed' || state === 'prioritized' || state === 'waiting-children') {
                await job.remove();
                cancelledCount += 1;
            } else if (state === 'active') {
                const abort = activeThumbnailAborts.get(jobId);
                if (abort) {
                    abort.abort();
                    cancelledCount += 1;
                }
            }
        } catch (err) {
            // Single-job failures are non-fatal; the session flag still protects the rest.
        }
    }));

    await redis.del(sessionKey);
    return cancelledCount;
}

export async function enqueueMediaRefresh(data: MediaRefreshJobData) {
    const now = Date.now();

    if (now - lastMediaRefreshEnqueueAt < MEDIA_REFRESH_COOLDOWN_MS) {
        return {
            queued: false,
            message: 'Media library refresh was triggered recently. Please wait a few seconds.'
        };
    }

    const jobId = 'media-library-refresh';
    const existingJob = await mediaRefreshQueue.getJob(jobId);

    if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'waiting' || state === 'active' || state === 'delayed' || state === 'prioritized') {
            return {
                queued: false,
                message: 'Media library refresh is already in progress'
            };
        }
    }

    await mediaRefreshQueue.add('refresh', data, { jobId });
    lastMediaRefreshEnqueueAt = now;
    return {
        queued: true,
        message: 'Media library refresh queued'
    };
}
