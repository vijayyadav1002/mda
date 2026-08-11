import { db } from '../db/index.js';
import { logAudit } from '../services/audit.js';
import { compressImageAdvanced, compressVideoAdvanced, compressPdfAdvanced } from '../services/thumbnail.js';
import { getCacheStats, clearCacheByType, runCacheMaintenanceOnce } from '../services/cache-maintenance.js';
import { getCacheSettings, updateCacheSettings as updateCacheSettingsService, getTimelineSettings, updateTimelineSettings, type TimelineDateSource } from '../services/settings.js';
import { recomputeAllCaptureDates } from '../services/capture-date.js';
import {
  listTrashItems,
  restoreTrashItem as restoreTrashItemService,
  purgeTrashItem as purgeTrashItemService,
  emptyTrash as emptyTrashService
} from '../services/trash.js';
import { canCompressFile } from '../services/file-types.js';
import type { GraphQLContext } from './context.js';
import { authQueryResolvers, authMutationResolvers } from './resolvers/auth.resolvers.js';
import { mediaQueryResolvers, mediaMutationResolvers, mediaAssetTypeResolvers } from './resolvers/media.resolvers.js';
import { directoryQueryResolvers, directoryMutationResolvers } from './resolvers/directory.resolvers.js';
import { tagsQueryResolvers, tagsMutationResolvers } from './resolvers/tags.resolvers.js';
import { thumbnailsMutationResolvers } from './resolvers/thumbnails.resolvers.js';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { buildThumbnailUrl, mapMediaAssetRow } from './helpers/media-mappers.js';
import { cleanupCompressPreviewFiles } from './helpers/compress-cleanup.js';

export const resolvers = {
  Query: {
    ...authQueryResolvers,
    ...mediaQueryResolvers,
    ...directoryQueryResolvers,
    ...tagsQueryResolvers,

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
    ...directoryMutationResolvers,
    ...tagsMutationResolvers,
    ...thumbnailsMutationResolvers,

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
