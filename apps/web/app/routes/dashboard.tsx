import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { createGraphQLClient, getApiUrl, getAuthToken, clearAuthToken } from "~/lib/api";
import { MediaAssetViewer } from "~/components/MediaAssetViewer";
import { CompressDialog } from "~/components/CompressDialog";
import { CompressQueuePanel, type CompressJob } from "~/components/CompressQueuePanel";
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
import { getFileCategory, canCompressAsset, type FileCategory } from "~/lib/file-type";
import type { MediaAsset, DirectoryNode } from "~/lib/types";
import { useDirectoryTree } from "~/hooks/useDirectoryTree";
import { useMediaSelection } from "~/hooks/useMediaSelection";
import { useConfirmDialog } from "~/hooks/useConfirmDialog";
import { useTagActions } from "~/hooks/useTagActions";
import { useThumbnailObserver } from "~/hooks/useThumbnailObserver";
import { useFileUpload } from "~/hooks/useFileUpload";
import { useCacheSettings } from "~/hooks/useCacheSettings";
import { usePasswordChange } from "~/hooks/usePasswordChange";
import { CachePanelBody } from "~/components/CachePanelBody";
import {
  Folder, File, FileImage, FileText, Table2, ArrowLeft, ChevronDown, ChevronRight,
  Trash2, CheckSquare, Square, Users, Key, RotateCcw,
  Menu, X, ImagePlus, ArrowUpDown, Minimize2,
  Upload, LogOut, Download, FolderPlus, ListTodo,
  Moon, Sun, User, Tag as TagIcon, Pencil, HardDrive, FolderOpen,
  Copy, ScrollText, CalendarDays, Film, RefreshCw, Zap,
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

const CONFIRM_COMPRESS_MUTATION = `
  mutation ConfirmCompressReplace($ids: [ID!]!) {
    confirmCompressReplace(ids: $ids) { id fileName fileSize }
  }
`;

const CANCEL_COMPRESS_MUTATION = `
  mutation CancelCompressPreview($ids: [ID!]!) {
    cancelCompressPreview(ids: $ids)
  }
`;

const CREATE_TEXT_FILE_MUTATION = `
  mutation CreateTextFile($parentPath: String, $name: String!) {
    createTextFile(parentPath: $parentPath, name: $name) {
      id fileName filePath mimeType fileSize thumbnailUrl transcodedUrl createdAt capturedAt tags { id name }
    }
  }
`;

const CREATE_FOLDER_MUTATION = `
  mutation CreateFolder($parentPath: String, $name: String!) {
    createFolder(parentPath: $parentPath, name: $name) {
      name
      path
      type
    }
  }
`;

const DELETE_FOLDER_MUTATION = `
  mutation DeleteFolder($path: String!) {
    deleteFolder(path: $path)
  }
`;

const RENAME_MEDIA_ASSET_MUTATION = `
  mutation RenameMediaAsset($id: ID!, $newName: String!) {
    renameMediaAsset(id: $id, newName: $newName) {
      id fileName filePath mimeType fileSize thumbnailUrl transcodedUrl createdAt capturedAt tags { id name }
    }
  }
`;

const MOVE_MEDIA_ASSET_MUTATION = `
  mutation MoveMediaAsset($id: ID!, $newPath: String!) {
    moveMediaAsset(id: $id, newPath: $newPath) {
      id fileName filePath mimeType fileSize thumbnailUrl transcodedUrl createdAt capturedAt tags { id name }
    }
  }
`;

const DUPLICATE_MEDIA_ASSET_MUTATION = `
  mutation DuplicateMediaAsset($id: ID!, $destinationFolder: String) {
    duplicateMediaAsset(id: $id, destinationFolder: $destinationFolder) {
      id fileName filePath mimeType fileSize thumbnailUrl transcodedUrl createdAt capturedAt tags { id name }
    }
  }
`;

const DUPLICATE_FOLDER_MUTATION = `
  mutation DuplicateFolder($path: String!, $destinationFolder: String) {
    duplicateFolder(path: $path, destinationFolder: $destinationFolder) {
      name path type
    }
  }
`;

const RENAME_FOLDER_MUTATION = `
  mutation RenameFolder($path: String!, $newName: String!) {
    renameFolder(path: $path, newName: $newName) {
      name path type
    }
  }
`;

const MOVE_FOLDER_MUTATION = `
  mutation MoveFolder($path: String!, $destinationFolder: String!) {
    moveFolder(path: $path, destinationFolder: $destinationFolder) {
      name path type
    }
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

function getFileCategoryLabel(asset: MediaAsset) {
  const labels: Record<FileCategory, string> = {
    image: "Image",
    video: "Video",
    pdf: "PDF",
    word: "Word",
    excel: "Excel",
    text: "Text",
    markdown: "MD",
    other: "File",
  };
  return labels[getFileCategory(asset)];
}

function FileTypeIcon({ asset, className }: { asset: MediaAsset; className: string }) {
  const category = getFileCategory(asset);
  if (category === "excel") return <Table2 className={className} />;
  if (category === "word" || category === "text" || category === "markdown" || category === "pdf") {
    return <FileText className={className} />;
  }
  if (category === "image" || category === "video") return <FileImage className={className} />;
  return <File className={className} />;
}

function SidebarNavItem({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  onClick?: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 relative ${
        active
          ? "nav-active bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-auto w-5 h-5 gradient-brand rounded-full flex items-center justify-center text-[10px] font-bold text-[#060e20]">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

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
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const [showSelectionActionsMenu, setShowSelectionActionsMenu] = useState(false);
  const selectionActionsMenuRef = useRef<HTMLDivElement>(null);
  const [isCompressDialogOpen, setIsCompressDialogOpen] = useState(false);
  const [compressDialogAssets, setCompressDialogAssets] = useState<MediaAsset[]>([]);
  const [compressQueue, setCompressQueue] = useState<CompressJob[]>([]);
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const compressQueueRef = useRef<CompressJob[]>([]);
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileType, setNewFileType] = useState<'md' | 'txt'>('md');
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [autoEditAssetId, setAutoEditAssetId] = useState<string | null>(null);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [moveTargetFolderPath, setMoveTargetFolderPath] = useState('');
  const [isMoving, setIsMoving] = useState(false);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateTargetFolderPath, setDuplicateTargetFolderPath] = useState('');
  const [duplicateSourceFolder, setDuplicateSourceFolder] = useState<{ path: string; name: string } | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<{ path: string; name: string } | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
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
    fetchCacheStats,
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
  const [searchQuery, setSearchQuery] = useState<{ term: string; mediaType: string } | null>(null);
  const [searchAssets, setSearchAssets] = useState<MediaAsset[]>([]);
  const [searchFolders, setSearchFolders] = useState<{ name: string; path: string; parentPath?: string | null }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLimit, setSearchLimit] = useState<25 | 50 | 100 | 250 | 0>(25);
  const [minSizeBytes, setMinSizeBytes] = useState<number>(0); // 0 = no filter
  const refreshInFlightRef = useRef(false);
  const thumbnailPollTimerRef = useRef<number | null>(null);
  const thumbnailPollAttemptsRef = useRef(0);
  const thumbnailPollInFlightRef = useRef(false);
  const { thumbnailSessionIdRef, registerLazyThumbnailCard } = useThumbnailObserver({ currentPath });
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("queue") === "open") {
      setShowQueuePanel(true);
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

  // Keep queue ref in sync so confirmCompressJob can read current jobs without stale closures
  useEffect(() => { compressQueueRef.current = compressQueue; }, [compressQueue]);

  // Load queue from server on login
  useEffect(() => {
    if (!user) return;
    const token = getAuthToken();
    if (!token) return;
    fetch(`${API_URL}/api/queue-state`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(({ queue }) => {
        if (!Array.isArray(queue) || queue.length === 0) return;
        setCompressQueue(
          (queue as CompressJob[]).map(job => ({
            ...job,
            progress: {},
            currentFileId: null,
            fileStatuses: job.fileStatuses ?? Object.fromEntries(
              (job.assets ?? []).map(a => [
                a.id,
                job.status === "done" ? "confirmed" as const : "pending" as const,
              ])
            ),
            status: (
              job.status === "compressing" ? "pending"       // BullMQ retries the job
              : job.status === "transcoding" ? "pending"     // BullMQ retries the job
              : job.status === "confirming" ? "preview_ready" // let user retry confirm
              : job.status
            ) as CompressJob["status"],
          }))
        );
      })
      .catch(() => {});
  }, [user?.username]);

  // Poll for queue updates every 5 s when jobs are active
  const hasActiveJobs = compressQueue.some(j => j.status === "pending" || j.status === "compressing" || j.status === "transcoding");
  useEffect(() => {
    if (!hasActiveJobs || !user) return;
    const token = getAuthToken();
    if (!token) return;
    const intervalId = setInterval(() => {
      fetch(`${API_URL}/api/queue-state`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(({ queue }) => {
          if (!Array.isArray(queue)) return;
          setCompressQueue(prev =>
            (queue as CompressJob[]).map(serverJob => {
              const local = prev.find(j => j.id === serverJob.id);
              return {
                ...serverJob,
                fileStatuses: local?.fileStatuses ?? Object.fromEntries(
                  (serverJob.assets ?? []).map(a => [a.id, "pending" as const])
                ),
              };
            })
          );
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(intervalId);
  }, [hasActiveJobs, user]);

  const addToCompressQueue = useCallback(async (assets: MediaAsset[], options: { resolution: string; quality: number }) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/compress/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: assets.map(a => a.id), options }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const { jobId } = await res.json();
      setCompressQueue(prev => [...prev, {
        id: jobId,
        assets,
        options,
        status: "pending" as const,
        progress: {},
        currentFileId: null,
        previews: [],
        fileStatuses: Object.fromEntries(assets.map(a => [a.id, "pending" as const])),
        addedAt: Date.now(),
      }]);
      setShowQueuePanel(true);
    } catch (err: any) {
      console.error("Failed to enqueue compression job:", err.message);
    }
  }, []);

  const saveQueueToServer = useCallback((updatedQueue: CompressJob[]) => {
    const token = getAuthToken();
    if (!token || !user) return;
    fetch(`${API_URL}/api/queue-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ queue: updatedQueue }),
    }).catch(() => {});
  }, [user]);

  const confirmCompressJob = useCallback(async (jobId: string) => {
    const job = compressQueueRef.current.find(j => j.id === jobId);
    if (!job) return;
    const pendingIds = job.assets
      .filter(a => (job.fileStatuses?.[a.id] ?? "pending") === "pending")
      .map(a => a.id);
    if (pendingIds.length === 0) return;

    setCompressQueue(prev => prev.map(j => j.id !== jobId ? j : {
      ...j,
      status: "confirming" as const,
      fileStatuses: {
        ...j.fileStatuses,
        ...Object.fromEntries(pendingIds.map(id => [id, "confirming" as const])),
      },
    }));
    try {
      const token = getAuthToken();
      if (!token) throw new Error("Not authenticated");
      await createGraphQLClient(token).request(CONFIRM_COMPRESS_MUTATION, { ids: pendingIds });
      const updated = compressQueueRef.current.map(j => j.id !== jobId ? j : {
        ...j,
        status: "done" as const,
        fileStatuses: {
          ...j.fileStatuses,
          ...Object.fromEntries(pendingIds.map(id => [id, "confirmed" as const])),
        },
      });
      setCompressQueue(updated);
      saveQueueToServer(updated);
      if (currentPath) await loadDirectoryIntoCache(currentPath);
      if (rootPath && rootPath !== currentPath) await loadDirectoryIntoCache(rootPath);
    } catch (err: any) {
      setCompressQueue(prev => prev.map(j => j.id !== jobId ? j : {
        ...j,
        status: "error" as const,
        fileStatuses: {
          ...j.fileStatuses,
          ...Object.fromEntries(pendingIds.map(id => [id, "pending" as const])),
        },
        errorMessage: err.message || "Failed to apply compression",
      }));
    }
  }, [currentPath, rootPath, saveQueueToServer]);

  const dismissCompressJob = useCallback((jobId: string) => {
    const job = compressQueueRef.current.find(j => j.id === jobId);
    if (!job) return;
    const pendingIds = job.assets
      .filter(a => (job.fileStatuses?.[a.id] ?? "pending") === "pending")
      .map(a => a.id);
    if (pendingIds.length > 0) {
      const token = getAuthToken();
      if (token) {
        createGraphQLClient(token)
          .request(CANCEL_COMPRESS_MUTATION, { ids: pendingIds })
          .catch(() => {});
      }
    }
    setCompressQueue(prev => {
      const updated = prev.filter(j => j.id !== jobId);
      saveQueueToServer(updated);
      return updated;
    });
  }, [saveQueueToServer]);

  const confirmSingleCompressFile = useCallback(async (jobId: string, assetId: string) => {
    setCompressQueue(prev => prev.map(j => j.id !== jobId ? j : {
      ...j,
      fileStatuses: { ...j.fileStatuses, [assetId]: "confirming" as const },
    }));
    try {
      const token = getAuthToken();
      if (!token) throw new Error("Not authenticated");
      await createGraphQLClient(token).request(CONFIRM_COMPRESS_MUTATION, { ids: [assetId] });
      setCompressQueue(prev => {
        const updated = prev.map(j => {
          if (j.id !== jobId) return j;
          const newStatuses = { ...j.fileStatuses, [assetId]: "confirmed" as const };
          const allDecided = Object.values(newStatuses).every(
            s => s === "confirmed" || s === "discarded" || s === "error"
          );
          return { ...j, fileStatuses: newStatuses, status: allDecided ? "done" as const : j.status };
        });
        saveQueueToServer(updated);
        return updated;
      });
      if (currentPath) await loadDirectoryIntoCache(currentPath);
      if (rootPath && rootPath !== currentPath) await loadDirectoryIntoCache(rootPath);
    } catch (err: any) {
      setCompressQueue(prev => prev.map(j => j.id !== jobId ? j : {
        ...j,
        fileStatuses: { ...j.fileStatuses, [assetId]: "error" as const },
      }));
    }
  }, [currentPath, rootPath, saveQueueToServer]);

  const discardSingleCompressFile = useCallback(async (jobId: string, assetId: string) => {
    try {
      const token = getAuthToken();
      if (token) {
        await createGraphQLClient(token).request(CANCEL_COMPRESS_MUTATION, { ids: [assetId] });
      }
    } catch {
      // best-effort preview cleanup — don't block the UI update
    }
    setCompressQueue(prev => {
      const updated = prev.map(j => {
        if (j.id !== jobId) return j;
        const newStatuses = { ...j.fileStatuses, [assetId]: "discarded" as const };
        const allDecided = Object.values(newStatuses).every(
          s => s === "confirmed" || s === "discarded" || s === "error"
        );
        const anyConfirmed = Object.values(newStatuses).some(s => s === "confirmed");
        if (allDecided && !anyConfirmed) return null; // all skipped → remove job
        return { ...j, fileStatuses: newStatuses, status: allDecided ? "done" as const : j.status };
      }).filter((j): j is CompressJob => j !== null);
      saveQueueToServer(updated);
      return updated;
    });
  }, [saveQueueToServer]);

  const cancelCompressJob = useCallback(async (jobId: string) => {
    const token = getAuthToken();
    if (!token) return;
    // Optimistic UI: mark cancelled locally right away so the user gets feedback.
    setCompressQueue(prev => prev.map(j => j.id === jobId
      ? { ...j, status: "cancelled" as const, currentFileId: null, progress: {} }
      : j));
    try {
      const res = await fetch(`${API_URL}/api/compress/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
    } catch (err: any) {
      console.error("Failed to cancel compression job:", err.message);
      // Roll back to error state so the user knows the cancel didn't land.
      setCompressQueue(prev => prev.map(j => j.id === jobId
        ? { ...j, status: "error" as const, errorMessage: "Failed to cancel job" }
        : j));
    }
  }, []);

  const clearCompletedJobs = useCallback(() => {
    const isFinished = (s: CompressJob["status"]) => s === "done" || s === "error" || s === "cancelled";
    setCompressQueue(prev => {
      const updated = prev.filter(j => !isFinished(j.status));
      // Cancel preview files for completed jobs that had previews
      const toCancel = prev.filter(j => isFinished(j.status) && j.previews.length > 0);
      if (toCancel.length > 0) {
        const token = getAuthToken();
        if (token) {
          const ids = toCancel.flatMap(j => j.assets.map(a => a.id));
          createGraphQLClient(token).request(CANCEL_COMPRESS_MUTATION, { ids }).catch(() => {});
        }
      }
      saveQueueToServer(updated);
      return updated;
    });
  }, [saveQueueToServer]);

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFileName.trim();
    if (!trimmed || isCreatingFile) return;
    // Append the chosen extension unless the user already typed a valid one
    const hasValidExt = /\.(txt|md|markdown)$/i.test(trimmed);
    const finalName = hasValidExt ? trimmed : `${trimmed}.${newFileType}`;
    try {
      setIsCreatingFile(true);
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      const data: any = await client.request(CREATE_TEXT_FILE_MUTATION, {
        parentPath: currentPath,
        name: finalName,
      });
      setShowNewFileDialog(false);
      setNewFileName('');
      if (currentPath) await loadDirectoryIntoCache(currentPath);
      // Open the new document straight in the editor
      const created = data.createTextFile as MediaAsset;
      setAutoEditAssetId(created.id);
      setSelectedAsset(created);
      setIsViewerOpen(true);
    } catch (err: any) {
      alert(`Failed to create file: ${err?.response?.errors?.[0]?.message || err.message || 'Unknown error'}`);
    } finally {
      setIsCreatingFile(false);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || isCreatingFolder) return;
    try {
      setIsCreatingFolder(true);
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(CREATE_FOLDER_MUTATION, { parentPath: currentPath, name: newFolderName.trim() });
      setShowNewFolderDialog(false);
      setNewFolderName('');
      if (currentPath) await loadDirectoryIntoCache(currentPath);
    } catch (err: any) {
      alert(`Failed to create folder: ${err.message || 'Unknown error'}`);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleDeleteFolder = (folderPath: string, folderName: string) => {
    openConfirm({
      title: "Delete Folder",
      description: `Delete folder "${folderName}" and all its contents?`,
      warning: "The folder is moved to the Trash and kept for 30 days before permanent deletion.",
      onConfirm: async () => {
        try {
          const token = getAuthToken();
          if (!token) return;
          const client = createGraphQLClient(token);
          await client.request(DELETE_FOLDER_MUTATION, { path: folderPath });
          // Remove deleted folder from cache
          setDirectoryCache((prev) => {
            const next = { ...prev };
            for (const key of Object.keys(next)) {
              if (key === folderPath || key.startsWith(`${folderPath}/`)) delete next[key];
            }
            return next;
          });
          if (currentPath === folderPath) {
            await handleBackClick();
          } else {
            if (currentPath) await loadDirectoryIntoCache(currentPath);
          }
        } catch (err: any) {
          alert(`Failed to delete folder: ${err.message || 'Unknown error'}`);
        }
      },
    });
  };

  const handleMoveAsset = async () => {
    if (!selectedAsset || !moveTargetFolderPath || isMoving) return;
    setIsMoving(true);
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      const newPath = `${moveTargetFolderPath}/${selectedAsset.fileName}`;
      const data: any = await client.request(MOVE_MEDIA_ASSET_MUTATION, { id: selectedAsset.id, newPath });
      setSelectedAsset(data.moveMediaAsset);
      setShowMoveDialog(false);
      setMoveTargetFolderPath('');
      if (rootPath) await loadDirectoryIntoCache(rootPath);
      if (currentPath && currentPath !== rootPath) await loadDirectoryIntoCache(currentPath);
      if (moveTargetFolderPath !== rootPath && moveTargetFolderPath !== currentPath) {
        await loadDirectoryIntoCache(moveTargetFolderPath);
      }
    } catch (err: any) {
      alert(`Failed to move file: ${err.message || 'Unknown error'}`);
    } finally {
      setIsMoving(false);
    }
  };

  const handleDuplicateAsset = async () => {
    if ((!selectedAsset && !duplicateSourceFolder) || !duplicateTargetFolderPath || isDuplicating) return;
    setIsDuplicating(true);
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      if (duplicateSourceFolder) {
        await client.request(DUPLICATE_FOLDER_MUTATION, {
          path: duplicateSourceFolder.path,
          destinationFolder: duplicateTargetFolderPath,
        });
      } else if (selectedAsset) {
        const data: any = await client.request(DUPLICATE_MEDIA_ASSET_MUTATION, {
          id: selectedAsset.id,
          destinationFolder: duplicateTargetFolderPath,
        });
        setSelectedAsset(data.duplicateMediaAsset);
      }
      setShowDuplicateDialog(false);
      setDuplicateTargetFolderPath('');
      setDuplicateSourceFolder(null);
      if (rootPath) await loadDirectoryIntoCache(rootPath);
      if (currentPath && currentPath !== rootPath) await loadDirectoryIntoCache(currentPath);
      if (duplicateTargetFolderPath !== rootPath && duplicateTargetFolderPath !== currentPath) {
        await loadDirectoryIntoCache(duplicateTargetFolderPath);
      }
    } catch (err: any) {
      alert(`Failed to duplicate item: ${err.message || 'Unknown error'}`);
    } finally {
      setIsDuplicating(false);
    }
  };

  const openDuplicateFolderDialog = (folder: { path: string; name: string }) => {
    setSelectedAsset(null);
    setDuplicateSourceFolder(folder);
    setDuplicateTargetFolderPath(folder.path.substring(0, folder.path.lastIndexOf('/')) || currentPath || rootPath || '');
    setShowDuplicateDialog(true);
  };

  const handleBulkMove = async () => {
    if (!moveTargetFolderPath || isMoving) return;
    const token = getAuthToken();
    if (!token) return;
    setIsMoving(true);
    try {
      const client = createGraphQLClient(token);
      for (const node of sortedFolderChildren) {
        if (node.type === 'file' && node.mediaAsset && selectedAssetIds.has(node.mediaAsset.id)) {
          const newPath = `${moveTargetFolderPath}/${node.mediaAsset.fileName}`;
          await client.request(MOVE_MEDIA_ASSET_MUTATION, { id: node.mediaAsset.id, newPath });
        }
      }
      for (const folderPath of selectedFolderPaths) {
        await client.request(MOVE_FOLDER_MUTATION, { path: folderPath, destinationFolder: moveTargetFolderPath });
      }
      setSelectedAssetIds(new Set());
      setSelectedFolderPaths(new Set());
      setSelectionMode(false);
      setShowMoveDialog(false);
      setMoveTargetFolderPath('');
      if (rootPath) await loadDirectoryIntoCache(rootPath);
      if (currentPath && currentPath !== rootPath) await loadDirectoryIntoCache(currentPath);
      if (moveTargetFolderPath !== rootPath && moveTargetFolderPath !== currentPath) {
        await loadDirectoryIntoCache(moveTargetFolderPath);
      }
    } catch (err: any) {
      alert(`Failed to move items: ${err.message || 'Unknown error'}`);
    } finally {
      setIsMoving(false);
    }
  };

  const handleRenameFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingFolder || !renameFolderValue.trim() || isRenamingFolder) return;
    setIsRenamingFolder(true);
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(RENAME_FOLDER_MUTATION, { path: renamingFolder.path, newName: renameFolderValue.trim() });
      const renamedPath = renamingFolder.path;
      setRenamingFolder(null);
      setRenameFolderValue('');
      setDirectoryCache((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key === renamedPath || key.startsWith(`${renamedPath}/`)) delete next[key];
        }
        return next;
      });
      if (currentPath && (currentPath === renamedPath || currentPath.startsWith(`${renamedPath}/`))) {
        await handleBackClick();
      } else {
        if (currentPath) await loadDirectoryIntoCache(currentPath);
      }
    } catch (err: any) {
      alert(`Failed to rename folder: ${err.message || 'Unknown error'}`);
    } finally {
      setIsRenamingFolder(false);
    }
  };

  const handleFolderClick = async (folder: DirectoryNode) => {
    if (selectionMode) {
      toggleFolderSelection(folder.path);
      return;
    }
    // Opening a folder from search results exits search and navigates into it
    if (searchQuery) {
      setSearchQuery(null);
      setSearchAssets([]);
      setSearchFolders([]);
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
    setSearchQuery(null);
    setSearchAssets([]);
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
  }, [clearTagFilter, currentPath, directoryCache]);

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

  const sortedFolderChildren = useMemo(() => {
    const baseChildren = searchQuery
      ? searchResultNodes
      : activeTagFilter ? tagFilterNodes : currentFolderChildren;
    if (sortOption === "default" || searchQuery) return baseChildren;
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
  }, [activeTagFilter, currentFolderChildren, searchQuery, searchResultNodes, sortOption, tagFilterNodes]);

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
        if (searchQuery) {
          void handleSearch(searchQuery.term, searchQuery.mediaType);
        } else if (currentPath) {
          void loadDirectoryIntoCache(currentPath);
        }
      }, 6000);
    } catch (err: any) {
      console.error("Failed to queue thumbnail regeneration:", err.message);
      alert(`Failed to queue thumbnails: ${err.message}`);
    }
  }, [selectedAssets, searchQuery, currentPath, handleSearch]);

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
      setCompressQueue(prev => [...prev, {
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
      setShowQueuePanel(true);
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
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    };
    if (showSortMenu) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSortMenu]);

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
    if (!searchQuery) return;
    void handleSearch(searchQuery.term, searchQuery.mediaType);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortOption, searchLimit, minSizeBytes, currentPath]);

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
                onClick={() => { setRenamingFolder({ path: node.path, name: node.name }); setRenameFolderValue(node.name); }}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-accent rounded-lg transition-all duration-150 shrink-0"
                title="Rename folder"
              >
                <Pencil className="w-3.5 h-3.5 text-foreground" />
              </button>
              <button
                type="button"
                onClick={() => openDuplicateFolderDialog({ path: node.path, name: node.name })}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-accent rounded-lg transition-all duration-150 shrink-0"
                title="Duplicate folder"
              >
                <Copy className="w-3.5 h-3.5 text-foreground" />
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteFolder(node.path, node.name)}
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

  const heroTitle = searchQuery
    ? searchQuery.term
      ? `"${searchQuery.term}"`
      : searchQuery.mediaType === "image" ? "All Images" : "All Videos"
    : activeTagFilter
      ? `#${activeTagFilter}`
      : !isAtRoot && currentFolder
        ? currentFolder.name
        : "Your Collection";
  const heroSubtitle = searchQuery
    ? searchLoading
      ? "Searching…"
      : searchLimit > 0 && searchAssets.length >= searchLimit
        ? `Showing top ${searchAssets.length} results — try a narrower search or increase the limit`
        : `${searchAssets.length} result${searchAssets.length === 1 ? "" : "s"} found${currentPath && currentPath !== rootPath ? ` in /${currentPath.split("/").filter(Boolean).pop()}` : ""}`
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
      <aside className="hidden md:flex flex-col fixed left-0 top-0 h-screen w-64 bg-card z-30 shrink-0">
        {/* Brand */}
        <div className="px-5 py-6">
          <button
            type="button"
            onClick={() => { setCurrentPath(rootPath); setFolderHistory([]); }}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="w-9 h-9 rounded-xl gradient-brand flex items-center justify-center shadow-ambient shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#060e20" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
            </div>
            <div className="text-left">
              <p className="font-manrope font-bold text-sm text-foreground leading-none">The Curator</p>
              <p className="label-meta mt-0.5">Media Archive</p>
            </div>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-0.5">
          <SidebarNavItem icon={Folder} label="Collections" active onClick={() => { setCurrentPath(rootPath); setFolderHistory([]); }} />
          <SidebarNavItem icon={CalendarDays} label="Timeline" onClick={() => navigate("/timeline")} />
          {(user?.role === "admin" || user?.role === "editor") && (
            <SidebarNavItem icon={Trash2} label="Trash" onClick={() => navigate("/trash")} />
          )}
          {(user?.role === "admin" || user?.role === "editor") && (
            <SidebarNavItem
              icon={ListTodo}
              label="Queue"
              onClick={() => setShowQueuePanel(true)}
              badge={compressQueue.filter(j => !["done", "error"].includes(j.status)).length || undefined}
            />
          )}
          {user?.role === "admin" && (
            <SidebarNavItem icon={Users} label="Users" onClick={() => navigate("/users")} />
          )}
          {user?.role === "admin" && (
            <SidebarNavItem icon={ScrollText} label="Audit" onClick={() => navigate("/audit")} />
          )}
        </nav>

        {/* Bottom */}
        <div className="px-3 pb-6 space-y-3">
          {rootSize != null && rootSize > 0 && (
            <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-border/20 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 shrink-0" />
                Media Total
              </span>
              <span className="font-mono">{formatBytes(rootSize)}</span>
            </div>
          )}
          {/* Cache stats (admin only) */}
          {user?.role === "admin" && cacheStats && (
            <div className="rounded-xl border border-border/20 overflow-hidden">
              <button
                type="button"
                onClick={toggleCachePanel}
                className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
              >
                <span className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 shrink-0" />
                  Cache
                </span>
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono text-xs truncate">{formatBytes(cacheStats.totalBytes)}</span>
                  <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${showCachePanel ? "rotate-180" : ""}`} />
                </span>
              </button>
              {showCachePanel && (
                <CachePanelBody
                  cacheStats={cacheStats}
                  cacheSettings={cacheSettings}
                  onClear={(type) => void handleClearCache(type)}
                  onSaveSettings={handleSaveCacheSettings}
                />
              )}
            </div>
          )}

          {/* Refresh button */}
          <button
            type="button"
            onClick={handleRefreshMediaLibrary}
            disabled={isRefreshing}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border/40 text-muted-foreground text-sm hover:text-foreground hover:bg-accent transition-all duration-200 disabled:opacity-50"
          >
            <RotateCcw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Refreshing…" : "Refresh Library"}
          </button>

          {/* Upload */}
          {(user?.role === "admin" || user?.role === "editor") && (
            <button
              type="button"
              onClick={() => { setUploadTargetPath(currentPath || rootPath || ''); setShowUploadDialog(true); }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity duration-200"
            >
              <Upload className="w-4 h-4" />
              Upload Media
            </button>
          )}

          {/* User row */}
          {user && (
            <div className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-accent/50 transition-colors group">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{user.username}</p>
                <p className="label-meta capitalize">{user.role}</p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => setShowChangePasswordDialog(true)}
                  className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title="Change Password"
                >
                  <Key className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogoutConfirm(true)}
                  className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────── */}
      <div className="flex-1 md:ml-64 min-h-screen flex flex-col">

        {/* Mobile top bar */}
        <div className="md:hidden flex items-center justify-between px-4 py-4 bg-card/80 backdrop-blur-xs sticky top-0 z-20">
          <button
            type="button"
            onClick={() => { setCurrentPath(rootPath); setFolderHistory([]); }}
            className="flex items-center gap-3"
          >
            <div className="w-8 h-8 rounded-xl gradient-brand flex items-center justify-center">
              <Folder className="w-4 h-4 text-[#060e20]" />
            </div>
            <span className="font-manrope font-bold text-sm text-foreground">The Curator</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((p) => !p)}
            className="p-2 rounded-xl bg-muted text-muted-foreground"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
            <div className="relative w-64 bg-card h-full flex flex-col p-4 space-y-1 shadow-ambient">
              <SidebarNavItem icon={Folder} label="Collections" active onClick={() => { setCurrentPath(rootPath); setFolderHistory([]); setMobileMenuOpen(false); }} />
              <SidebarNavItem icon={CalendarDays} label="Timeline" onClick={() => { navigate("/timeline"); setMobileMenuOpen(false); }} />
              {(user?.role === "admin" || user?.role === "editor") && (
                <SidebarNavItem icon={Trash2} label="Trash" onClick={() => { navigate("/trash"); setMobileMenuOpen(false); }} />
              )}
              {(user?.role === "admin" || user?.role === "editor") && (
                <SidebarNavItem
                  icon={ListTodo}
                  label="Queue"
                  onClick={() => { setShowQueuePanel(true); setMobileMenuOpen(false); }}
                  badge={compressQueue.filter(j => !["done", "error"].includes(j.status)).length || undefined}
                />
              )}
              {user?.role === "admin" && (
                <SidebarNavItem icon={Users} label="Users" onClick={() => { navigate("/users"); setMobileMenuOpen(false); }} />
              )}
              {user?.role === "admin" && (
                <SidebarNavItem icon={ScrollText} label="Audit" onClick={() => { navigate("/audit"); setMobileMenuOpen(false); }} />
              )}
              <div className="pt-4 space-y-2">
                <button
                  type="button"
                  onClick={() => { handleRefreshMediaLibrary(); setMobileMenuOpen(false); }}
                  disabled={isRefreshing}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-all disabled:opacity-50"
                >
                  <RotateCcw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
                  {isRefreshing ? "Refreshing…" : "Refresh Library"}
                </button>
                {(user?.role === "admin" || user?.role === "editor") && (
                  <>
                    <button
                      type="button"
                      onClick={() => { handleGenerateThumbnails(); setMobileMenuOpen(false); }}
                      disabled={isGeneratingThumbnails || !currentPath}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-all disabled:opacity-40"
                    >
                      <ImagePlus className="w-4 h-4" />
                      {isGeneratingThumbnails ? "Queuing…" : "Generate Thumbnails"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setUploadTargetPath(currentPath || rootPath || ''); setShowUploadDialog(true); setMobileMenuOpen(false); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity"
                    >
                      <Upload className="w-4 h-4" />
                      Upload Media
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => { setDarkMode(!darkMode); setMobileMenuOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-all"
                >
                  {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  {darkMode ? "Light Mode" : "Dark Mode"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowChangePasswordDialog(true); setMobileMenuOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-all"
                >
                  <Key className="w-4 h-4" /> Change Password
                </button>
                {rootSize != null && rootSize > 0 && (
                  <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-border/20 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 shrink-0" />
                      Media Total
                    </span>
                    <span className="font-mono">{formatBytes(rootSize)}</span>
                  </div>
                )}
                {user?.role === "admin" && cacheStats && (
                  <div className="rounded-xl border border-border/20 overflow-hidden">
                    <button
                      type="button"
                      onClick={toggleCachePanel}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                    >
                      <span className="flex items-center gap-2">
                        <HardDrive className="w-4 h-4 shrink-0" />
                        Cache
                      </span>
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-xs truncate">{formatBytes(cacheStats.totalBytes)}</span>
                        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${showCachePanel ? "rotate-180" : ""}`} />
                      </span>
                    </button>
                    {showCachePanel && (
                      <CachePanelBody
                        cacheStats={cacheStats}
                        cacheSettings={cacheSettings}
                        onClear={(type) => void handleClearCache(type)}
                        onSaveSettings={handleSaveCacheSettings}
                      />
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => { setShowLogoutConfirm(true); setMobileMenuOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-all"
                >
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search bar */}
        <div className="md:sticky md:top-0 z-20 bg-background/80 backdrop-blur-xs px-4 md:px-10 pt-3 pb-1.5">
          <SearchBar
            onSearch={handleSearch}
            onClear={handleClearSearch}
            className="w-full md:max-w-xl"
          />
        </div>

        {/* Toolbar */}
        <div className="relative z-30 bg-background/80 backdrop-blur-xs px-4 md:px-10 pb-3 pt-1 flex items-center justify-between gap-2 md:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {searchQuery && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="flex items-center gap-1.5 text-sm text-brand-primary hover:opacity-80 transition-opacity"
              >
                <ArrowLeft className="w-4 h-4" /> Exit search
              </button>
            )}
            {activeTagFilter && !searchQuery && (
              <button
                type="button"
                onClick={clearTagFilter}
                className="flex items-center gap-1.5 text-sm text-brand-primary hover:opacity-80 transition-opacity"
              >
                <ArrowLeft className="w-4 h-4" /> Exit tag filter
              </button>
            )}
            {!activeTagFilter && !searchQuery && folderHistory.length > 0 && (
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
                          setCompressDialogAssets(selectedCompressibleAssets);
                          setIsCompressDialogOpen(true);
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
                        onClick={() => { setMoveTargetFolderPath(''); setShowMoveDialog(true); }}
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
                              setCompressDialogAssets(selectedCompressibleAssets);
                              setIsCompressDialogOpen(true);
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
                            { label: `Move (${selectedAssetIds.size + selectedFolderPaths.size})`, icon: FolderOpen, disabled: false, destructive: false, show: user?.role === "admin" || user?.role === "editor", run: () => { setMoveTargetFolderPath(''); setShowMoveDialog(true); } },
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
                onClick={() => setShowNewFolderDialog(true)}
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
                onClick={() => setShowNewFileDialog(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
                title="New text or Markdown file"
              >
                <FileText className="w-4 h-4" />
                <span className="hidden md:inline">New File</span>
              </button>
            )}

            {/* Tag filter */}
            <div className="relative" ref={tagFilterMenuRef}>
              <button
                ref={tagFilterTriggerRef}
                type="button"
                onClick={() => {
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
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all ${
                  activeTagFilter
                    ? "text-brand-primary bg-brand-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
                title={activeTagFilter ? `Filtered by #${activeTagFilter}` : "Filter by tag"}
              >
                <TagIcon className="w-4 h-4" />
                <span className="hidden sm:inline">
                  {activeTagFilter ? `#${activeTagFilter}` : "Tags"}
                </span>
                {activeTagFilter && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); clearTagFilter(); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        clearTagFilter();
                      }
                    }}
                    className="ml-1 hover:bg-brand-primary/20 rounded-full p-0.5 cursor-pointer"
                    aria-label="Clear tag filter"
                  >
                    <X className="w-3 h-3" />
                  </span>
                )}
              </button>
              {showTagFilterMenu && (
                <div
                  className="absolute top-full mt-1 w-64 max-w-[calc(100vw-1rem)] bg-card border border-border/20 rounded-xl shadow-ambient z-50 py-1 max-h-80 overflow-y-auto"
                  style={{ right: tagFilterMenuRight }}
                >
                  {tagSuggestions.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-muted-foreground">
                      No tags yet. Select files and apply a tag to start.
                    </p>
                  ) : (
                    tagSuggestions.map((tag) => {
                      const canEdit = user?.role === "admin" || user?.role === "editor";
                      return (
                        <div
                          key={tag.id}
                          className={`group flex items-center px-2 transition-colors ${
                            activeTagFilter === tag.name ? "bg-accent" : "hover:bg-accent"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => void applyTagFilter(tag.name)}
                            className={`flex-1 flex items-center justify-between px-2 py-2 text-sm text-left ${
                              activeTagFilter === tag.name
                                ? "text-brand-primary font-medium"
                                : "text-muted-foreground group-hover:text-foreground"
                            }`}
                          >
                            <span>#{tag.name}</span>
                            <span className="text-xs">{tag.assetCount}</span>
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void handleRenameTag(tag.name); }}
                              className="p-1.5 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-background transition-all"
                              title={`Rename #${tag.name}`}
                              aria-label={`Rename ${tag.name}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {user?.role === "admin" && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void handleDeleteTag(tag.name); }}
                              className="p-1.5 rounded-lg text-destructive opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all"
                              title={`Delete #${tag.name}`}
                              aria-label={`Delete ${tag.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Sort */}
            <div className="relative" ref={sortMenuRef}>
              <button
                type="button"
                onClick={() => setShowSortMenu((p) => !p)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all ${
                  sortOption !== "default"
                    ? "text-brand-primary bg-brand-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                <ArrowUpDown className="w-4 h-4" />
                <span className="hidden sm:inline">
                  {sortOption === "default" ? "Sort"
                    : sortOption === "size-asc" ? "Size ↑"
                    : sortOption === "size-desc" ? "Size ↓"
                    : sortOption === "date-asc" ? "Date ↑"
                    : "Date ↓"}
                </span>
              </button>
              {showSortMenu && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border/20 rounded-xl shadow-ambient z-50 py-1 overflow-hidden">
                  {([
                    ["default",   "Default"],
                    ["size-asc",  "Size ↑ (Smallest)"],
                    ["size-desc", "Size ↓ (Largest)"],
                    ["date-asc",  "Date ↑ (Oldest)"],
                    ["date-desc", "Date ↓ (Newest)"],
                  ] as const).map(([opt, label]) => (
                    <button
                      key={opt}
                      type="button"
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                        sortOption === opt
                          ? "text-brand-primary font-medium bg-accent"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                      onClick={() => { setSortOption(opt); setShowSortMenu(false); }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Search result limit — only visible during active search */}
            {searchQuery && (
              <select
                value={searchLimit}
                onChange={(e) => setSearchLimit(Number(e.target.value) as typeof searchLimit)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-muted text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-brand-primary/30 cursor-pointer"
                aria-label="Max search results"
              >
                <option value={25}>25 results</option>
                <option value={50}>50 results</option>
                <option value={100}>100 results</option>
                <option value={250}>250 results</option>
                <option value={0}>All results</option>
              </select>
            )}

            {/* File size filter — only visible during active search */}
            {searchQuery && (
              <select
                value={minSizeBytes}
                onChange={(e) => setMinSizeBytes(Number(e.target.value))}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-brand-primary/30 cursor-pointer ${
                  minSizeBytes > 0
                    ? "text-brand-primary bg-brand-primary/10"
                    : "bg-muted text-muted-foreground"
                }`}
                aria-label="Minimum file size"
              >
                <option value={0}>Any size</option>
                <option value={10 * 1024 * 1024}>&gt; 10 MB</option>
                <option value={100 * 1024 * 1024}>&gt; 100 MB</option>
                <option value={500 * 1024 * 1024}>&gt; 500 MB</option>
                <option value={1024 * 1024 * 1024}>&gt; 1 GB</option>
                <option value={2 * 1024 * 1024 * 1024}>&gt; 2 GB</option>
                <option value={5 * 1024 * 1024 * 1024}>&gt; 5 GB</option>
              </select>
            )}

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
                            onClick={(e) => { e.stopPropagation(); setRenamingFolder({ path: node.path, name: node.name }); setRenameFolderValue(node.name); }}
                            className="w-8 h-8 bg-background/80 backdrop-blur-xs rounded-xl flex items-center justify-center hover:bg-accent transition-all duration-200"
                            title="Rename folder"
                          >
                            <Pencil className="w-3.5 h-3.5 text-foreground" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openDuplicateFolderDialog({ path: node.path, name: node.name }); }}
                            className="w-8 h-8 bg-background/80 backdrop-blur-xs rounded-xl flex items-center justify-center hover:bg-accent transition-all duration-200"
                            title="Duplicate folder"
                          >
                            <Copy className="w-3.5 h-3.5 text-foreground" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void handleDeleteFolder(node.path, node.name); }}
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
                            <span className="label-meta">{getFileCategoryLabel(asset)}</span>
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
                        {searchQuery && rootPath && (
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
            setCompressDialogAssets([selectedAsset]);
            setIsCompressDialogOpen(true);
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
        onRename={async (newName) => {
          if (!selectedAsset) return;
          const token = getAuthToken();
          if (!token) return;
          const client = createGraphQLClient(token);
          const data: any = await client.request(RENAME_MEDIA_ASSET_MUTATION, { id: selectedAsset.id, newName });
          setSelectedAsset(data.renameMediaAsset);
          if (rootPath) await loadDirectoryIntoCache(rootPath);
          if (currentPath && currentPath !== rootPath) await loadDirectoryIntoCache(currentPath);
        }}
        onMove={() => {
          setMoveTargetFolderPath('');
          setShowMoveDialog(true);
        }}
        onDuplicate={() => {
          if (!selectedAsset) return;
          const currentFolderPath = selectedAsset.filePath.substring(0, selectedAsset.filePath.lastIndexOf('/'));
          setDuplicateSourceFolder(null);
          setDuplicateTargetFolderPath(currentFolderPath || currentPath || rootPath || '');
          setShowDuplicateDialog(true);
        }}
        onAssetUpdated={(updates) => {
          setSelectedAsset((prev) => prev ? { ...prev, ...updates } : prev);
          if (rootPath) void loadDirectoryIntoCache(rootPath);
          if (currentPath && currentPath !== rootPath) void loadDirectoryIntoCache(currentPath);
        }}
      />

      <CompressDialog
        isOpen={isCompressDialogOpen}
        onClose={() => setIsCompressDialogOpen(false)}
        selectedAssets={compressDialogAssets}
        onAddToQueue={(options) => {
          addToCompressQueue(compressDialogAssets, options);
          setIsCompressDialogOpen(false);
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
          if (searchQuery) await handleSearch(searchQuery.term, searchQuery.mediaType);
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
        isOpen={showQueuePanel}
        onClose={() => setShowQueuePanel(false)}
        jobs={compressQueue}
        onConfirm={confirmCompressJob}
        onDismiss={dismissCompressJob}
        onCancel={cancelCompressJob}
        onClearCompleted={clearCompletedJobs}
        onConfirmFile={confirmSingleCompressFile}
        onDiscardFile={discardSingleCompressFile}
        apiUrl={API_URL}
      />

      {/* Duplicate Asset */}
      <DuplicateDialog
        isOpen={showDuplicateDialog}
        setShowDuplicateDialog={setShowDuplicateDialog}
        duplicateTargetFolderPath={duplicateTargetFolderPath}
        setDuplicateTargetFolderPath={setDuplicateTargetFolderPath}
        duplicateSourceFolder={duplicateSourceFolder}
        setDuplicateSourceFolder={setDuplicateSourceFolder}
        allAvailableFolders={allAvailableFolders}
        rootPath={rootPath}
        selectedAsset={selectedAsset}
        isDuplicating={isDuplicating}
        handleDuplicateAsset={handleDuplicateAsset}
      />

      {/* Move Asset */}
      <MoveDialog
        isOpen={showMoveDialog}
        setShowMoveDialog={setShowMoveDialog}
        moveTargetFolderPath={moveTargetFolderPath}
        setMoveTargetFolderPath={setMoveTargetFolderPath}
        allAvailableFolders={allAvailableFolders}
        rootPath={rootPath}
        selectionMode={selectionMode}
        selectedAsset={selectedAsset}
        selectedAssetCount={selectedAssetIds.size}
        selectedFolderPaths={selectedFolderPaths}
        isMoving={isMoving}
        handleMoveAsset={handleMoveAsset}
        handleBulkMove={handleBulkMove}
      />

      {/* Rename Folder */}
      <RenameFolderDialog
        renamingFolder={renamingFolder}
        setRenamingFolder={setRenamingFolder}
        renameFolderValue={renameFolderValue}
        setRenameFolderValue={setRenameFolderValue}
        isRenamingFolder={isRenamingFolder}
        onSubmit={(e) => void handleRenameFolder(e)}
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
        isOpen={showNewFileDialog}
        setShowNewFileDialog={setShowNewFileDialog}
        newFileName={newFileName}
        setNewFileName={setNewFileName}
        newFileType={newFileType}
        setNewFileType={setNewFileType}
        isCreatingFile={isCreatingFile}
        currentFolder={currentFolder}
        onSubmit={handleCreateFile}
      />

      {/* New Folder Dialog */}
      <NewFolderDialog
        isOpen={showNewFolderDialog}
        setShowNewFolderDialog={setShowNewFolderDialog}
        newFolderName={newFolderName}
        setNewFolderName={setNewFolderName}
        isCreatingFolder={isCreatingFolder}
        currentFolder={currentFolder}
        onSubmit={handleCreateFolder}
      />

      {/* Upload Dialog */}
      <UploadDialog
        isOpen={showUploadDialog}
        setShowUploadDialog={setShowUploadDialog}
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
