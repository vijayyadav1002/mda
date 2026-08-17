import { Queue, Worker } from 'bullmq';
import { redis } from '../redis.js';
import { connection } from './connection.js';

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

export interface EncodingJobData {
    filePath: string;
    assetId: string;
    type?: 'mp4' | 'hls';
}

export const addToEncodingQueue = (data: EncodingJobData) => encodingQueue.add('transcode', data);

export function createEncodingWorker() {
    const encodingWorker = new Worker<EncodingJobData>('encoding', async (job) => {
        console.log(`[Worker] Sarting encoding job ${job.id} for ${job.data.filePath}`);
        // Dynamic import to avoid circular dependencies
        const { transcodeVideo, transcodeToHLS } = await import('../video-transcode/index.js');
        const path = await import('node:path');
        const { config } = await import('../../config.js');

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

    encodingWorker.on('error', (err) => console.error('[Worker] Encoding worker error:', err));

    return encodingWorker;
}
