import { useCallback, useState } from "react";
import type { TimelineAsset } from "~/hooks/useTimelineSections";

/**
 * Timeline's own asset-selection state: whether selection mode is active,
 * which asset ids are selected, and the handlers that toggle them.
 *
 * This is timeline's counterpart to the dashboard's `useMediaSelection` —
 * a separate, timeline-specific copy (no folder selection, no shared
 * state with the dashboard).
 */
export function useTimelineSelection() {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const toggleAssetSelection = (assetId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  // Toggle selection of every (loaded) asset in a month section
  const toggleSectionSelection = useCallback((assets: TimelineAsset[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = assets.every((a) => next.has(a.id));
      for (const asset of assets) {
        if (allSelected) next.delete(asset.id);
        else next.add(asset.id);
      }
      return next;
    });
  }, []);

  return {
    selectionMode,
    setSelectionMode,
    selectedIds,
    setSelectedIds,
    toggleAssetSelection,
    toggleSectionSelection,
    exitSelection,
  };
}
