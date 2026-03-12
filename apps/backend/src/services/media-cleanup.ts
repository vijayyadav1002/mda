import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { deleteTranscodedVideo } from './video-transcode.js';

export interface MediaAssetCleanupTarget {
  id: string | number;
  file_path: string;
  thumbnail_path?: string | null;
  transcoded_path?: string | null;
}

type CleanupOptions = {
  removeTranscoded?: boolean;
};

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn(`[Cleanup] Could not delete file ${filePath}:`, error);
    }
  }
}

export async function cleanupDeletedAssetCaches(
  asset: MediaAssetCleanupTarget,
  options: CleanupOptions = {}
) {
  const removeTranscoded = options.removeTranscoded !== false;
  const assetId = String(asset.id);

  if (asset.thumbnail_path) {
    await unlinkIfExists(asset.thumbnail_path);
  }

  if (asset.transcoded_path) {
    await unlinkIfExists(asset.transcoded_path);
  }

  const hlsDir = path.join(path.dirname(config.thumbnailCachePath), 'hls', assetId);
  await fs.rm(hlsDir, { recursive: true, force: true });

  if (removeTranscoded) {
    await deleteTranscodedVideo(asset.file_path, assetId);
  }
}
