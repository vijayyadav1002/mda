import { useState } from "react";

/**
 * Asset+folder selection-mode state for the dashboard grid/tree views:
 * whether selection mode is active, which asset ids and folder paths are
 * currently selected, and the handlers that toggle them.
 */
export function useMediaSelection() {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [selectedFolderPaths, setSelectedFolderPaths] = useState<Set<string>>(new Set());

  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssetIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(assetId)) {
        newSet.delete(assetId);
      } else {
        newSet.add(assetId);
      }
      return newSet;
    });
  };

  const toggleFolderSelection = (folderPath: string) => {
    setSelectedFolderPaths((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath); else next.add(folderPath);
      return next;
    });
  };

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    setSelectedAssetIds(new Set());
    setSelectedFolderPaths(new Set());
  };

  return {
    selectionMode,
    setSelectionMode,
    selectedAssetIds,
    setSelectedAssetIds,
    selectedFolderPaths,
    setSelectedFolderPaths,
    toggleAssetSelection,
    toggleFolderSelection,
    toggleSelectionMode,
  };
}
