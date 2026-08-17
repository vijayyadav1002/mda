import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { createGraphQLClient, getApiUrl, getAuthToken, clearAuthToken } from "~/lib/api";
import { MediaAssetViewer } from "~/components/MediaAssetViewer";
import { CompressDialog } from "~/components/CompressDialog";
import { CompressQueuePanel } from "~/components/CompressQueuePanel";
import { TagDialog } from "~/components/TagDialog";
import { RemoveTagsDialog } from "~/components/RemoveTagsDialog";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { ChangePasswordDialog } from "~/components/ChangePasswordDialog";
import { LogoutConfirmDialog } from "~/components/LogoutConfirmDialog";
import { NewFileDialog } from "~/components/NewFileDialog";
import { NewFolderDialog } from "~/components/NewFolderDialog";
import { UploadDialog } from "~/components/UploadDialog";
import { MoveDialog } from "~/components/MoveDialog";
import { DuplicateDialog } from "~/components/DuplicateDialog";
import { RenameFolderDialog } from "~/components/RenameFolderDialog";
import { SearchBar } from "~/components/SearchBar";
import { formatDate, formatBytes } from "~/lib/format";
import { getFileCategory, getFileCategoryLabel, canCompressAsset } from "~/lib/file-type";
import type { MediaAsset, DirectoryNode } from "~/lib/types";
import { useDirectoryTree } from "~/hooks/useDirectoryTree";
import { useMediaSelection } from "~/hooks/useMediaSelection";
import { useConfirmDialog } from "~/hooks/useConfirmDialog";
import { useTagActions } from "~/hooks/useTagActions";
import { useThumbnailObserver } from "~/hooks/useThumbnailObserver";
import { useFileUpload } from "~/hooks/useFileUpload";
import { useCacheSettings } from "~/hooks/useCacheSettings";
import { usePasswordChange } from "~/hooks/usePasswordChange";
import { useSearch } from "~/hooks/useSearch";
import { useCompressQueue } from "~/hooks/useCompressQueue";
import { useFileCrud } from "~/hooks/useFileCrud";
import { useFolderCrud } from "~/hooks/useFolderCrud";
import { Sidebar } from "~/components/Sidebar";
import { MobileNav } from "~/components/MobileNav";
import { FileTypeIcon } from "~/components/FileTypeIcon";
import { TagFilterMenu } from "~/components/TagFilterMenu";
import { SortMenu } from "~/components/SortMenu";
import {
  Folder, FileImage, FileText, ArrowLeft, ChevronDown, ChevronRight,
  Trash2, CheckSquare, Square,
  X, ImagePlus, Minimize2,
  Download, FolderPlus,
  Moon, Sun, Tag as TagIcon, Pencil, FolderOpen,
  Copy, Film, RefreshCw, Zap,
} from "lucide-react";

const API_URL = getApiUrl();

const DELETE_MEDIA_ASSET_MUTATION = `
  mutation DeleteMediaAsset($id: ID!) {
    deleteMediaAsset(id: $id)
  }
`;

const REFRESH_MEDIA_LIBRARY_MUTATION = `
  mutation RefreshMediaLibrary {
    refreshMediaLibrary
  }
`;

const GENERATE_THUMBNAILS_FOR_PATH_MUTATION = `
  mutation GenerateThumbnailsForPath($path: String) {
    generateThumbnailsForPath(path: $path)
  }
`;

const GENERATE_THUMBNAILS_FOR_ASSETS_MUTATION = `
  mutation GenerateThumbnailsForAssets($ids: [ID!]!, $sessionId: String, $force: Boolean) {
    generateThumbnailsForAssets(ids: $ids, sessionId: $sessionId, force: $force)
  }
`;

