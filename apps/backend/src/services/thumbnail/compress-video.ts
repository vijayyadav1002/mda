import ffmpeg from 'fluent-ffmpeg';
import type { AdvancedCompressOptions } from './compress-image.js';

export async function compressVideo(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .output(outputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .output(outputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Compress a video with resolution and CRF options.
 * Preserves the original container format. Audio is copied (no re-encode).
 */
export async function compressVideoAdvanced(
  inputPath: string,
  outputPath: string,
  options: AdvancedCompressOptions & { onProgress?: (percent: number) => void; signal?: AbortSignal }
): Promise<void> {
  // Map quality (1-100) to CRF (51-0). Higher quality = lower CRF.
  const quality = options.quality ?? 70;
  const crf = Math.round(51 - (quality / 100) * 51);

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('Compression cancelled'));
      return;
    }

    const cmd = ffmpeg(inputPath);

    const outputOptions: string[] = [
      '-c:v libx264',
      `-crf ${crf}`,
      '-preset medium',
      '-c:a copy',
      '-movflags +faststart',
      '-pix_fmt yuv420p'
    ];

    // Apply resolution scaling if specified
    if (options.resolution && options.resolution !== 'original') {
      const [w, h] = options.resolution.split('x').map(Number);
      if (w && h) {
        // Scale to fit within WxH while maintaining aspect ratio; ensure even dimensions
        outputOptions.push(`-vf scale='min(${w},iw)':min'(${h},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`);
      }
    }

    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      try { cmd.kill('SIGKILL'); } catch { /* ignore */ }
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    cmd
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('progress', (progress) => {
        if (options.onProgress && progress.percent != null) {
          options.onProgress(Math.min(Math.round(progress.percent), 100));
        }
      })
      .on('end', () => {
        options.signal?.removeEventListener('abort', onAbort);
        resolve();
      })
      .on('error', (err) => {
        options.signal?.removeEventListener('abort', onAbort);
        if (cancelled) {
          reject(new Error('Compression cancelled'));
        } else {
          reject(err);
        }
      })
      .run();
  });
}
