import chokidar from 'chokidar';
import path from 'node:path';
import { config } from '../config.js';
import { indexFile, removeFile } from './media-indexer.js';

const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp', '.bmp'];
const SUPPORTED_VIDEO_FORMATS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
const SUPPORTED_FORMATS = new Set([...SUPPORTED_IMAGE_FORMATS, ...SUPPORTED_VIDEO_FORMATS]);

let watcherInstance: ReturnType<typeof chokidar.watch> | null = null;
let isWatcherReady = false;
let watcherRestarting = false;

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

function getWatcherOptions(usePolling: boolean) {
  const interval = toPositiveInt(
    process.env.CHOKIDAR_INTERVAL,
    usePolling ? 1000 : 100
  );
  const binaryInterval = toPositiveInt(
    process.env.CHOKIDAR_BINARY_INTERVAL,
    usePolling ? 3000 : 300
  );
  const awaitWritePollInterval = toPositiveInt(
    process.env.CHOKIDAR_AWAIT_WRITE_POLL_INTERVAL,
    usePolling ? 300 : 100
  );

  return {
    ignored: /(^|[/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true, // Don't process existing files - already done by indexMediaLibrary
    awaitWriteFinish: {
      stabilityThreshold: 3000, // Better handling of large files
      pollInterval: awaitWritePollInterval
    },
    usePolling,
    interval,
    binaryInterval,
    alwaysStat: true // Always stat files for better detection
  } as const;
}

function createWatcher(usePolling: boolean) {
  console.log(`[WATCHER] Starting media watcher on path: ${config.mediaLibraryPath} (polling=${usePolling})`);

  const watcher = chokidar.watch(config.mediaLibraryPath, getWatcherOptions(usePolling));

  watcher
    .on('add', async (filePath) => {
      // Only process after watcher is ready to avoid duplicate indexing
      if (!isWatcherReady) {
        console.log(`[WATCHER] Ignoring add event (watcher not ready): ${path.basename(filePath)}`);
        return;
      }
      
      const ext = path.extname(filePath).toLowerCase();
      if (SUPPORTED_FORMATS.has(ext)) {
        console.log(`[WATCHER] New file detected: ${filePath}`);
        try {
          await indexFile(filePath, {
            queueThumbnails: !config.thumbnailsOnDemand,
            requeueMissingThumbnails: !config.thumbnailsOnDemand
          });
          console.log(`[WATCHER] Successfully indexed: ${path.basename(filePath)}`);
        } catch (error) {
          console.error(`[WATCHER] Error indexing ${filePath}:`, error);
        }
      } else {
        console.log(`[WATCHER] Skipping unsupported file type: ${path.basename(filePath)} (${ext})`);
      }
    })
    .on('change', async (filePath) => {
      // Only process after watcher is ready
      if (!isWatcherReady) {
        console.log(`[WATCHER] Ignoring change event (watcher not ready): ${path.basename(filePath)}`);
        return;
      }
      
      const ext = path.extname(filePath).toLowerCase();
      if (SUPPORTED_FORMATS.has(ext)) {
        console.log(`[WATCHER] File changed: ${filePath}`);
        try {
          await indexFile(filePath, {
            queueThumbnails: !config.thumbnailsOnDemand,
            requeueMissingThumbnails: !config.thumbnailsOnDemand
          });
          console.log(`[WATCHER] Successfully reindexed: ${path.basename(filePath)}`);
        } catch (error) {
          console.error(`[WATCHER] Error reindexing ${filePath}:`, error);
        }
      }
    })
    .on('unlink', async (filePath) => {
      // Only process after watcher is ready
      if (!isWatcherReady) {
        console.log(`[WATCHER] Ignoring unlink event (watcher not ready): ${path.basename(filePath)}`);
        return;
      }
      
      console.log(`[WATCHER] File removed: ${filePath}`);
      try {
        await removeFile(filePath);
        console.log(`[WATCHER] Successfully removed from index: ${path.basename(filePath)}`);
      } catch (error) {
        console.error(`[WATCHER] Error removing ${filePath} from index:`, error);
      }
    })
    .on('error', (err: unknown) => {
      const error = err as NodeJS.ErrnoException;
      // Raspberry Pi / Linux often hits inotify limits on huge media trees.
      if (error?.code === 'ENOSPC' && !usePolling && !watcherRestarting) {
        watcherRestarting = true;
        console.warn('[WATCHER] ENOSPC reached for fs.watch. Restarting watcher with polling mode.');
        void (async () => {
          try {
            isWatcherReady = false;
            await watcher.close();
            watcherInstance = createWatcher(true);
          } catch (restartError) {
            console.error('[WATCHER] Failed to restart watcher in polling mode:', restartError);
          } finally {
            watcherRestarting = false;
          }
        })();
        return;
      }

      console.error('[WATCHER] Watcher error:', error);
    })
    .on('ready', () => {
      isWatcherReady = true;
      console.log('✓ Media watcher is ready and monitoring for changes');
      console.log(`[WATCHER] Watching directory: ${config.mediaLibraryPath}`);
    });

  return watcher;
}

export function startMediaWatcher() {
  if (watcherInstance) {
    console.log('[WATCHER] Watcher already started');
    return watcherInstance;
  }

  const usePolling = process.env.CHOKIDAR_USEPOLLING === 'true';
  watcherInstance = createWatcher(usePolling);

  return watcherInstance;
}
