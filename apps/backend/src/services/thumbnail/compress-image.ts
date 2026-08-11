import sharp, { type Sharp } from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { decodeHeicToRgba, shouldPreferExternalHeic } from './heic.js';

const execFileAsync = promisify(execFile);

export interface AdvancedCompressOptions {
  resolution?: string; // e.g. "1920x1080", "1280x720", "original"
  quality?: number;    // 1-100 for images; maps to CRF for videos
}

export async function compressImage(inputPath: string, outputPath: string, quality: number = 80) {
  await sharp(inputPath)
    .jpeg({ quality })
    .toFile(outputPath);
}

/**
 * Compress an image with resolution and quality options.
 * Preserves original format (HEIC outputs as JPEG).
 */
export async function compressImageAdvanced(
  inputPath: string,
  outputPath: string,
  options: AdvancedCompressOptions
): Promise<void> {
  const ext = path.extname(inputPath).toLowerCase();
  const quality = options.quality ?? 80;

  let pipeline: Sharp;

  // HEIC needs special decoding
  if (ext === '.heic') {
    if (shouldPreferExternalHeic) {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mda-compress-'));
      const tempJpeg = path.join(tempDir, 'source.jpg');
      try {
        await execFileAsync('heif-convert', [inputPath, tempJpeg]);
        pipeline = sharp(tempJpeg).rotate();
      } catch {
        const decoded = await decodeHeicToRgba(inputPath);
        pipeline = sharp(decoded.data, {
          raw: { width: decoded.width, height: decoded.height, channels: 4 }
        });
      }
    } else {
      const decoded = await decodeHeicToRgba(inputPath);
      pipeline = sharp(decoded.data, {
        raw: { width: decoded.width, height: decoded.height, channels: 4 }
      });
    }
  } else {
    pipeline = sharp(inputPath).rotate();
  }

  // Apply resolution resize
  if (options.resolution && options.resolution !== 'original') {
    const [w, h] = options.resolution.split('x').map(Number);
    if (w && h) {
      pipeline = pipeline.resize(w, h, { fit: 'inside', withoutEnlargement: true });
    }
  }

  // Output in the closest matching format
  const outExt = path.extname(outputPath).toLowerCase();
  if (outExt === '.png') {
    await pipeline.png({ quality }).toFile(outputPath);
  } else if (outExt === '.webp') {
    await pipeline.webp({ quality }).toFile(outputPath);
  } else {
    // Default to JPEG for jpg, jpeg, heic, bmp, gif, and anything else
    await pipeline.jpeg({ quality }).toFile(outputPath);
  }
}
