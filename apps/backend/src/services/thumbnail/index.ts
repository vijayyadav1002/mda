import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { generateImageThumbnail, SUPPORTED_IMAGE_FORMATS } from './image.js';
import { generateVideoThumbnail, SUPPORTED_VIDEO_FORMATS } from './video.js';
import { generateDocumentThumbnail, DOCUMENT_THUMBNAIL_FORMATS } from './pdf-doc.js';

export interface ThumbnailGenerationOptions {
  signal?: AbortSignal;
}

export async function generateThumbnail(
  filePath: string,
  options?: ThumbnailGenerationOptions
): Promise<string | null> {
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

  if (options?.signal?.aborted) return null;

  if (SUPPORTED_IMAGE_FORMATS.includes(ext)) {
    await generateImageThumbnail(filePath, thumbnailPath);
  } else if (SUPPORTED_VIDEO_FORMATS.includes(ext)) {
    await generateVideoThumbnail(filePath, thumbnailPath, options);
  } else if (DOCUMENT_THUMBNAIL_FORMATS.includes(ext)) {
    await generateDocumentThumbnail(filePath, thumbnailPath, options);
  } else {
    return null;
  }

  if (options?.signal?.aborted) {
    await fs.unlink(thumbnailPath).catch(() => undefined);
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

export async function generateAndSaveThumbnail(
  filePath: string,
  assetId: string,
  options?: ThumbnailGenerationOptions
) {
  try {
    const thumbnailPath = await generateThumbnail(filePath, options);
    if (options?.signal?.aborted) return;
    if (thumbnailPath) {
      await db.query('UPDATE media_assets SET thumbnail_path = $1, updated_at = NOW() WHERE id = $2', [thumbnailPath, assetId]);
      console.log(`✓ Updated thumbnail for asset ${assetId}`);
    }
  } catch (error) {
    if (options?.signal?.aborted) return; // Cancellation is expected — don't log as failure.
    console.error(`Failed to generate/save thumbnail for ${filePath}:`, error);
  }
}

export { renderHeicToJpeg } from './heic.js';
export { compressImage, compressImageAdvanced, type AdvancedCompressOptions } from './compress-image.js';
export { compressVideo, compressVideoAdvanced } from './compress-video.js';
export { compressPdfAdvanced } from './compress-pdf.js';
