import { db } from '../db/index.js';
import { hashPassword, verifyPassword } from '../services/auth.js';
import { logAudit } from '../services/audit.js';
import { compressImage, compressVideo, compressImageAdvanced, compressVideoAdvanced } from '../services/thumbnail.js';
import { enqueueMediaRefresh } from '../services/queue.js';
import { cleanupDeletedAssetCaches } from '../services/media-cleanup.js';
import { indexFile } from '../services/media-indexer.js';
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

  const children = entries
    .map((entry) => {
      const childPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: childPath,
          type: 'directory',
          children: null,
          mediaAsset: null
        };
      }

      if (entry.isFile()) {
        const row = assetsByPath.get(childPath);
        return {
          name: entry.name,
          path: childPath,
          type: 'file',
          children: null,
          mediaAsset: row ? mapMediaAssetRow(row) : null
        };
      }

      return null;
    })
    .filter(Boolean);

  return {
    name: path.basename(dirPath) || dirPath,
    path: dirPath,
    type: 'directory',
    children
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

      for (const filePath of mediaFiles) {
        try {
          const result = await indexFile(filePath, { queueThumbnails: true, requeueMissingThumbnails: true });
          if (result === 'indexed' || result === 'thumbnail_requeued') {
            queuedCount += 1;
          }
        } catch (error) {
          console.warn(`[GenerateThumbnails] Failed for ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return queuedCount;
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
      }

      return true;
    }
  }
};
