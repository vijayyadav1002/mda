import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../../config.js';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs/promises';
import { checkVideoCompatibility } from './compatibility.js';
import { parseTimemarkToSeconds, probeDurationSeconds } from './progress.js';

const TRANSCODE_CACHE_PATH = path.join(config.thumbnailCachePath, '../transcoded');

// Track active transcoding sessions
const activeTranscodes = new Map<string, { startTime: number; lastAccessed: number }>();

/**
 * Mark a transcoded video as accessed
 */
export function markTranscodeAccessed(filePath: string) {
  const info = activeTranscodes.get(filePath);
  if (info) {
    info.lastAccessed = Date.now();
  }
}

/**
 * Transcode video to web-compatible format (H.264/MP4)
 */
export async function transcodeVideo(
  videoPath: string,
  assetId: string,
  opts?: { onProgress?: (percent: number) => void; signal?: AbortSignal }
): Promise<string> {
  // Ensure transcode cache directory exists
  await fs.mkdir(TRANSCODE_CACHE_PATH, { recursive: true });

  // Generate cache key based on asset ID and file path
  const stats = await fs.stat(videoPath);
  const cacheKey = crypto
    .createHash('md5')
    .update(assetId + videoPath + stats.mtime.toISOString())
    .digest('hex');

  const transcodedPath = path.join(TRANSCODE_CACHE_PATH, `${cacheKey}.mp4`);

  // Check if already transcoded
  try {
    await fs.access(transcodedPath);
    console.log(`Using cached transcoded video: ${transcodedPath}`);

    // Update access time
    activeTranscodes.set(transcodedPath, {
      startTime: Date.now(),
      lastAccessed: Date.now()
    });

    return transcodedPath;
  } catch {
    // Not cached, need to transcode
  }

  console.log(`Transcoding video on-demand: ${path.basename(videoPath)} to MP4/H.264`);

  const duration = await probeDurationSeconds(videoPath);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const command = ffmpeg(videoPath)
      .outputOptions([
        '-c:v libx264',        // H.264 video codec
        '-preset fast',         // Encoding speed/quality trade-off
        '-crf 23',             // Constant Rate Factor (quality: 0-51, 23 is default)
        '-c:a aac',            // AAC audio codec
        '-b:a 128k',           // Audio bitrate
        '-movflags +faststart', // Enable streaming
        '-pix_fmt yuv420p'     // Pixel format for compatibility
      ])
      .output(transcodedPath);

    const onAbort = () => {
      command.kill('SIGKILL');
    };
    if (opts?.signal) {
      if (opts.signal.aborted) {
        reject(new Error('Transcoding aborted'));
        return;
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    command
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        let percent = 0;
        if (duration > 0 && progress.timemark) {
          const elapsed = parseTimemarkToSeconds(progress.timemark);
          percent = Math.min(99, Math.max(0, Math.round((elapsed / duration) * 100)));
        } else if (typeof progress.percent === 'number' && !Number.isNaN(progress.percent)) {
          percent = Math.min(99, Math.max(0, Math.round(progress.percent)));
        }
        opts?.onProgress?.(percent);
      })
      .on('end', () => {
        opts?.signal?.removeEventListener('abort', onAbort);
        console.log(`✓ Transcoding complete: ${transcodedPath}`);

        // Track this transcode
        activeTranscodes.set(transcodedPath, {
          startTime,
          lastAccessed: Date.now()
        });

        resolve(transcodedPath);
      })
      .on('error', (err) => {
        opts?.signal?.removeEventListener('abort', onAbort);
        // Remove partial output so the cache never serves a truncated file
        fs.unlink(transcodedPath).catch(() => {});
        if (opts?.signal?.aborted) {
          reject(new Error('Transcoding aborted'));
          return;
        }
        console.error('Transcoding error:', err);
        reject(err);
      })
      .run();
  });
}

/**
 * Get web-compatible video path (transcode on-demand if needed)
 */
export async function getWebCompatibleVideo(videoPath: string, assetId: string): Promise<string> {
  try {
    const info = await checkVideoCompatibility(videoPath);

    if (!info.needsTranscoding) {
      console.log(`Video is web-compatible: ${path.basename(videoPath)}`);
      return videoPath;
    }

    console.log(`Video needs transcoding: ${path.basename(videoPath)} (codec: ${info.codec})`);
    return await transcodeVideo(videoPath, assetId);
  } catch (error) {
    console.error('Error checking video compatibility:', error);
    // Return original path as fallback
    return videoPath;
  }
}

/**
 * Delete transcoded video for a specific asset immediately
 */
export async function deleteTranscodedVideo(videoPath: string, assetId: string): Promise<void> {
  try {
    console.log(`[deleteTranscodedVideo] Called for asset ${assetId}, video path: ${videoPath}`);

    // Generate the same cache key used during transcoding
    const stats = await fs.stat(videoPath);
    const cacheKey = crypto
      .createHash('md5')
      .update(assetId + videoPath + stats.mtime.toISOString())
      .digest('hex');

    const transcodedPath = path.join(TRANSCODE_CACHE_PATH, `${cacheKey}.mp4`);
    console.log(`[deleteTranscodedVideo] Looking for transcoded file: ${transcodedPath}`);

    // Check if transcoded file exists
    try {
      await fs.access(transcodedPath);
      console.log(`[deleteTranscodedVideo] File exists, deleting...`);

      // Delete the file
      await fs.unlink(transcodedPath);

      // Remove from tracking
      activeTranscodes.delete(transcodedPath);

      console.log(`✓ Deleted transcoded video: ${path.basename(transcodedPath)}`);
    } catch (accessError) {
      // File doesn't exist or was already deleted - this is expected if video was web-compatible
      console.log('[deleteTranscodedVideo] No transcoded video found for asset', assetId, 'at', transcodedPath, accessError instanceof Error ? accessError.message : '');
    }
  } catch (error) {
    console.error('[deleteTranscodedVideo] Error for asset', assetId, ':', error);
  }
}
