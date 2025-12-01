import chokidar from 'chokidar';
import path from 'node:path';
import { config } from '../config.js';
import { indexFile, removeFile } from './media-indexer.js';

const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp', '.bmp'];
const SUPPORTED_VIDEO_FORMATS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
const SUPPORTED_FORMATS = new Set([...SUPPORTED_IMAGE_FORMATS, ...SUPPORTED_VIDEO_FORMATS]);

let watcherInstance: ReturnType<typeof chokidar.watch> | null = null;
let isWatcherReady = false;

export function startMediaWatcher() {
  if (watcherInstance) {
    console.log('[WATCHER] Watcher already started');
    return watcherInstance;
  }

  console.log(`[WATCHER] Starting media watcher on path: ${config.mediaLibraryPath}`);

  watcherInstance = chokidar.watch(config.mediaLibraryPath, {
    ignored: /(^|[/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true, // Don't process existing files - already done by indexMediaLibrary
    awaitWriteFinish: {
      stabilityThreshold: 3000, // Increased for better handling of large files
      pollInterval: 100
    },
    // Improve performance and reliability
    usePolling: process.env.CHOKIDAR_USEPOLLING === 'true',
    interval: 100,
    binaryInterval: 300,
    alwaysStat: true // Always stat files for better detection
  });

  watcherInstance
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
          await indexFile(filePath);
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
          await indexFile(filePath);
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
    .on('error', (error) => {
      console.error('[WATCHER] Watcher error:', error);
    })
    .on('ready', () => {
      isWatcherReady = true;
      console.log('✓ Media watcher is ready and monitoring for changes');
      console.log(`[WATCHER] Watching directory: ${config.mediaLibraryPath}`);
    });

  return watcherInstance;
}
