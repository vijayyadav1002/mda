import fs from 'fs/promises';
import path from 'path';
import type { GraphQLContext } from '../context.js';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { compressImageAdvanced, compressVideoAdvanced, compressPdfAdvanced } from '../../services/thumbnail.js';
import { canCompressFile } from '../../services/file-types.js';
import { logAudit } from '../../services/audit.js';
import { cleanupCompressPreviewFiles } from '../helpers/compress-cleanup.js';
import { mapMediaAssetRow } from '../helpers/media-mappers.js';

export const compressMutationResolvers = {
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
  }
};
