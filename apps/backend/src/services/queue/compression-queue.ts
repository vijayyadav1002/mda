import { Queue, Worker } from 'bullmq';
import { redis } from '../redis.js';
import { connection } from './connection.js';

export const compressionQueue = new Queue('compression', {
    connection,
    defaultJobOptions: {
        attempts: 2, // retry once on stall/crash
        removeOnComplete: 50,
        removeOnFail: 100,
    }
});

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

export const addToCompressionQueue = (data: CompressJobData) =>
    compressionQueue.add('compress', data);

// Runs on the compression queue (same worker, concurrency 1) so at most one
// heavy ffmpeg pipeline runs at a time on constrained hardware.
export const addToTranscodeQueue = (data: TranscodeJobData) =>
    compressionQueue.add('transcode', data);

// Map of in-flight compression jobs → AbortController, keyed by CompressJobData.jobId.
// Used by the cancel endpoint to stop ffmpeg mid-run and break the per-file loop.
export const activeCompressionAborts = new Map<string, AbortController>();

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

        const { transcodeVideo, checkVideoCompatibility } = await import('../video-transcode/index.js');
        const { db } = await import('../../db/index.js');

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

export function createCompressionWorker() {
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
        const { config: cfg } = await import('../../config.js');
        const { compressImageAdvanced, compressVideoAdvanced, compressPdfAdvanced } = await import('../thumbnail/index.js');
        const { canCompressFile } = await import('../file-types.js');

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

    return compressionWorker;
}
