import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../config.js';
import { db } from '../db/index.js';

const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp', '.bmp'];
const SUPPORTED_VIDEO_FORMATS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];

type HeicJpegOptions =
  | { kind: 'cover'; width: number; height: number; quality?: number }
  | { kind: 'inside'; maxWidth: number; maxHeight: number; quality?: number };

const execFileAsync = promisify(execFile);

const heicDecodeMode = (process.env.HEIC_DECODE_MODE || 'auto').toLowerCase();
const shouldPreferExternalHeic =
  heicDecodeMode === 'external' ||
  (heicDecodeMode === 'auto' && process.platform === 'linux' && process.arch.startsWith('arm'));

async function decodeHeicToRgba(inputPath: string): Promise<{ data: Buffer; width: number; height: number }> {
  // @ts-ignore - libheif-js has no types.
  const libheif = (await import('libheif-js')).default;
  const file = await fs.readFile(inputPath);

  // @ts-ignore
  const decoder = new libheif.HeifDecoder();
  // @ts-ignore
  const decoded = decoder.decode(file);

  if (!decoded || decoded.length === 0) {
    throw new Error('HEIC decode returned no images');
  }

  const image = decoded[0];
  const width = image.get_width();
  const height = image.get_height();

  const displayData = await new Promise<{ data: Uint8ClampedArray; width: number; height: number }>((resolve, reject) => {
    const rgba = new Uint8ClampedArray(width * height * 4);
    image.display({ data: rgba, width, height }, (result: any) => {
      if (!result) return reject(new Error('HEIC display returned null'));
      resolve(result);
    });
  });

  return { data: Buffer.from(displayData.data), width: displayData.width, height: displayData.height };
}

export async function renderHeicToJpeg(inputPath: string, outputPath: string, options: HeicJpegOptions): Promise<void> {
  if (shouldPreferExternalHeic) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mda-heic-'));
    const tempJpeg = path.join(tempDir, 'source.jpg');
    try {
      await execFileAsync('heif-convert', [inputPath, tempJpeg]);
      const pipeline = sharp(tempJpeg).rotate();

      if (options.kind === 'cover') {
        await pipeline
          .resize(options.width, options.height, { fit: 'cover', position: 'center' })
          .jpeg({ quality: options.quality ?? config.thumbnailQuality })
          .toFile(outputPath);
        return;
      }

      await pipeline
        .resize(options.maxWidth, options.maxHeight, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: options.quality ?? config.previewQuality })
        .toFile(outputPath);
      return;
    } catch (error) {
      if (heicDecodeMode === 'external') {
        throw error;
      }
      // Fall back to libheif-js when auto mode is enabled.
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const decoded = await decodeHeicToRgba(inputPath);

  const pipeline = sharp(decoded.data, {
    raw: {
      width: decoded.width,
      height: decoded.height,
      channels: 4
    }
  });

  if (options.kind === 'cover') {
    await pipeline
      .resize(options.width, options.height, { fit: 'cover', position: 'center' })
      .jpeg({ quality: options.quality ?? config.thumbnailQuality })
      .toFile(outputPath);
    return;
  }

  await pipeline
    .resize(options.maxWidth, options.maxHeight, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: options.quality ?? config.previewQuality })
    .toFile(outputPath);
}

export async function generateThumbnail(filePath: string): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();
  const hash = crypto.createHash('md5').update(filePath).digest('hex');
  const thumbnailFileName = `${hash}.jpg`;
  const thumbnailPath = path.join(config.thumbnailCachePath, thumbnailFileName);

  // Check if thumbnail already exists
  try {
    const st = await fs.stat(thumbnailPath);
    if (st.size > 0) return thumbnailPath;
    await fs.unlink(thumbnailPath).catch(() => undefined);
  } catch {
    // Thumbnail doesn't exist, generate it
  }

  if (SUPPORTED_IMAGE_FORMATS.includes(ext)) {
    await generateImageThumbnail(filePath, thumbnailPath);
  } else if (SUPPORTED_VIDEO_FORMATS.includes(ext)) {
    await generateVideoThumbnail(filePath, thumbnailPath);
  } else {
    return null;
  }

  try {
    const st = await fs.stat(thumbnailPath);
    if (st.size > 0) return thumbnailPath;
    // Clean up empty/corrupt outputs so future attempts can retry.
    await fs.unlink(thumbnailPath).catch(() => undefined);
    return null;
  } catch {
    return null;
  }
}

async function generateImageThumbnail(inputPath: string, outputPath: string) {
  const ext = path.extname(inputPath).toLowerCase();

  // Fast path: let sharp handle the decode if it supports it.
  try {
    await sharp(inputPath)
      .rotate() // honor EXIF orientation where present
      .resize(config.thumbnailSize, config.thumbnailSize, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: config.thumbnailQuality })
      .toFile(outputPath);
    return;
  } catch (error: any) {
    if (ext !== '.heic') {
      console.error(`Error generating image thumbnail for ${inputPath}:`, error);
      throw error;
    }

    // Fallback: decode HEIC via libheif-js and re-encode with sharp.
    try {
      await renderHeicToJpeg(inputPath, outputPath, {
        kind: 'cover',
        width: config.thumbnailSize,
        height: config.thumbnailSize,
        quality: config.thumbnailQuality
      });
      return;
    } catch (fallbackError: any) {
      console.warn(`Skipping HEIC thumbnail generation for ${inputPath}: ${fallbackError?.message ?? String(fallbackError)}`);
      return; // Avoid worker retries; the asset can still be indexed.
    }
  }
}

async function generateVideoThumbnail(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        count: 1,
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: `${config.thumbnailSize}x${config.thumbnailSize}`
      })
      .on('end', () => resolve())
      .on('error', (err) => {
        console.error(`Error generating video thumbnail for ${inputPath}:`, err);
        reject(err);
      });
  });
}

export async function compressImage(inputPath: string, outputPath: string, quality: number = 80) {
  await sharp(inputPath)
    .jpeg({ quality })
    .toFile(outputPath);
}

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

export async function generateAndSaveThumbnail(filePath: string, assetId: string) {
  try {
    const thumbnailPath = await generateThumbnail(filePath);
    if (thumbnailPath) {
      await db.query('UPDATE media_assets SET thumbnail_path = $1, updated_at = NOW() WHERE id = $2', [thumbnailPath, assetId]);
      console.log(`✓ Updated thumbnail for asset ${assetId}`);
    }
  } catch (error) {
    console.error(`Failed to generate/save thumbnail for ${filePath}:`, error);
  }
}

export interface AdvancedCompressOptions {
  resolution?: string; // e.g. "1920x1080", "1280x720", "original"
  quality?: number;    // 1-100 for images; maps to CRF for videos
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

  let pipeline: sharp.Sharp;

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

/**
 * Compress a video with resolution and CRF options.
 * Preserves the original container format. Audio is copied (no re-encode).
 */
export async function compressVideoAdvanced(
  inputPath: string,
  outputPath: string,
  options: AdvancedCompressOptions & { onProgress?: (percent: number) => void }
): Promise<void> {
  // Map quality (1-100) to CRF (51-0). Higher quality = lower CRF.
  const quality = options.quality ?? 70;
  const crf = Math.round(51 - (quality / 100) * 51);

  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(inputPath);

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

    cmd
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('progress', (progress) => {
        if (options.onProgress && progress.percent != null) {
          options.onProgress(Math.min(Math.round(progress.percent), 100));
        }
      })
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}
