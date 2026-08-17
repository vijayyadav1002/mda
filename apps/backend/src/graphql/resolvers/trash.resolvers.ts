import { logAudit } from '../../services/audit.js';
import {
  listTrashItems,
  restoreTrashItem as restoreTrashItemService,
  purgeTrashItem as purgeTrashItemService,
  emptyTrash as emptyTrashService
} from '../../services/trash.js';
import type { GraphQLContext } from '../context.js';
import path from 'path';
import { config } from '../../config.js';

export const trashQueryResolvers = {
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
  }
};

export const trashMutationResolvers = {
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
  }
};
