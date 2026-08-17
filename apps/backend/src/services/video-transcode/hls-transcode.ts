import path from 'node:path';
import fs from 'node:fs/promises';
import ffmpeg from 'fluent-ffmpeg';
import { config } from '../../config.js';
import { isValidAssetId, resolveWithinRoot } from '../../lib/media-path.js';
import { parseTimemarkToSeconds, probeDurationSeconds } from './progress.js';

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
    const { addToEncodingQueue } = await import('../queue/index.js');
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
