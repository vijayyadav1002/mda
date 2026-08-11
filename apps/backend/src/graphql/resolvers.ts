import { db } from '../db/index.js';
import { getTimelineSettings, updateTimelineSettings, type TimelineDateSource } from '../services/settings.js';
import { recomputeAllCaptureDates } from '../services/capture-date.js';
import { logAudit } from '../services/audit.js';
import {
  listTrashItems,
  restoreTrashItem as restoreTrashItemService,
  purgeTrashItem as purgeTrashItemService,
  emptyTrash as emptyTrashService
} from '../services/trash.js';
import type { GraphQLContext } from './context.js';
import { authQueryResolvers, authMutationResolvers } from './resolvers/auth.resolvers.js';
import { mediaQueryResolvers, mediaMutationResolvers, mediaAssetTypeResolvers } from './resolvers/media.resolvers.js';
import { directoryQueryResolvers, directoryMutationResolvers } from './resolvers/directory.resolvers.js';
import { tagsQueryResolvers, tagsMutationResolvers } from './resolvers/tags.resolvers.js';
import { thumbnailsMutationResolvers } from './resolvers/thumbnails.resolvers.js';
import { compressMutationResolvers } from './resolvers/compress.resolvers.js';
import { cacheAuditQueryResolvers, cacheAuditMutationResolvers } from './resolvers/cache-audit.resolvers.js';
import path from 'path';
import { config } from '../config.js';
import { mapMediaAssetRow } from './helpers/media-mappers.js';

export const resolvers = {
  Query: {
    ...authQueryResolvers,
    ...mediaQueryResolvers,
    ...directoryQueryResolvers,
    ...tagsQueryResolvers,
    ...cacheAuditQueryResolvers,

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
    ...compressMutationResolvers,
    ...cacheAuditMutationResolvers,

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
