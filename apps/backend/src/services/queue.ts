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

export interface EncodingJobData {
    filePath: string;
    assetId: string;
    type?: 'mp4' | 'hls';
}

export interface ThumbnailJobData {
    filePath: string;
    assetId?: string; // Optional, might need to update DB
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
        const { generateThumbnail } = await import('./thumbnail.js');
        await generateThumbnail(job.data.filePath);
        // Note: If we need to update DB, we should add logic here
    }, {
        connection,
        concurrency: 4 // Process max 4 thumbnails at a time
    });

    encodingWorker.on('error', (err) => console.error('[Worker] Encoding worker error:', err));
    thumbnailWorker.on('error', (err) => console.error('[Worker] Thumbnail worker error:', err));

    console.log('Background task workers started');

    return { encodingWorker, thumbnailWorker };
}

export const addToEncodingQueue = (data: EncodingJobData) => encodingQueue.add('transcode', data);
export const addToThumbnailQueue = (data: ThumbnailJobData) => thumbnailQueue.add('generate', data);
