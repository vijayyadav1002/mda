import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";
import type { DirectoryNode, MediaAsset } from "~/lib/types";

const CREATE_FOLDER_MUTATION = `
  mutation CreateFolder($parentPath: String, $name: String!) {
    createFolder(parentPath: $parentPath, name: $name) {
      name
      path
      type
    }
  }
`;

const DELETE_FOLDER_MUTATION = `
  mutation DeleteFolder($path: String!) {
    deleteFolder(path: $path)
  }
`;

const MOVE_MEDIA_ASSET_MUTATION = `
  mutation MoveMediaAsset($id: ID!, $newPath: String!) {
    moveMediaAsset(id: $id, newPath: $newPath) {
      id fileName filePath mimeType fileSize thumbnailUrl transcodedUrl createdAt capturedAt tags { id name }
    }
  }
`;

const DUPLICATE_MEDIA_ASSET_MUTATION = `
  mutation DuplicateMediaAsset($id: ID!, $destinationFolder: String) {
    duplicateMediaAsset(id: $id, destinationFolder: $destinationFolder) {
      id fileName filePath mimeType fileSize thumbnailUrl transcodedUrl createdAt capturedAt tags { id name }
    }
  }
`;

const DUPLICATE_FOLDER_MUTATION = `
  mutation DuplicateFolder($path: String!, $destinationFolder: String) {
    duplicateFolder(path: $path, destinationFolder: $destinationFolder) {
      name path type
    }
  }
`;

const RENAME_FOLDER_MUTATION = `
  mutation RenameFolder($path: String!, $newName: String!) {
    renameFolder(path: $path, newName: $newName) {
      name path type
    }
  }
`;

const MOVE_FOLDER_MUTATION = `
  mutation MoveFolder($path: String!, $destinationFolder: String!) {
    moveFolder(path: $path, destinationFolder: $destinationFolder) {
      name path type
    }
  }
`;

interface UseFolderCrudParams {
  /** Currently open folder; new folders are created here, and mutations refresh it afterward. */
  currentPath: string | null;
  /** Library root; re-fetched alongside `currentPath` for mutations that can touch either. */
  rootPath: string | null;
  /** From `useDirectoryTree` — refreshes a path's cached `DirectoryNode` after a mutation. */
  loadDirectoryIntoCache: (directoryPath?: string | null) => Promise<DirectoryNode | null>;
  /** From `useDirectoryTree` — used to prune deleted/renamed subtrees out of the cache directly. */
  setDirectoryCache: Dispatch<SetStateAction<Record<string, DirectoryNode>>>;
  /** From `useDirectoryTree` — navigates up when the folder currently open is deleted or renamed. */
  handleBackClick: () => Promise<void>;
  /** Shared confirm-dialog opener used to gate folder deletion. */
  openConfirm: (opts: {
    title: string;
    description: string;
    warning?: string;
    confirmLabel?: string;
    onConfirm: () => Promise<void>;
  }) => void;
  /** The asset currently open in the viewer; move/duplicate/rename act on it when no folder is targeted. */
  selectedAsset: MediaAsset | null;
  setSelectedAsset: Dispatch<SetStateAction<MediaAsset | null>>;
  /** The current folder's children in display order, walked by bulk-move to resolve selected file ids to paths. */
  sortedFolderChildren: DirectoryNode[];
  selectedAssetIds: Set<string>;
  selectedFolderPaths: Set<string>;
  setSelectedAssetIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedFolderPaths: Dispatch<SetStateAction<Set<string>>>;
  setSelectionMode: Dispatch<SetStateAction<boolean>>;
}

/**
 * Owns the dashboard's folder CRUD plus the move/duplicate/rename dialogs
 * shared with single-asset operations: dialog open/target/loading state,
 * and the create/delete/move/duplicate/rename handlers (including their
 * GraphQL mutations and the directory-cache refreshes each one triggers).
 *
 * File *creation* lives separately in `useFileCrud`, since it doesn't touch
 * this hook's shared move/duplicate dialog state.
 *
 * Takes the directory-tree cache accessors, the shared confirm-dialog opener,
 * and the selected-asset/selection-mode state as parameters rather than
 * owning them, since all are shared with other dashboard features.
 */
