import { db } from '../db/index.js';
import { hashPassword, verifyPassword } from '../services/auth.js';
import { logAudit } from '../services/audit.js';
import { compressImage, compressVideo } from '../services/thumbnail.js';
import { indexMediaLibrary } from '../services/media-indexer.js';
import type { GraphQLContext } from './context.js';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

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

      return result.rows.map(row => ({
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
      }));
    },

    mediaAsset: async (_: any, args: { id: string }, context: GraphQLContext) => {
      if (!context.user) throw new Error('Unauthorized');

      const result = await db.query('SELECT * FROM media_assets WHERE id = $1', [args.id]);
      
      if (result.rows.length === 0) throw new Error('Media asset not found');
      
      const row = result.rows[0];
      return {
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
        indexedAt: row.indexed_at.toISOString(),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      };
    },

    directoryTree: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.user) throw new Error('Unauthorized');

      const buildTree = async (dirPath: string): Promise<any> => {
        const stats = await fs.stat(dirPath);
        const name = path.basename(dirPath);
        
        if (!stats.isDirectory()) {
          // Check if it's a media asset
          const result = await db.query(
            'SELECT * FROM media_assets WHERE file_path = $1',
            [dirPath]
          );
          
          return {
            name,
            path: dirPath,
            type: 'file',
            children: [],
            mediaAsset: result.rows.length > 0 ? {
              id: result.rows[0].id,
              filePath: result.rows[0].file_path,
              fileName: result.rows[0].file_name,
              fileSize: result.rows[0].file_size.toString(),
              mimeType: result.rows[0].mime_type,
              thumbnailUrl: result.rows[0].thumbnail_path ? `/thumbnails/${path.basename(result.rows[0].thumbnail_path)}` : null,
              transcodedUrl: result.rows[0].transcoded_path ? `/transcoded/${path.basename(result.rows[0].transcoded_path)}` : null,
              createdAt: result.rows[0].created_at.toISOString()
            } : null
          };
        }

        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        // Filter out hidden/system files like .DS_Store
        const filteredEntries = entries.filter(entry => !entry.name.startsWith('.'));
        const children = await Promise.all(
          filteredEntries.map(entry => buildTree(path.join(dirPath, entry.name)))
        );

        return {
          name,
          path: dirPath,
          type: 'directory',
          children: children.filter(Boolean)
        };
      };

      return buildTree(config.mediaLibraryPath);
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

      // Delete the file
      await fs.unlink(asset.file_path);

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
        console.log('[GRAPHQL] Refreshing media library...');
        await indexMediaLibrary();
        console.log('[GRAPHQL] Media library refresh completed');
        
        await logAudit(context.user.id, 'REFRESH_MEDIA_LIBRARY', 'media_library');
        
        return 'Media library refreshed successfully';
      } catch (error) {
        console.error('[GRAPHQL] Error refreshing media library:', error);
        throw new Error(`Failed to refresh media library: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }
};
