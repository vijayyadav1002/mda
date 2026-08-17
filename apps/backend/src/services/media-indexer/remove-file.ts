import path from 'node:path';
import { db } from '../../db/index.js';
import { cleanupDeletedAssetCaches } from '../media-cleanup.js';

export async function removeFile(filePath: string) {
  try {
    const deleted = await db.query(
      `DELETE FROM media_assets
       WHERE file_path = $1
       RETURNING id, file_path, thumbnail_path, transcoded_path`,
      [filePath]
    );

    if (deleted.rows.length > 0) {
      // Source file is already gone (watcher unlink), so skip transcode hash cleanup.
      await cleanupDeletedAssetCaches(deleted.rows[0], { removeTranscoded: false });
    }

    console.log(`✓ Removed from index: ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`Error removing file ${filePath} from index:`, error);
  }
}
