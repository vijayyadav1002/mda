import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { config } from '../../config.js';
import type { ThumbnailGenerationOptions } from './types.js';

export const SUPPORTED_VIDEO_FORMATS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];

export async function generateVideoThumbnail(
  inputPath: string,
  outputPath: string,
  options?: ThumbnailGenerationOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new Error('Thumbnail generation cancelled'));
      return;
    }

    let cancelled = false;
    const cmd = ffmpeg(inputPath)
      .screenshots({
        count: 1,
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: `${config.thumbnailSize}x${config.thumbnailSize}`
      });

    const onAbort = () => {
      cancelled = true;
      try { cmd.kill('SIGKILL'); } catch { /* ignore */ }
    };
    options?.signal?.addEventListener('abort', onAbort, { once: true });

    cmd
      .on('end', () => {
        options?.signal?.removeEventListener('abort', onAbort);
        resolve();
      })
      .on('error', (err) => {
        options?.signal?.removeEventListener('abort', onAbort);
        if (cancelled) {
          reject(new Error('Thumbnail generation cancelled'));
        } else {
          console.error(`Error generating video thumbnail for ${inputPath}:`, err);
          reject(err);
        }
      });
  });
}
