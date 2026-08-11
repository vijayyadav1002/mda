import { db } from '../db/index.js';
import { logAudit } from '../services/audit.js';
import { compressImageAdvanced, compressVideoAdvanced, compressPdfAdvanced } from '../services/thumbnail.js';
import { getCacheStats, clearCacheByType, runCacheMaintenanceOnce } from '../services/cache-maintenance.js';
import { getCacheSettings, updateCacheSettings as updateCacheSettingsService, getTimelineSettings, updateTimelineSettings, type TimelineDateSource } from '../services/settings.js';
import { indexFile } from '../services/media-indexer.js';
import { updateCaptureDateForAsset, recomputeAllCaptureDates } from '../services/capture-date.js';
import {
  listTrashItems,
  restoreTrashItem as restoreTrashItemService,
  purgeTrashItem as purgeTrashItemService,
  emptyTrash as emptyTrashService,
  moveToTrash
} from '../services/trash.js';
import { canCompressFile, canThumbnailFile } from '../services/file-types.js';
import {
  normalizeTagName,
  upsertTag,
  attachTags,
  detachTag,
  detachTagsBulk,
  listTags,
  getTagByName,
  getAssetsByTagName,
  deleteTagByName,
  renameTag as renameTagService
} from '../services/tags.js';
import type { GraphQLContext } from './context.js';
import { authQueryResolvers, authMutationResolvers } from './resolvers/auth.resolvers.js';
import { mediaQueryResolvers, mediaMutationResolvers, mediaAssetTypeResolvers } from './resolvers/media.resolvers.js';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { buildThumbnailUrl, mapMediaAssetRow, mapTagRow } from './helpers/media-mappers.js';
import { cleanupCompressPreviewFiles } from './helpers/compress-cleanup.js';
import {
  resolveLibraryPath,
  buildDuplicatePath,
  collectIndexableFiles,
  listMediaFilesInDirectory,
  buildDirectoryNode
} from './helpers/directory-tree.js';
import { cleanupDeletedAssetCaches } from '../services/media-cleanup.js';
import { addToThumbnailQueue, cancelThumbnailSession } from '../services/queue.js';

