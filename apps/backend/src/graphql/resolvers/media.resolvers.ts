import { db } from '../../db/index.js';
import { logAudit } from '../../services/audit.js';
import { compressImage, compressVideo, compressPdfAdvanced } from '../../services/thumbnail/index.js';
import { enqueueMediaRefresh } from '../../services/queue/index.js';
import { cleanupDeletedAssetCaches } from '../../services/media-cleanup.js';
import { indexFile } from '../../services/media-indexer.js';
import { updateCaptureDateForAsset } from '../../services/capture-date.js';
import { parseSearchTerm, toLikePattern, toDirLikePattern, buildNameMatcher } from '../../services/search-query.js';
import {
  moveToTrash
} from '../../services/trash.js';
import { canCompressFile } from '../../services/file-types.js';
import {
  getTagsForAssets
} from '../../services/tags.js';
import type { GraphQLContext } from '../context.js';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../../config.js';
import { buildThumbnailUrl, mapMediaAssetRow, mapTagRow } from '../helpers/media-mappers.js';
import {
  resolveLibraryPath,
  buildDuplicatePath,
  collectMatchingFolders,
  SEARCH_HARD_CAP
} from '../helpers/directory-tree.js';

export const mediaQueryResolvers = {
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

  search: async (
    _: any,
    args: { term?: string; mediaType?: string; sortBy?: string; limit?: number; minSize?: number; maxSize?: number; path?: string },
    context: GraphQLContext
  ) => {
    if (!context.user) throw new Error('Unauthorized');

    const parsed = parseSearchTerm((args.term ?? '').trim());

    // In-field operators take precedence over UI-level filters
    const mediaType = parsed.type
      ?? (args.mediaType === 'image' || args.mediaType === 'video' ? args.mediaType : null);
    const sortBy = ['size-asc', 'size-desc', 'date-asc', 'date-desc'].includes(args.sortBy ?? '')
      ? args.sortBy!
      : null;

    const minSize = parsed.minSize
      ?? (typeof args.minSize === 'number' && args.minSize > 0 ? Math.floor(args.minSize) : null);
    const maxSize = parsed.maxSize
      ?? (typeof args.maxSize === 'number' && args.maxSize > 0 ? Math.floor(args.maxSize) : null);

    const hasNamePattern = parsed.nameTerm !== null || parsed.dirTerms.length > 0;
    if (!hasNamePattern && !mediaType && !minSize && !maxSize && !parsed.tag && !parsed.ext) {
      return { files: [], folders: [] };
    }

    const requestedLimit = args.limit ?? 25;
    const limit = requestedLimit <= 0
      ? SEARCH_HARD_CAP
      : Math.min(Math.max(requestedLimit, 1), SEARCH_HARD_CAP);
    const folderSearchLimit = requestedLimit <= 0 ? 200 : limit;

    const queryParams: unknown[] = [];
    const conditions: string[] = [];

    if (parsed.nameTerm) {
      queryParams.push(toLikePattern(parsed.nameTerm));
      conditions.push(`file_name ILIKE $${queryParams.length} ESCAPE '\\'`);
    }

    // Each dir term must appear as (part of) a folder component in the path
    for (const dirTerm of parsed.dirTerms) {
      queryParams.push(toDirLikePattern(dirTerm));
      conditions.push(`file_path ILIKE $${queryParams.length} ESCAPE '\\'`);
    }

    if (parsed.ext) {
      queryParams.push(`%.${parsed.ext.replace(/[\\%_]/g, (ch) => `\\${ch}`)}`);
      conditions.push(`file_name ILIKE $${queryParams.length} ESCAPE '\\'`);
    }

    if (parsed.tag) {
      queryParams.push(parsed.tag);
      conditions.push(`EXISTS (
        SELECT 1 FROM media_asset_tags mat
        JOIN tags t ON t.id = mat.tag_id
        WHERE mat.media_asset_id = media_assets.id AND t.name = $${queryParams.length}
      )`);
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

    const scopedPath = args.path ? resolveLibraryPath(args.path) : null;
    if (scopedPath) {
      queryParams.push(`${scopedPath}/%`);
      conditions.push(`file_path LIKE $${queryParams.length}`);
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
    } else if (parsed.nameTerm && !/[*?]/.test(parsed.nameTerm)) {
      const escapedTerm = parsed.nameTerm.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      const base = queryParams.length;
      queryParams.push(parsed.nameTerm, `${escapedTerm}%`);
      orderClause = `ORDER BY CASE WHEN LOWER(file_name) = LOWER($${base + 1}) THEN 0 WHEN LOWER(file_name) LIKE LOWER($${base + 2}) THEN 1 ELSE 2 END, file_name ASC`;
    } else {
      orderClause = 'ORDER BY file_name ASC';
    }

    queryParams.push(limit);
    const fileResult = await db.query(
      `SELECT * FROM media_assets ${whereClause} ${orderClause} LIMIT $${queryParams.length}`,
      queryParams
    );

    // Folders are searched whenever any name/folder pattern exists — even
    // with a media-type filter active, so switching Images/Videos in the UI
    // never hides matching folders.
    const folderTerms = [
      ...(parsed.nameTerm ? [parsed.nameTerm] : []),
      ...parsed.dirTerms
    ];
    const folders = folderTerms.length > 0
      ? await collectMatchingFolders(
          scopedPath ?? resolveLibraryPath(null),
          buildNameMatcher(folderTerms),
          folderSearchLimit
        )
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
};

export const mediaAssetTypeResolvers = {
  tags: async (parent: { id: string | number }) => {
    const assetId = typeof parent.id === 'number' ? parent.id : parseInt(String(parent.id), 10);
    if (!Number.isFinite(assetId)) return [];
    const map = await getTagsForAssets([assetId]);
    const tags = map.get(assetId) ?? [];
    return tags.map(mapTagRow);
  }
};

export const mediaMutationResolvers = {
  moveMediaAsset: async (_: any, args: { id: string; newPath: string }, context: GraphQLContext) => {
    if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
      throw new Error('Admin or Editor access required');
    }

    const result = await db.query('SELECT * FROM media_assets WHERE id = $1', [args.id]);

    if (result.rows.length === 0) throw new Error('Media asset not found');

    const asset = result.rows[0];
    const oldPath = asset.file_path;
    const newPath = resolveLibraryPath(args.newPath);

    // Move the file
    await fs.rename(oldPath, newPath);

    // Update database
    await db.query(
      'UPDATE media_assets SET file_path = $1, updated_at = NOW() WHERE id = $2',
      [newPath, args.id]
    );
    await updateCaptureDateForAsset(args.id, newPath);

    await logAudit(context.user.id, 'MOVE_ASSET', 'media_asset', parseInt(args.id, 10), {
      oldPath,
      newPath
    });

    const updated = await db.query('SELECT * FROM media_assets WHERE id = $1', [args.id]);
    const row = updated.rows[0];

    return {
      id: row.id,
      filePath: row.file_path,
      fileName: row.file_name,
      fileSize: row.file_size.toString(),
      mimeType: row.mime_type,
      thumbnailUrl: buildThumbnailUrl(row),
      indexedAt: row.indexed_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  },

  renameMediaAsset: async (_: any, args: { id: string; newName: string }, context: GraphQLContext) => {
    if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
      throw new Error('Admin or Editor access required');
    }

    if (!args.newName || !args.newName.trim() || /[/\\]/.test(args.newName) || args.newName.includes('..') || args.newName.startsWith('.')) {
      throw new Error('Invalid file name');
    }

    const result = await db.query('SELECT * FROM media_assets WHERE id = $1', [args.id]);

    if (result.rows.length === 0) throw new Error('Media asset not found');

    const asset = result.rows[0];
    const oldPath = asset.file_path;
    const newPath = path.join(path.dirname(oldPath), args.newName);
    const rootPath = path.resolve(config.mediaLibraryPath);
    if (!newPath.startsWith(`${rootPath}${path.sep}`)) {
      throw new Error('Invalid file path');
    }

    // Rename the file
    await fs.rename(oldPath, newPath);

    // Update database
    await db.query(
      'UPDATE media_assets SET file_path = $1, file_name = $2, updated_at = NOW() WHERE id = $3',
      [newPath, args.newName, args.id]
    );
    await updateCaptureDateForAsset(args.id, newPath);

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
      thumbnailUrl: buildThumbnailUrl(row),
      indexedAt: row.indexed_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  },

  duplicateMediaAsset: async (
    _: any,
    args: { id: string; destinationFolder?: string | null },
    context: GraphQLContext
  ) => {
    if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
      throw new Error('Admin or Editor access required');
    }

    const result = await db.query('SELECT * FROM media_assets WHERE id = $1', [args.id]);
    if (result.rows.length === 0) throw new Error('Media asset not found');

    const asset = result.rows[0];
    const sourcePath = path.resolve(asset.file_path);
    const rootPath = resolveLibraryPath(null);
    if (sourcePath !== rootPath && !sourcePath.startsWith(`${rootPath}${path.sep}`)) {
      throw new Error('Invalid source file path');
    }

    const destinationDir = args.destinationFolder
      ? resolveLibraryPath(args.destinationFolder)
      : path.dirname(sourcePath);
    const destinationStat = await fs.stat(destinationDir);
    if (!destinationStat.isDirectory()) {
      throw new Error('Destination must be a folder');
    }

    const duplicatePath = await buildDuplicatePath(destinationDir, asset.file_name, { preserveExtension: true });
    await fs.copyFile(sourcePath, duplicatePath);
    await indexFile(duplicatePath);

    const copied = await db.query('SELECT * FROM media_assets WHERE file_path = $1', [duplicatePath]);
    if (copied.rows.length === 0) {
      throw new Error('Duplicate was created but could not be indexed');
    }

    await logAudit(context.user.id, 'DUPLICATE_ASSET', 'media_asset', parseInt(args.id, 10), {
      sourcePath,
      duplicatePath
    });

    return mapMediaAssetRow(copied.rows[0]);
  },

  deleteMediaAsset: async (_: any, args: { id: string }, context: GraphQLContext) => {
    if (!context.user || !['admin', 'editor'].includes(context.user.role)) {
      throw new Error('Admin or Editor access required');
    }

    const result = await db.query('SELECT * FROM media_assets WHERE id = $1', [args.id]);

    if (result.rows.length === 0) throw new Error('Media asset not found');

    const asset = result.rows[0];

    // Remove generated caches, but keep the thumbnail so the trash page
    // can show what the deleted item looked like.
    await cleanupDeletedAssetCaches(asset, { removeTranscoded: true, preserveThumbnail: true });

    // Soft delete: move the file to the trash bin instead of unlinking.
    // Permanent deletion happens only from the trash (explicitly or after
    // the retention window expires).
    try {
      await moveToTrash({
        originalPath: asset.file_path,
        itemType: 'file',
        fileName: asset.file_name,
        fileSize: asset.file_size,
        mimeType: asset.mime_type,
        thumbnailPath: asset.thumbnail_path,
        deletedBy: context.user.id
      });
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }

    // Delete from database
    await db.query('DELETE FROM media_assets WHERE id = $1', [args.id]);

    await logAudit(context.user.id, 'DELETE_ASSET', 'media_asset', parseInt(args.id, 10), {
      filePath: asset.file_path,
      movedToTrash: true
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
      } else if (canCompressFile(asset.file_name, asset.mime_type)) {
        await compressPdfAdvanced(asset.file_path, tempPath, { quality });
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
      } else if (canCompressFile(asset.file_name, asset.mime_type)) {
        await compressPdfAdvanced(asset.file_path, outputPath, { quality });
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
      thumbnailUrl: buildThumbnailUrl(row),
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
  }
};