export function useFolderCrud({
  currentPath,
  rootPath,
  loadDirectoryIntoCache,
  setDirectoryCache,
  handleBackClick,
  openConfirm,
  selectedAsset,
  setSelectedAsset,
  sortedFolderChildren,
  selectedAssetIds,
  selectedFolderPaths,
  setSelectedAssetIds,
  setSelectedFolderPaths,
  setSelectionMode,
}: UseFolderCrudParams) {
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [moveTargetFolderPath, setMoveTargetFolderPath] = useState('');
  const [isMoving, setIsMoving] = useState(false);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateTargetFolderPath, setDuplicateTargetFolderPath] = useState('');
  const [duplicateSourceFolder, setDuplicateSourceFolder] = useState<{ path: string; name: string } | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<{ path: string; name: string } | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || isCreatingFolder) return;
    try {
      setIsCreatingFolder(true);
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(CREATE_FOLDER_MUTATION, { parentPath: currentPath, name: newFolderName.trim() });
      setShowNewFolderDialog(false);
      setNewFolderName('');
      if (currentPath) await loadDirectoryIntoCache(currentPath);
    } catch (err: any) {
      alert(`Failed to create folder: ${err.message || 'Unknown error'}`);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleDeleteFolder = (folderPath: string, folderName: string) => {
    openConfirm({
      title: "Delete Folder",
      description: `Delete folder "${folderName}" and all its contents?`,
      warning: "The folder is moved to the Trash and kept for 30 days before permanent deletion.",
      onConfirm: async () => {
        try {
          const token = getAuthToken();
          if (!token) return;
          const client = createGraphQLClient(token);
          await client.request(DELETE_FOLDER_MUTATION, { path: folderPath });
          // Remove deleted folder from cache
          setDirectoryCache((prev) => {
            const next = { ...prev };
            for (const key of Object.keys(next)) {
              if (key === folderPath || key.startsWith(`${folderPath}/`)) delete next[key];
            }
            return next;
          });
          if (currentPath === folderPath) {
            await handleBackClick();
          } else {
            if (currentPath) await loadDirectoryIntoCache(currentPath);
          }
        } catch (err: any) {
          alert(`Failed to delete folder: ${err.message || 'Unknown error'}`);
        }
      },
    });
  };

  const handleMoveAsset = async () => {
    if (!selectedAsset || !moveTargetFolderPath || isMoving) return;
    setIsMoving(true);
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      const newPath = `${moveTargetFolderPath}/${selectedAsset.fileName}`;
      const data: any = await client.request(MOVE_MEDIA_ASSET_MUTATION, { id: selectedAsset.id, newPath });
      setSelectedAsset(data.moveMediaAsset);
      setShowMoveDialog(false);
      setMoveTargetFolderPath('');
      if (rootPath) await loadDirectoryIntoCache(rootPath);
      if (currentPath && currentPath !== rootPath) await loadDirectoryIntoCache(currentPath);
      if (moveTargetFolderPath !== rootPath && moveTargetFolderPath !== currentPath) {
        await loadDirectoryIntoCache(moveTargetFolderPath);
      }
    } catch (err: any) {
      alert(`Failed to move file: ${err.message || 'Unknown error'}`);
    } finally {
      setIsMoving(false);
    }
  };

  const handleDuplicateAsset = async () => {
    if ((!selectedAsset && !duplicateSourceFolder) || !duplicateTargetFolderPath || isDuplicating) return;
    setIsDuplicating(true);
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      if (duplicateSourceFolder) {
        await client.request(DUPLICATE_FOLDER_MUTATION, {
          path: duplicateSourceFolder.path,
          destinationFolder: duplicateTargetFolderPath,
        });
      } else if (selectedAsset) {
        const data: any = await client.request(DUPLICATE_MEDIA_ASSET_MUTATION, {
          id: selectedAsset.id,
          destinationFolder: duplicateTargetFolderPath,
        });
        setSelectedAsset(data.duplicateMediaAsset);
      }
      setShowDuplicateDialog(false);
      setDuplicateTargetFolderPath('');
      setDuplicateSourceFolder(null);
      if (rootPath) await loadDirectoryIntoCache(rootPath);
      if (currentPath && currentPath !== rootPath) await loadDirectoryIntoCache(currentPath);
      if (duplicateTargetFolderPath !== rootPath && duplicateTargetFolderPath !== currentPath) {
        await loadDirectoryIntoCache(duplicateTargetFolderPath);
      }
    } catch (err: any) {
      alert(`Failed to duplicate item: ${err.message || 'Unknown error'}`);
    } finally {
      setIsDuplicating(false);
    }
  };

  const openDuplicateFolderDialog = (folder: { path: string; name: string }) => {
    setSelectedAsset(null);
    setDuplicateSourceFolder(folder);
    setDuplicateTargetFolderPath(folder.path.substring(0, folder.path.lastIndexOf('/')) || currentPath || rootPath || '');
    setShowDuplicateDialog(true);
  };

  const handleBulkMove = async () => {
    if (!moveTargetFolderPath || isMoving) return;
    const token = getAuthToken();
    if (!token) return;
    setIsMoving(true);
    try {
      const client = createGraphQLClient(token);
      for (const node of sortedFolderChildren) {
        if (node.type === 'file' && node.mediaAsset && selectedAssetIds.has(node.mediaAsset.id)) {
          const newPath = `${moveTargetFolderPath}/${node.mediaAsset.fileName}`;
          await client.request(MOVE_MEDIA_ASSET_MUTATION, { id: node.mediaAsset.id, newPath });
        }
      }
      for (const folderPath of selectedFolderPaths) {
        await client.request(MOVE_FOLDER_MUTATION, { path: folderPath, destinationFolder: moveTargetFolderPath });
      }
      setSelectedAssetIds(new Set());
      setSelectedFolderPaths(new Set());
      setSelectionMode(false);
      setShowMoveDialog(false);
      setMoveTargetFolderPath('');
      if (rootPath) await loadDirectoryIntoCache(rootPath);
      if (currentPath && currentPath !== rootPath) await loadDirectoryIntoCache(currentPath);
      if (moveTargetFolderPath !== rootPath && moveTargetFolderPath !== currentPath) {
        await loadDirectoryIntoCache(moveTargetFolderPath);
      }
    } catch (err: any) {
      alert(`Failed to move items: ${err.message || 'Unknown error'}`);
    } finally {
      setIsMoving(false);
    }
  };

  const handleRenameFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingFolder || !renameFolderValue.trim() || isRenamingFolder) return;
    setIsRenamingFolder(true);
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(RENAME_FOLDER_MUTATION, { path: renamingFolder.path, newName: renameFolderValue.trim() });
      const renamedPath = renamingFolder.path;
      setRenamingFolder(null);
      setRenameFolderValue('');
      setDirectoryCache((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key === renamedPath || key.startsWith(`${renamedPath}/`)) delete next[key];
        }
        return next;
      });
      if (currentPath && (currentPath === renamedPath || currentPath.startsWith(`${renamedPath}/`))) {
        await handleBackClick();
      } else {
        if (currentPath) await loadDirectoryIntoCache(currentPath);
      }
    } catch (err: any) {
      alert(`Failed to rename folder: ${err.message || 'Unknown error'}`);
    } finally {
      setIsRenamingFolder(false);
    }
  };

  return {
    showNewFolderDialog,
    setShowNewFolderDialog,
    newFolderName,
    setNewFolderName,
    isCreatingFolder,
    showMoveDialog,
    setShowMoveDialog,
    moveTargetFolderPath,
    setMoveTargetFolderPath,
    isMoving,
    showDuplicateDialog,
    setShowDuplicateDialog,
    duplicateTargetFolderPath,
    setDuplicateTargetFolderPath,
    duplicateSourceFolder,
    setDuplicateSourceFolder,
    isDuplicating,
    renamingFolder,
    setRenamingFolder,
    renameFolderValue,
    setRenameFolderValue,
    isRenamingFolder,
    handleCreateFolder,
    handleDeleteFolder,
    handleMoveAsset,
    handleDuplicateAsset,
    openDuplicateFolderDialog,
    handleBulkMove,
    handleRenameFolder,
  };
}
