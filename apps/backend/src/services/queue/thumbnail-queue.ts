import { Queue, Worker } from 'bullmq';
import { redis } from '../redis.js';
import { connection } from './connection.js';

export const thumbnailQueue = new Queue('thumbnail', {
    connection,
    defaultJobOptions: {
        attempts: 2,
        removeOnComplete: true,
        removeOnFail: 100,
    }
});

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

export function createThumbnailWorker() {
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
            const { generateAndSaveThumbnail, generateThumbnail } = await import('../thumbnail/index.js');
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

    thumbnailWorker.on('error', (err) => console.error('[Worker] Thumbnail worker error:', err));

    return thumbnailWorker;
}
