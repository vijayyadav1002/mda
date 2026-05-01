import { db } from '../db/index.js';
import { hashPassword, verifyPassword } from '../services/auth.js';
import { logAudit } from '../services/audit.js';
import { compressImage, compressVideo, compressImageAdvanced, compressVideoAdvanced } from '../services/thumbnail.js';
import { enqueueMediaRefresh, addToThumbnailQueue, cancelThumbnailSession } from '../services/queue.js';
import { cleanupDeletedAssetCaches } from '../services/media-cleanup.js';
import { getCacheStats, clearCacheByType } from '../services/cache-maintenance.js';
import { indexFile } from '../services/media-indexer.js';
import {
  normalizeTagName,
  upsertTag,
  attachTags,
  detachTag,
  listTags,
  getTagByName,
  getTagsForAssets,
  getAssetsByTagName,
  deleteTagByName,
  renameTag as renameTagService
} from '../services/tags.js';
import type { GraphQLContext } from './context.js';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp', '.bmp'];
const SUPPORTED_VIDEO_FORMATS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
const SUPPORTED_FORMATS = new Set([...SUPPORTED_IMAGE_FORMATS, ...SUPPORTED_VIDEO_FORMATS]);

const mapMediaAssetRow = (row: any) => ({
  id: row.id,
  filePath: row.file_path,
  fileName: row.file_name,
  fileSize: row.file_size.toString(),
  mimeType: row.mime_type,
  width: row.width,
  height: row.height,
  duration: row.duration,
  thumbnailPath: row.thumbnail_path,
  thumbnailUrl: row.thumbnail_path ? `/thumbnails/${path.basename(row.thumbnail_path)}` : null,
  transcodedPath: row.transcoded_path,
  transcodedUrl: row.transcoded_path ? `/transcoded/${path.basename(row.transcoded_path)}` : null,
  indexedAt: row.indexed_at.toISOString(),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
});

const mapTagRow = (row: any) => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  assetCount: typeof row.asset_count === 'number' ? row.asset_count : 0
});

const cleanupCompressPreviewFiles = async (previewDir: string, ids: string[]) => {
  if (ids.length === 0) return;
  let entries: string[];
  try {
    entries = await fs.readdir(previewDir);
  } catch {
    return;
  }

  const idSet = new Set(ids);
  const deletions = entries
    .filter((name) => {
      const markerIndex = name.lastIndexOf('_preview');
      if (markerIndex <= 0) return false;
      const assetId = name.slice(0, markerIndex);
      return idSet.has(assetId);
    })
    .map((name) => fs.unlink(path.join(previewDir, name)).catch(() => {}));

  await Promise.all(deletions);
};

const resolveLibraryPath = (requestedPath?: string | null) => {
  const rootPath = path.resolve(config.mediaLibraryPath);
  const targetPath = requestedPath ? path.resolve(requestedPath) : rootPath;

  if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error('Invalid directory path');
  }

  return targetPath;
};

