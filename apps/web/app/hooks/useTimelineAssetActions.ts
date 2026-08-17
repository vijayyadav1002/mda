import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";
import { monthKeyOf } from "~/lib/date";
import type { Bucket, SectionState, TimelineAsset } from "~/hooks/useTimelineSections";

/* ── GraphQL ────────────────────────────────────────────────────── */

const DELETE_MEDIA_ASSET_MUTATION = `
  mutation DeleteMediaAsset($id: ID!) { deleteMediaAsset(id: $id) }
`;

/**
 * Timeline's destructive/queueing bulk actions on the current selection:
 * moving selected assets to Trash, and queueing them for compression or
 * (for videos) transcoding. Also owns the confirm-dialog and
 * compress-dialog open state those actions gate on.
 *
 * Takes the section/bucket state setters and the selection + toast/exit
 * callbacks as parameters, rather than importing `useTimelineSections` or
 * `useTimelineSelection` directly, since both are shared with other
 * timeline features.
 */
export function useTimelineAssetActions({
  apiUrl,
  selectedAssets,
  selectedVideos,
  sectionsRef,
  setSections,
  setMonthBuckets,
  showToast,
  exitSelection,
}: Readonly<{
  apiUrl: string;
  selectedAssets: TimelineAsset[];
  selectedVideos: TimelineAsset[];
  sectionsRef: MutableRefObject<Record<string, SectionState>>;
  setSections: Dispatch<SetStateAction<Record<string, SectionState>>>;
  setMonthBuckets: Dispatch<SetStateAction<Bucket[] | null>>;
  showToast: (message: string, queueLink?: boolean) => void;
  exitSelection: () => void;
}>) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isCompressDialogOpen, setIsCompressDialogOpen] = useState(false);

  const handleDeleteSelected = async () => {
    const token = getAuthToken();
    if (!token || selectedAssets.length === 0) return;
    const client = createGraphQLClient(token);
    let deleted = 0;
    const deletedIds = new Set<string>();
    for (const asset of selectedAssets) {
      try {
        await client.request(DELETE_MEDIA_ASSET_MUTATION, { id: asset.id });
        deleted += 1;
        deletedIds.add(asset.id);
      } catch (err) {
        console.error(`Failed to delete asset ${asset.id}:`, err);
      }
    }

    if (deletedIds.size > 0) {
      // Remove deleted assets from loaded sections and shrink bucket counts
      const removedPerMonth = new Map<string, number>();
      for (const [key, section] of Object.entries(sectionsRef.current)) {
        const removed = section.assets?.filter((a) => deletedIds.has(a.id)).length ?? 0;
        if (removed > 0) removedPerMonth.set(key, removed);
      }
      setSections((prev) => {
        const next: typeof prev = {};
        for (const [key, section] of Object.entries(prev)) {
          next[key] = section.assets?.some((a) => deletedIds.has(a.id))
            ? { ...section, assets: section.assets.filter((a) => !deletedIds.has(a.id)) }
            : section;
        }
        return next;
      });
      setMonthBuckets((prev) =>
        prev
          ? prev
              .map((b) => {
                const removed = removedPerMonth.get(monthKeyOf(b.period)) ?? 0;
                return removed > 0 ? { ...b, count: Math.max(0, b.count - removed) } : b;
              })
              .filter((b) => b.count > 0)
          : prev
      );
    }

    showToast(
      deleted === selectedAssets.length
        ? `Moved ${deleted} item${deleted !== 1 ? "s" : ""} to Trash`
        : `Moved ${deleted} of ${selectedAssets.length} items to Trash — some failed`
    );
    exitSelection();
  };

  const handleAddToCompressQueue = async (options: { resolution: string; quality: number }) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/compress/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: selectedAssets.map((a) => a.id), options }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      showToast("Compression job queued", true);
      exitSelection();
    } catch (err: any) {
      showToast(`Failed to queue compression: ${err.message}`);
    }
  };

  const handleTranscode = async () => {
    const token = getAuthToken();
    if (!token || selectedVideos.length === 0) return;
    try {
      const res = await fetch(`${apiUrl}/api/transcode/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: selectedVideos.map((a) => a.id) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Server error ${res.status}`);
      }
      showToast(`Transcoding ${selectedVideos.length} video${selectedVideos.length !== 1 ? "s" : ""}`, true);
      exitSelection();
    } catch (err: any) {
      showToast(`Failed to queue transcode: ${err.message}`);
    }
  };

  return {
    showDeleteConfirm,
    setShowDeleteConfirm,
    isCompressDialogOpen,
    setIsCompressDialogOpen,
    handleDeleteSelected,
    handleAddToCompressQueue,
    handleTranscode,
  };
}
