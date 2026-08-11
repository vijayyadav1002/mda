import { createThumbnailWorker } from './thumbnail-queue.js';
import { createCompressionWorker } from './compression-queue.js';
import { createEncodingWorker } from './transcode-queue.js';
import { createMediaRefreshWorker } from './media-refresh-queue.js';

export {
    thumbnailQueue,
    activeThumbnailAborts,
    addToThumbnailQueue,
    cancelThumbnailSession,
    type ThumbnailJobData,
} from './thumbnail-queue.js';

export {
    compressionQueue,
    activeCompressionAborts,
    addToCompressionQueue,
    addToTranscodeQueue,
    type CompressAssetData,
    type CompressJobData,
    type TranscodeJobData,
} from './compression-queue.js';

export {
    encodingQueue,
    addToEncodingQueue,
    type EncodingJobData,
} from './transcode-queue.js';

export {
    mediaRefreshQueue,
    enqueueMediaRefresh,
    type MediaRefreshJobData,
} from './media-refresh-queue.js';

export function startWorkers() {
    const encodingWorker = createEncodingWorker();
    const thumbnailWorker = createThumbnailWorker();
    const mediaRefreshWorker = createMediaRefreshWorker();
    const compressionWorker = createCompressionWorker();

    console.log('Background task workers started');

    return { encodingWorker, thumbnailWorker, mediaRefreshWorker, compressionWorker };
}
