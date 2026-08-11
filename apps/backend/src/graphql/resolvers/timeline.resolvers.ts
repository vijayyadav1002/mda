import { db } from '../../db/index.js';
import { getTimelineSettings, updateTimelineSettings, type TimelineDateSource } from '../../services/settings.js';
import { recomputeAllCaptureDates } from '../../services/capture-date.js';
import { logAudit } from '../../services/audit.js';
import type { GraphQLContext } from '../context.js';
import path from 'path';
import { config } from '../../config.js';
import { mapMediaAssetRow } from '../helpers/media-mappers.js';

export const timelineQueryResolvers = {
  timelineSettings: async (_: any, __: any, context: GraphQLContext) => {
    if (!context.user) throw new Error('Unauthorized');
    return getTimelineSettings();
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
};

export const timelineMutationResolvers = {
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
};
