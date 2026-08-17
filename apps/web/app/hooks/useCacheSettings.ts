import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";
import type { CacheSettingsData, CacheStats, DirectoryNode } from "~/lib/types";

const CACHE_STATS_QUERY = `
  query CacheStats {
    cacheStats {
      totalBytes
      thumbnails { label bytes fileCount maxBytes }
      previews   { label bytes fileCount maxBytes }
      hls        { label bytes fileCount maxBytes }
      transcoded { label bytes fileCount maxBytes }
    }
  }
`;

const CLEAR_CACHE_MUTATION = `
  mutation ClearCache($type: String!) {
    clearCache(type: $type) {
      totalBytes
      thumbnails { label bytes fileCount maxBytes }
      previews   { label bytes fileCount maxBytes }
      hls        { label bytes fileCount maxBytes }
      transcoded { label bytes fileCount maxBytes }
    }
  }
`;

const CACHE_SETTINGS_FIELDS = `
  thumbnailCacheMaxMb previewCacheMaxMb hlsCacheMaxMb transcodedCacheMaxMb
  previewCacheMaxAgeDays hlsCacheMaxAgeHours
`;

const CACHE_SETTINGS_QUERY = `
  query CacheSettings { cacheSettings { ${CACHE_SETTINGS_FIELDS} } }
`;

const UPDATE_CACHE_SETTINGS_MUTATION = `
  mutation UpdateCacheSettings($input: CacheSettingsInput!) {
    updateCacheSettings(input: $input) { ${CACHE_SETTINGS_FIELDS} }
  }
`;

interface UseCacheSettingsParams {
  /** Current user's role; cache stats/settings are only fetched for `"admin"`. */
  userRole: string | undefined;
  /** Library root; re-fetched after a cache clear so its cached children drop stale thumbnail/transcode URLs. */
  rootPath: string | null;
  /** Currently open folder; re-fetched alongside `rootPath` after a cache clear. */
  currentPath: string | null;
  /** From `useDirectoryTree` — refreshes a path's cached `DirectoryNode` after a cache clear. */
  loadDirectoryIntoCache: (directoryPath?: string | null) => Promise<DirectoryNode | null>;
  /** From `useDirectoryTree` — flushed entirely after a cache clear so stale thumbnail/transcode URLs are dropped. */
  setDirectoryCache: Dispatch<SetStateAction<Record<string, DirectoryNode>>>;
  /** Shared confirm-dialog opener used to gate the destructive cache-clear action. */
  openConfirm: (opts: {
    title: string;
    description: string;
    warning?: string;
    confirmLabel?: string;
    onConfirm: () => Promise<void>;
  }) => void;
}

/**
 * Owns the dashboard's admin cache-settings panel: current cache usage stats
 * (polled every 10s), the configurable cache-size/age settings, the panel's
 * open/closed state, and the fetch/save/clear actions (including their
 * GraphQL queries/mutations and the directory-cache refresh a clear triggers).
 *
 * Takes the directory-tree cache accessors and the shared confirm-dialog
 * opener as parameters rather than importing `useDirectoryTree` or owning a
 * confirm dialog itself, since both are shared with other dashboard features.
 */
export function useCacheSettings({
  userRole,
  rootPath,
  currentPath,
  loadDirectoryIntoCache,
  setDirectoryCache,
  openConfirm,
}: UseCacheSettingsParams) {
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheSettings, setCacheSettings] = useState<CacheSettingsData | null>(null);
  const [showCachePanel, setShowCachePanel] = useState(false);

  const fetchCacheStats = useCallback(async () => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const client = createGraphQLClient(token);
      const data = await client.request<{ cacheStats: CacheStats }>(CACHE_STATS_QUERY);
      setCacheStats(data.cacheStats);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    if (userRole !== "admin") return;
    void fetchCacheStats();
    const id = window.setInterval(fetchCacheStats, 10_000);
    return () => window.clearInterval(id);
  }, [userRole, fetchCacheStats]);

  useEffect(() => {
    if (userRole !== "admin") return;
    const token = getAuthToken();
    if (!token) return;
    const client = createGraphQLClient(token);
    client
      .request<{ cacheSettings: CacheSettingsData }>(CACHE_SETTINGS_QUERY)
      .then((data) => setCacheSettings(data.cacheSettings))
      .catch(() => { /* non-critical */ });
  }, [userRole]);

  const handleSaveCacheSettings = useCallback(async (input: Partial<CacheSettingsData>) => {
    const token = getAuthToken();
    if (!token) throw new Error("Not authenticated");
    const client = createGraphQLClient(token);
    const data = await client.request<{ updateCacheSettings: CacheSettingsData }>(
      UPDATE_CACHE_SETTINGS_MUTATION,
      { input }
    );
    setCacheSettings(data.updateCacheSettings);
    void fetchCacheStats();
  }, [fetchCacheStats]);

  const handleClearCache = (type: string) => {
    openConfirm({
      title: "Clear Cache",
      description: `Clear ${type === "all" ? "all caches" : `${type} cache`}?`,
      warning: "This cannot be undone.",
      confirmLabel: "Clear",
      onConfirm: async () => {
        try {
          const token = getAuthToken();
          if (!token) return;
          const client = createGraphQLClient(token);
          const data = await client.request<{ clearCache: CacheStats }>(CLEAR_CACHE_MUTATION, { type });
          setCacheStats(data.clearCache);
          // Flush stale directory state so thumbnailUrl/transcodedUrl reflect the nulled DB rows
          setDirectoryCache({});
          if (rootPath) await loadDirectoryIntoCache(rootPath);
          if (currentPath && currentPath !== rootPath) await loadDirectoryIntoCache(currentPath);
        } catch (err) {
          console.error("Failed to clear cache:", err);
          alert("Failed to clear cache. Please try again.");
        }
      },
    });
  };

  const toggleCachePanel = () => {
    setShowCachePanel((p) => {
      if (!p) void fetchCacheStats();
      return !p;
    });
  };

  return {
    cacheStats,
    cacheSettings,
    showCachePanel,
    fetchCacheStats,
    handleSaveCacheSettings,
    handleClearCache,
    toggleCachePanel,
  };
}
