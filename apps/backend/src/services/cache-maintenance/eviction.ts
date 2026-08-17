import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '../../db/index.js';
import { listFiles, safeUnlink, removeEmptyDirectories } from './fs-utils.js';

export async function cleanupByAgeAndSize(options: {
  label: string;
  rootPath: string;
  maxAgeMs: number;
  maxBytes: number;
  recursive: boolean;
}): Promise<string[]> {
  const { label, rootPath, maxAgeMs, maxBytes, recursive } = options;
  await fs.mkdir(rootPath, { recursive: true });

  const now = Date.now();
  let files = await listFiles(rootPath, recursive);
  const deletedPaths: string[] = [];

  let ageDeleted = 0;
  if (maxAgeMs > 0) {
    const cutoff = now - maxAgeMs;
    for (const file of files) {
      if (file.mtimeMs < cutoff) {
        if (await safeUnlink(file.filePath)) {
          ageDeleted += 1;
          deletedPaths.push(file.filePath);
        }
      }
    }
    if (ageDeleted > 0) {
      files = await listFiles(rootPath, recursive);
    }
  }

  let sizeDeleted = 0;
  if (maxBytes > 0) {
    let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > maxBytes) {
      const sortedOldestFirst = [...files].sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const file of sortedOldestFirst) {
        if (totalBytes <= maxBytes) break;
        if (await safeUnlink(file.filePath)) {
          totalBytes -= file.size;
          sizeDeleted += 1;
          deletedPaths.push(file.filePath);
        }
      }
    }
  }

  if (recursive) {
    await removeEmptyDirectories(rootPath);
  }

  if (ageDeleted > 0 || sizeDeleted > 0) {
    console.log(`[CacheMaintenance] ${label}: deleted ${ageDeleted} by age, ${sizeDeleted} by size`);
  }

  return deletedPaths;
}

// Deleting cache files must also clear the DB references, otherwise the
// frontend renders broken <img> tags for thumbnails that no longer exist.
export async function clearDbReferences(column: 'thumbnail_path' | 'transcoded_path', deletedPaths: string[]) {
  if (deletedPaths.length === 0) return;
  try {
    const resolved = deletedPaths.map((p) => path.resolve(p));
    const allForms = resolved.concat(deletedPaths);
    await db.query(
      `UPDATE media_assets SET ${column} = NULL WHERE ${column} = ANY($1)`,
      [allForms]
    );
    if (column === 'thumbnail_path') {
      await db.query(
        'UPDATE trash_items SET thumbnail_path = NULL WHERE thumbnail_path = ANY($1)',
        [allForms]
      );
    }
  } catch (error) {
    console.warn(`[CacheMaintenance] Could not clear ${column} references:`, error);
  }
}

export async function cleanupOrphanThumbnails(thumbnailCachePath: string): Promise<void> {
  await fs.mkdir(thumbnailCachePath, { recursive: true });

  // Thumbnails referenced by live assets AND by trash items (kept so the
  // trash page can show what a deleted photo looked like).
  const result = await db.query(
    `SELECT thumbnail_path FROM media_assets WHERE thumbnail_path IS NOT NULL
     UNION
     SELECT thumbnail_path FROM trash_items WHERE thumbnail_path IS NOT NULL`
  );
  const referencedRows = result.rows
    .map((row) => row.thumbnail_path as string)
    .filter(Boolean)
    .map((raw) => ({ raw, resolved: path.resolve(raw) }));
  const referenced = new Set<string>(referencedRows.map((r) => r.resolved));

  const files = await listFiles(thumbnailCachePath, false);
  let deleted = 0;

  const existingOnDisk = new Set<string>();
  for (const file of files) {
    const resolved = path.resolve(file.filePath);
    if (file.size === 0 || !referenced.has(resolved)) {
      if (await safeUnlink(file.filePath)) deleted += 1;
    } else {
      existingOnDisk.add(resolved);
    }
  }

  if (deleted > 0) {
    console.log(`[CacheMaintenance] Thumbnails: deleted ${deleted} orphan/empty files`);
  }

  // Reverse sweep: DB rows pointing at thumbnail files that no longer exist
  // (e.g. removed by older cleanup runs) would render as broken images.
  const staleRawPaths = referencedRows
    .filter((r) => !existingOnDisk.has(r.resolved))
    .map((r) => r.raw);
  if (staleRawPaths.length > 0) {
    try {
      await db.query(
        'UPDATE media_assets SET thumbnail_path = NULL WHERE thumbnail_path = ANY($1)',
        [staleRawPaths]
      );
      console.log(`[CacheMaintenance] Thumbnails: cleared ${staleRawPaths.length} stale DB references`);
    } catch (error) {
      console.warn('[CacheMaintenance] Could not clear stale thumbnail references:', error);
    }
  }
}
