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
}

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
        concurrency: 2 // Process max 2 videos at a time
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
        concurrency: 4 // Process max 4 thumbnails at a time
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
export const addToThumbnailQueue = (data: ThumbnailJobData) => thumbnailQueue.add('generate', data);

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