export const resolvers = {
  Query: {
    ...authQueryResolvers,
    ...mediaQueryResolvers,

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

    auditLogs: async (_: any, args: { limit?: number; offset?: number; userId?: string; action?: string; resourceType?: string; startDate?: string; endDate?: string }, context: GraphQLContext) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }

      const conditions: string[] = [];
      const params: any[] = [];

      if (args.userId) { params.push(args.userId); conditions.push(`al.user_id = $${params.length}`); }
      if (args.action) { params.push(args.action); conditions.push(`al.action = $${params.length}`); }
      if (args.resourceType) { params.push(args.resourceType); conditions.push(`al.resource_type = $${params.length}`); }
      if (args.startDate) { params.push(args.startDate); conditions.push(`al.created_at >= $${params.length}`); }
      if (args.endDate) { params.push(args.endDate); conditions.push(`al.created_at < ($${params.length}::date + interval '1 day')`); }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = args.limit || 50;
      const offset = args.offset || 0;
      params.push(limit, offset);

      const result = await db.query(
        `SELECT al.*, u.username, u.role
         FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         ${where}
         ORDER BY al.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
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

    auditLogsCount: async (_: any, args: { userId?: string; action?: string; resourceType?: string; startDate?: string; endDate?: string }, context: GraphQLContext) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }

      const conditions: string[] = [];
      const params: any[] = [];

      if (args.userId) { params.push(args.userId); conditions.push(`al.user_id = $${params.length}`); }
      if (args.action) { params.push(args.action); conditions.push(`al.action = $${params.length}`); }
      if (args.resourceType) { params.push(args.resourceType); conditions.push(`al.resource_type = $${params.length}`); }
      if (args.startDate) { params.push(args.startDate); conditions.push(`al.created_at >= $${params.length}`); }
      if (args.endDate) { params.push(args.endDate); conditions.push(`al.created_at < ($${params.length}::date + interval '1 day')`); }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await db.query(
        `SELECT COUNT(*) FROM audit_logs al ${where}`,
        params
      );

      return parseInt(result.rows[0].count, 10);
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

    cacheSettings: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      return getCacheSettings();
    },

    timelineSettings: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.user) throw new Error('Unauthorized');
      return getTimelineSettings();
    },

    trashItems: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }
      const retentionMs = config.trashRetentionDays * 24 * 60 * 60 * 1000;
      const items = await listTrashItems();
      return items.map((item) => ({
        id: item.id,
        fileName: item.file_name,
        originalPath: item.original_path,
        itemType: item.item_type,
        fileSize: item.file_size != null ? String(item.file_size) : null,
        mimeType: item.mime_type,
        thumbnailUrl: item.thumbnail_path
          ? `/thumbnails/${path.basename(item.thumbnail_path)}?v=${item.deleted_at.getTime()}`
          : null,
        deletedAt: item.deleted_at.toISOString(),
        expiresAt: new Date(item.deleted_at.getTime() + retentionMs).toISOString()
      }));
    },

    timelineBuckets: async (
      _: any,
      args: { granularity: string; coverLimit?: number },
      context: GraphQLContext
    ) => {
      if (!context.user) throw new Error('Unauthorized');

      const granularity = ['year', 'month', 'day'].includes(args.granularity) ? args.granularity : 'month';
      const coverLimit = Math.min(Math.max(args.coverLimit ?? 0, 0), 12);

      const buckets = await db.query(
        `SELECT date_trunc('${granularity}', captured_at) AS period, COUNT(*)::int AS count
         FROM media_assets
         WHERE captured_at IS NOT NULL
           AND (mime_type LIKE 'image/%' OR mime_type LIKE 'video/%')
         GROUP BY period
         ORDER BY period DESC`
      );

      const results = [];
      for (const bucket of buckets.rows) {
        let coverAssets: any[] = [];
        if (coverLimit > 0) {
          const covers = await db.query(
            `SELECT * FROM media_assets
             WHERE captured_at IS NOT NULL
               AND (mime_type LIKE 'image/%' OR mime_type LIKE 'video/%')
               AND date_trunc('${granularity}', captured_at) = $1
             ORDER BY thumbnail_path IS NULL, captured_at DESC, file_name ASC
             LIMIT $2`,
            [bucket.period, coverLimit]
          );
          coverAssets = covers.rows.map(mapMediaAssetRow);
        }
        results.push({
          period: bucket.period.toISOString(),
          count: bucket.count,
          coverAssets
        });
      }
      return results;
    },

    timelineAssets: async (
      _: any,
      args: { from: string; to: string; limit?: number; offset?: number },
      context: GraphQLContext
    ) => {
      if (!context.user) throw new Error('Unauthorized');

      const from = new Date(args.from);
      const to = new Date(args.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new Error('Invalid date range');
      }
      const limit = Math.min(args.limit ?? 200, 500);
      const offset = args.offset ?? 0;

      const where = `captured_at >= $1 AND captured_at < $2
           AND (mime_type LIKE 'image/%' OR mime_type LIKE 'video/%')`;

      const [assets, total] = await Promise.all([
        db.query(
          `SELECT * FROM media_assets
           WHERE ${where}
           ORDER BY captured_at DESC, file_name ASC
           LIMIT $3 OFFSET $4`,
          [from, to, limit, offset]
        ),
        db.query(`SELECT COUNT(*)::int AS count FROM media_assets WHERE ${where}`, [from, to])
      ]);

      return {
        assets: assets.rows.map(mapMediaAssetRow),
        totalCount: total.rows[0].count
      };
    }
  },

  MediaAsset: {
    ...mediaAssetTypeResolvers
  },

  Mutation: {
    ...authMutationResolvers,
    ...mediaMutationResolvers,

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

    generateThumbnailsForAssets: async (_: any, args: { ids: string[]; sessionId?: string | null; force?: boolean | null }, context: GraphQLContext) => {
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
        if (args.force) {
          // Force-regenerate: remove the existing thumbnail file first —
          // the generator returns early when one already exists on disk.
          const thumbPath = row.thumbnail_path as string | null;
          if (thumbPath) {
            await fs.unlink(thumbPath).catch(() => {});
            await db.query('UPDATE media_assets SET thumbnail_path = NULL WHERE id = $1', [row.id]);
          }
        } else {
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
        }

        const filePath = row.file_path as string;
        const mimeType = (row.mime_type as string | null) ?? '';
        if (!canThumbnailFile(filePath, mimeType)) continue;
        const isVideo = mimeType.startsWith('video/');

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
        } else if (canCompressFile(asset.file_name, asset.mime_type)) {
          await compressPdfAdvanced(asset.file_path, previewPath, {
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

    createTextFile: async (
      _: any,
      args: { parentPath?: string | null; name: string },
      context: GraphQLContext
    ) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const name = (args.name ?? '').trim();
      if (!name || /[/\\]/.test(name) || name.includes('..') || name.startsWith('.')) {
        throw new Error('Invalid file name');
      }
      const ext = path.extname(name).toLowerCase();
      if (!['.txt', '.md', '.markdown'].includes(ext)) {
        throw new Error('Only .txt, .md, and .markdown files can be created');
      }

      const parentPath = resolveLibraryPath(args.parentPath ?? null);
      const parentStat = await fs.stat(parentPath);
      if (!parentStat.isDirectory()) {
        throw new Error('Parent path is not a directory');
      }

      const newFilePath = path.join(parentPath, name);
      const rootPath = path.resolve(config.mediaLibraryPath);
      if (!newFilePath.startsWith(`${rootPath}${path.sep}`)) {
        throw new Error('Invalid file path');
      }

      // 'wx' fails if the file already exists — no silent overwrite
      try {
        await fs.writeFile(newFilePath, '', { flag: 'wx' });
      } catch (err: any) {
        if (err?.code === 'EEXIST') throw new Error('A file with that name already exists');
        throw err;
      }

      await indexFile(newFilePath);

      const created = await db.query('SELECT * FROM media_assets WHERE file_path = $1', [newFilePath]);
      if (created.rows.length === 0) {
        throw new Error('File was created but could not be indexed');
      }

      await logAudit(context.user.id, 'CREATE_FILE', 'media_asset', created.rows[0].id, {
        path: newFilePath
      });

      return mapMediaAssetRow(created.rows[0]);
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

      // Soft delete: move the whole folder to the trash bin.
      await moveToTrash({
        originalPath: targetPath,
        itemType: 'folder',
        fileName: path.basename(targetPath),
        deletedBy: context.user.id
      });

      await logAudit(context.user.id, 'DELETE_FOLDER', 'directory', undefined, {
        path: targetPath,
        movedToTrash: true,
        assetsDeleted: assetsResult.rows.length
      });

      return true;
    },

    renameFolder: async (
      _: any,
      args: { path: string; newName: string },
      context: GraphQLContext
    ) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      if (!args.newName || /[/\\]/.test(args.newName) || args.newName.startsWith('.')) {
        throw new Error('Invalid folder name');
      }

      const targetPath = resolveLibraryPath(args.path);
      const targetStat = await fs.stat(targetPath);
      if (!targetStat.isDirectory()) {
        throw new Error('Path is not a directory');
      }
      const rootPath = path.resolve(config.mediaLibraryPath);

      if (targetPath === rootPath) {
        throw new Error('Cannot rename the root library folder');
      }

      const parentDir = path.dirname(targetPath);
      const newFolderPath = path.join(parentDir, args.newName);

      if (!newFolderPath.startsWith(`${rootPath}${path.sep}`)) {
        throw new Error('Invalid directory path');
      }

      await fs.rename(targetPath, newFolderPath);

      const assetsResult = await db.query(
        'SELECT id, file_path FROM media_assets WHERE file_path LIKE $1',
        [`${targetPath}${path.sep}%`]
      );

      for (const asset of assetsResult.rows) {
        const newAssetPath = newFolderPath + asset.file_path.slice(targetPath.length);
        await db.query(
          'UPDATE media_assets SET file_path = $1, updated_at = NOW() WHERE id = $2',
          [newAssetPath, asset.id]
        );
        await updateCaptureDateForAsset(asset.id, newAssetPath);
      }

      await logAudit(context.user.id, 'RENAME_FOLDER', 'directory', undefined, {
        oldPath: targetPath,
        newPath: newFolderPath,
        assetsUpdated: assetsResult.rows.length
      });

      return {
        name: args.newName,
        path: newFolderPath,
        type: 'directory',
        children: []
      };
    },

    moveFolder: async (
      _: any,
      args: { path: string; destinationFolder: string },
      context: GraphQLContext
    ) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const sourcePath = resolveLibraryPath(args.path);
      const sourceStat = await fs.stat(sourcePath);
      if (!sourceStat.isDirectory()) {
        throw new Error('Path is not a directory');
      }

      const destParent = resolveLibraryPath(args.destinationFolder);
      const destStat = await fs.stat(destParent);
      if (!destStat.isDirectory()) {
        throw new Error('Destination is not a directory');
      }

      const rootPath = path.resolve(config.mediaLibraryPath);
      if (sourcePath === rootPath) {
        throw new Error('Cannot move the root library folder');
      }

      const folderName = path.basename(sourcePath);
      const newFolderPath = path.join(destParent, folderName);

      if (newFolderPath === sourcePath || newFolderPath.startsWith(`${sourcePath}${path.sep}`)) {
        throw new Error('Cannot move folder into itself');
      }
      if (!newFolderPath.startsWith(`${rootPath}${path.sep}`)) {
        throw new Error('Invalid destination path');
      }

      await fs.rename(sourcePath, newFolderPath);

      const assetsResult = await db.query(
        'SELECT id, file_path FROM media_assets WHERE file_path LIKE $1',
        [`${sourcePath}${path.sep}%`]
      );

      for (const asset of assetsResult.rows) {
        const newAssetPath = newFolderPath + asset.file_path.slice(sourcePath.length);
        await db.query(
          'UPDATE media_assets SET file_path = $1, updated_at = NOW() WHERE id = $2',
          [newAssetPath, asset.id]
        );
        await updateCaptureDateForAsset(asset.id, newAssetPath);
      }

      await logAudit(context.user.id, 'MOVE_FOLDER', 'directory', undefined, {
        oldPath: sourcePath,
        newPath: newFolderPath,
        assetsUpdated: assetsResult.rows.length
      });

      return {
        name: folderName,
        path: newFolderPath,
        type: 'directory',
        children: []
      };
    },

    duplicateFolder: async (
      _: any,
      args: { path: string; destinationFolder?: string | null },
      context: GraphQLContext
    ) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const sourcePath = resolveLibraryPath(args.path);
      const sourceStat = await fs.stat(sourcePath);
      if (!sourceStat.isDirectory()) {
        throw new Error('Path is not a directory');
      }

      const rootPath = path.resolve(config.mediaLibraryPath);
      if (sourcePath === rootPath) {
        throw new Error('Cannot duplicate the root library folder');
      }

      const destinationDir = args.destinationFolder
        ? resolveLibraryPath(args.destinationFolder)
        : path.dirname(sourcePath);
      const destinationStat = await fs.stat(destinationDir);
      if (!destinationStat.isDirectory()) {
        throw new Error('Destination is not a directory');
      }

      const duplicatePath = await buildDuplicatePath(destinationDir, path.basename(sourcePath), { preserveExtension: false });
      if (duplicatePath === sourcePath || duplicatePath.startsWith(`${sourcePath}${path.sep}`)) {
        throw new Error('Cannot duplicate folder into itself');
      }

      await fs.cp(sourcePath, duplicatePath, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });

      const copiedFiles = await collectIndexableFiles(duplicatePath);
      for (const filePath of copiedFiles) {
        await indexFile(filePath);
      }

      await logAudit(context.user.id, 'DUPLICATE_FOLDER', 'directory', undefined, {
        sourcePath,
        duplicatePath,
        filesCopied: copiedFiles.length
      });

      return buildDirectoryNode(duplicatePath);
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

    removeTagsFromAssets: async (
      _: any,
      args: { assetIds: string[]; tagNames: string[] },
      context: GraphQLContext
    ) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }

      const assetIds = Array.from(
        new Set(
          (args.assetIds ?? [])
            .map((raw) => Number.parseInt(String(raw), 10))
            .filter((n) => Number.isInteger(n) && n > 0)
        )
      );
      const tagNames = (args.tagNames ?? []).map((t) => String(t)).filter(Boolean);
      if (assetIds.length === 0 || tagNames.length === 0) return 0;

      const removed = await detachTagsBulk(assetIds, tagNames);

      await logAudit(context.user.id, 'REMOVE_TAGS_BULK', 'media_asset', undefined, {
        assetIds,
        tagNames,
        removed
      });

      return removed;
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

    clearAuditLogs: async (_: any, args: { startDate: string; endDate: string }, context: GraphQLContext) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      const result = await db.query(
        `DELETE FROM audit_logs
         WHERE created_at >= $1::date
           AND created_at < ($2::date + interval '1 day')`,
        [args.startDate, args.endDate]
      );
      return result.rowCount ?? 0;
    },

    clearCache: async (_: any, args: { type: string }, context: GraphQLContext) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      const allowed = ['thumbnails', 'previews', 'hls', 'transcoded', 'all'];
      if (!allowed.includes(args.type)) throw new Error(`Unknown cache type: ${args.type}`);
      await clearCacheByType(args.type as 'thumbnails' | 'previews' | 'hls' | 'transcoded' | 'all');
      return getCacheStats();
    },

    updateCacheSettings: async (
      _: any,
      args: { input: Partial<import('../services/settings.js').CacheSettings> },
      context: GraphQLContext
    ) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      const updated = await updateCacheSettingsService(args.input);
      await logAudit(context.user.id, 'UPDATE_CACHE_SETTINGS', 'settings', undefined, { ...args.input });
      // Apply new limits right away so shrinking a cache takes effect immediately.
      void runCacheMaintenanceOnce().catch((error) => {
        console.error('[CacheMaintenance] Post-settings-update run failed:', error);
      });
      return updated;
    },

    restoreTrashItem: async (_: any, args: { id: string }, context: GraphQLContext) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }
      const id = Number.parseInt(String(args.id), 10);
      if (!Number.isFinite(id)) throw new Error('Invalid trash item id');
      const restoredPath = await restoreTrashItemService(id);
      await logAudit(context.user.id, 'RESTORE_TRASH_ITEM', 'trash', id, { restoredPath });
      return true;
    },

    purgeTrashItem: async (_: any, args: { id: string }, context: GraphQLContext) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }
      const id = Number.parseInt(String(args.id), 10);
      if (!Number.isFinite(id)) throw new Error('Invalid trash item id');
      await purgeTrashItemService(id);
      await logAudit(context.user.id, 'PURGE_TRASH_ITEM', 'trash', id);
      return true;
    },

    emptyTrash: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
        throw new Error('Admin or Editor access required');
      }
      const purged = await emptyTrashService();
      await logAudit(context.user.id, 'EMPTY_TRASH', 'trash', undefined, { purged });
      return purged;
    },

    updateTimelineDateSource: async (
      _: any,
      args: { dateSource: string },
      context: GraphQLContext
    ) => {
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      const updated = await updateTimelineSettings({ dateSource: args.dateSource as TimelineDateSource });
      await logAudit(context.user.id, 'UPDATE_TIMELINE_DATE_SOURCE', 'settings', undefined, {
        dateSource: updated.dateSource
      });
      // Re-date the whole library in the background; the timeline reflects
      // the new ordering as batches complete.
      void recomputeAllCaptureDates().catch((error) => {
        console.error('[CaptureDate] Recompute after date-source change failed:', error);
      });
      return updated;
    }
  }
};
