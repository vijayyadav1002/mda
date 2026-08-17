import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";
import { type TagSuggestion } from "~/components/TagDialog";
import type { AssetTag, SectionState, TimelineAsset } from "~/hooks/useTimelineSections";

const TAGS_QUERY = `
  query Tags { tags { id name assetCount } }
`;

const APPLY_TAGS_MUTATION = `
  mutation ApplyTagsToAssets($assetIds: [ID!]!, $tagNames: [String!]!) {
    applyTagsToAssets(assetIds: $assetIds, tagNames: $tagNames) { id tags { id name } }
  }
`;

const REMOVE_TAGS_FROM_ASSETS_MUTATION = `
  mutation RemoveTagsFromAssets($assetIds: [ID!]!, $tagNames: [String!]!) {
    removeTagsFromAssets(assetIds: $assetIds, tagNames: $tagNames)
  }
`;

const REMOVE_TAG_MUTATION = `
  mutation RemoveTagFromAsset($assetId: ID!, $tagName: String!) {
    removeTagFromAsset(assetId: $assetId, tagName: $tagName) { id }
  }
`;

interface UseTimelineTagActionsParams {
  /** Whether multi-select mode is active — also triggers the tag-suggestions preload. */
  selectionMode: boolean;
  /** Exits selection mode after a bulk tag apply/remove, as the original page did inline. */
  exitSelection: () => void;
  /** Currently open lightbox asset; read by `handleRemoveSingleTag` and patched by tag updates. */
  selectedAsset: TimelineAsset | null;
  setSelectedAsset: Dispatch<SetStateAction<TimelineAsset | null>>;
  /** From `useTimelineSections` — patched in place so loaded tiles reflect new tags. */
  setSections: Dispatch<SetStateAction<Record<string, SectionState>>>;
  showToast: (message: string, queueLink?: boolean) => void;
}

/**
 * Owns the timeline's tag dialogs (add/remove) and their apply/remove
 * mutations: dialog open state, the assets targeted by the dialog, the
 * existing-tags suggestion list, and patching loaded sections + the open
 * viewer asset with the server's updated tags after each mutation.
 */
export function useTimelineTagActions({
  selectionMode,
  exitSelection,
  selectedAsset,
  setSelectedAsset,
  setSections,
  showToast,
}: UseTimelineTagActionsParams) {
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
  const [isRemoveTagsDialogOpen, setIsRemoveTagsDialogOpen] = useState(false);
  const [tagTargets, setTagTargets] = useState<TimelineAsset[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);

  // Load tag suggestions once selection mode or the tag dialog is first used
  useEffect(() => {
    if ((!selectionMode && !isTagDialogOpen) || tagSuggestions.length > 0) return;
    const token = getAuthToken();
    if (!token) return;
    createGraphQLClient(token)
      .request<{ tags: TagSuggestion[] }>(TAGS_QUERY)
      .then((data) => setTagSuggestions(data.tags))
      .catch(() => {});
  }, [selectionMode, isTagDialogOpen, tagSuggestions.length]);

  // Apply the given tags map to loaded sections + the open viewer asset
  const updateLocalAssetTags = useCallback((updated: Array<{ id: string; tags: AssetTag[] }>) => {
    const byId = new Map(updated.map((u) => [u.id, u.tags]));
    setSections((prev) => {
      const next: typeof prev = {};
      for (const [key, section] of Object.entries(prev)) {
        if (section.assets?.some((a) => byId.has(a.id))) {
          next[key] = {
            ...section,
            assets: section.assets.map((a) => (byId.has(a.id) ? { ...a, tags: byId.get(a.id) } : a)),
          };
        } else {
          next[key] = section;
        }
      }
      return next;
    });
    setSelectedAsset((prev) => (prev && byId.has(prev.id) ? { ...prev, tags: byId.get(prev.id) } : prev));
  }, []);

  const handleApplyTags = async (tagNames: string[]) => {
    const token = getAuthToken();
    if (!token) return;
    const data = await createGraphQLClient(token).request<{ applyTagsToAssets: Array<{ id: string; tags: AssetTag[] }> }>(
      APPLY_TAGS_MUTATION,
      { assetIds: tagTargets.map((a) => a.id), tagNames }
    );
    updateLocalAssetTags(data.applyTagsToAssets);
    showToast(`Tagged ${tagTargets.length} item${tagTargets.length !== 1 ? "s" : ""}`);
    if (selectionMode) exitSelection();
  };

  const handleRemoveTagsBulk = async (tagNames: string[]) => {
    const token = getAuthToken();
    if (!token) return;
    await createGraphQLClient(token).request(REMOVE_TAGS_FROM_ASSETS_MUTATION, {
      assetIds: tagTargets.map((a) => a.id),
      tagNames,
    });
    updateLocalAssetTags(
      tagTargets.map((a) => ({
        id: a.id,
        tags: (a.tags ?? []).filter((t) => !tagNames.includes(t.name)),
      }))
    );
    showToast(`Removed tags from ${tagTargets.length} item${tagTargets.length !== 1 ? "s" : ""}`);
    if (selectionMode) exitSelection();
  };

  const handleRemoveSingleTag = async (tagName: string) => {
    if (!selectedAsset) return;
    const token = getAuthToken();
    if (!token) return;
    await createGraphQLClient(token).request(REMOVE_TAG_MUTATION, {
      assetId: selectedAsset.id,
      tagName,
    });
    updateLocalAssetTags([
      { id: selectedAsset.id, tags: (selectedAsset.tags ?? []).filter((t) => t.name !== tagName) },
    ]);
  };

  return {
    isTagDialogOpen,
    setIsTagDialogOpen,
    isRemoveTagsDialogOpen,
    setIsRemoveTagsDialogOpen,
    tagTargets,
    setTagTargets,
    tagSuggestions,
    updateLocalAssetTags,
    handleApplyTags,
    handleRemoveTagsBulk,
    handleRemoveSingleTag,
  };
}
