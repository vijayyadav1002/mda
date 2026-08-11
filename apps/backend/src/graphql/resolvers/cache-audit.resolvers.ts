import { db } from '../../db/index.js';
import { logAudit } from '../../services/audit.js';
import { getCacheStats, clearCacheByType, runCacheMaintenanceOnce } from '../../services/cache-maintenance/index.js';
import { getCacheSettings, updateCacheSettings as updateCacheSettingsService } from '../../services/settings.js';
import type { GraphQLContext } from '../context.js';

export const cacheAuditQueryResolvers = {
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
  }
};

export const cacheAuditMutationResolvers = {
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
    args: { input: Partial<import('../../services/settings.js').CacheSettings> },
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
  }
};
