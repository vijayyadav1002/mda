import { Queue, Worker } from 'bullmq';
import { config } from '../config.js';

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

export function startWorkers() {
    const encodingWorker = new Worker<EncodingJobData>('encoding', async (job) => {
        console.log(`[Worker] Sarting encoding job ${job.id} for ${job.data.filePath}`);
        // Dynamic import to avoid circular dependencies
        const { transcodeVideo, transcodeToHLS } = await import('./video-transcode.js');
        const path = await import('node:path');
        const { config } = await import('../config.js');

        if (job.data.type === 'hls') {
            const hlsDir = path.default.join(path.default.dirname(config.thumbnailCachePath), 'hls', job.data.assetId);
            await transcodeToHLS(job.data.filePath, hlsDir);
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

    encodingWorker.on('error', (err) => console.error('[Worker] Encoding worker error:', err));
    thumbnailWorker.on('error', (err) => console.error('[Worker] Thumbnail worker error:', err));
    mediaRefreshWorker.on('error', (err) => console.error('[Worker] Media refresh worker error:', err));

    console.log('Background task workers started');

    return { encodingWorker, thumbnailWorker, mediaRefreshWorker };
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
