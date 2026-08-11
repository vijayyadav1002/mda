import { Queue, Worker } from 'bullmq';
import { connection } from './connection.js';

export const mediaRefreshQueue = new Queue('media-refresh', {
    connection,
    defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 100,
    }
});

export interface MediaRefreshJobData {
    requestedByUserId: number;
}

const MEDIA_REFRESH_COOLDOWN_MS = 30 * 1000;
let lastMediaRefreshEnqueueAt = 0;

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

export function createMediaRefreshWorker() {
    const mediaRefreshWorker = new Worker<MediaRefreshJobData>('media-refresh', async (job) => {
        console.log(`[Worker] Starting media refresh job ${job.id}`);
        const { indexMediaLibrary } = await import('../media-indexer/index.js');
        const { logAudit } = await import('../audit.js');

        await indexMediaLibrary();
        await logAudit(job.data.requestedByUserId, 'REFRESH_MEDIA_LIBRARY', 'media_library');
        console.log(`[Worker] Finished media refresh job ${job.id}`);
    }, {
        connection,
        concurrency: 1
    });

    mediaRefreshWorker.on('error', (err) => console.error('[Worker] Media refresh worker error:', err));

    return mediaRefreshWorker;
}
