import fs from 'fs/promises';
import path from 'path';
import { db } from '../../db/index.js';
import { config } from '../../config.js';
import { canThumbnailFile } from '../../services/file-types.js';
import { mapMediaAssetRow } from './media-mappers.js';

export const resolveLibraryPath = (requestedPath?: string | null) => {
  const rootPath = path.resolve(config.mediaLibraryPath);
  const targetPath = requestedPath ? path.resolve(requestedPath) : rootPath;

  if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error('Invalid directory path');
  }

  return targetPath;
};

export const buildDuplicatePath = async (
  destinationDir: string,
  name: string,
  options: { preserveExtension: boolean }
): Promise<string> => {
  const ext = options.preserveExtension ? path.extname(name) : '';
  const base = options.preserveExtension ? path.basename(name, ext) : name;
  for (let i = 1; i < 1000; i += 1) {
    const suffix = i === 1 ? ' copy' : ` copy ${i}`;
    const candidate = path.join(destinationDir, `${base}${suffix}${ext}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error('Could not choose a duplicate file name');
};

export const collectIndexableFiles = async (dirPath: string): Promise<string[]> => {
  const files: string[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    const stat = await fs.lstat(fullPath);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      files.push(...await collectIndexableFiles(fullPath));
    } else if (stat.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
};

export const listMediaFilesInDirectory = async (dirPath: string): Promise<string[]> => {
  const entries = (await fs.readdir(dirPath, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith('.'));

  const mediaFiles: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (canThumbnailFile(entry.name)) {
      mediaFiles.push(fullPath);
    }
  }

  return mediaFiles;
};

const getDirectorySizeFromDB = async (dirPath: string): Promise<number> => {
  const sep = dirPath.endsWith('/') ? '' : '/';
  const result = await db.query(
    `SELECT COALESCE(SUM(file_size), 0)::bigint AS total FROM media_assets WHERE file_path LIKE $1`,
    [`${dirPath}${sep}%`]
  );
  return Number(result.rows[0].total);
};

const SEARCH_MAX_FOLDER_DEPTH = 12;
export const SEARCH_HARD_CAP = 2000;

export const collectMatchingFolders = async (
  rootDir: string,
  matches: (folderName: string) => boolean,
  limit: number
): Promise<{ name: string; path: string; parentPath: string | null }[]> => {
  const results: { name: string; path: string; parentPath: string | null }[] = [];

  const walk = async (dir: string, depth: number, parent: string | null) => {
    if (results.length >= limit) return;
    if (depth > SEARCH_MAX_FOLDER_DEPTH) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.name.startsWith('.')) continue;
      if (!entry.isDirectory()) continue;

      const fullPath = path.join(dir, entry.name);
      if (matches(entry.name)) {
        results.push({ name: entry.name, path: fullPath, parentPath: dir });
      }
      await walk(fullPath, depth + 1, dir);
    }
  };

  await walk(rootDir, 0, null);
  return results;
};

export const buildDirectoryNode = async (dirPath: string): Promise<any> => {
  const stats = await fs.stat(dirPath);
  if (!stats.isDirectory()) {
    throw new Error('Path is not a directory');
  }

  const entries = (await fs.readdir(dirPath, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

  const filePaths = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dirPath, entry.name));

  const assetsByPath = new Map<string, any>();
  if (filePaths.length > 0) {
    const result = await db.query(
      'SELECT * FROM media_assets WHERE file_path = ANY($1::text[])',
      [filePaths]
    );

    for (const row of result.rows) {
      assetsByPath.set(row.file_path, row);
    }
  }

  const children = (
    await Promise.all(
      entries.map(async (entry) => {
        const childPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          const size = await getDirectorySizeFromDB(childPath);
          return { name: entry.name, path: childPath, type: 'directory', children: null, mediaAsset: null, size };
        }

        if (entry.isFile()) {
          const row = assetsByPath.get(childPath);
          return { name: entry.name, path: childPath, type: 'file', children: null, mediaAsset: row ? mapMediaAssetRow(row) : null, size: null };
        }

        return null;
      })
    )
  ).filter(Boolean);

  const rootSize = await getDirectorySizeFromDB(dirPath);
  return {
    name: path.basename(dirPath) || dirPath,
    path: dirPath,
    type: 'directory',
    children,
    size: rootSize
  };
};
