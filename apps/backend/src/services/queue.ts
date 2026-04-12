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
}

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
        const { generateAndSaveThumbnail, generateThumbnail } = await import('./thumbnail.js');
        if (job.data.assetId) {
            await generateAndSaveThumbnail(job.data.filePath, job.data.assetId);
        } else {
            await generateThumbnail(job.data.filePath);
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

    const compressionWorker = new Worker<CompressJobData>('compression', async (job) => {
        console.log(`[Worker] Starting compression job ${job.id} (jobId=${job.data.jobId})`);
        const { userId, jobId, assets, options } = job.data;
        const queueKey = `compress_queue:${userId}`;

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

        await updateJob(j => ({ ...j, status: 'compressing', progress: {}, currentFileId: null }));

        const pathMod = await import('node:path');
        const fsMod = await import('node:fs');
        const { config: cfg } = await import('../config.js');
        const { compressImageAdvanced, compressVideoAdvanced } = await import('./thumbnail.js');

        const previewDir = pathMod.default.resolve(pathMod.default.dirname(cfg.thumbnailCachePath), 'compress-preview');
        await fsMod.promises.mkdir(previewDir, { recursive: true });

        const previews: Array<{ assetId: string; originalSize: string; compressedSize: string; previewUrl: string }> = [];

        for (const asset of assets) {
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
                await updateJob(j => ({ ...j, previews: [...(j.previews ?? []), preview] }));
            } catch (err: any) {
                console.error(`[Worker] Error compressing asset ${asset.id}: ${err.message}`);
                await updateJob(j => ({
                    ...j,
                    progress: { ...j.progress, [asset.id]: { percent: 0, etaSeconds: null } },
                }));
            }
        }

        await updateJob(j => ({ ...j, status: 'preview_ready', currentFileId: null }));
        console.log(`[Worker] Finished compression job ${job.id}`);
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
 */
export const addToThumbnailQueue = (data: ThumbnailJobData) => {
    const priority = data.mediaType === 'video' ? THUMBNAIL_PRIORITY.VIDEO : THUMBNAIL_PRIORITY.IMAGE;
    return thumbnailQueue.add('generate', data, { priority });
};

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
