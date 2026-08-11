import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs/promises';
import { isValidAssetId, resolveWithinRoot } from '../lib/media-path.js';

const TRANSCODE_CACHE_PATH = path.join(config.thumbnailCachePath, '../transcoded');

// Track active transcoding sessions
const activeTranscodes = new Map<string, { startTime: number; lastAccessed: number }>();

// Web-compatible video codecs
const WEB_COMPATIBLE_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const WEB_COMPATIBLE_CONTAINERS = new Set(['.mp4', '.webm']);

interface VideoInfo {
  codec: string;
  container: string;
  needsTranscoding: boolean;
}

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
 * Check if a video needs transcoding for web playback
 */
export async function checkVideoCompatibility(videoPath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const container = path.extname(videoPath).toLowerCase();
      const codec = videoStream?.codec_name || 'unknown';

      const needsTranscoding =
        !WEB_COMPATIBLE_CODECS.has(codec.toLowerCase()) ||
        !WEB_COMPATIBLE_CONTAINERS.has(container);

      resolve({
        codec,
        container,
        needsTranscoding
      });
    });
  });
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

function parseTimemarkToSeconds(timemark: string): number {
  // FFmpeg timemark format: "HH:MM:SS.ms"
  const parts = timemark.split(':');
  if (parts.length !== 3) return 0;
  const hours = Number.parseFloat(parts[0]) || 0;
  const minutes = Number.parseFloat(parts[1]) || 0;
  const seconds = Number.parseFloat(parts[2]) || 0;
  return hours * 3600 + minutes * 60 + seconds;
}

async function probeDurationSeconds(videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err || !metadata?.format?.duration) {
        resolve(0);
        return;
      }
      resolve(Number(metadata.format.duration) || 0);
    });
  });
}

export async function transcodeToHLS(
  videoPath: string,
  outputDir: string,
  opts?: { onProgress?: (percent: number) => void }
): Promise<string> {
  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });
  const playlistPath = path.join(outputDir, 'master.m3u8');

  const duration = await probeDurationSeconds(videoPath);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        '-profile:v baseline',
        '-level 3.0',
        '-start_number 0',
        '-hls_time 4',
        '-hls_list_size 0',
        '-f hls'
      ])
      .output(playlistPath)
      .on('progress', (progress) => {
        if (!opts?.onProgress) return;
        let percent = 0;
        if (duration > 0 && progress.timemark) {
          const elapsed = parseTimemarkToSeconds(progress.timemark);
          percent = Math.min(99, Math.max(0, Math.round((elapsed / duration) * 100)));
        } else if (typeof progress.percent === 'number' && !Number.isNaN(progress.percent)) {
          percent = Math.min(99, Math.max(0, Math.round(progress.percent)));
        }
        opts.onProgress(percent);
      })
      .on('end', () => resolve(playlistPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

export async function ensureHLS(filePath: string, assetId: string): Promise<string> {
  if (!isValidAssetId(assetId)) {
    throw new Error(`Invalid assetId: ${assetId}`);
  }
  const hlsRoot = path.resolve(path.dirname(config.thumbnailCachePath), 'hls');
  const playlistPath = resolveWithinRoot(hlsRoot, path.join(hlsRoot, assetId, 'master.m3u8'));
  if (!playlistPath) {
    throw new Error(`Invalid assetId: ${assetId}`);
  }

  try {
    await fs.access(playlistPath);
    return playlistPath;
  } catch {
    console.log(`HLS not found for ${assetId}, triggering generation`);
    // Dynamic import to avoid circular dependency if queue imports this
    const { addToEncodingQueue } = await import('./queue/index.js');
    await addToEncodingQueue({ filePath, assetId, type: 'hls' });

    // Poll for creation (max 10s)
    const start = Date.now();
    while (Date.now() - start < 10000) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        await fs.access(playlistPath);
        return playlistPath;
      } catch { }
    }
    throw new Error('Video processing started. Please try again in moments.');
  }
}