const listMediaFilesInDirectory = async (dirPath: string): Promise<string[]> => {
  const entries = (await fs.readdir(dirPath, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith('.'));

  const mediaFiles: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(dirPath, entry.name);
    const ext = path.extname(entry.name).toLowerCase();
    if (SUPPORTED_FORMATS.has(ext)) {
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
const SEARCH_HARD_CAP = 2000;

const collectMatchingFolders = async (
  rootDir: string,
  needleLower: string,
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
      if (entry.name.toLowerCase().includes(needleLower)) {
        results.push({ name: entry.name, path: fullPath, parentPath: dir });
      }
      await walk(fullPath, depth + 1, dir);
    }
  };

  await walk(rootDir, 0, null);
  return results;
};

const buildDirectoryNode = async (dirPath: string): Promise<any> => {
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

  const mediaFilePaths = filePaths.filter((filePath) => SUPPORTED_FORMATS.has(path.extname(filePath).toLowerCase()));

  const assetsByPath = new Map<string, any>();
  if (mediaFilePaths.length > 0) {
    const result = await db.query(
      'SELECT * FROM media_assets WHERE file_path = ANY($1::text[])',
      [mediaFilePaths]
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

export const resolvers = {
  Query: {
    me: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.user) throw new Error('Unauthorized');
      
      const result = await db.query(
        'SELECT id, username, role, created_at FROM users WHERE id = $1',
        [context.user.id]
      );
      
      if (result.rows.length === 0) throw new Error('User not found');
      
      return {
        id: result.rows[0].id,
        username: result.rows[0].username,
        role: result.rows[0].role,
        createdAt: result.rows[0].created_at.toISOString()
      };
    },

    hasAdminUser: async () => {
      const result = await db.query('SELECT COUNT(*) FROM users WHERE role = $1', ['admin']);
      const adminCount = parseInt(result.rows[0].count, 10);
      return adminCount > 0;
    },

    users: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }

      const result = await db.query(
        'SELECT id, username, role, created_at FROM users ORDER BY created_at DESC'
      );

      return result.rows.map(row => ({
        id: row.id,
        username: row.username,
        role: row.role,
        createdAt: row.created_at.toISOString()
      }));
    },

    mediaAssets: async (_: any, args: { limit?: number; offset?: number; mimeType?: string }, context: GraphQLContext) => {
      if (!context.user) throw new Error('Unauthorized');

      const limit = args.limit || 50;
      const offset = args.offset || 0;
      
      let query = 'SELECT * FROM media_assets';
      const params: any[] = [];
      
      if (args.mimeType) {
        query += ' WHERE mime_type LIKE $1';
        params.push(`${args.mimeType}%`);
      }
      
      query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limit, offset);

      const result = await db.query(query, params);

      return result.rows.map(mapMediaAssetRow);
    },

    mediaAsset: async (_: any, args: { id: string }, context: GraphQLContext) => {
      if (!context.user) throw new Error('Unauthorized');

      const result = await db.query('SELECT * FROM media_assets WHERE id = $1', [args.id]);
      
      if (result.rows.length === 0) throw new Error('Media asset not found');
      
      return mapMediaAssetRow(result.rows[0]);
    },

    directoryTree: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.user) throw new Error('Unauthorized');
      const rootPath = resolveLibraryPath(null);
      return buildDirectoryNode(rootPath);
    },

    directoryNode: async (_: any, args: { path?: string | null }, context: GraphQLContext) => {
      if (!context.user) throw new Error('Unauthorized');
      const targetPath = resolveLibraryPath(args.path ?? null);
      return buildDirectoryNode(targetPath);
    },

    auditLogs: async (_: any, args: { limit?: number; offset?: number }, context: GraphQLContext) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }

      const limit = args.limit || 50;
      const offset = args.offset || 0;

      const result = await db.query(
        `SELECT al.*, u.username, u.role 
         FROM audit_logs al 
         LEFT JOIN users u ON al.user_id = u.id 
         ORDER BY al.created_at DESC 
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      return result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        user: row.username ? {
          id: row.user_id,
          username: row.username,
          role: row.role
        } : null,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        details: row.details ? JSON.stringify(row.details) : null,
        createdAt: row.created_at.toISOString()
      }));
    },

    tags: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.user) throw new Error('Unauthorized');
      const rows = await listTags();
      return rows.map(mapTagRow);
    },

    mediaAssetsByTag: async (
      _: any,
      args: { tagName: string; limit?: number; offset?: number },
      context: GraphQLContext
    ) => {
      if (!context.user) throw new Error('Unauthorized');
      const limit = args.limit || 50;
      const offset = args.offset || 0;
      const rows = await getAssetsByTagName(args.tagName, limit, offset);
      return rows.map(mapMediaAssetRow);
    },

    cacheStats: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return getCacheStats();
    },

    search: async (
      _: any,
      args: { term?: string; mediaType?: string; sortBy?: string; limit?: number; minSize?: number; maxSize?: number },
      context: GraphQLContext
    ) => {
      if (!context.user) throw new Error('Unauthorized');

      const trimmed = (args.term ?? '').trim();
      const mediaType = args.mediaType === 'image' || args.mediaType === 'video' ? args.mediaType : null;
      const sortBy = ['size-asc', 'size-desc', 'date-asc', 'date-desc'].includes(args.sortBy ?? '')
        ? args.sortBy!
        : null;

      const minSize = typeof args.minSize === 'number' && args.minSize > 0 ? Math.floor(args.minSize) : null;
      const maxSize = typeof args.maxSize === 'number' && args.maxSize > 0 ? Math.floor(args.maxSize) : null;

      if (trimmed.length === 0 && !mediaType && !minSize && !maxSize) {
        return { files: [], folders: [] };
      }

      const requestedLimit = args.limit ?? 25;
      const limit = requestedLimit <= 0
        ? SEARCH_HARD_CAP
        : Math.min(Math.max(requestedLimit, 1), SEARCH_HARD_CAP);
      const folderSearchLimit = requestedLimit <= 0 ? 200 : limit;

      const queryParams: unknown[] = [];
      const conditions: string[] = [];

      if (trimmed.length > 0) {
        const escapedTerm = trimmed.replace(/[\\%_]/g, (ch) => `\\${ch}`);
        queryParams.push(`%${escapedTerm}%`);
        conditions.push(`file_name ILIKE $${queryParams.length} ESCAPE '\\'`);
      }

      if (mediaType) {
        queryParams.push(`${mediaType}/%`);
        conditions.push(`mime_type LIKE $${queryParams.length}`);
      }

      if (minSize !== null) {
        queryParams.push(minSize);
        conditions.push(`file_size >= $${queryParams.length}`);
      }

      if (maxSize !== null) {
        queryParams.push(maxSize);
        conditions.push(`file_size <= $${queryParams.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      let orderClause: string;
      if (sortBy === 'size-asc') {
        orderClause = 'ORDER BY file_size ASC, file_name ASC';
      } else if (sortBy === 'size-desc') {
        orderClause = 'ORDER BY file_size DESC, file_name ASC';
      } else if (sortBy === 'date-asc') {
        orderClause = 'ORDER BY created_at ASC';
      } else if (sortBy === 'date-desc') {
        orderClause = 'ORDER BY created_at DESC';
      } else if (trimmed.length > 0) {
        const escapedTerm = trimmed.replace(/[\\%_]/g, (ch) => `\\${ch}`);
        const base = queryParams.length;
        queryParams.push(trimmed, `${escapedTerm}%`);
        orderClause = `ORDER BY CASE WHEN LOWER(file_name) = LOWER($${base + 1}) THEN 0 WHEN LOWER(file_name) LIKE LOWER($${base + 2}) THEN 1 ELSE 2 END, file_name ASC`;
      } else {
        orderClause = 'ORDER BY file_name ASC';
      }

      queryParams.push(limit);
      const fileResult = await db.query(
        `SELECT * FROM media_assets ${whereClause} ${orderClause} LIMIT $${queryParams.length}`,
        queryParams
      );

      // Only search folders when there's a text term (folders have no media type)
      const folders = trimmed.length > 0 && !mediaType
        ? await collectMatchingFolders(resolveLibraryPath(null), trimmed.toLowerCase(), folderSearchLimit)
        : [];

      return {
        files: fileResult.rows.map(mapMediaAssetRow),
        folders: folders.map((f) => ({
          name: f.name,
          path: f.path,
          parentPath: f.parentPath
        }))
      };
    }
  },

  MediaAsset: {
    tags: async (parent: { id: string | number }) => {
      const assetId = typeof parent.id === 'number' ? parent.id : parseInt(String(parent.id), 10);
      if (!Number.isFinite(assetId)) return [];
      const map = await getTagsForAssets([assetId]);
      const tags = map.get(assetId) ?? [];
      return tags.map(mapTagRow);
    }
  },

  Mutation: {
    login: async (_: any, args: { username: string; password: string }, context: GraphQLContext) => {
      const result = await db.query(
        'SELECT * FROM users WHERE username = $1',
        [args.username]
      );

      if (result.rows.length === 0) {
        throw new Error('Invalid credentials');
      }

      const user = result.rows[0];
      const valid = await verifyPassword(args.password, user.password_hash);

      if (!valid) {
        throw new Error('Invalid credentials');
      }

      const token = context.reply.jwtSign({
        id: user.id,
        username: user.username,
        role: user.role
      });

      await logAudit(user.id, 'LOGIN', 'user', user.id);

      return {
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          createdAt: user.created_at.toISOString()
        }
      };
    },

    createFirstAdmin: async (_: any, args: { username: string; password: string }, context: GraphQLContext) => {
      // Check if any admin exists
      const adminCheck = await db.query('SELECT COUNT(*) FROM users WHERE role = $1', ['admin']);
      const adminCount = parseInt(adminCheck.rows[0].count, 10);

      if (adminCount > 0) {
        throw new Error('Admin already exists. Please login.');
      }

      const passwordHash = await hashPassword(args.password);

      const result = await db.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING *',
        [args.username, passwordHash, 'admin']
      );

      const user = result.rows[0];

      const token = context.reply.jwtSign({
        id: user.id,
        username: user.username,
        role: user.role
      });

      await logAudit(user.id, 'CREATE_FIRST_ADMIN', 'user', user.id);

      return {
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          createdAt: user.created_at.toISOString()
        }
      };
    },

    createUser: async (_: any, args: { username: string; password: string; role: string }, context: GraphQLContext) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }

      if (!['admin', 'editor', 'readonly'].includes(args.role)) {
        throw new Error('Invalid role. Must be admin, editor, or readonly');
      }

      const passwordHash = await hashPassword(args.password);

      const result = await db.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING *',
        [args.username, passwordHash, args.role]
      );

      const user = result.rows[0];

      await logAudit(context.user.id, 'CREATE_USER', 'user', user.id, {
        username: args.username,
        role: args.role
      });

      return {
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.created_at.toISOString()
      };
    },

    updateUserRole: async (_: any, args: { id: string; role: string }, context: GraphQLContext) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }

      if (!['admin', 'editor', 'readonly'].includes(args.role)) {
        throw new Error('Invalid role. Must be admin, editor, or readonly');
      }

      if (context.user.id === Number.parseInt(args.id, 10)) {
        throw new Error('Cannot change your own role');
      }

      const result = await db.query(
        'UPDATE users SET role = $1 WHERE id = $2 RETURNING *',
        [args.role, args.id]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      const user = result.rows[0];

      await logAudit(context.user.id, 'UPDATE_USER_ROLE', 'user', user.id, {
        newRole: args.role
      });

      return {
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.created_at.toISOString()
      };
    },

    resetPassword: async (_: any, args: { userId: string; newPassword: string }, context: GraphQLContext) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }

      const passwordHash = await hashPassword(args.newPassword);

      const result = await db.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [passwordHash, args.userId]
      );

      if (result.rowCount === 0) {
        throw new Error('User not found');
      }

      await logAudit(context.user.id, 'RESET_PASSWORD', 'user', Number.parseInt(args.userId, 10));

      return true;
    },

    changeMyPassword: async (_: any, args: { currentPassword: string; newPassword: string }, context: GraphQLContext) => {
      if (!context.user) {
        throw new Error('Unauthorized');
      }

      const userResult = await db.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [context.user.id]
      );

      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const isValid = await verifyPassword(args.currentPassword, userResult.rows[0].password_hash);
      
      if (!isValid) {
        throw new Error('Current password is incorrect');
      }

      const passwordHash = await hashPassword(args.newPassword);

      await db.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [passwordHash, context.user.id]
      );

      await logAudit(context.user.id, 'CHANGE_PASSWORD', 'user', context.user.id);

      return true;
    },

    deleteUser: async (_: any, args: { id: string }, context: GraphQLContext) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }

      if (context.user.id === Number.parseInt(args.id, 10)) {
        throw new Error('Cannot delete yourself');
      }

      await db.query('DELETE FROM users WHERE id = $1', [args.id]);

      await logAudit(context.user.id, 'DELETE_USER', 'user', Number.parseInt(args.id, 10));

      return true;
    },

    moveMediaAsset: async (_: any, args: { id: string; newPath: string }, context: GraphQLContext) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const result = await db.query('SELECT * FROM media_assets WHERE id = $1', [args.id]);
      
      if (result.rows.length === 0) throw new Error('Media asset not found');

      const asset = result.rows[0];
      const oldPath = asset.file_path;

      // Move the file
      await fs.rename(oldPath, args.newPath);

      // Update database
      await db.query(
        'UPDATE media_assets SET file_path = $1, updated_at = NOW() WHERE id = $2',
        [args.newPath, args.id]
      );

      await logAudit(context.user.id, 'MOVE_ASSET', 'media_asset', parseInt(args.id, 10), {
        oldPath,
        newPath: args.newPath
      });

      const updated = await db.query('SELECT * FROM media_assets WHERE id = $1', [args.id]);
      const row = updated.rows[0];

      return {
        id: row.id,
        filePath: row.file_path,
        fileName: row.file_name,
        fileSize: row.file_size.toString(),
        mimeType: row.mime_type,
        thumbnailUrl: row.thumbnail_path ? `/thumbnails/${path.basename(row.thumbnail_path)}` : null,
        indexedAt: row.indexed_at.toISOString(),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      };
    },

    renameMediaAsset: async (_: any, args: { id: string; newName: string }, context: GraphQLContext) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const result = await db.query('SELECT * FROM media_assets WHERE id = $1', [args.id]);
      
      if (result.rows.length === 0) throw new Error('Media asset not found');

      const asset = result.rows[0];
      const oldPath = asset.file_path;
      const newPath = path.join(path.dirname(oldPath), args.newName);

      // Rename the file
      await fs.rename(oldPath, newPath);

      // Update database
      await db.query(
        'UPDATE media_assets SET file_path = $1, file_name = $2, updated_at = NOW() WHERE id = $3',
        [newPath, args.newName, args.id]
      );

      await logAudit(context.user.id, 'RENAME_ASSET', 'media_asset', parseInt(args.id, 10), {
        oldName: asset.file_name,
        newName: args.newName
      });

      const updated = await db.query('SELECT * FROM media_assets WHERE id = $1', [args.id]);
      const row = updated.rows[0];

      return {
        id: row.id,
        filePath: row.file_path,
        fileName: row.file_name,
        fileSize: row.file_size.toString(),
        mimeType: row.mime_type,
        thumbnailUrl: row.thumbnail_path ? `/thumbnails/${path.basename(row.thumbnail_path)}` : null,
        indexedAt: row.indexed_at.toISOString(),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      };
    },

    deleteMediaAsset: async (_: any, args: { id: string }, context: GraphQLContext) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const result = await db.query('SELECT * FROM media_assets WHERE id = $1', [args.id]);
      
      if (result.rows.length === 0) throw new Error('Media asset not found');

      const asset = result.rows[0];

      // Remove generated caches first while source file metadata is still available.
      await cleanupDeletedAssetCaches(asset, { removeTranscoded: true });

      // Delete the file
      try {
        await fs.unlink(asset.file_path);
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }

      // Delete from database
      await db.query('DELETE FROM media_assets WHERE id = $1', [args.id]);

      await logAudit(context.user.id, 'DELETE_ASSET', 'media_asset', parseInt(args.id, 10), {
        filePath: asset.file_path
      });

      return true;
    },

    compressMediaAsset: async (
      _: any,
      args: { id: string; quality?: number; overwrite?: boolean },
      context: GraphQLContext
    ) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const result = await db.query('SELECT * FROM media_assets WHERE id = $1', [args.id]);
      
      if (result.rows.length === 0) throw new Error('Media asset not found');

      const asset = result.rows[0];
      const quality = args.quality || 80;
      const overwrite = args.overwrite !== false;

      let outputPath: string;
      if (overwrite) {
        outputPath = asset.file_path;
        const tempPath = asset.file_path + '.temp';
        
        if (asset.mime_type.startsWith('image/')) {
          await compressImage(asset.file_path, tempPath, quality);
          await fs.rename(tempPath, outputPath);
        } else if (asset.mime_type.startsWith('video/')) {
          await compressVideo(asset.file_path, tempPath);
          await fs.rename(tempPath, outputPath);
        } else {
          throw new Error('Unsupported media type for compression');
        }
      } else {
        const ext = path.extname(asset.file_path);
        const baseName = path.basename(asset.file_path, ext);
        const dirName = path.dirname(asset.file_path);
        outputPath = path.join(dirName, `${baseName}_compressed${ext}`);

        if (asset.mime_type.startsWith('image/')) {
          await compressImage(asset.file_path, outputPath, quality);
        } else if (asset.mime_type.startsWith('video/')) {
          await compressVideo(asset.file_path, outputPath);
        } else {
          throw new Error('Unsupported media type for compression');
        }
      }

      // Update database if overwritten, or create new entry if derivative
      if (overwrite) {
        const stats = await fs.stat(outputPath);
        await db.query(
          'UPDATE media_assets SET file_size = $1, updated_at = NOW() WHERE id = $2',
          [stats.size, args.id]
        );
      }

      await logAudit(context.user.id, 'COMPRESS_ASSET', 'media_asset', parseInt(args.id, 10), {
        quality,
        overwrite
      });

      const updated = await db.query('SELECT * FROM media_assets WHERE id = $1', [args.id]);
      const row = updated.rows[0];

      return {
        id: row.id,
        filePath: row.file_path,
        fileName: row.file_name,
        fileSize: row.file_size.toString(),
        mimeType: row.mime_type,
        thumbnailUrl: row.thumbnail_path ? `/thumbnails/${path.basename(row.thumbnail_path)}` : null,
        indexedAt: row.indexed_at.toISOString(),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      };
    },

    refreshMediaLibrary: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      try {
        const result = await enqueueMediaRefresh({ requestedByUserId: context.user.id });
        console.log(`[GRAPHQL] ${result.message}`);
        return result.message;
      } catch (error) {
        console.error('[GRAPHQL] Error refreshing media library:', error);
        throw new Error(`Failed to refresh media library: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },

    generateThumbnailsForPath: async (_: any, args: { path?: string | null }, context: GraphQLContext) => {
      if (!context.user) throw new Error('Unauthorized');

      const targetPath = resolveLibraryPath(args.path ?? null);
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        throw new Error('Path is not a directory');
      }

      const mediaFiles = await listMediaFilesInDirectory(targetPath);
      let queuedCount = 0;
      const BATCH_SIZE = 10;
      const BATCH_DELAY_MS = 200; // Throttle job production to prevent queue explosion

      // Process in batches with delay to keep queue manageable and CPU responsive
      for (let i = 0; i < mediaFiles.length; i += BATCH_SIZE) {
        const batch = mediaFiles.slice(i, i + BATCH_SIZE);
        
        for (const filePath of batch) {
          try {
            const result = await indexFile(filePath, { queueThumbnails: true, requeueMissingThumbnails: true });
            if (result === 'indexed' || result === 'thumbnail_requeued') {
              queuedCount += 1;
            }
          } catch (error) {
            console.warn(`[GenerateThumbnails] Failed for ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        // Delay before next batch to throttle job production (except on last batch)
        if (i + BATCH_SIZE < mediaFiles.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      return queuedCount;
    },

    generateThumbnailsForAssets: async (_: any, args: { ids: string[]; sessionId?: string | null }, context: GraphQLContext) => {
      if (!context.user) throw new Error('Unauthorized');

      const numericIds = Array.from(
        new Set(
          (args.ids ?? [])
            .map((raw) => Number.parseInt(String(raw), 10))
            .filter((n) => Number.isInteger(n) && n > 0)
        )
      );
      if (numericIds.length === 0) return 0;

      // Cap the number of ids we consider per call so a malicious or buggy
      // client cannot ask us to re-queue the entire library in one request.
      const MAX_IDS_PER_CALL = 200;
      const boundedIds = numericIds.slice(0, MAX_IDS_PER_CALL);

      // Fetch asset rows for the requested ids. Only queue thumbnails for assets
      // that are currently missing a usable thumbnail file on disk so repeated
      // viewport requests don't re-queue the same work.
      const result = await db.query(
        'SELECT id, file_path, thumbnail_path, mime_type FROM media_assets WHERE id = ANY($1::int[])',
        [boundedIds]
      );

      let queuedCount = 0;
      for (const row of result.rows) {
        const thumbPath = row.thumbnail_path as string | null;
        let hasUsableThumbnail = false;
        if (thumbPath) {
          try {
            const thumbStat = await fs.stat(thumbPath);
            hasUsableThumbnail = thumbStat.size > 0;
          } catch {
            hasUsableThumbnail = false;
          }
        }
        if (hasUsableThumbnail) continue;

        const filePath = row.file_path as string;
        const ext = path.extname(filePath).toLowerCase();
        if (!SUPPORTED_FORMATS.has(ext)) continue;

        const mimeType = (row.mime_type as string | null) ?? '';
        const isVideo = mimeType.startsWith('video/') || SUPPORTED_VIDEO_FORMATS.includes(ext);

        try {
          await addToThumbnailQueue({
            filePath,
            assetId: String(row.id),
            mediaType: isVideo ? 'video' : 'image',
            sessionId: args.sessionId ?? undefined
          });
          queuedCount += 1;
        } catch (error) {
          console.warn(`[GenerateThumbnailsForAssets] Failed to queue ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return queuedCount;
    },

    cancelThumbnailJobsForSession: async (_: any, args: { sessionId: string }, context: GraphQLContext) => {
      if (!context.user) throw new Error('Unauthorized');
      if (!args.sessionId || typeof args.sessionId !== 'string') return 0;
      try {
        return await cancelThumbnailSession(args.sessionId);
      } catch (error) {
        console.warn(`[CancelThumbnailJobsForSession] Failed: ${error instanceof Error ? error.message : String(error)}`);
        return 0;
      }
    },

    previewCompressAssets: async (
      _: any,
      args: { ids: string[]; options: { resolution?: string; quality?: number } },
      context: GraphQLContext
    ) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const previewDir = path.resolve(path.dirname(config.thumbnailCachePath), 'compress-preview');
      await fs.mkdir(previewDir, { recursive: true });

      const results = [];

      for (const id of args.ids) {
        const result = await db.query('SELECT * FROM media_assets WHERE id = $1', [id]);
        if (result.rows.length === 0) {
          throw new Error(`Media asset not found: ${id}`);
        }

        const asset = result.rows[0];
        const ext = path.extname(asset.file_path).toLowerCase();
        // HEIC outputs as jpeg in preview
        const previewExt = ext === '.heic' ? '.jpg' : ext;
        const previewFileName = `${id}_preview${previewExt}`;
        const previewPath = path.join(previewDir, previewFileName);

        const originalStats = await fs.stat(asset.file_path);

        if (asset.mime_type.startsWith('image/')) {
          await compressImageAdvanced(asset.file_path, previewPath, {
            resolution: args.options.resolution,
            quality: args.options.quality
          });
        } else if (asset.mime_type.startsWith('video/')) {
          await compressVideoAdvanced(asset.file_path, previewPath, {
            resolution: args.options.resolution,
            quality: args.options.quality
          });
        } else {
          throw new Error(`Unsupported media type for compression: ${asset.mime_type}`);
        }

        const compressedStats = await fs.stat(previewPath);

        results.push({
          assetId: id,
          originalSize: originalStats.size.toString(),
          compressedSize: compressedStats.size.toString(),
          previewUrl: `/compress-preview/${previewFileName}`
        });
      }

      await logAudit(context.user.id, 'PREVIEW_COMPRESS_ASSETS', 'media_asset', undefined, {
        ids: args.ids,
        options: args.options
      });

      return results;
    },

    confirmCompressReplace: async (
      _: any,
      args: { ids: string[] },
      context: GraphQLContext
    ) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const previewDir = path.resolve(path.dirname(config.thumbnailCachePath), 'compress-preview');
      const results = [];

      for (const id of args.ids) {
        const result = await db.query('SELECT * FROM media_assets WHERE id = $1', [id]);
        if (result.rows.length === 0) {
          throw new Error(`Media asset not found: ${id}`);
        }

        const asset = result.rows[0];
        const ext = path.extname(asset.file_path).toLowerCase();
        const previewExt = ext === '.heic' ? '.jpg' : ext;
        const previewFileName = `${id}_preview${previewExt}`;
        const previewPath = path.join(previewDir, previewFileName);

        // Check preview file exists
        try {
          await fs.access(previewPath);
        } catch {
          throw new Error(`No preview found for asset ${id}. Run previewCompressAssets first.`);
        }

        // Read original timestamps
        const originalStats = await fs.stat(asset.file_path);
        const originalAtime = originalStats.atime;
        const originalMtime = originalStats.mtime;

        // Determine the final file path (HEIC gets renamed to .jpg)
        let finalFilePath = asset.file_path;
        let finalFileName = asset.file_name;
        let finalMimeType = asset.mime_type;

        if (ext === '.heic') {
          // The compressed output is JPEG, so rename the file
          finalFilePath = asset.file_path.replace(/\.heic$/i, '.jpg');
          finalFileName = asset.file_name.replace(/\.heic$/i, '.jpg');
          finalMimeType = 'image/jpeg';
        }

        // Copy compressed preview to the final path
        await fs.copyFile(previewPath, finalFilePath);

        // If HEIC was converted, remove the original .heic file
        if (ext === '.heic' && finalFilePath !== asset.file_path) {
          await fs.unlink(asset.file_path).catch(() => {});
        }

        // Restore original timestamps on the new file
        await fs.utimes(finalFilePath, originalAtime, originalMtime);

        // Update DB: file_size, and if format changed, also file_path, file_name, mime_type
        const newStats = await fs.stat(finalFilePath);
        await db.query(
          'UPDATE media_assets SET file_size = $1, file_path = $2, file_name = $3, mime_type = $4 WHERE id = $5',
          [newStats.size, finalFilePath, finalFileName, finalMimeType, id]
        );

        // Clean up preview file
        await fs.unlink(previewPath).catch(() => {});
        await cleanupCompressPreviewFiles(previewDir, [id]);

        const updated = await db.query('SELECT * FROM media_assets WHERE id = $1', [id]);
        results.push(mapMediaAssetRow(updated.rows[0]));
      }

      await logAudit(context.user.id, 'CONFIRM_COMPRESS_REPLACE', 'media_asset', undefined, {
        ids: args.ids
      });

      return results;
    },

    cancelCompressPreview: async (
      _: any,
      args: { ids: string[] },
      context: GraphQLContext
    ) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const previewDir = path.resolve(path.dirname(config.thumbnailCachePath), 'compress-preview');

      for (const id of args.ids) {
        // Try common extensions
        const result = await db.query('SELECT file_path FROM media_assets WHERE id = $1', [id]);
        if (result.rows.length > 0) {
          const ext = path.extname(result.rows[0].file_path).toLowerCase();
          const previewExt = ext === '.heic' ? '.jpg' : ext;
          const previewPath = path.join(previewDir, `${id}_preview${previewExt}`);
          await fs.unlink(previewPath).catch(() => {});
        }
        await cleanupCompressPreviewFiles(previewDir, [id]);
      }

      return true;
    },

    createFolder: async (
      _: any,
      args: { parentPath?: string | null; name: string },
      context: GraphQLContext
    ) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      if (!args.name || /[/\\]/.test(args.name) || args.name.startsWith('.')) {
        throw new Error('Invalid folder name');
      }

      const parentPath = resolveLibraryPath(args.parentPath ?? null);
      const newFolderPath = path.join(parentPath, args.name);

      // Ensure new path is still within library
      const rootPath = path.resolve(config.mediaLibraryPath);
      if (newFolderPath !== rootPath && !newFolderPath.startsWith(`${rootPath}${path.sep}`)) {
        throw new Error('Invalid directory path');
      }

      await fs.mkdir(newFolderPath);

      await logAudit(context.user.id, 'CREATE_FOLDER', 'directory', undefined, {
        path: newFolderPath
      });

      return {
        name: args.name,
        path: newFolderPath,
        type: 'directory',
        children: []
      };
    },

    deleteFolder: async (
      _: any,
      args: { path: string },
      context: GraphQLContext
    ) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const targetPath = resolveLibraryPath(args.path);
      const rootPath = path.resolve(config.mediaLibraryPath);

      if (targetPath === rootPath) {
        throw new Error('Cannot delete the root library folder');
      }

      // Find all media assets within this folder
      const assetsResult = await db.query(
        'SELECT * FROM media_assets WHERE file_path LIKE $1',
        [`${targetPath}${path.sep}%`]
      );

      // Clean up caches for each asset
      for (const asset of assetsResult.rows) {
        await cleanupDeletedAssetCaches(asset, { removeTranscoded: true }).catch(() => {});
      }

      // Remove assets from database
      if (assetsResult.rows.length > 0) {
        await db.query(
          'DELETE FROM media_assets WHERE file_path LIKE $1',
          [`${targetPath}${path.sep}%`]
        );
      }

      // Delete folder from filesystem
      await fs.rm(targetPath, { recursive: true, force: true });

      await logAudit(context.user.id, 'DELETE_FOLDER', 'directory', undefined, {
        path: targetPath,
        assetsDeleted: assetsResult.rows.length
      });

      return true;
    },

    applyTagsToAssets: async (
      _: any,
      args: { assetIds: string[]; tagNames: string[] },
      context: GraphQLContext
    ) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const assetIdNums = Array.from(
        new Set(
          args.assetIds
            .map((raw) => Number.parseInt(String(raw), 10))
            .filter((n) => Number.isInteger(n) && n > 0)
        )
      );
      if (assetIdNums.length === 0) throw new Error('No valid asset ids provided');

      const normalizedTagNames = Array.from(new Set(args.tagNames.map((n) => normalizeTagName(n))));
      if (normalizedTagNames.length === 0) throw new Error('No tag names provided');

      const existing = await db.query(
        'SELECT id FROM media_assets WHERE id = ANY($1::int[])',
        [assetIdNums]
      );
      if (existing.rows.length !== assetIdNums.length) {
        throw new Error('One or more media assets not found');
      }

      const tagIds: number[] = [];
      for (const name of normalizedTagNames) {
        const tag = await upsertTag(name);
        tagIds.push(tag.id);
      }

      await attachTags(assetIdNums, tagIds);

      await logAudit(context.user.id, 'APPLY_TAGS', 'media_asset', undefined, {
        assetIds: assetIdNums,
        tagNames: normalizedTagNames
      });

      const updated = await db.query(
        'SELECT * FROM media_assets WHERE id = ANY($1::int[]) ORDER BY created_at DESC',
        [assetIdNums]
      );
      return updated.rows.map(mapMediaAssetRow);
    },

    removeTagFromAsset: async (
      _: any,
      args: { assetId: string; tagName: string },
      context: GraphQLContext
    ) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const assetId = Number.parseInt(String(args.assetId), 10);
      if (!Number.isFinite(assetId) || assetId <= 0) throw new Error('Invalid asset id');

      const assetResult = await db.query('SELECT * FROM media_assets WHERE id = $1', [assetId]);
      if (assetResult.rows.length === 0) throw new Error('Media asset not found');

      const tag = await getTagByName(args.tagName);
      if (!tag) throw new Error('Tag not found');

      await detachTag(assetId, tag.id);

      await logAudit(context.user.id, 'REMOVE_TAG', 'media_asset', assetId, {
        tagName: tag.name
      });

      return mapMediaAssetRow(assetResult.rows[0]);
    },

    deleteTag: async (_: any, args: { name: string }, context: GraphQLContext) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }

      const normalized = normalizeTagName(args.name);
      const removed = await deleteTagByName(normalized);

      if (removed) {
        await logAudit(context.user.id, 'DELETE_TAG', 'tag', undefined, {
          name: normalized
        });
      }

      return removed;
    },

    renameTag: async (_: any, args: { oldName: string; newName: string }, context: GraphQLContext) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const updated = await renameTagService(args.oldName, args.newName);

      await logAudit(context.user.id, 'RENAME_TAG', 'tag', updated.id, {
        oldName: normalizeTagName(args.oldName),
        newName: updated.name
      });

      return mapTagRow({ ...updated, asset_count: 0 });
    },

    clearCache: async (_: any, args: { type: string }, context: GraphQLContext) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      const allowed = ['thumbnails', 'previews', 'hls', 'transcoded', 'all'];
      if (!allowed.includes(args.type)) throw new Error(`Unknown cache type: ${args.type}`);
      await clearCacheByType(args.type as 'thumbnails' | 'previews' | 'hls' | 'transcoded' | 'all');
      return getCacheStats();
    }
  }
};
