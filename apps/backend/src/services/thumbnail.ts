import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import { config } from '../config.js';
import { db } from '../db/index.js';

const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp', '.bmp'];
const SUPPORTED_VIDEO_FORMATS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];

type HeicJpegOptions =
  | { kind: 'cover'; width: number; height: number; quality?: number }
  | { kind: 'inside'; maxWidth: number; maxHeight: number; quality?: number };

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
