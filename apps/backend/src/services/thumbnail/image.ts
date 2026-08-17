import sharp from 'sharp';
import path from 'path';
import { config } from '../../config.js';
import { renderHeicToJpeg } from './heic.js';

export const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp', '.bmp'];

export async function generateImageThumbnail(inputPath: string, outputPath: string) {
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
