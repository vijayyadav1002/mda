import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { indexFile } from './media-indexer.js';

/**
 * Soft-delete trash bin. Deleted files/folders are moved (renamed) into a
 * hidden `.trash` directory inside the media library — dotfiles are ignored
 * by the indexer, the filesystem watcher, and the directory tree, and staying
 * on the same filesystem keeps the move an O(1) rename. Items are restorable
 * until they are explicitly purged or expire (config.trashRetentionDays).
 */

export type TrashItemRow = {
  id: number;
  original_path: string;
  trash_path: string;
  file_name: string;
  file_size: string | null;
  mime_type: string | null;
  item_type: 'file' | 'folder';
  deleted_by: number | null;
  deleted_at: Date;
};

export const getTrashDir = () => path.join(path.resolve(config.mediaLibraryPath), '.trash');

const uniqueTrashName = (name: string) =>
  `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${name}`;

export async function moveToTrash(options: {
  originalPath: string;
  itemType: 'file' | 'folder';
  fileName: string;
  fileSize?: string | number | null;
  mimeType?: string | null;
  deletedBy: number;
}): Promise<TrashItemRow> {
  const trashDir = getTrashDir();
  await fs.mkdir(trashDir, { recursive: true });

  const trashPath = path.join(trashDir, uniqueTrashName(options.fileName));
  await fs.rename(options.originalPath, trashPath);

  const result = await db.query(
    `INSERT INTO trash_items (original_path, trash_path, file_name, file_size, mime_type, item_type, deleted_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      options.originalPath,
      trashPath,
      options.fileName,
      options.fileSize ?? null,
      options.mimeType ?? null,
      options.itemType,
      options.deletedBy
    ]
  );
  return result.rows[0];
}

export async function listTrashItems(): Promise<TrashItemRow[]> {
  const result = await db.query('SELECT * FROM trash_items ORDER BY deleted_at DESC');
  return result.rows;
}

const getTrashItem = async (id: number): Promise<TrashItemRow> => {
  const result = await db.query('SELECT * FROM trash_items WHERE id = $1', [id]);
  if (result.rows.length === 0) throw new Error('Trash item not found');
  return result.rows[0];
};

// Re-index every media file inside a restored folder
async function reindexFolder(dirPath: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await reindexFolder(fullPath);
    } else if (entry.isFile()) {
      await indexFile(fullPath).catch(() => {});
    }
  }
}

/** Move an item back to its original location (or a "(restored)" sibling on conflict). */
export async function restoreTrashItem(id: number): Promise<string> {
  const item = await getTrashItem(id);

  let targetPath = item.original_path;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  // Original name taken again? Restore under a suffixed name instead.
  try {
    await fs.access(targetPath);
    const ext = item.item_type === 'file' ? path.extname(targetPath) : '';
    const base = ext ? targetPath.slice(0, -ext.length) : targetPath;
    targetPath = `${base} (restored ${Date.now()})${ext}`;
  } catch {
    // Target free — restore in place.
  }

  await fs.rename(item.trash_path, targetPath);
  await db.query('DELETE FROM trash_items WHERE id = $1', [id]);

  if (item.item_type === 'file') {
    await indexFile(targetPath).catch(() => {});
  } else {
    await reindexFolder(targetPath);
  }

  return targetPath;
}

/** Permanently delete a trash item from disk and the trash register. */
export async function purgeTrashItem(id: number): Promise<void> {
  const item = await getTrashItem(id);
  await fs.rm(item.trash_path, { recursive: true, force: true });
  await db.query('DELETE FROM trash_items WHERE id = $1', [id]);
}

/** Permanently delete everything in the trash. Returns purged count. */
export async function emptyTrash(): Promise<number> {
  const items = await listTrashItems();
  for (const item of items) {
    await fs.rm(item.trash_path, { recursive: true, force: true }).catch(() => {});
  }
  await db.query('DELETE FROM trash_items');
  return items.length;
}

/** Purge items older than the retention window (default 30 days). */
export async function purgeExpiredTrash(): Promise<number> {
  const result = await db.query(
    `SELECT * FROM trash_items WHERE deleted_at < NOW() - ($1 || ' days')::interval`,
    [config.trashRetentionDays]
  );
  for (const item of result.rows as TrashItemRow[]) {
    await fs.rm(item.trash_path, { recursive: true, force: true }).catch(() => {});
    await db.query('DELETE FROM trash_items WHERE id = $1', [item.id]);
  }
  if (result.rows.length > 0) {
    console.log(`[Trash] Purged ${result.rows.length} expired item(s) (retention ${config.trashRetentionDays} days)`);
  }
  return result.rows.length;
}
