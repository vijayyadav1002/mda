import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";
import type { SectionState, TimelineAsset } from "~/hooks/useTimelineSections";

/* ── GraphQL ────────────────────────────────────────────────────── */

const GENERATE_THUMBNAILS_MUTATION = `
  mutation GenerateThumbnailsForAssets($ids: [ID!]!, $sessionId: String, $force: Boolean) {
    generateThumbnailsForAssets(ids: $ids, sessionId: $sessionId, force: $force)
  }
`;

/* ── Helpers ────────────────────────────────────────────────────── */

const sessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `tl-${Date.now()}-${hex}`;
};

/**
 * Timeline's thumbnail refresh / error-handling logic: queues on-demand
 * generation for loaded sections missing thumbnails, clears a tile's
 * thumbnail locally when its image fails to load so it gets re-queued and
 * re-fetched, and drives the manual "Regenerate thumbnails" bulk action.
 *
 * Takes the section/visibility state from `useTimelineSections` and the
 * selection state + toast/exit callbacks it needs as parameters, rather
 * than importing those hooks directly.
 */
export function useThumbnailRefresh({
  sections,
  setSections,
  visibleMonths,
  isGridLevel,
  refreshSectionThumbnails,
  selectedAssets,
  selectedIds,
  showToast,
  exitSelection,
}: Readonly<{
  sections: Record<string, SectionState>;
  setSections: Dispatch<SetStateAction<Record<string, SectionState>>>;
  visibleMonths: Set<string>;
  isGridLevel: boolean;
  refreshSectionThumbnails: (monthKey: string) => Promise<void>;
  selectedAssets: TimelineAsset[];
  selectedIds: Set<string>;
  showToast: (message: string, queueLink?: boolean) => void;
  exitSelection: () => void;
}>) {
  const requestedThumbIdsRef = useRef<Set<string>>(new Set());
  const thumbnailSessionIdRef = useRef<string>(sessionId());

  // Queue on-demand thumbnail generation for loaded, visible sections
  useEffect(() => {
    if (!isGridLevel) return;
    const missing: string[] = [];
    const monthsWithMissing: string[] = [];
    for (const key of visibleMonths) {
      const section = sections[key];
      if (!section?.assets) continue;
      const ids = section.assets
        .filter((a) => !a.thumbnailUrl && !requestedThumbIdsRef.current.has(a.id))
        .map((a) => a.id);
      if (ids.length > 0) {
        missing.push(...ids);
        if (section.thumbRetries < 4) monthsWithMissing.push(key);
      }
    }
    if (missing.length === 0) return;
    for (const id of missing) requestedThumbIdsRef.current.add(id);

    const token = getAuthToken();
    if (!token) return;
    const client = createGraphQLClient(token);
    void client
      .request(GENERATE_THUMBNAILS_MUTATION, { ids: missing.slice(0, 300), sessionId: thumbnailSessionIdRef.current })
      .catch((err) => console.error("Failed to queue thumbnails:", err));

    const timer = window.setTimeout(() => {
      for (const key of monthsWithMissing) void refreshSectionThumbnails(key);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [visibleMonths, sections, isGridLevel, refreshSectionThumbnails]);

  const handleRegenerateThumbnails = async () => {
    const token = getAuthToken();
    if (!token || selectedAssets.length === 0) return;
    const ids = selectedAssets.map((a) => a.id);
    try {
      await createGraphQLClient(token).request(GENERATE_THUMBNAILS_MUTATION, {
        ids,
        sessionId: thumbnailSessionIdRef.current,
        force: true,
      });
      // Prevent the on-demand effect from double-queueing while we wait
      for (const id of ids) requestedThumbIdsRef.current.add(id);
      // Show placeholders right away; the refetch below picks up fresh thumbs
      const affectedMonths = new Set<string>();
      setSections((prev) => {
        const next: typeof prev = {};
        for (const [key, section] of Object.entries(prev)) {
          if (section.assets?.some((a) => selectedIds.has(a.id))) {
            affectedMonths.add(key);
            next[key] = {
              ...section,
              assets: section.assets.map((a) =>
                selectedIds.has(a.id) ? { ...a, thumbnailUrl: null } : a
              ),
            };
          } else {
            next[key] = section;
          }
        }
        return next;
      });
      window.setTimeout(() => {
        for (const key of affectedMonths) void refreshSectionThumbnails(key);
      }, 6000);
      showToast(`Regenerating ${ids.length} thumbnail${ids.length !== 1 ? "s" : ""}`);
      exitSelection();
    } catch (err: any) {
      showToast(`Failed to queue thumbnails: ${err.message}`);
    }
  };

  // A tile's thumbnail URL can go stale if cache eviction removed the file
  // after the section was fetched. Clear it locally so the on-demand
  // generation effect re-queues it and the section refetch picks up the
  // fresh thumbnail — the tile shows a placeholder in the meantime.
  const handleThumbError = useCallback((assetId: string) => {
    requestedThumbIdsRef.current.delete(assetId);
    setSections((prev) => {
      let changed = false;
      const next: typeof prev = {};
      for (const [key, section] of Object.entries(prev)) {
        if (section.assets?.some((a) => a.id === assetId && a.thumbnailUrl)) {
          changed = true;
          next[key] = {
            ...section,
            assets: section.assets.map((a) => (a.id === assetId ? { ...a, thumbnailUrl: null } : a)),
          };
        } else {
          next[key] = section;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  return { handleThumbError, handleRegenerateThumbnails };
}
