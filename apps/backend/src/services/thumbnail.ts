import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import { config } from '../config.js';

const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp', '.bmp'];
const SUPPORTED_VIDEO_FORMATS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];

export async function generateThumbnail(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const hash = crypto.createHash('md5').update(filePath).digest('hex');
  const thumbnailFileName = `${hash}.jpg`;
  const thumbnailPath = path.join(config.thumbnailCachePath, thumbnailFileName);

  // Check if thumbnail already exists
  try {
    await fs.access(thumbnailPath);
    return thumbnailPath;
  } catch {
    // Thumbnail doesn't exist, generate it
  }

  if (SUPPORTED_IMAGE_FORMATS.includes(ext)) {
    await generateImageThumbnail(filePath, thumbnailPath);
  } else if (SUPPORTED_VIDEO_FORMATS.includes(ext)) {
    await generateVideoThumbnail(filePath, thumbnailPath);
  }

  return thumbnailPath;
}

async function generateImageThumbnail(inputPath: string, outputPath: string) {
  try {
    await sharp(inputPath)
      .resize(300, 300, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 80 })
      .toFile(outputPath);
  } catch (error) {
    console.error(`Error generating image thumbnail for ${inputPath}:`, error);
    throw error;
  }
}

async function generateVideoThumbnail(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        count: 1,
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '300x300'
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
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}
