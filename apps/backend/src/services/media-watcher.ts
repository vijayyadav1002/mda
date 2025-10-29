import chokidar from 'chokidar';
import path from 'node:path';
import { config } from '../config.js';
import { indexFile, removeFile } from './media-indexer.js';

const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp', '.bmp'];
const SUPPORTED_VIDEO_FORMATS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
const SUPPORTED_FORMATS = new Set([...SUPPORTED_IMAGE_FORMATS, ...SUPPORTED_VIDEO_FORMATS]);

export function startMediaWatcher() {
  const watcher = chokidar.watch(config.mediaLibraryPath, {
    ignored: /(^|[/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: false, // Process existing files on startup
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100
    }
  });

  watcher
    .on('add', async (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (SUPPORTED_FORMATS.has(ext)) {
        console.log(`New file detected: ${filePath}`);
        await indexFile(filePath);
      }
    })
    .on('change', async (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (SUPPORTED_FORMATS.has(ext)) {
        console.log(`File changed: ${filePath}`);
        await indexFile(filePath);
      }
    })
    .on('unlink', async (filePath) => {
      console.log(`File removed: ${filePath}`);
      await removeFile(filePath);
    })
    .on('error', (error) => {
      console.error('Watcher error:', error);
    })
    .on('ready', () => {
      console.log('Media watcher is ready and monitoring for changes');
    });

  return watcher;
}
