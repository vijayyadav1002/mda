import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";
import type { DirectoryNode, MediaAsset } from "~/lib/types";
import { type TagSuggestion } from "~/components/TagDialog";

const LIST_TAGS_QUERY = `
  query ListTags {
    tags { id name assetCount }
  }
`;

const MEDIA_ASSETS_BY_TAG_QUERY = `
  query MediaAssetsByTag($tagName: String!, $limit: Int, $offset: Int) {
    mediaAssetsByTag(tagName: $tagName, limit: $limit, offset: $offset) {
      id
      fileName
      filePath
      mimeType
      fileSize
      thumbnailUrl
      transcodedUrl
      createdAt
      capturedAt
      tags { id name }
    }
  }
`;

const APPLY_TAGS_MUTATION = `
  mutation ApplyTagsToAssets($assetIds: [ID!]!, $tagNames: [String!]!) {
    applyTagsToAssets(assetIds: $assetIds, tagNames: $tagNames) {
      id
      tags { id name }
    }
  }
`;

const REMOVE_TAGS_FROM_ASSETS_MUTATION = `
  mutation RemoveTagsFromAssets($assetIds: [ID!]!, $tagNames: [String!]!) {
    removeTagsFromAssets(assetIds: $assetIds, tagNames: $tagNames)
  }
`;

const REMOVE_TAG_MUTATION = `
  mutation RemoveTagFromAsset($assetId: ID!, $tagName: String!) {
    removeTagFromAsset(assetId: $assetId, tagName: $tagName) {
      id
      tags { id name }
    }
  }
`;

const RENAME_TAG_MUTATION = `
  mutation RenameTag($oldName: String!, $newName: String!) {
    renameTag(oldName: $oldName, newName: $newName) { id name }
  }
`;

const DELETE_TAG_MUTATION = `
  mutation DeleteTag($name: String!) {
    deleteTag(name: $name)
  }
`;

interface UseTagActionsParams {
  /** Currently open folder; re-fetched after a tag mutation so its cached children pick up the new tags. */
  currentPath: string | null;
  /** Library root; re-fetched alongside `currentPath` for mutations that touch it. */
  rootPath: string | null;
  /** From `useDirectoryTree` — refreshes a path's cached `DirectoryNode` after a tag mutation. */
  loadDirectoryIntoCache: (directoryPath?: string | null) => Promise<DirectoryNode | null>;
  /** Shared confirm-dialog opener used to gate destructive tag deletion. */
  openConfirm: (opts: {
    title: string;
    description: string;
    warning?: string;
    confirmLabel?: string;
    onConfirm: () => Promise<void>;
  }) => void;
}

/**
 * Owns the dashboard's tag feature: the existing-tags suggestion list, the
 * tag-filter (browse-by-tag) menu and its results, the TagDialog/RemoveTagsDialog
 * open/selection state, and the apply/remove/rename/delete tag actions
 * (including their GraphQL mutations and the directory-cache/tag-filter
 * refreshes each one triggers).
 *
 * Takes the directory-tree cache accessors and the shared confirm-dialog
 * opener as parameters rather than importing `useDirectoryTree` or owning a
 * confirm dialog itself, since both are shared with other dashboard features.
 */
