import { useCallback, useMemo, useState } from "react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";
import type { DirectoryNode, MediaAsset } from "~/lib/types";
import type { SortOption } from "~/components/SortMenu";

const SEARCH_RESULTS_QUERY = `
  query SearchResults($term: String, $mediaType: String, $sortBy: String, $limit: Int, $minSize: Float, $maxSize: Float, $path: String) {
    search(term: $term, mediaType: $mediaType, sortBy: $sortBy, limit: $limit, minSize: $minSize, maxSize: $maxSize, path: $path) {
      files {
        id fileName filePath fileSize mimeType
        thumbnailUrl transcodedUrl
        indexedAt createdAt updatedAt capturedAt
        tags { id name }
      }
      folders { name path parentPath }
    }
  }
`;

interface UseSearchParams {
  /** Current folder; scopes search results when not at the library root. */
  currentPath: string | null;
  /** Library root; search is unscoped when `currentPath` equals this. */
  rootPath: string | null;
  /** Dashboard's active sort, forwarded to the search query as `sortBy`. */
  sortOption: SortOption;
}

/**
 * Owns the dashboard's search feature: query/results/loading state, the
 * limit and minimum-size filters, the search GraphQL request, and the
 * `DirectoryNode` projection of the results used to render them alongside
 * regular folder children.
 */
export function useSearch({ currentPath, rootPath, sortOption }: UseSearchParams) {
  const [searchQuery, setSearchQuery] = useState<{ term: string; mediaType: string } | null>(null);
  const [searchAssets, setSearchAssets] = useState<MediaAsset[]>([]);
  const [searchFolders, setSearchFolders] = useState<{ name: string; path: string; parentPath?: string | null }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLimit, setSearchLimit] = useState<25 | 50 | 100 | 250 | 0>(25);
  const [minSizeBytes, setMinSizeBytes] = useState<number>(0); // 0 = no filter

  const handleSearch = useCallback(async (term: string, mediaType: string) => {
    const trimmed = term.trim();
    if (!trimmed && mediaType === "all") {
      setSearchQuery(null);
      setSearchAssets([]);
      setSearchFolders([]);
      return;
    }
    setSearchQuery({ term: trimmed, mediaType });
    setSearchLoading(true);
    const token = getAuthToken();
    if (!token) { setSearchLoading(false); return; }
    try {
      const client = createGraphQLClient(token);
      const vars: Record<string, unknown> = { limit: searchLimit };
      if (trimmed) vars.term = trimmed;
      if (mediaType !== "all") vars.mediaType = mediaType;
      if (sortOption !== "default") vars.sortBy = sortOption;
      if (minSizeBytes > 0) vars.minSize = minSizeBytes;
      if (currentPath && currentPath !== rootPath) vars.path = currentPath;
      const data: any = await client.request(SEARCH_RESULTS_QUERY, vars);
      setSearchAssets((data?.search?.files ?? []) as MediaAsset[]);
      setSearchFolders(data?.search?.folders ?? []);
    } catch (err) {
      console.error("Search failed:", err);
      setSearchAssets([]);
      setSearchFolders([]);
    } finally {
      setSearchLoading(false);
    }
  }, [searchLimit, sortOption, minSizeBytes, currentPath, rootPath]);

  const handleClearSearch = useCallback(() => {
    setSearchQuery(null);
    setSearchAssets([]);
    setSearchFolders([]);
    setMinSizeBytes(0);
  }, []);

  /** Resets query/results without touching `minSizeBytes`, unlike `handleClearSearch`. */
  const clearSearchState = useCallback(() => {
    setSearchQuery(null);
    setSearchAssets([]);
    setSearchFolders([]);
  }, []);

  const searchResultNodes = useMemo<DirectoryNode[]>(() => {
    const folderNodes: DirectoryNode[] = searchFolders.map((folder) => ({
      name: folder.name,
      path: folder.path,
      type: "directory",
      children: null,
    }));
    const fileNodes: DirectoryNode[] = searchAssets.map((asset) => ({
      name: asset.fileName,
      path: asset.filePath,
      type: "file",
      children: null,
      mediaAsset: asset,
    }));
    return [...folderNodes, ...fileNodes];
  }, [searchAssets, searchFolders]);

  return {
    searchQuery,
    searchAssets,
    searchLoading,
    searchLimit,
    setSearchLimit,
    minSizeBytes,
    setMinSizeBytes,
    handleSearch,
    handleClearSearch,
    clearSearchState,
    searchResultNodes,
  };
}
