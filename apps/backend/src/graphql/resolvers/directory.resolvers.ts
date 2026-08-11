import { db } from '../../db/index.js';
import { logAudit } from '../../services/audit.js';
import { updateCaptureDateForAsset } from '../../services/capture-date/index.js';
import { moveToTrash } from '../../services/trash.js';
import { cleanupDeletedAssetCaches } from '../../services/media-cleanup.js';
import { indexFile } from '../../services/media-indexer/index.js';
import type { GraphQLContext } from '../context.js';
import {
  buildDuplicatePath,
  collectIndexableFiles,
  resolveLibraryPath,
  buildDirectoryNode
} from '../helpers/directory-tree.js';
import { mapMediaAssetRow } from '../helpers/media-mappers.js';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../../config.js';

export const directoryQueryResolvers = {
  directoryTree: async (_: any, __: any, context: GraphQLContext) => {
    if (!context.user) throw new Error('Unauthorized');
    const rootPath = resolveLibraryPath(null);
    return buildDirectoryNode(rootPath);
  },

  directoryNode: async (_: any, args: { path?: string | null }, context: GraphQLContext) => {
    if (!context.user) throw new Error('Unauthorized');
    const targetPath = resolveLibraryPath(args.path ?? null);
    return buildDirectoryNode(targetPath);
  }
};

export const directoryMutationResolvers = {
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
  }
};
