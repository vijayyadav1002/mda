import fs from 'fs/promises';
import { config } from '../../config.js';
import { scanDirectory } from './directory-scan.js';
import { indexFile, normalizeIndexOptions, type IndexOptions } from './index-file.js';

export async function indexMediaLibrary(options: IndexOptions = {}) {
  try {
    const mediaPath = config.mediaLibraryPath;

    // Ensure media library path exists
    try {
      await fs.access(mediaPath);
    } catch {
      console.warn(`Media library path does not exist: ${mediaPath}`);
      return;
    }

    // Ensure thumbnail cache directory exists
    await fs.mkdir(config.thumbnailCachePath, { recursive: true });

    const files = await scanDirectory(mediaPath);
    console.log(`Found ${files.length} media files to index`);

    let indexedCount = 0;
    let upToDateCount = 0;
    let requeuedCount = 0;
    let unsupportedCount = 0;
    let failedCount = 0;

    const normalizedOptions = normalizeIndexOptions({
      queueThumbnails: options.queueThumbnails ?? !config.thumbnailsOnDemand,
      requeueMissingThumbnails: options.requeueMissingThumbnails ?? !config.thumbnailsOnDemand
    });

    for (const filePath of files) {
      try {
        const result = await indexFile(filePath, normalizedOptions);
        if (result === 'indexed') indexedCount += 1;
        if (result === 'up_to_date') upToDateCount += 1;
        if (result === 'thumbnail_requeued') requeuedCount += 1;
        if (result === 'unsupported') unsupportedCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    console.log(`Initial media indexing completed (indexed=${indexedCount}, unchanged=${upToDateCount}, requeued=${requeuedCount}, unsupported=${unsupportedCount}, failed=${failedCount})`);
  } catch (error) {
    console.error('Error indexing media library:', error);
    throw error;
  }
}
