import { db } from '../../db/index.js';
import { logAudit } from '../../services/audit.js';
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
} from '../../services/tags.js';
import type { GraphQLContext } from '../context.js';
import { mapTagRow, mapMediaAssetRow } from '../helpers/media-mappers.js';

export const tagsQueryResolvers = {
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
  }
};

export const tagsMutationResolvers = {
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
  }
};