const MEDIA_ASSET_QUERY = `
  query GetMediaAsset($id: ID!) {
    mediaAsset(id: $id) {
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

export default function Dashboard() {
  const {
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
  } = useDirectoryTree();
  const {
    selectionMode,
    setSelectionMode,
    selectedAssetIds,
    setSelectedAssetIds,
    selectedFolderPaths,
    setSelectedFolderPaths,
    toggleAssetSelection,
    toggleFolderSelection,
    toggleSelectionMode,
  } = useMediaSelection();
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [view, setView] = useState<"grid" | "tree">("grid");
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const {
    showChangePasswordDialog,
    setShowChangePasswordDialog,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    passwordError,
    setPasswordError,
    handleChangePassword,
  } = usePasswordChange();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("darkMode");
      return stored !== null ? stored === "true" : true;
    }
    return true;
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sortOption, setSortOption] = useState<"default" | "size-asc" | "size-desc" | "date-asc" | "date-desc">("default");
  const [showSelectionActionsMenu, setShowSelectionActionsMenu] = useState(false);
  const selectionActionsMenuRef = useRef<HTMLDivElement>(null);
  const [autoEditAssetId, setAutoEditAssetId] = useState<string | null>(null);
  const { confirmDialog, setConfirmDialog, openConfirm } = useConfirmDialog();
  const {
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
  } = useTagActions({ currentPath, rootPath, loadDirectoryIntoCache, openConfirm });
  const {
    showUploadDialog,
    setShowUploadDialog,
    uploadFiles,
    setUploadFiles,
    uploadTargetPath,
    setUploadTargetPath,
    uploadProgress,
    setUploadProgress,
    isUploading,
    fileInputRef,
    handleUpload,
  } = useFileUpload({ currentPath, rootPath, loadDirectoryIntoCache });
  const {
    cacheStats,
    cacheSettings,
    showCachePanel,
    handleSaveCacheSettings,
    handleClearCache,
    toggleCachePanel,
  } = useCacheSettings({
    userRole: user?.role,
    rootPath,
    currentPath,
    loadDirectoryIntoCache,
    setDirectoryCache,
    openConfirm,
  });
  const search = useSearch({ currentPath, rootPath, sortOption });
  const compress = useCompressQueue({ user, currentPath, rootPath, loadDirectoryIntoCache });
  const fileCrud = useFileCrud({
    currentPath, loadDirectoryIntoCache,
    setSelectedAsset, setAutoEditAssetId, setIsViewerOpen,
  });
  const refreshInFlightRef = useRef(false);
  const thumbnailPollTimerRef = useRef<number | null>(null);
  const thumbnailPollAttemptsRef = useRef(0);
  const thumbnailPollInFlightRef = useRef(false);
  const { thumbnailSessionIdRef, registerLazyThumbnailCard } = useThumbnailObserver({ currentPath });
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("queue") === "open") {
      compress.setShowQueuePanel(true);
      const next = new URLSearchParams(searchParams);
      next.delete("queue");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("darkMode", darkMode.toString());
      if (darkMode) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  }, [darkMode]);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      navigate("/login");
      return;
    }
    loadData();
    loadUser();
    refreshTagSuggestions();
  }, []);

  const loadUser = async () => {
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      const data: any = await client.request(`query { me { username role } }`);
      setUser(data.me);
    } catch (err) {
      console.error("Failed to load user:", err);
    }
  };

  const handleLogout = () => {
    clearAuthToken();
    navigate("/login");
  };

  const handleRefreshMediaLibrary = async () => {
    if (refreshInFlightRef.current || isRefreshing) return;
    try {
      refreshInFlightRef.current = true;
      setIsRefreshing(true);
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      const response: any = await client.request(REFRESH_MEDIA_LIBRARY_MUTATION);
      if (rootPath) await loadDirectoryIntoCache(rootPath);
      if (currentPath && currentPath !== rootPath) await loadDirectoryIntoCache(currentPath);
      alert(response?.refreshMediaLibrary || "Media library refreshed successfully!");
    } catch (err: any) {
      console.error("Failed to refresh media library:", err);
      alert(`Failed to refresh media library: ${err.message || "Unknown error"}`);
    } finally {
      refreshInFlightRef.current = false;
      setIsRefreshing(false);
    }
  };

  const generateThumbnailsForPath = async (pathToQueue: string, options?: { silent?: boolean }) => {
    const token = getAuthToken();
    if (!token) return;
    const client = createGraphQLClient(token);
    const response: any = await client.request(GENERATE_THUMBNAILS_FOR_PATH_MUTATION, { path: pathToQueue });
    if (!options?.silent) {
      const queuedCount = response?.generateThumbnailsForPath ?? 0;
      alert(
        queuedCount > 0
          ? `Queued thumbnails for ${queuedCount} item(s).`
          : "No thumbnails were queued for this folder."
      );
    }
  };

  const handleGenerateThumbnails = async () => {
    if (!currentPath || isGeneratingThumbnails) return;
    try {
      setIsGeneratingThumbnails(true);
      await generateThumbnailsForPath(currentPath);
      await loadDirectoryIntoCache(currentPath);
    } catch (err: any) {
      console.error("Failed to generate thumbnails:", err);
      alert(`Failed to generate thumbnails: ${err.message || "Unknown error"}`);
    } finally {
      setIsGeneratingThumbnails(false);
    }
  };

  // Thumbnails are always requested on demand as cards enter the viewport
  // (see IntersectionObserver + registerLazyThumbnailCard below). No folder
  // is bulk-queued up front — that used to generate thumbnails for files the
  // user never actually scrolled to.

  const handleAssetClick = (asset: MediaAsset) => {
    if (selectionMode) {
      toggleAssetSelection(asset.id);
    } else {
      setSelectedAsset(asset);
      setIsViewerOpen(true);
    }
  };

  const handleDownloadSelected = () => {
    if (selectedAssetIds.size === 0) return;
    const ids = Array.from(selectedAssetIds);
    if (ids.length === 1) {
      window.location.href = `${API_URL}/download/${ids[0]}`;
      return;
    }
    const folderName = currentPath ? currentPath.split("/").filter(Boolean).pop() : "";
    const zipName = `${folderName || "media"}-${ids.length}-files.zip`;
    const url = `${API_URL}/download-zip?ids=${ids.join(",")}&name=${encodeURIComponent(zipName)}`;
    window.location.href = url;
  };

  const handleDeleteSelected = () => {
    if (selectedAssetIds.size === 0) return;
    const count = selectedAssetIds.size;
    const ids = Array.from(selectedAssetIds);
    openConfirm({
      title: "Delete Items",
      description: `Delete ${count} selected item${count === 1 ? "" : "s"}?`,
      warning: "Items are moved to the Trash and kept for 30 days before permanent deletion.",
      onConfirm: async () => {
        try {
          const token = getAuthToken();
          if (!token) return;
          const client = createGraphQLClient(token);
          await Promise.all(ids.map((id) => client.request(DELETE_MEDIA_ASSET_MUTATION, { id })));
          setSelectedAssetIds(new Set());
          setSelectionMode(false);
          if (rootPath) await loadDirectoryIntoCache(rootPath);
          if (currentPath && currentPath !== rootPath) await loadDirectoryIntoCache(currentPath);
        } catch (err) {
          console.error("Failed to delete assets:", err);
          alert("Failed to delete some assets. Please try again.");
        }
      },
    });
  };

  const handleDeleteSingle = (assetId: string, fileName: string) => {
    openConfirm({
      title: "Delete File",
      description: `Delete "${fileName}"?`,
      warning: "The file is moved to the Trash and kept for 30 days before permanent deletion.",
      onConfirm: async () => {
        try {
          const token = getAuthToken();
          if (!token) return;
          const client = createGraphQLClient(token);
          await client.request(DELETE_MEDIA_ASSET_MUTATION, { id: assetId });
          if (rootPath) await loadDirectoryIntoCache(rootPath);
          if (currentPath && currentPath !== rootPath) await loadDirectoryIntoCache(currentPath);
        } catch (err) {
          console.error("Failed to delete asset:", err);
          alert("Failed to delete asset. Please try again.");
        }
      },
    });
  };

  const handleFolderClick = async (folder: DirectoryNode) => {
    if (selectionMode) {
      toggleFolderSelection(folder.path);
      return;
    }
    // Opening a folder from search results exits search and navigates into it
    if (search.searchQuery) {
      search.clearSearchState();
    }
    if (currentPath) setFolderHistory((prev) => [...prev, currentPath]);
    setCurrentPath(folder.path);
    const cachedNode = directoryCache[folder.path];
    if (!cachedNode || cachedNode.children === null || cachedNode.children === undefined) {
      await loadDirectoryIntoCache(folder.path);
    }
  };

  const jumpToPath = useCallback(async (targetPath: string) => {
    if (!targetPath) return;
    if (targetPath === currentPath) return;
    if (currentPath && currentPath !== targetPath) {
      setFolderHistory((prev) => [...prev, currentPath]);
    }
    clearTagFilter();
    search.clearSearchState();
    setCurrentPath(targetPath);
    const cachedNode = directoryCache[targetPath];
    if (!cachedNode || cachedNode.children === null || cachedNode.children === undefined) {
      try {
        await loadDirectoryIntoCache(targetPath);
      } catch (err: any) {
        console.error("Failed to load directory:", err);
        alert(`Failed to open folder: ${err?.message || "Unknown error"}`);
      }
    }
  }, [clearTagFilter, currentPath, directoryCache, search.clearSearchState]);

  const openAssetById = useCallback(async (assetId: string) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const client = createGraphQLClient(token);
      const data: any = await client.request(MEDIA_ASSET_QUERY, { id: assetId });
      const asset = data?.mediaAsset as MediaAsset | null;
      if (!asset) return;
      setSelectedAsset(asset);
      setIsViewerOpen(true);
    } catch (err) {
      console.error("Failed to load media asset:", err);
    }
  }, []);

  useEffect(() => {
    let mutated = false;
    const next = new URLSearchParams(searchParams);
    const targetPath = next.get("path");
    if (targetPath) {
      void jumpToPath(targetPath);
      next.delete("path");
      mutated = true;
    }
    const openAssetId = next.get("openAsset");
    if (openAssetId) {
      void openAssetById(openAssetId);
      next.delete("openAsset");
      mutated = true;
    }
    if (mutated) setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, jumpToPath, openAssetById]);

  const handleCloseViewer = () => {
    setIsViewerOpen(false);
    setSelectedAsset(null);
    setAutoEditAssetId(null);
  };

  const sortedFolderChildren = useMemo(() => {
    const baseChildren = search.searchQuery
      ? search.searchResultNodes
      : activeTagFilter ? tagFilterNodes : currentFolderChildren;
    if (sortOption === "default" || search.searchQuery) return baseChildren;
    const folders = baseChildren.filter((n) => n.type === "directory");
    const files = baseChildren.filter((n) => n.type !== "directory");
    const sorted = [...files].sort((a, b) => {
      if (sortOption === "size-asc" || sortOption === "size-desc") {
        const sizeA = a.mediaAsset ? parseInt(a.mediaAsset.fileSize) || 0 : 0;
        const sizeB = b.mediaAsset ? parseInt(b.mediaAsset.fileSize) || 0 : 0;
        return sortOption === "size-asc" ? sizeA - sizeB : sizeB - sizeA;
      }
      const dateA = a.mediaAsset ? new Date(a.mediaAsset.capturedAt ?? a.mediaAsset.createdAt).getTime() : 0;
      const dateB = b.mediaAsset ? new Date(b.mediaAsset.capturedAt ?? b.mediaAsset.createdAt).getTime() : 0;
      return sortOption === "date-asc" ? dateA - dateB : dateB - dateA;
    });
    return [...folders, ...sorted];
  }, [activeTagFilter, currentFolderChildren, search.searchQuery, search.searchResultNodes, sortOption, tagFilterNodes]);

  const folderCrud = useFolderCrud({
    currentPath, rootPath, loadDirectoryIntoCache,
    setDirectoryCache, handleBackClick, openConfirm,
    selectedAsset, setSelectedAsset,
    sortedFolderChildren, selectedAssetIds, selectedFolderPaths,
    setSelectedAssetIds, setSelectedFolderPaths, setSelectionMode,
  });

  const selectedAssets = useMemo(() => {
    return sortedFolderChildren
      .filter((node) => node.type === "file" && node.mediaAsset && selectedAssetIds.has(node.mediaAsset.id))
      .map((node) => node.mediaAsset!);
  }, [selectedAssetIds, sortedFolderChildren]);

  const selectedCompressibleAssets = useMemo(() => {
    return selectedAssets.filter(canCompressAsset);
  }, [selectedAssets]);

  const selectedVideoAssets = useMemo(() => {
    return selectedAssets.filter((a) => a.mimeType.startsWith("video/"));
  }, [selectedAssets]);

  const selectedThumbableAssets = useMemo(() => {
    return selectedAssets.filter(
      (a) => a.mimeType.startsWith("image/") || a.mimeType.startsWith("video/")
    );
  }, [selectedAssets]);

  // Force-regenerate thumbnails for the selected assets (works in folder,
  // search, and tag-filter views — mirrors the timeline action)
  const handleRegenerateThumbnailsSelected = useCallback(async () => {
    const thumbable = selectedAssets.filter(
      (a) => a.mimeType.startsWith("image/") || a.mimeType.startsWith("video/")
    );
    if (thumbable.length === 0) return;
    const token = getAuthToken();
    if (!token) return;
    try {
      const client = createGraphQLClient(token);
      await client.request(GENERATE_THUMBNAILS_FOR_ASSETS_MUTATION, {
        ids: thumbable.map((a) => a.id),
        sessionId: thumbnailSessionIdRef.current,
        force: true,
      });
      setSelectionMode(false);
      setSelectedAssetIds(new Set());
      // Pick up the fresh thumbnails once the queue has had a moment to work
      window.setTimeout(() => {
        if (search.searchQuery) {
          void search.handleSearch(search.searchQuery.term, search.searchQuery.mediaType);
        } else if (currentPath) {
          void loadDirectoryIntoCache(currentPath);
        }
      }, 6000);
    } catch (err: any) {
      console.error("Failed to queue thumbnail regeneration:", err.message);
      alert(`Failed to queue thumbnails: ${err.message}`);
    }
  }, [selectedAssets, search.searchQuery, currentPath, search.handleSearch]);

  const handleTranscodeSelected = useCallback(async () => {
    if (selectedVideoAssets.length === 0) return;
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/transcode/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: selectedVideoAssets.map((a) => a.id) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Server error ${res.status}`);
      }
      const { jobId } = await res.json();
      compress.setCompressQueue(prev => [...prev, {
        id: jobId,
        kind: "transcode" as const,
        assets: selectedVideoAssets,
        status: "pending" as const,
        progress: {},
        currentFileId: null,
        previews: [],
        fileStatuses: Object.fromEntries(selectedVideoAssets.map(a => [a.id, "pending" as const])),
        addedAt: Date.now(),
      }]);
      compress.setShowQueuePanel(true);
      setSelectionMode(false);
      setSelectedAssetIds(new Set());
    } catch (err: any) {
      console.error("Failed to enqueue transcode job:", err.message);
      alert(`Failed to queue transcode: ${err.message}`);
    }
  }, [selectedVideoAssets]);

  // Ordered list of files in the current view, used for viewer prev/next navigation
  const viewerNavAssets = useMemo(() => {
    return sortedFolderChildren
      .filter((node) => node.type === "file" && node.mediaAsset)
      .map((node) => node.mediaAsset!);
  }, [sortedFolderChildren]);

  const viewerNavIndex = useMemo(() => {
    if (!selectedAsset) return -1;
    return viewerNavAssets.findIndex((a) => a.id === selectedAsset.id);
  }, [selectedAsset, viewerNavAssets]);

  const handleViewerNavigate = useCallback((direction: 1 | -1) => {
    setSelectedAsset((prev) => {
      if (!prev) return prev;
      const idx = viewerNavAssets.findIndex((a) => a.id === prev.id);
      if (idx === -1) return prev;
      return viewerNavAssets[idx + direction] ?? prev;
    });
  }, [viewerNavAssets]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (selectionActionsMenuRef.current && !selectionActionsMenuRef.current.contains(e.target as Node)) {
        setShowSelectionActionsMenu(false);
      }
    };
    if (showSelectionActionsMenu) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSelectionActionsMenu]);

  useEffect(() => {
    if (!search.searchQuery) return;
    void search.handleSearch(search.searchQuery.term, search.searchQuery.mediaType);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortOption, search.searchLimit, search.minSizeBytes, currentPath]);

  useEffect(() => {
    if (!currentPath) return;
    const hasMissingThumbnails = currentFolderChildren.some(
      (node) => node.type !== "file" ? false : !!node.mediaAsset && !node.mediaAsset.thumbnailUrl
    );
    if (!hasMissingThumbnails) {
      if (thumbnailPollTimerRef.current) {
        window.clearInterval(thumbnailPollTimerRef.current);
        thumbnailPollTimerRef.current = null;
      }
      return;
    }
    if (thumbnailPollTimerRef.current) return;
    thumbnailPollAttemptsRef.current = 0;
    thumbnailPollTimerRef.current = window.setInterval(async () => {
      if (!currentPath) return;
      if (thumbnailPollInFlightRef.current) return;
      if (thumbnailPollAttemptsRef.current >= 12) {
        if (thumbnailPollTimerRef.current) {
          window.clearInterval(thumbnailPollTimerRef.current);
          thumbnailPollTimerRef.current = null;
        }
        return;
      }
      thumbnailPollAttemptsRef.current += 1;
      thumbnailPollInFlightRef.current = true;
      try {
        await loadDirectoryIntoCache(currentPath);
      } catch (err) {
        console.error("Failed to refresh directory thumbnails:", err);
      } finally {
        thumbnailPollInFlightRef.current = false;
      }
    }, 5000);
    return () => {
      if (thumbnailPollTimerRef.current) {
        window.clearInterval(thumbnailPollTimerRef.current);
        thumbnailPollTimerRef.current = null;
      }
    };
  }, [currentPath, currentFolderChildren]);

  const renderTree = (node: DirectoryNode) => {
    if (node.type === "file") {
      const isSelected = node.mediaAsset ? selectedAssetIds.has(node.mediaAsset.id) : false;
      return (
        <div key={node.path} className="relative group">
          <button
            type="button"
            className={`w-full pl-6 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-accent rounded-xl transition-all duration-150 outline-hidden focus:ring-2 focus:ring-brand-primary/30 text-left ${
              isSelected ? "bg-accent" : ""
            }`}
            onClick={() => node.mediaAsset && handleAssetClick(node.mediaAsset)}
          >
            {selectionMode && (
              <div className="shrink-0">
                {isSelected ? (
                  <CheckSquare className="w-4 h-4 text-brand-primary" />
                ) : (
                  <Square className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            )}
            <FileImage className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-sm truncate text-foreground flex-1">{node.name}</span>
            {!selectionMode && node.mediaAsset && (user?.role === "admin" || user?.role === "editor") && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteSingle(node.mediaAsset!.id, node.mediaAsset!.fileName);
                }}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-destructive/10 rounded-lg transition-all duration-150 mr-2"
              >
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </button>
            )}
          </button>
        </div>
      );
    }

    const cachedNode = directoryCache[node.path] || node;
    const children = cachedNode.children ?? null;
    const isExpanded = expandedFolders.has(node.path);

    return (
      <div key={node.path} className="pl-4">
        <div className="group relative flex items-center">
          <button
            type="button"
            className="flex-1 py-2.5 flex items-center gap-3 font-medium text-foreground hover:bg-accent rounded-xl transition-all duration-150 outline-hidden focus:ring-2 focus:ring-brand-primary/30 text-left px-2"
            onClick={() => void toggleFolder(node.path)}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <div className="w-8 h-8 gradient-brand rounded-lg flex items-center justify-center shrink-0">
              <Folder className="w-4 h-4 text-[#060e20]" />
            </div>
            <span className="text-sm">{node.name}</span>
            <span className="flex items-center gap-1.5 ml-auto mr-2 shrink-0">
              {node.size != null && node.size > 0 && (
                <span className="text-xs text-muted-foreground font-mono">
                  {formatBytes(node.size)}
                </span>
              )}
              {Array.isArray(children) && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {children.length}
                </span>
              )}
            </span>
          </button>
          {(user?.role === "admin" || user?.role === "editor") && (
            <>
              <button
                type="button"
                onClick={() => { folderCrud.setRenamingFolder({ path: node.path, name: node.name }); folderCrud.setRenameFolderValue(node.name); }}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-accent rounded-lg transition-all duration-150 shrink-0"
                title="Rename folder"
              >
                <Pencil className="w-3.5 h-3.5 text-foreground" />
              </button>
              <button
                type="button"
                onClick={() => folderCrud.openDuplicateFolderDialog({ path: node.path, name: node.name })}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-accent rounded-lg transition-all duration-150 shrink-0"
                title="Duplicate folder"
              >
                <Copy className="w-3.5 h-3.5 text-foreground" />
              </button>
              <button
                type="button"
                onClick={() => void folderCrud.handleDeleteFolder(node.path, node.name)}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-destructive/10 rounded-lg transition-all duration-150 mr-1 shrink-0"
                title="Delete folder"
              >
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </button>
            </>
          )}
        </div>
        {isExpanded && children === null && (
          <div className="pl-10 py-2 text-xs text-muted-foreground">Loading…</div>
        )}
        {isExpanded && Array.isArray(children) && children.length > 0 && (
          <div className="ml-4 mt-1">{children.map((child) => renderTree(child))}</div>
        )}
        {isExpanded && Array.isArray(children) && children.length === 0 && (
          <div className="pl-10 py-2 text-xs text-muted-foreground">Empty folder</div>
        )}
      </div>
    );
  };

  const heroTitle = search.searchQuery
    ? search.searchQuery.term
      ? `"${search.searchQuery.term}"`
      : search.searchQuery.mediaType === "image" ? "All Images" : "All Videos"
    : activeTagFilter
      ? `#${activeTagFilter}`
      : !isAtRoot && currentFolder
        ? currentFolder.name
        : "Your Collection";
  const heroSubtitle = search.searchQuery
    ? search.searchLoading
      ? "Searching…"
      : search.searchLimit > 0 && search.searchAssets.length >= search.searchLimit
        ? `Showing top ${search.searchAssets.length} results — try a narrower search or increase the limit`
        : `${search.searchAssets.length} result${search.searchAssets.length === 1 ? "" : "s"} found${currentPath && currentPath !== rootPath ? ` in /${currentPath.split("/").filter(Boolean).pop()}` : ""}`
    : activeTagFilter
      ? `${tagFilterAssets.length} tagged file${tagFilterAssets.length === 1 ? "" : "s"} across your library`
      : !isAtRoot
        ? `${folderHistory.length + 1} level${folderHistory.length > 0 ? "s" : ""} deep`
        : "Organized precision for your creative assets and digital artifacts.";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background dark:bg-background">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl gradient-brand flex items-center justify-center mx-auto mb-4 shadow-ambient animate-pulse">
            <Folder className="w-6 h-6 text-[#060e20]" />
          </div>
          <p className="text-muted-foreground text-sm">Loading your media library…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <Sidebar
        user={user}
        rootSize={rootSize}
        onNavigateHome={() => { setCurrentPath(rootPath); setFolderHistory([]); }}
        onNavigateTimeline={() => navigate("/timeline")}
        onNavigateTrash={() => navigate("/trash")}
        onNavigateUsers={() => navigate("/users")}
        onNavigateAudit={() => navigate("/audit")}
        onOpenQueuePanel={() => compress.setShowQueuePanel(true)}
        queueBadgeCount={compress.compressQueue.filter(j => !["done", "error"].includes(j.status)).length || undefined}
        cacheStats={cacheStats}
        cacheSettings={cacheSettings}
        showCachePanel={showCachePanel}
        onToggleCachePanel={toggleCachePanel}
        onClearCache={(type) => void handleClearCache(type)}
        onSaveCacheSettings={handleSaveCacheSettings}
        isRefreshing={isRefreshing}
        onRefreshLibrary={handleRefreshMediaLibrary}
        onUpload={() => { setUploadTargetPath(currentPath || rootPath || ''); setShowUploadDialog(true); }}
        onChangePassword={() => setShowChangePasswordDialog(true)}
        onLogout={() => setShowLogoutConfirm(true)}
      />

      {/* ── Main content ─────────────────────────────────────────── */}
      <div className="flex-1 md:ml-64 min-h-screen flex flex-col">

        <MobileNav
          open={mobileMenuOpen}
          onToggle={() => setMobileMenuOpen((p) => !p)}
          onClose={() => setMobileMenuOpen(false)}
          user={user}
          queueBadgeCount={compress.compressQueue.filter(j => !["done", "error"].includes(j.status)).length}
          isRefreshing={isRefreshing}
          isGeneratingThumbnails={isGeneratingThumbnails}
          canGenerateThumbnails={Boolean(currentPath)}
          darkMode={darkMode}
          rootSize={rootSize}
          cacheStats={cacheStats}
          cacheSettings={cacheSettings}
          showCachePanel={showCachePanel}
          onNavigateHome={() => { setCurrentPath(rootPath); setFolderHistory([]); }}
          onNavigateTimeline={() => navigate("/timeline")}
          onNavigateTrash={() => navigate("/trash")}
          onOpenQueue={() => compress.setShowQueuePanel(true)}
          onNavigateUsers={() => navigate("/users")}
          onNavigateAudit={() => navigate("/audit")}
          onRefreshLibrary={handleRefreshMediaLibrary}
          onGenerateThumbnails={handleGenerateThumbnails}
          onUpload={() => { setUploadTargetPath(currentPath || rootPath || ''); setShowUploadDialog(true); }}
          onToggleDarkMode={() => setDarkMode(!darkMode)}
          onChangePassword={() => setShowChangePasswordDialog(true)}
          onToggleCachePanel={toggleCachePanel}
          onClearCache={(type) => void handleClearCache(type)}
          onSaveCacheSettings={handleSaveCacheSettings}
          onLogout={() => setShowLogoutConfirm(true)}
        />

        {/* Search bar */}
        <div className="md:sticky md:top-0 z-20 bg-background/80 backdrop-blur-xs px-4 md:px-10 pt-3 pb-1.5">
          <SearchBar
            onSearch={search.handleSearch}
            onClear={search.handleClearSearch}
            className="w-full md:max-w-xl"
          />
        </div>

        {/* Toolbar */}
        <div className="relative z-30 bg-background/80 backdrop-blur-xs px-4 md:px-10 pb-3 pt-1 flex items-center justify-between gap-2 md:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {search.searchQuery && (
              <button
                type="button"
                onClick={search.handleClearSearch}
                className="flex items-center gap-1.5 text-sm text-brand-primary hover:opacity-80 transition-opacity"
              >
                <ArrowLeft className="w-4 h-4" /> Exit search
              </button>
            )}
            {activeTagFilter && !search.searchQuery && (
              <button
                type="button"
                onClick={clearTagFilter}
                className="flex items-center gap-1.5 text-sm text-brand-primary hover:opacity-80 transition-opacity"
              >
                <ArrowLeft className="w-4 h-4" /> Exit tag filter
              </button>
            )}
            {!activeTagFilter && !search.searchQuery && folderHistory.length > 0 && (
              <button
                type="button"
                onClick={() => void handleBackClick()}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}
            {!activeTagFilter && !isAtRoot && currentFolder && (
              <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full truncate max-w-[200px]">
                {currentFolder.name}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 md:gap-2 flex-wrap justify-end">
            {/* Dark mode toggle — desktop only */}
            <button
              type="button"
              onClick={() => setDarkMode(!darkMode)}
              className="hidden md:flex p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              title={darkMode ? "Light Mode" : "Dark Mode"}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {(user?.role === "admin" || user?.role === "editor") && (
              <>
                {/* Thumbnails — desktop only */}
                <button
                  type="button"
                  onClick={handleGenerateThumbnails}
                  disabled={isGeneratingThumbnails || !currentPath}
                  className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all disabled:opacity-40"
                  title="Generate thumbnails"
                >
                  <ImagePlus className="w-4 h-4" />
                  <span>{isGeneratingThumbnails ? "Queuing…" : "Thumbnails"}</span>
                </button>
                <button
                  type="button"
                  onClick={toggleSelectionMode}
                  className={`flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm transition-all ${
                    selectionMode
                      ? "gradient-brand text-[#060e20] font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  <CheckSquare className="w-4 h-4" />
                  <span className="hidden sm:inline">{selectionMode ? "Cancel" : "Select"}</span>
                </button>
                {selectionMode && viewerNavAssets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const allSelected = viewerNavAssets.every((a) => selectedAssetIds.has(a.id));
                      setSelectedAssetIds(allSelected ? new Set() : new Set(viewerNavAssets.map((a) => a.id)));
                    }}
                    className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
                    title={viewerNavAssets.every((a) => selectedAssetIds.has(a.id)) ? "Unselect all files in this view" : "Select all files in this view"}
                  >
                    {viewerNavAssets.every((a) => selectedAssetIds.has(a.id)) ? (
                      <>
                        <Square className="w-4 h-4" />
                        <span className="hidden sm:inline">Unselect All</span>
                      </>
                    ) : (
                      <>
                        <CheckSquare className="w-4 h-4" />
                        <span className="hidden sm:inline">Select All</span>
                        <span className="text-xs">({viewerNavAssets.length})</span>
                      </>
                    )}
                  </button>
                )}
                {selectionMode && (selectedAssetIds.size > 0 || selectedFolderPaths.size > 0) && (
                  <>
                    <div className="hidden md:flex items-center gap-1.5 md:gap-2 flex-wrap justify-end">
                    {selectedAssetIds.size > 0 && (
                      <button
                        type="button"
                        onClick={handleDownloadSelected}
                        className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-foreground hover:bg-accent transition-all"
                        title={`Download ${selectedAssetIds.size} file(s)`}
                      >
                        <Download className="w-4 h-4" />
                        <span className="hidden sm:inline">Download</span>
                        <span className="text-xs">({selectedAssetIds.size})</span>
                      </button>
                    )}
                    {selectedAssetIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedCompressibleAssets.length === 0) return;
                          const skipped = selectedAssets.length - selectedCompressibleAssets.length;
                          if (skipped > 0) {
                            alert(`${skipped} unsupported file${skipped === 1 ? "" : "s"} will be skipped.`);
                          }
                          compress.setCompressDialogAssets(selectedCompressibleAssets);
                          compress.setIsCompressDialogOpen(true);
                        }}
                        disabled={selectedCompressibleAssets.length === 0}
                        title={selectedCompressibleAssets.length === 0 ? "No selected files can be compressed" : undefined}
                        className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-brand-primary hover:bg-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Minimize2 className="w-4 h-4" />
                        <span className="hidden sm:inline">Compress</span>
                        <span className="text-xs">({selectedCompressibleAssets.length})</span>
                      </button>
                    )}
                    {(user?.role === "admin" || user?.role === "editor") && selectedAssetIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleTranscodeSelected()}
                        disabled={selectedVideoAssets.length === 0}
                        title={selectedVideoAssets.length === 0 ? "No videos selected" : "Transcode selected videos to web format"}
                        className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-brand-primary hover:bg-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Film className="w-4 h-4" />
                        <span className="hidden sm:inline">Transcode</span>
                        <span className="text-xs">({selectedVideoAssets.length})</span>
                      </button>
                    )}
                    {selectedAssetIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleRegenerateThumbnailsSelected()}
                        disabled={selectedThumbableAssets.length === 0}
                        title={selectedThumbableAssets.length === 0 ? "No selected files support thumbnails" : "Regenerate thumbnails for selected items"}
                        className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-brand-primary hover:bg-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span className="hidden sm:inline">Thumbnails</span>
                        <span className="text-xs">({selectedThumbableAssets.length})</span>
                      </button>
                    )}
                    {selectedAssetIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const pool: MediaAsset[] = activeTagFilter
                            ? tagFilterAssets
                            : sortedFolderChildren
                                .filter((n) => n.type === "file" && n.mediaAsset)
                                .map((n) => n.mediaAsset!);
                          setTagDialogAssets(pool.filter((a) => selectedAssetIds.has(a.id)));
                          setIsTagDialogOpen(true);
                        }}
                        className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-brand-primary hover:bg-accent transition-all"
                      >
                        <TagIcon className="w-4 h-4" />
                        <span className="hidden sm:inline">Tag</span>
                        <span className="text-xs">({selectedAssetIds.size})</span>
                      </button>
                    )}
                    {(user?.role === "admin" || user?.role === "editor") && selectedAssetIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const pool: MediaAsset[] = activeTagFilter
                            ? tagFilterAssets
                            : sortedFolderChildren
                                .filter((n) => n.type === "file" && n.mediaAsset)
                                .map((n) => n.mediaAsset!);
                          setRemoveTagsAssets(pool.filter((a) => selectedAssetIds.has(a.id)));
                          setIsRemoveTagsDialogOpen(true);
                        }}
                        className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-brand-primary hover:bg-accent transition-all"
                        title="Remove tags from selected items"
                      >
                        <TagIcon className="w-4 h-4" />
                        <span className="hidden sm:inline">Untag</span>
                        <span className="text-xs">({selectedAssetIds.size})</span>
                      </button>
                    )}
                    {(user?.role === "admin" || user?.role === "editor") && (
                      <button
                        type="button"
                        onClick={() => { folderCrud.setMoveTargetFolderPath(''); folderCrud.setShowMoveDialog(true); }}
                        className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-brand-primary hover:bg-accent transition-all"
                      >
                        <FolderOpen className="w-4 h-4" />
                        <span className="hidden sm:inline">Move</span>
                        <span className="text-xs">({selectedAssetIds.size + selectedFolderPaths.size})</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleDeleteSelected}
                      className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-destructive hover:bg-destructive/10 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="hidden sm:inline">Delete</span>
                      <span className="text-xs">({selectedAssetIds.size})</span>
                    </button>
                    </div>

                    {/* Mobile: selection actions dropdown */}
                    <div className="relative md:hidden" ref={selectionActionsMenuRef}>
                      <button
                        type="button"
                        onClick={() => setShowSelectionActionsMenu((p) => !p)}
                        className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium text-foreground bg-muted transition-all"
                      >
                        Actions
                        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showSelectionActionsMenu ? "rotate-180" : ""}`} />
                      </button>
                      {showSelectionActionsMenu && (
                        <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl bg-card border border-border/30 shadow-ambient p-1.5 z-40">
                          {[
                            { label: `Download (${selectedAssetIds.size})`, icon: Download, disabled: selectedAssetIds.size === 0, destructive: false, show: true, run: () => handleDownloadSelected() },
                            { label: `Compress (${selectedCompressibleAssets.length})`, icon: Minimize2, disabled: selectedCompressibleAssets.length === 0, destructive: false, show: selectedAssetIds.size > 0, run: () => {
                              const skipped = selectedAssets.length - selectedCompressibleAssets.length;
                              if (skipped > 0) alert(`${skipped} unsupported file${skipped === 1 ? "" : "s"} will be skipped.`);
                              compress.setCompressDialogAssets(selectedCompressibleAssets);
                              compress.setIsCompressDialogOpen(true);
                            } },
                            { label: `Transcode (${selectedVideoAssets.length})`, icon: Film, disabled: selectedVideoAssets.length === 0, destructive: false, show: user?.role === "admin" || user?.role === "editor", run: () => void handleTranscodeSelected() },
                            { label: `Thumbnails (${selectedThumbableAssets.length})`, icon: RefreshCw, disabled: selectedThumbableAssets.length === 0, destructive: false, show: true, run: () => void handleRegenerateThumbnailsSelected() },
                            { label: `Add tags (${selectedAssetIds.size})`, icon: TagIcon, disabled: selectedAssetIds.size === 0, destructive: false, show: true, run: () => {
                              const pool: MediaAsset[] = activeTagFilter ? tagFilterAssets : sortedFolderChildren.filter((n) => n.type === "file" && n.mediaAsset).map((n) => n.mediaAsset!);
                              setTagDialogAssets(pool.filter((a) => selectedAssetIds.has(a.id)));
                              setIsTagDialogOpen(true);
                            } },
                            { label: `Remove tags (${selectedAssetIds.size})`, icon: TagIcon, disabled: selectedAssetIds.size === 0, destructive: false, show: user?.role === "admin" || user?.role === "editor", run: () => {
                              const pool: MediaAsset[] = activeTagFilter ? tagFilterAssets : sortedFolderChildren.filter((n) => n.type === "file" && n.mediaAsset).map((n) => n.mediaAsset!);
                              setRemoveTagsAssets(pool.filter((a) => selectedAssetIds.has(a.id)));
                              setIsRemoveTagsDialogOpen(true);
                            } },
                            { label: `Move (${selectedAssetIds.size + selectedFolderPaths.size})`, icon: FolderOpen, disabled: false, destructive: false, show: user?.role === "admin" || user?.role === "editor", run: () => { folderCrud.setMoveTargetFolderPath(''); folderCrud.setShowMoveDialog(true); } },
                            { label: `Delete (${selectedAssetIds.size})`, icon: Trash2, disabled: false, destructive: true, show: true, run: () => handleDeleteSelected() },
                          ].filter((item) => item.show).map((item) => (
                            <button
                              key={item.label}
                              type="button"
                              onClick={() => { setShowSelectionActionsMenu(false); item.run(); }}
                              disabled={item.disabled}
                              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left text-sm disabled:opacity-40 transition-colors ${
                                item.destructive
                                  ? "text-destructive hover:bg-destructive/10"
                                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
                              }`}
                            >
                              <item.icon className="w-4 h-4 shrink-0" />
                              {item.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {/* New Folder */}
            {(user?.role === "admin" || user?.role === "editor") && !selectionMode && (
              <button
                type="button"
                onClick={() => folderCrud.setShowNewFolderDialog(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
                title="New folder"
              >
                <FolderPlus className="w-4 h-4" />
                <span className="hidden md:inline">New Folder</span>
              </button>
            )}

            {/* New File */}
            {(user?.role === "admin" || user?.role === "editor") && !selectionMode && (
              <button
                type="button"
                onClick={() => fileCrud.setShowNewFileDialog(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
                title="New text or Markdown file"
              >
                <FileText className="w-4 h-4" />
                <span className="hidden md:inline">New File</span>
              </button>
            )}

            {/* Tag filter */}
            <TagFilterMenu
              tagSuggestions={tagSuggestions}
              showTagFilterMenu={showTagFilterMenu}
              activeTagFilter={activeTagFilter}
              tagFilterMenuRef={tagFilterMenuRef}
              tagFilterTriggerRef={tagFilterTriggerRef}
              tagFilterMenuRight={tagFilterMenuRight}
              userRole={user?.role}
              onToggleMenu={() => {
                const next = !showTagFilterMenu;
                if (next) {
                  refreshTagSuggestions();
                  const rect = tagFilterTriggerRef.current?.getBoundingClientRect();
                  if (rect) {
                    const menuWidth = Math.min(256, window.innerWidth - 16);
                    const minRight = rect.right - window.innerWidth + 8;
                    const maxRight = rect.right - menuWidth - 8;
                    setTagFilterMenuRight(Math.max(minRight, Math.min(0, maxRight)));
                  }
                }
                setShowTagFilterMenu(next);
              }}
              onClearFilter={clearTagFilter}
              onApplyFilter={(tagName) => void applyTagFilter(tagName)}
              onRenameTag={(tagName) => void handleRenameTag(tagName)}
              onDeleteTag={(tagName) => void handleDeleteTag(tagName)}
            />

            {/* Sort */}
            <SortMenu
              sortOption={sortOption}
              onSortOptionChange={setSortOption}
              searchQuery={search.searchQuery}
              searchLimit={search.searchLimit}
              onSearchLimitChange={search.setSearchLimit}
              minSizeBytes={search.minSizeBytes}
              onMinSizeBytesChange={search.setMinSizeBytes}
            />

            {/* View toggle */}
            <div className="flex gap-1 bg-muted p-1 rounded-xl">
              {(["grid", "tree"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all capitalize ${
                    view === v
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Hero */}
        <div className="px-4 md:px-10 pt-6 md:pt-8 pb-4 md:pb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-manrope text-3xl md:text-4xl font-bold text-foreground tracking-tight">
                {heroTitle}
              </h1>
              <p className="text-muted-foreground mt-1.5 text-sm">{heroSubtitle}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="label-meta">Total Items</p>
              <p className="font-manrope text-2xl font-bold text-foreground">
                {activeTagFilter ? tagFilterAssets.length : currentFolderChildren.length}
              </p>
            </div>
          </div>
        </div>

        {/* Grid / Tree content */}
        <div className="flex-1 px-4 md:px-10 pb-10">
          {view === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
              {sortedFolderChildren.map((node) => {
                if (node.type === "directory") {
                  return (
                    <div key={node.path} className="group relative">
                      <button
                        type="button"
                        onClick={() => void handleFolderClick(node)}
                        className={`w-full rounded-2xl bg-card hover:bg-accent transition-all duration-300 p-6 flex flex-col items-center justify-center gap-4 min-h-[180px] text-center ${
                          selectedFolderPaths.has(node.path) ? 'ring-2 ring-brand-primary ring-offset-2 ring-offset-background' : ''
                        }`}
                      >
                        {selectionMode && (
                          <div className="absolute top-3 left-3 z-10">
                            {selectedFolderPaths.has(node.path)
                              ? <CheckSquare className="w-5 h-5 text-brand-primary drop-shadow-sm" />
                              : <Square className="w-5 h-5 text-white drop-shadow-sm" />}
                          </div>
                        )}
                        <div className="w-16 h-16 rounded-2xl gradient-brand flex items-center justify-center shadow-ambient group-hover:scale-110 transition-transform duration-300">
                          <Folder className="w-8 h-8 text-[#060e20]" />
                        </div>
                        <div>
                          <p className="font-manrope font-semibold text-sm text-foreground truncate max-w-[120px]">
                            {node.name}
                          </p>
                          <p className="label-meta mt-1">
                            {node.size != null && node.size > 0 ? formatBytes(node.size) : "Folder"}
                          </p>
                        </div>
                      </button>
                      {!selectionMode && (user?.role === "admin" || user?.role === "editor") && (
                        <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); folderCrud.setRenamingFolder({ path: node.path, name: node.name }); folderCrud.setRenameFolderValue(node.name); }}
                            className="w-8 h-8 bg-background/80 backdrop-blur-xs rounded-xl flex items-center justify-center hover:bg-accent transition-all duration-200"
                            title="Rename folder"
                          >
                            <Pencil className="w-3.5 h-3.5 text-foreground" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); folderCrud.openDuplicateFolderDialog({ path: node.path, name: node.name }); }}
                            className="w-8 h-8 bg-background/80 backdrop-blur-xs rounded-xl flex items-center justify-center hover:bg-accent transition-all duration-200"
                            title="Duplicate folder"
                          >
                            <Copy className="w-3.5 h-3.5 text-foreground" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void folderCrud.handleDeleteFolder(node.path, node.name); }}
                            className="w-8 h-8 bg-background/80 backdrop-blur-xs rounded-xl flex items-center justify-center hover:bg-destructive/20 transition-all duration-200"
                            title="Delete folder"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                } else if (node.mediaAsset) {
                  const asset = node.mediaAsset;
                  const isSelected = selectedAssetIds.has(asset.id);
                  return (
                    <div
                      key={asset.id}
                      onClick={() => handleAssetClick(asset)}
                      className={`group cursor-pointer rounded-2xl overflow-hidden bg-card transition-all duration-300 relative ${
                        isSelected ? "ring-2 ring-brand-primary ring-offset-2 ring-offset-background" : "hover:bg-accent"
                      }`}
                    >
                      {/* Selection checkbox */}
                      {selectionMode && (
                        <div className="absolute top-3 left-3 z-10">
                          {isSelected ? (
                            <CheckSquare className="w-5 h-5 text-brand-primary drop-shadow-sm" />
                          ) : (
                            <Square className="w-5 h-5 text-white drop-shadow-sm" />
                          )}
                        </div>
                      )}

                      {/* Delete button */}
                      {!selectionMode && (user?.role === "admin" || user?.role === "editor") && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSingle(asset.id, asset.fileName);
                          }}
                          className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 w-8 h-8 bg-background/80 backdrop-blur-xs rounded-xl flex items-center justify-center hover:bg-destructive/20 transition-all duration-200"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </button>
                      )}

                      {/* Thumbnail — 4:5 portrait */}
                      {/* overflow-hidden is on the inner div so the download button isn't clipped */}
                      <div
                        className="aspect-[4/5] bg-muted relative"
                        ref={asset.thumbnailUrl ? undefined : registerLazyThumbnailCard(asset.id)}
                      >
                        <div className="absolute inset-0 overflow-hidden">
                          {asset.thumbnailUrl ? (
                            <img
                              src={`${API_URL}${asset.thumbnailUrl}`}
                              alt={asset.fileName}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <FileTypeIcon asset={asset} className="w-12 h-12 text-muted-foreground/30" />
                            </div>
                          )}

                          {/* Gradient overlay */}
                          <div className="absolute inset-0 bg-gradient-to-t from-background/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        </div>

                        {/* Type badge */}
                        <div className="absolute top-3 left-3 z-10 flex items-center gap-1">
                          <div className="bg-background/70 backdrop-blur-xs px-2 py-0.5 rounded-lg">
                            <span className="label-meta">{getFileCategoryLabel(getFileCategory(asset))}</span>
                          </div>
                          {asset.mimeType.startsWith("video/") && asset.transcodedUrl && (
                            <div
                              className="bg-emerald-500/20 backdrop-blur-xs px-1.5 py-0.5 rounded-lg flex items-center gap-0.5"
                              title="Transcoded — plays instantly"
                            >
                              <Zap className="w-2.5 h-2.5 text-emerald-400 fill-emerald-400" />
                              <span className="text-[10px] font-medium text-emerald-400">Transcoded</span>
                            </div>
                          )}
                        </div>

                        {/* Download button */}
                        {!selectionMode && (
                          <a
                            href={`${API_URL}/download/${asset.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="absolute bottom-3 right-3 z-10 opacity-0 group-hover:opacity-100 w-8 h-8 bg-background/80 backdrop-blur-xs rounded-xl flex items-center justify-center hover:bg-accent transition-all duration-200"
                            title={`Download ${asset.fileName}`}
                          >
                            <Download className="w-3.5 h-3.5 text-foreground" />
                          </a>
                        )}
                      </div>

                      {/* Meta */}
                      <div className="p-3">
                        <p className="font-medium text-sm text-foreground truncate">{asset.fileName}</p>
                        <p className="label-meta mt-1">
                          {formatBytes(asset.fileSize)} · {formatDate(asset.capturedAt ?? asset.createdAt)}
                        </p>
                        {search.searchQuery && rootPath && (
                          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">
                            {(asset.filePath.substring(0, asset.filePath.lastIndexOf('/')).replace(rootPath, '') || '/').replace(/^\//, '') || '/'}
                          </p>
                        )}
                        {asset.tags && asset.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {asset.tags.map((tag) => (
                              <span
                                key={tag.id}
                                className={`inline-flex items-center rounded-full pl-1.5 text-[10px] font-medium transition-colors ${
                                  activeTagFilter === tag.name
                                    ? "bg-brand-primary text-[#060e20]"
                                    : "bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void applyTagFilter(tag.name);
                                  }}
                                  className="py-0.5 pr-1"
                                  title={`Filter by #${tag.name}`}
                                >
                                  #{tag.name}
                                </button>
                                {!selectionMode && (user?.role === "admin" || user?.role === "editor") && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void removeTagFromAsset(asset.id, tag.name);
                                    }}
                                    className="px-1 py-0.5 rounded-r-full hover:bg-brand-primary/30 transition-colors"
                                    title={`Remove #${tag.name} from this file`}
                                    aria-label={`Remove ${tag.name}`}
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                )}
                                {(selectionMode || (user?.role !== "admin" && user?.role !== "editor")) && (
                                  <span className="pr-1.5" />
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
                return null;
              })}

              {/* Empty states */}
              {(activeTagFilter ? tagFilterLoading : isCurrentFolderLoading) && (
                <div className="col-span-full flex flex-col items-center justify-center py-24 text-muted-foreground">
                  <div className="w-10 h-10 rounded-2xl gradient-brand flex items-center justify-center mx-auto mb-4 animate-pulse">
                    <Folder className="w-5 h-5 text-[#060e20]" />
                  </div>
                  <p className="text-sm">{activeTagFilter ? "Loading tagged files…" : "Loading folder…"}</p>
                </div>
              )}
              {activeTagFilter && !tagFilterLoading && sortedFolderChildren.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-24 text-muted-foreground">
                  <TagIcon className="w-16 h-16 opacity-20 mb-4" />
                  <p className="font-manrope font-semibold text-foreground">No files with #{activeTagFilter}</p>
                  <p className="text-sm mt-1">Apply this tag to media files to see them here.</p>
                </div>
              )}
              {!activeTagFilter && !isCurrentFolderLoading && sortedFolderChildren.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-24 text-muted-foreground">
                  <Folder className="w-16 h-16 opacity-20 mb-4" />
                  <p className="font-manrope font-semibold text-foreground">This folder is empty</p>
                  <p className="text-sm mt-1">No items found in this directory</p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-card rounded-2xl p-4 md:p-6 overflow-auto max-h-[calc(100vh-300px)]">
              {directoryTree ? (
                renderTree(directoryTree)
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <FileImage className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p className="text-sm">No data available</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Dialogs ──────────────────────────────────────────────── */}

      <MediaAssetViewer
        asset={selectedAsset}
        isOpen={isViewerOpen}
        onClose={handleCloseViewer}
        apiUrl={API_URL}
        userRole={user?.role}
        onNavigate={handleViewerNavigate}
        hasPrev={viewerNavIndex > 0}
        hasNext={viewerNavIndex >= 0 && viewerNavIndex < viewerNavAssets.length - 1}
        autoEdit={selectedAsset != null && selectedAsset.id === autoEditAssetId}
        onCompress={selectedAsset && canCompressAsset(selectedAsset) ? () => {
          if (selectedAsset) {
            compress.setCompressDialogAssets([selectedAsset]);
            compress.setIsCompressDialogOpen(true);
          }
        } : undefined}
        onRemoveTag={async (tagName) => {
          if (!selectedAsset) return;
          await removeTagFromAsset(selectedAsset.id, tagName);
          setSelectedAsset((prev) =>
            prev ? { ...prev, tags: (prev.tags ?? []).filter((t) => t.name !== tagName) } : prev
          );
        }}
        onAddTags={() => {
          if (selectedAsset) {
            setTagDialogAssets([selectedAsset]);
            setIsTagDialogOpen(true);
          }
        }}
        onRename={folderCrud.handleRenameAsset}
        onMove={() => {
          folderCrud.setMoveTargetFolderPath('');
          folderCrud.setShowMoveDialog(true);
        }}
        onDuplicate={() => {
          if (!selectedAsset) return;
          const currentFolderPath = selectedAsset.filePath.substring(0, selectedAsset.filePath.lastIndexOf('/'));
          folderCrud.setDuplicateSourceFolder(null);
          folderCrud.setDuplicateTargetFolderPath(currentFolderPath || currentPath || rootPath || '');
          folderCrud.setShowDuplicateDialog(true);
        }}
        onAssetUpdated={(updates) => {
          setSelectedAsset((prev) => prev ? { ...prev, ...updates } : prev);
          if (rootPath) void loadDirectoryIntoCache(rootPath);
          if (currentPath && currentPath !== rootPath) void loadDirectoryIntoCache(currentPath);
        }}
      />

      <CompressDialog
        isOpen={compress.isCompressDialogOpen}
        onClose={() => compress.setIsCompressDialogOpen(false)}
        selectedAssets={compress.compressDialogAssets}
        onAddToQueue={(options) => {
          compress.addToCompressQueue(compress.compressDialogAssets, options);
          compress.setIsCompressDialogOpen(false);
          setSelectionMode(false);
          setSelectedAssetIds(new Set());
        }}
      />

      <TagDialog
        isOpen={isTagDialogOpen}
        onClose={() => setIsTagDialogOpen(false)}
        selectedAssets={tagDialogAssets}
        suggestions={tagSuggestions}
        onApply={async (tagNames) => {
          const updated = await applyTagsToAssets(tagDialogAssets.map((a) => a.id), tagNames);
          if (isViewerOpen && selectedAsset && updated) {
            const refreshed = updated.find((a) => a.id === selectedAsset.id);
            if (refreshed) {
              setSelectedAsset((prev) => prev ? { ...prev, tags: refreshed.tags } : prev);
            }
          }
          setIsTagDialogOpen(false);
          setSelectionMode(false);
          setSelectedAssetIds(new Set());
        }}
      />

      <RemoveTagsDialog
        isOpen={isRemoveTagsDialogOpen}
        onClose={() => setIsRemoveTagsDialogOpen(false)}
        selectedAssets={removeTagsAssets}
        onRemove={async (tagNames) => {
          await removeTagsFromAssets(removeTagsAssets.map((a) => a.id), tagNames);
          if (search.searchQuery) await search.handleSearch(search.searchQuery.term, search.searchQuery.mediaType);
          if (isViewerOpen && selectedAsset && removeTagsAssets.some((a) => a.id === selectedAsset.id)) {
            setSelectedAsset((prev) =>
              prev ? { ...prev, tags: (prev.tags ?? []).filter((t) => !tagNames.includes(t.name)) } : prev
            );
          }
          setSelectionMode(false);
          setSelectedAssetIds(new Set());
        }}
      />

      <CompressQueuePanel
        isOpen={compress.showQueuePanel}
        onClose={() => compress.setShowQueuePanel(false)}
        jobs={compress.compressQueue}
        onConfirm={compress.confirmCompressJob}
        onDismiss={compress.dismissCompressJob}
        onCancel={compress.cancelCompressJob}
        onClearCompleted={compress.clearCompletedJobs}
        onConfirmFile={compress.confirmSingleCompressFile}
        onDiscardFile={compress.discardSingleCompressFile}
        apiUrl={API_URL}
      />

      {/* Duplicate Asset */}
      <DuplicateDialog
        isOpen={folderCrud.showDuplicateDialog}
        onOpenChange={folderCrud.setShowDuplicateDialog}
        duplicateTargetFolderPath={folderCrud.duplicateTargetFolderPath}
        setDuplicateTargetFolderPath={folderCrud.setDuplicateTargetFolderPath}
        duplicateSourceFolder={folderCrud.duplicateSourceFolder}
        setDuplicateSourceFolder={folderCrud.setDuplicateSourceFolder}
        allAvailableFolders={allAvailableFolders}
        rootPath={rootPath}
        selectedAsset={selectedAsset}
        isDuplicating={folderCrud.isDuplicating}
        handleDuplicateAsset={folderCrud.handleDuplicateAsset}
      />

      {/* Move Asset */}
      <MoveDialog
        isOpen={folderCrud.showMoveDialog}
        onOpenChange={folderCrud.setShowMoveDialog}
        moveTargetFolderPath={folderCrud.moveTargetFolderPath}
        setMoveTargetFolderPath={folderCrud.setMoveTargetFolderPath}
        allAvailableFolders={allAvailableFolders}
        rootPath={rootPath}
        selectionMode={selectionMode}
        selectedAsset={selectedAsset}
        selectedAssetCount={selectedAssetIds.size}
        selectedFolderPaths={selectedFolderPaths}
        isMoving={folderCrud.isMoving}
        handleMoveAsset={folderCrud.handleMoveAsset}
        handleBulkMove={folderCrud.handleBulkMove}
      />

      {/* Rename Folder */}
      <RenameFolderDialog
        renamingFolder={folderCrud.renamingFolder}
        onClose={() => folderCrud.setRenamingFolder(null)}
        renameFolderValue={folderCrud.renameFolderValue}
        setRenameFolderValue={folderCrud.setRenameFolderValue}
        isRenamingFolder={folderCrud.isRenamingFolder}
        onSubmit={(e) => void folderCrud.handleRenameFolder(e)}
      />

      {/* Change Password */}
      <ChangePasswordDialog
        isOpen={showChangePasswordDialog}
        onOpenChange={setShowChangePasswordDialog}
        currentPassword={currentPassword}
        setCurrentPassword={setCurrentPassword}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        confirmPassword={confirmPassword}
        setConfirmPassword={setConfirmPassword}
        passwordError={passwordError}
        setPasswordError={setPasswordError}
        onSubmit={handleChangePassword}
      />

      {/* New File Dialog */}
      <NewFileDialog
        isOpen={fileCrud.showNewFileDialog}
        onOpenChange={fileCrud.setShowNewFileDialog}
        newFileName={fileCrud.newFileName}
        setNewFileName={fileCrud.setNewFileName}
        newFileType={fileCrud.newFileType}
        setNewFileType={fileCrud.setNewFileType}
        isCreatingFile={fileCrud.isCreatingFile}
        currentFolder={currentFolder}
        onSubmit={fileCrud.handleCreateFile}
      />

      {/* New Folder Dialog */}
      <NewFolderDialog
        isOpen={folderCrud.showNewFolderDialog}
        onOpenChange={folderCrud.setShowNewFolderDialog}
        newFolderName={folderCrud.newFolderName}
        setNewFolderName={folderCrud.setNewFolderName}
        isCreatingFolder={folderCrud.isCreatingFolder}
        currentFolder={currentFolder}
        onSubmit={folderCrud.handleCreateFolder}
      />

      {/* Upload Dialog */}
      <UploadDialog
        isOpen={showUploadDialog}
        onOpenChange={setShowUploadDialog}
        uploadFiles={uploadFiles}
        setUploadFiles={setUploadFiles}
        uploadTargetPath={uploadTargetPath}
        setUploadTargetPath={setUploadTargetPath}
        uploadProgress={uploadProgress}
        setUploadProgress={setUploadProgress}
        isUploading={isUploading}
        fileInputRef={fileInputRef}
        handleUpload={handleUpload}
        allDirectories={allDirectories}
      />

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        warning={confirmDialog.warning}
        confirmLabel={confirmDialog.confirmLabel}
        onConfirm={confirmDialog.onConfirm}
      />

      {/* Logout Confirmation */}
      <LogoutConfirmDialog
        isOpen={showLogoutConfirm}
        onCancel={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
      />
    </div>
  );
}
