import { useMemo, useState } from "react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";
import type { DirectoryNode } from "~/lib/types";

const DIRECTORY_NODE_QUERY = `
  fragment FileInfo on MediaAsset {
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

  fragment DirNode on DirectoryNode {
    name
    path
    type
    size
    mediaAsset {
      ...FileInfo
    }
  }

  query GetDirectoryNode($path: String) {
    directoryNode(path: $path) {
      ...DirNode
      children {
        ...DirNode
      }
    }
  }
`;

/**
 * Owns the directory-tree cache used by the dashboard: the path-keyed
 * `DirectoryNode` cache, the current/root path, the folder-history
 * breadcrumb trail, and tree expand/collapse state.
 *
 * `loadDirectoryIntoCache` is the shared entry point other dashboard
 * features (uploads, tagging, compress/transcode, folder CRUD, cache-clear,
 * etc.) call to refresh a path's subtree after their own mutations, so it's
 * exposed alongside the raw cache/setters those call sites also touch
 * directly (e.g. invalidating a subtree after a delete/rename).
 */
export function useDirectoryTree() {
  const [directoryCache, setDirectoryCache] = useState<Record<string, DirectoryNode>>({});
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [folderHistory, setFolderHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const mergeDirectoryNode = (node: DirectoryNode) => {
    setDirectoryCache((prev) => {
      const next = { ...prev };
      const incomingChildren = node.children ?? [];
      const mergedChildren = incomingChildren.map((child) => {
        const cachedChild = prev[child.path];
        if (child.type === "directory" && cachedChild) {
          return { ...child, children: cachedChild.children ?? child.children ?? null };
        }
        return child;
      });
      next[node.path] = { ...node, children: mergedChildren };
      for (const child of mergedChildren) {
        if (child.type === "directory") {
          const cachedChild = prev[child.path];
          next[child.path] = cachedChild
            ? { ...cachedChild, name: child.name, path: child.path, type: "directory" }
            : { ...child, children: child.children ?? null };
        }
      }
      return next;
    });
  };

  const fetchDirectoryNode = async (directoryPath?: string | null) => {
    const token = getAuthToken();
    if (!token) return null;
    const client = createGraphQLClient(token);
    const data: any = await client.request(DIRECTORY_NODE_QUERY, { path: directoryPath ?? null });
    return data.directoryNode as DirectoryNode;
  };

  const loadDirectoryIntoCache = async (directoryPath?: string | null) => {
    const node = await fetchDirectoryNode(directoryPath);
    if (!node) return null;
    mergeDirectoryNode(node);
    return node;
  };

  const loadData = async () => {
    try {
      const rootNode = await loadDirectoryIntoCache(null);
      if (!rootNode) return;
      setRootPath(rootNode.path);
      // Only set the initial folder if a search-driven `?path=` jump hasn't
      // already landed; otherwise we'd race with jumpToPath and clobber it.
      setCurrentPath((prev) => prev ?? rootNode.path);
      if (rootNode.path) {
        setExpandedFolders((prev) => (prev.size > 0 ? prev : new Set([rootNode.path])));
      }
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleFolder = async (directoryPath: string) => {
    const isExpanded = expandedFolders.has(directoryPath);
    setExpandedFolders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(directoryPath)) {
        newSet.delete(directoryPath);
      } else {
        newSet.add(directoryPath);
      }
      return newSet;
    });
    if (!isExpanded) {
      const cachedNode = directoryCache[directoryPath];
      if (!cachedNode || cachedNode.children === null || cachedNode.children === undefined) {
        await loadDirectoryIntoCache(directoryPath);
      }
    }
  };

  const handleBackClick = async () => {
    if (folderHistory.length === 0) return;
    const nextHistory = [...folderHistory];
    const previousPath = nextHistory.pop() || null;
    setFolderHistory(nextHistory);
    if (!previousPath) return;
    setCurrentPath(previousPath);
    const cachedNode = directoryCache[previousPath];
    if (!cachedNode || cachedNode.children === null || cachedNode.children === undefined) {
      await loadDirectoryIntoCache(previousPath);
    }
  };

  const currentFolder = currentPath ? directoryCache[currentPath] || null : null;
  const directoryTree = rootPath ? directoryCache[rootPath] || null : null;
  const currentFolderChildren = Array.isArray(currentFolder?.children) ? currentFolder.children : [];
  const isCurrentFolderLoading = !!currentFolder && currentFolder.children === null;

  const allDirectories = useMemo(() => {
    const dirs: { path: string; displayName: string }[] = [];
    const seen = new Set<string>();
    const traverse = (node: DirectoryNode, depth: number) => {
      if (seen.has(node.path)) return;
      seen.add(node.path);
      if (node.type !== 'directory') return;
      dirs.push({ path: node.path, displayName: node.path === rootPath ? '/ (Root)' : '\u00a0\u00a0'.repeat(depth) + node.name });
      for (const child of node.children ?? []) {
        if (child.type === 'directory') traverse(directoryCache[child.path] || child, depth + 1);
      }
    };
    if (rootPath && directoryCache[rootPath]) traverse(directoryCache[rootPath], 0);
    return dirs;
  }, [directoryCache, rootPath]);

  const allAvailableFolders = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ name: string; path: string }> = [];
    for (const node of Object.values(directoryCache)) {
      if (!seen.has(node.path)) {
        seen.add(node.path);
        result.push({ name: node.name, path: node.path });
      }
      if (node.children) {
        for (const child of node.children) {
          if (child.type === 'directory' && !seen.has(child.path)) {
            seen.add(child.path);
            result.push({ name: child.name, path: child.path });
          }
        }
      }
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }, [directoryCache]);

  const isAtRoot = currentPath === rootPath;
  const rootSize = rootPath ? (directoryCache[rootPath]?.size ?? null) : null;

  return {
    directoryCache,
    setDirectoryCache,
    rootPath,
    currentPath,
    setCurrentPath,
    folderHistory,
    setFolderHistory,
    expandedFolders,
    loading,
    loadData,
    loadDirectoryIntoCache,
    toggleFolder,
    handleBackClick,
    currentFolder,
    directoryTree,
    currentFolderChildren,
    isCurrentFolderLoading,
    allDirectories,
    allAvailableFolders,
    isAtRoot,
    rootSize,
  };
}
