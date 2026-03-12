import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs/promises';

const TRANSCODE_CACHE_PATH = path.join(config.thumbnailCachePath, '../transcoded');

// Track active transcoding sessions
const activeTranscodes = new Map<string, { startTime: number; lastAccessed: number }>();

// Cleanup interval (run every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;
// Delete transcoded files after 10 minutes of inactivity
const INACTIVITY_TIMEOUT = 10 * 60 * 1000;

// Web-compatible video codecs
const WEB_COMPATIBLE_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const WEB_COMPATIBLE_CONTAINERS = new Set(['.mp4', '.webm']);

interface VideoInfo {
  codec: string;
  container: string;
  needsTranscoding: boolean;
}

/**
 * Start cleanup timer for inactive transcoded videos
 */
export function startTranscodeCleanup() {
  setInterval(async () => {
    await cleanupInactiveTranscodes();
  }, CLEANUP_INTERVAL);

  console.log('Transcode cleanup service started');
}

/**
 * Clean up transcoded videos that haven't been accessed recently
 */
async function cleanupInactiveTranscodes() {
  const now = Date.now();
  const toDelete: string[] = [];

  for (const [filePath, info] of activeTranscodes.entries()) {
    if (now - info.lastAccessed > INACTIVITY_TIMEOUT) {
      toDelete.push(filePath);
    }
  }

  for (const filePath of toDelete) {
    try {
      await fs.unlink(filePath);
      activeTranscodes.delete(filePath);
      console.log(`✓ Cleaned up inactive transcode: ${path.basename(filePath)}`);
    } catch (error) {
      // File might already be deleted, log and continue
      console.warn(`Could not delete transcode ${path.basename(filePath)}:`, error);
      activeTranscodes.delete(filePath);
    }
  }

  if (toDelete.length > 0) {
    console.log(`Cleaned up ${toDelete.length} inactive transcoded video(s)`);
  }
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
export async function transcodeVideo(videoPath: string, assetId: string): Promise<string> {
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

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    ffmpeg(videoPath)
      .outputOptions([
        '-c:v libx264',        // H.264 video codec
        '-preset fast',         // Encoding speed/quality trade-off
        '-crf 23',             // Constant Rate Factor (quality: 0-51, 23 is default)
        '-c:a aac',            // AAC audio codec
        '-b:a 128k',           // Audio bitrate
        '-movflags +faststart', // Enable streaming
        '-pix_fmt yuv420p'     // Pixel format for compatibility
      ])
      .output(transcodedPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`Transcoding progress: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log(`✓ Transcoding complete: ${transcodedPath}`);

        // Track this transcode
        activeTranscodes.set(transcodedPath, {
          startTime,
          lastAccessed: Date.now()
        });

        resolve(transcodedPath);
      })
      .on('error', (err) => {
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
      console.log(`[deleteTranscodedVideo] No transcoded video found for asset ${assetId} at ${transcodedPath}`, accessError instanceof Error ? accessError.message : '');
    }
  } catch (error) {
    console.error(`[deleteTranscodedVideo] Error for asset ${assetId}:`, error);
  }
}

export async function transcodeToHLS(videoPath: string, outputDir: string): Promise<string> {
  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });
  const playlistPath = path.join(outputDir, 'master.m3u8');

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        '-profile:v baseline',
        '-level 3.0',
        '-start_number 0',
        '-hls_time 6',
        '-hls_list_size 0',
        '-f hls'
      ])
      .output(playlistPath)
      .on('end', () => resolve(playlistPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

export async function ensureHLS(filePath: string, assetId: string): Promise<string> {
  const hlsDir = path.join(path.dirname(config.thumbnailCachePath), 'hls', assetId);
  const playlistPath = path.join(hlsDir, 'master.m3u8');

  try {
    await fs.access(playlistPath);
    return playlistPath;
  } catch {
    console.log(`HLS not found for ${assetId}, triggering generation`);
    // Dynamic import to avoid circular dependency if queue imports this
    const { addToEncodingQueue } = await import('./queue.js');
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