export function useTagActions({ currentPath, rootPath, loadDirectoryIntoCache, openConfirm }: UseTagActionsParams) {
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
  const [tagDialogAssets, setTagDialogAssets] = useState<MediaAsset[]>([]);
  const [isRemoveTagsDialogOpen, setIsRemoveTagsDialogOpen] = useState(false);
  const [removeTagsAssets, setRemoveTagsAssets] = useState<MediaAsset[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);
  const [showTagFilterMenu, setShowTagFilterMenu] = useState(false);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [tagFilterAssets, setTagFilterAssets] = useState<MediaAsset[]>([]);
  const [tagFilterLoading, setTagFilterLoading] = useState(false);
  const tagFilterMenuRef = useRef<HTMLDivElement>(null);
  const tagFilterTriggerRef = useRef<HTMLButtonElement>(null);
  const [tagFilterMenuRight, setTagFilterMenuRight] = useState<number>(0);

  const refreshTagSuggestions = useCallback(async () => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const client = createGraphQLClient(token);
      const data: any = await client.request(LIST_TAGS_QUERY);
      const tags: TagSuggestion[] = (data?.tags ?? []).map((t: any) => ({
        id: String(t.id),
        name: t.name,
        assetCount: t.assetCount ?? 0,
      }));
      setTagSuggestions(tags);
    } catch (err) {
      console.error("Failed to load tags:", err);
    }
  }, []);

  const loadTagFilterAssets = useCallback(async (tagName: string) => {
    const token = getAuthToken();
    if (!token) return;
    setTagFilterLoading(true);
    try {
      const client = createGraphQLClient(token);
      const data: any = await client.request(MEDIA_ASSETS_BY_TAG_QUERY, {
        tagName,
        limit: 500,
        offset: 0,
      });
      setTagFilterAssets((data?.mediaAssetsByTag ?? []) as MediaAsset[]);
    } catch (err: any) {
      console.error("Failed to load tag filter:", err);
      setTagFilterAssets([]);
    } finally {
      setTagFilterLoading(false);
    }
  }, []);

  const applyTagFilter = useCallback(async (tagName: string) => {
    setActiveTagFilter(tagName);
    setShowTagFilterMenu(false);
    await loadTagFilterAssets(tagName);
  }, [loadTagFilterAssets]);

  const clearTagFilter = useCallback(() => {
    setActiveTagFilter(null);
    setTagFilterAssets([]);
  }, []);

  const applyTagsToAssets = useCallback(async (assetIds: string[], tagNames: string[]) => {
    const token = getAuthToken();
    if (!token) throw new Error("Not authenticated");
    const client = createGraphQLClient(token);
    const data: any = await client.request(APPLY_TAGS_MUTATION, { assetIds, tagNames });
    await refreshTagSuggestions();
    if (currentPath) await loadDirectoryIntoCache(currentPath);
    if (rootPath && rootPath !== currentPath) await loadDirectoryIntoCache(rootPath);
    if (activeTagFilter) await loadTagFilterAssets(activeTagFilter);
    return data.applyTagsToAssets as Array<{ id: string; tags: Array<{ id: string; name: string }> }>;
  }, [activeTagFilter, currentPath, loadDirectoryIntoCache, loadTagFilterAssets, refreshTagSuggestions, rootPath]);

  const removeTagsFromAssets = useCallback(async (assetIds: string[], tagNames: string[]) => {
    const token = getAuthToken();
    if (!token) throw new Error("Not authenticated");
    const client = createGraphQLClient(token);
    await client.request(REMOVE_TAGS_FROM_ASSETS_MUTATION, { assetIds, tagNames });
    await refreshTagSuggestions();
    if (currentPath) await loadDirectoryIntoCache(currentPath);
    if (rootPath && rootPath !== currentPath) await loadDirectoryIntoCache(rootPath);
    if (activeTagFilter) await loadTagFilterAssets(activeTagFilter);
  }, [activeTagFilter, currentPath, loadDirectoryIntoCache, loadTagFilterAssets, refreshTagSuggestions, rootPath]);

  const removeTagFromAsset = useCallback(async (assetId: string, tagName: string) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const client = createGraphQLClient(token);
      await client.request(REMOVE_TAG_MUTATION, { assetId, tagName });
      await refreshTagSuggestions();
      if (currentPath) await loadDirectoryIntoCache(currentPath);
      if (activeTagFilter) await loadTagFilterAssets(activeTagFilter);
    } catch (err: any) {
      console.error("Failed to remove tag:", err);
      alert(`Failed to remove tag: ${err.message || "Unknown error"}`);
    }
  }, [activeTagFilter, currentPath, loadDirectoryIntoCache, loadTagFilterAssets, refreshTagSuggestions]);

  const handleRenameTag = useCallback(async (oldName: string) => {
    const input = window.prompt(`Rename #${oldName} to:`, oldName);
    if (input == null) return;
    const newName = input.trim().replace(/^#/, "").toLowerCase();
    if (!newName || newName === oldName) return;
    const token = getAuthToken();
    if (!token) return;
    try {
      const client = createGraphQLClient(token);
      await client.request(RENAME_TAG_MUTATION, { oldName, newName });
      await refreshTagSuggestions();
      if (currentPath) await loadDirectoryIntoCache(currentPath);
      if (activeTagFilter === oldName) {
        setActiveTagFilter(newName);
        await loadTagFilterAssets(newName);
      } else if (activeTagFilter) {
        await loadTagFilterAssets(activeTagFilter);
      }
    } catch (err: any) {
      console.error("Failed to rename tag:", err);
      alert(`Failed to rename tag: ${err.message || "Unknown error"}`);
    }
  }, [activeTagFilter, currentPath, loadDirectoryIntoCache, loadTagFilterAssets, refreshTagSuggestions]);

  const handleDeleteTag = useCallback((name: string) => {
    openConfirm({
      title: "Delete Tag",
      description: `Delete #${name} from every file in the library?`,
      warning: "This cannot be undone.",
      onConfirm: async () => {
        const token = getAuthToken();
        if (!token) return;
        try {
          const client = createGraphQLClient(token);
          await client.request(DELETE_TAG_MUTATION, { name });
          await refreshTagSuggestions();
          if (currentPath) await loadDirectoryIntoCache(currentPath);
          if (activeTagFilter === name) {
            setActiveTagFilter(null);
            setTagFilterAssets([]);
          }
        } catch (err: any) {
          console.error("Failed to delete tag:", err);
          alert(`Failed to delete tag: ${err.message || "Unknown error"}`);
        }
      },
    });
  }, [openConfirm, activeTagFilter, currentPath, loadDirectoryIntoCache, refreshTagSuggestions]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tagFilterMenuRef.current && !tagFilterMenuRef.current.contains(e.target as Node)) {
        setShowTagFilterMenu(false);
      }
    };
    if (showTagFilterMenu) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showTagFilterMenu]);

  const tagFilterNodes = useMemo<DirectoryNode[]>(() => {
    return tagFilterAssets.map((asset) => ({
      name: asset.fileName,
      path: asset.filePath,
      type: "file",
      children: null,
      mediaAsset: asset,
    }));
  }, [tagFilterAssets]);

  return {
    isTagDialogOpen,
    setIsTagDialogOpen,
    tagDialogAssets,
    setTagDialogAssets,
    isRemoveTagsDialogOpen,
    setIsRemoveTagsDialogOpen,
    removeTagsAssets,
    setRemoveTagsAssets,
    tagSuggestions,
    showTagFilterMenu,
    setShowTagFilterMenu,
    activeTagFilter,
    tagFilterAssets,
    tagFilterLoading,
    tagFilterMenuRef,
    tagFilterTriggerRef,
    tagFilterMenuRight,
    setTagFilterMenuRight,
    tagFilterNodes,
    refreshTagSuggestions,
    applyTagFilter,
    clearTagFilter,
    applyTagsToAssets,
    removeTagsFromAssets,
    removeTagFromAsset,
    handleRenameTag,
    handleDeleteTag,
  };
}
