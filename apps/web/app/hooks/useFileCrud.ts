import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";
import type { DirectoryNode, MediaAsset } from "~/lib/types";

const CREATE_TEXT_FILE_MUTATION = `
  mutation CreateTextFile($parentPath: String, $name: String!) {
    createTextFile(parentPath: $parentPath, name: $name) {
      id fileName filePath mimeType fileSize thumbnailUrl transcodedUrl createdAt capturedAt tags { id name }
    }
  }
`;

interface UseFileCrudParams {
  /** Currently open folder; new files are created here, then it's re-fetched to pick up the new entry. */
  currentPath: string | null;
  /** From `useDirectoryTree` — refreshes `currentPath`'s cached `DirectoryNode` after creation. */
  loadDirectoryIntoCache: (directoryPath?: string | null) => Promise<DirectoryNode | null>;
  /** Opens the newly created text file straight into the editor. */
  setSelectedAsset: Dispatch<SetStateAction<MediaAsset | null>>;
  setAutoEditAssetId: Dispatch<SetStateAction<string | null>>;
  setIsViewerOpen: Dispatch<SetStateAction<boolean>>;
}

/**
 * Owns the dashboard's new-text-file dialog: its open/name/type/loading
 * state and the `createTextFile` mutation, which opens the created file
 * straight into the editor on success.
 *
 * Split out of `useFileFolderCrud`'s folder-oriented handlers (create/
 * rename/move/duplicate/delete) since file creation is the one operation
 * that doesn't share their move/duplicate dialog state — see `useFolderCrud`.
 */
export function useFileCrud({
  currentPath,
  loadDirectoryIntoCache,
  setSelectedAsset,
  setAutoEditAssetId,
  setIsViewerOpen,
}: UseFileCrudParams) {
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileType, setNewFileType] = useState<'md' | 'txt'>('md');
  const [isCreatingFile, setIsCreatingFile] = useState(false);

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFileName.trim();
    if (!trimmed || isCreatingFile) return;
    // Append the chosen extension unless the user already typed a valid one
    const hasValidExt = /\.(txt|md|markdown)$/i.test(trimmed);
    const finalName = hasValidExt ? trimmed : `${trimmed}.${newFileType}`;
    try {
      setIsCreatingFile(true);
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      const data: any = await client.request(CREATE_TEXT_FILE_MUTATION, {
        parentPath: currentPath,
        name: finalName,
      });
      setShowNewFileDialog(false);
      setNewFileName('');
      if (currentPath) await loadDirectoryIntoCache(currentPath);
      // Open the new document straight in the editor
      const created = data.createTextFile as MediaAsset;
      setAutoEditAssetId(created.id);
      setSelectedAsset(created);
      setIsViewerOpen(true);
    } catch (err: any) {
      alert(`Failed to create file: ${err?.response?.errors?.[0]?.message || err.message || 'Unknown error'}`);
    } finally {
      setIsCreatingFile(false);
    }
  };

  return {
    showNewFileDialog,
    setShowNewFileDialog,
    newFileName,
    setNewFileName,
    newFileType,
    setNewFileType,
    isCreatingFile,
    handleCreateFile,
  };
}
