import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "@remix-run/react";
import { createGraphQLClient, getApiUrl, getAuthToken, clearAuthToken } from "~/lib/api";
import { Input } from "~/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { MediaAssetViewer } from "~/components/MediaAssetViewer";
import { CompressDialog } from "~/components/CompressDialog";
import { CompressQueuePanel, type CompressJob } from "~/components/CompressQueuePanel";
import {
  Folder, FileImage, ArrowLeft, ChevronDown, ChevronRight,
  Trash2, CheckSquare, Square, Users, Key, RotateCcw,
  Menu, X, ImagePlus, ArrowUpDown, Minimize2,
  Upload, LogOut, Download, FolderPlus, ListTodo,
  Moon, Sun, User,
} from "lucide-react";

const API_URL = getApiUrl();

const DELETE_MEDIA_ASSET_MUTATION = `
  mutation DeleteMediaAsset($id: ID!) {
    deleteMediaAsset(id: $id)
  }
`;

const CHANGE_MY_PASSWORD_MUTATION = `
  mutation ChangeMyPassword($currentPassword: String!, $newPassword: String!) {
    changeMyPassword(currentPassword: $currentPassword, newPassword: $newPassword)
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
  }

  fragment DirNode on DirectoryNode {
    name
    path
    type
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

interface MediaAsset {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

interface DirectoryNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: DirectoryNode[] | null;
  mediaAsset?: MediaAsset;
}

function formatBytes(bytes: string | number) {
  const n = typeof bytes === "string" ? parseInt(bytes) : bytes;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
      <Icon className="w-4 h-4 flex-shrink-0" />
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
  const [directoryCache, setDirectoryCache] = useState<Record<string, DirectoryNode>>({});
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [folderHistory, setFolderHistory] = useState<string[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [view, setView] = useState<"grid" | "tree">("grid");
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [showChangePasswordDialog, setShowChangePasswordDialog] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
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
  const [isCompressDialogOpen, setIsCompressDialogOpen] = useState(false);
  const [compressDialogAssets, setCompressDialogAssets] = useState<MediaAsset[]>([]);
  const [compressQueue, setCompressQueue] = useState<CompressJob[]>([]);
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const compressQueueRef = useRef<CompressJob[]>([]);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadTargetPath, setUploadTargetPath] = useState('');
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refreshInFlightRef = useRef(false);
  const thumbnailPollTimerRef = useRef<number | null>(null);
  const thumbnailPollAttemptsRef = useRef(0);
  const thumbnailPollInFlightRef = useRef(false);
  const thumbnailQueueCooldownRef = useRef<Record<string, number>>({});
  const navigate = useNavigate();

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
      setCurrentPath(rootNode.path);
      setFolderHistory([]);
      if (rootNode.path) setExpandedFolders(new Set([rootNode.path]));
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    clearAuthToken();
    navigate("/login");
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters long");
      return;
    }
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(CHANGE_MY_PASSWORD_MUTATION, { currentPassword, newPassword });
      setShowChangePasswordDialog(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordError("");
      alert("Password changed successfully");
    } catch (err: any) {
      setPasswordError(err.message || "Failed to change password");
    }
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

  useEffect(() => {
    if (!currentPath) return;
    const now = Date.now();
    const lastQueuedAt = thumbnailQueueCooldownRef.current[currentPath] ?? 0;
    if (now - lastQueuedAt < 60_000) return;
    thumbnailQueueCooldownRef.current[currentPath] = now;
    void generateThumbnailsForPath(currentPath, { silent: true }).catch((err) => {
      console.error("Failed to auto-queue thumbnails:", err);
    });
  }, [currentPath]);

  const handleAssetClick = (asset: MediaAsset) => {
    if (selectionMode) {
      toggleAssetSelection(asset.id);
    } else {
      setSelectedAsset(asset);
      setIsViewerOpen(true);
    }
  };

  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssetIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(assetId)) {
        newSet.delete(assetId);
      } else {
        newSet.add(assetId);
      }
      return newSet;
    });
  };

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    if (selectionMode) setSelectedAssetIds(new Set());
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

  const handleDeleteSelected = async () => {
    if (selectedAssetIds.size === 0) return;
    const confirmDelete = window.confirm(
      `Are you sure you want to delete ${selectedAssetIds.size} item(s)? This action cannot be undone.`
    );
    if (!confirmDelete) return;
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await Promise.all(
        Array.from(selectedAssetIds).map((id) => client.request(DELETE_MEDIA_ASSET_MUTATION, { id }))
      );
      setSelectedAssetIds(new Set());
      setSelectionMode(false);
      if (rootPath) await loadDirectoryIntoCache(rootPath);
      if (currentPath && currentPath !== rootPath) await loadDirectoryIntoCache(currentPath);
    } catch (err) {
      console.error("Failed to delete assets:", err);
      alert("Failed to delete some assets. Please try again.");
    }
  };

  const handleDeleteSingle = async (assetId: string, fileName: string) => {
    const confirmDelete = window.confirm(
      `Are you sure you want to delete "${fileName}"? This action cannot be undone.`
    );
    if (!confirmDelete) return;
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
            status: (
              job.status === "compressing" ? "pending"       // BullMQ retries the job
              : job.status === "confirming" ? "preview_ready" // let user retry confirm
              : job.status
            ) as CompressJob["status"],
          }))
        );
      })
      .catch(() => {});
  }, [user?.username]);

  // Poll for queue updates every 5 s when jobs are active
  const hasActiveJobs = compressQueue.some(j => j.status === "pending" || j.status === "compressing");
  useEffect(() => {
    if (!hasActiveJobs || !user) return;
    const token = getAuthToken();
    if (!token) return;
    const intervalId = setInterval(() => {
      fetch(`${API_URL}/api/queue-state`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(({ queue }) => { if (Array.isArray(queue)) setCompressQueue(queue as CompressJob[]); })
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
    setCompressQueue(prev => prev.map(j => j.id === jobId ? { ...j, status: "confirming" as const } : j));
    try {
      const token = getAuthToken();
      if (!token) throw new Error("Not authenticated");
      const client = createGraphQLClient(token);
      await client.request(CONFIRM_COMPRESS_MUTATION, { ids: job.assets.map(a => a.id) });
      const updated = compressQueueRef.current.map(j => j.id === jobId ? { ...j, status: "done" as const } : j);
      setCompressQueue(updated);
      saveQueueToServer(updated);
      if (currentPath) await loadDirectoryIntoCache(currentPath);
      if (rootPath && rootPath !== currentPath) await loadDirectoryIntoCache(rootPath);
    } catch (err: any) {
      setCompressQueue(prev => prev.map(j => j.id === jobId
        ? { ...j, status: "error" as const, errorMessage: err.message || "Failed to apply compression" }
        : j));
    }
  }, [currentPath, rootPath, saveQueueToServer]);

  const dismissCompressJob = useCallback((jobId: string) => {
    const job = compressQueueRef.current.find(j => j.id === jobId);
    if (!job) return;
    // Clean up preview files via GraphQL cancel if previews exist
    if (job.previews.length > 0) {
      const token = getAuthToken();
      if (token) {
        createGraphQLClient(token)
          .request(CANCEL_COMPRESS_MUTATION, { ids: job.assets.map(a => a.id) })
          .catch(() => {});
      }
    }
    setCompressQueue(prev => {
      const updated = prev.filter(j => j.id !== jobId);
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

  const handleDeleteFolder = async (folderPath: string, folderName: string) => {
    const confirmed = window.confirm(
      `Delete folder "${folderName}" and all its contents? This cannot be undone.`
    );
    if (!confirmed) return;
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
  };

  const handleUpload = async () => {
    if (uploadFiles.length === 0 || isUploading) return;
    setIsUploading(true);
    const token = getAuthToken();
    if (!token) { setIsUploading(false); return; }
    const target = uploadTargetPath || currentPath || rootPath || '';
    const newProgress: Record<string, number> = {};
    try {
      for (const file of uploadFiles) {
        newProgress[file.name] = 0;
        setUploadProgress({ ...newProgress });
        const formData = new FormData();
        formData.append('file', file);
        const url = `${API_URL}/api/upload?targetPath=${encodeURIComponent(target)}`;
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', url);
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              newProgress[file.name] = Math.round((e.loaded / e.total) * 100);
              setUploadProgress({ ...newProgress });
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              newProgress[file.name] = 100;
              setUploadProgress({ ...newProgress });
              resolve();
            } else {
              try {
                const err = JSON.parse(xhr.responseText);
                reject(new Error(err.error || xhr.statusText));
              } catch {
                reject(new Error(xhr.statusText));
              }
            }
          };
          xhr.onerror = () => reject(new Error('Network error'));
          xhr.send(formData);
        });
      }
      setShowUploadDialog(false);
      setUploadFiles([]);
      setUploadProgress({});
      if (target) await loadDirectoryIntoCache(target);
      if (rootPath && rootPath !== target) await loadDirectoryIntoCache(rootPath);
    } catch (err: any) {
      alert(`Upload failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFolderClick = async (folder: DirectoryNode) => {
    if (currentPath) setFolderHistory((prev) => [...prev, currentPath]);
    setCurrentPath(folder.path);
    const cachedNode = directoryCache[folder.path];
    if (!cachedNode || cachedNode.children === null || cachedNode.children === undefined) {
      await loadDirectoryIntoCache(folder.path);
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

  const handleCloseViewer = () => {
    setIsViewerOpen(false);
    setSelectedAsset(null);
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

  const currentFolder = currentPath ? directoryCache[currentPath] || null : null;
  const directoryTree = rootPath ? directoryCache[rootPath] || null : null;
  const currentFolderChildren = Array.isArray(currentFolder?.children) ? currentFolder.children : [];

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
  const isCurrentFolderLoading = !!currentFolder && currentFolder.children === null;

  const sortedFolderChildren = useMemo(() => {
    if (sortOption === "default") return currentFolderChildren;
    const folders = currentFolderChildren.filter((n) => n.type === "directory");
    const files = currentFolderChildren.filter((n) => n.type !== "directory");
    const sorted = [...files].sort((a, b) => {
      if (sortOption === "size-asc" || sortOption === "size-desc") {
        const sizeA = a.mediaAsset ? parseInt(a.mediaAsset.fileSize) || 0 : 0;
        const sizeB = b.mediaAsset ? parseInt(b.mediaAsset.fileSize) || 0 : 0;
        return sortOption === "size-asc" ? sizeA - sizeB : sizeB - sizeA;
      }
      const dateA = a.mediaAsset ? new Date(a.mediaAsset.createdAt).getTime() : 0;
      const dateB = b.mediaAsset ? new Date(b.mediaAsset.createdAt).getTime() : 0;
      return sortOption === "date-asc" ? dateA - dateB : dateB - dateA;
    });
    return [...folders, ...sorted];
  }, [currentFolderChildren, sortOption]);

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
            className={`w-full pl-6 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-accent rounded-xl transition-all duration-150 outline-none focus:ring-2 focus:ring-brand-primary/30 text-left ${
              isSelected ? "bg-accent" : ""
            }`}
            onClick={() => node.mediaAsset && handleAssetClick(node.mediaAsset)}
          >
            {selectionMode && (
              <div className="flex-shrink-0">
                {isSelected ? (
                  <CheckSquare className="w-4 h-4 text-brand-primary" />
                ) : (
                  <Square className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            )}
            <FileImage className="w-4 h-4 text-muted-foreground flex-shrink-0" />
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
            className="flex-1 py-2.5 flex items-center gap-3 font-medium text-foreground hover:bg-accent rounded-xl transition-all duration-150 outline-none focus:ring-2 focus:ring-brand-primary/30 text-left px-2"
            onClick={() => void toggleFolder(node.path)}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            )}
            <div className="w-8 h-8 gradient-brand rounded-lg flex items-center justify-center flex-shrink-0">
              <Folder className="w-4 h-4 text-[#060e20]" />
            </div>
            <span className="text-sm">{node.name}</span>
            {Array.isArray(children) && (
              <span className="text-xs text-muted-foreground ml-auto mr-2 bg-muted px-2 py-0.5 rounded-full">
                {children.length}
              </span>
            )}
          </button>
          {(user?.role === "admin" || user?.role === "editor") && (
            <button
              type="button"
              onClick={() => void handleDeleteFolder(node.path, node.name)}
              className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-destructive/10 rounded-lg transition-all duration-150 mr-1 flex-shrink-0"
              title="Delete folder"
            >
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </button>
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

  const isAtRoot = currentPath === rootPath;
  const heroTitle = !isAtRoot && currentFolder ? currentFolder.name : "Your Collection";
  const heroSubtitle = !isAtRoot
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
      <aside className="hidden md:flex flex-col fixed left-0 top-0 h-screen w-64 bg-card z-30 flex-shrink-0">
        {/* Brand */}
        <div className="px-5 py-6">
          <button
            type="button"
            onClick={() => { setCurrentPath(rootPath); setFolderHistory([]); }}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="w-9 h-9 rounded-xl gradient-brand flex items-center justify-center shadow-ambient flex-shrink-0">
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
        </nav>

        {/* Bottom */}
        <div className="px-3 pb-6 space-y-3">
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
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
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
        <div className="md:hidden flex items-center justify-between px-4 py-4 bg-card/80 backdrop-blur-sm sticky top-0 z-20">
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
              <div className="pt-4 space-y-2">
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

        {/* Toolbar */}
        <div className="md:sticky md:top-0 z-10 bg-background/80 backdrop-blur-sm px-4 md:px-10 py-3 flex items-center justify-between gap-2 md:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {folderHistory.length > 0 && (
              <button
                type="button"
                onClick={() => void handleBackClick()}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}
            {!isAtRoot && currentFolder && (
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
                {selectionMode && selectedAssetIds.size > 0 && (
                  <>
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
                    <button
                      type="button"
                      onClick={() => {
                        setCompressDialogAssets(
                          sortedFolderChildren
                            .filter(n => n.type === "file" && n.mediaAsset && selectedAssetIds.has(n.mediaAsset.id))
                            .map(n => n.mediaAsset!)
                        );
                        setIsCompressDialogOpen(true);
                      }}
                      className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-brand-primary hover:bg-accent transition-all"
                    >
                      <Minimize2 className="w-4 h-4" />
                      <span className="hidden sm:inline">Compress</span>
                      <span className="text-xs">({selectedAssetIds.size})</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteSelected}
                      className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-destructive hover:bg-destructive/10 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="hidden sm:inline">Delete</span>
                      <span className="text-xs">({selectedAssetIds.size})</span>
                    </button>
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

            {/* View toggle */}
            <div className="flex gap-1 bg-muted p-1 rounded-xl">
              {(["grid", "tree"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all capitalize ${
                    view === v
                      ? "bg-card text-foreground shadow-sm"
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
            <div className="text-right flex-shrink-0">
              <p className="label-meta">Total Items</p>
              <p className="font-manrope text-2xl font-bold text-foreground">
                {currentFolderChildren.length}
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
                        className="w-full rounded-2xl bg-card hover:bg-accent transition-all duration-300 p-6 flex flex-col items-center justify-center gap-4 min-h-[180px] text-center"
                      >
                        <div className="w-16 h-16 rounded-2xl gradient-brand flex items-center justify-center shadow-ambient group-hover:scale-110 transition-transform duration-300">
                          <Folder className="w-8 h-8 text-[#060e20]" />
                        </div>
                        <div>
                          <p className="font-manrope font-semibold text-sm text-foreground truncate max-w-[120px]">
                            {node.name}
                          </p>
                          <p className="label-meta mt-1">Folder</p>
                        </div>
                      </button>
                      {!selectionMode && (user?.role === "admin" || user?.role === "editor") && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void handleDeleteFolder(node.path, node.name); }}
                          className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 w-8 h-8 bg-background/80 backdrop-blur-sm rounded-xl flex items-center justify-center hover:bg-destructive/20 transition-all duration-200"
                          title="Delete folder"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </button>
                      )}
                    </div>
                  );
                } else if (node.mediaAsset) {
                  const asset = node.mediaAsset;
                  const isSelected = selectedAssetIds.has(asset.id);
                  const isImage = asset.mimeType.startsWith("image");
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
                            <CheckSquare className="w-5 h-5 text-brand-primary drop-shadow" />
                          ) : (
                            <Square className="w-5 h-5 text-white drop-shadow" />
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
                          className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 w-8 h-8 bg-background/80 backdrop-blur-sm rounded-xl flex items-center justify-center hover:bg-destructive/20 transition-all duration-200"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </button>
                      )}

                      {/* Thumbnail — 4:5 portrait */}
                      {/* overflow-hidden is on the inner div so the download button isn't clipped */}
                      <div className="aspect-[4/5] bg-muted relative">
                        <div className="absolute inset-0 overflow-hidden">
                          {asset.thumbnailUrl ? (
                            <img
                              src={`${API_URL}${asset.thumbnailUrl}`}
                              alt={asset.fileName}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <FileImage className="w-12 h-12 text-muted-foreground/30" />
                            </div>
                          )}

                          {/* Gradient overlay */}
                          <div className="absolute inset-0 bg-gradient-to-t from-background/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        </div>

                        {/* Type badge */}
                        <div className="absolute top-3 left-3 z-10 bg-background/70 backdrop-blur-sm px-2 py-0.5 rounded-lg">
                          <span className="label-meta">{isImage ? "Image" : "Video"}</span>
                        </div>

                        {/* Download button */}
                        {!selectionMode && (
                          <a
                            href={`${API_URL}/download/${asset.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="absolute bottom-3 right-3 z-10 opacity-0 group-hover:opacity-100 w-8 h-8 bg-background/80 backdrop-blur-sm rounded-xl flex items-center justify-center hover:bg-accent transition-all duration-200"
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
                          {formatBytes(asset.fileSize)} · {formatDate(asset.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                }
                return null;
              })}

              {/* Empty states */}
              {isCurrentFolderLoading && (
                <div className="col-span-full flex flex-col items-center justify-center py-24 text-muted-foreground">
                  <div className="w-10 h-10 rounded-2xl gradient-brand flex items-center justify-center mx-auto mb-4 animate-pulse">
                    <Folder className="w-5 h-5 text-[#060e20]" />
                  </div>
                  <p className="text-sm">Loading folder…</p>
                </div>
              )}
              {!isCurrentFolderLoading && sortedFolderChildren.length === 0 && (
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
        onCompress={() => {
          if (selectedAsset) {
            setCompressDialogAssets([selectedAsset]);
            setIsCompressDialogOpen(true);
          }
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

      <CompressQueuePanel
        isOpen={showQueuePanel}
        onClose={() => setShowQueuePanel(false)}
        jobs={compressQueue}
        onConfirm={confirmCompressJob}
        onDismiss={dismissCompressJob}
        onCancel={cancelCompressJob}
        onClearCompleted={clearCompletedJobs}
        apiUrl={API_URL}
      />

      {/* Change Password */}
      <Dialog open={showChangePasswordDialog} onOpenChange={setShowChangePasswordDialog}>
        <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-manrope text-foreground">Change Password</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleChangePassword} className="space-y-4 mt-2">
            {(
              [
                { id: "cur-pwd", label: "Current Password", value: currentPassword, onChange: setCurrentPassword },
                { id: "new-pwd", label: "New Password", value: newPassword, onChange: setNewPassword },
                { id: "con-pwd", label: "Confirm New Password", value: confirmPassword, onChange: setConfirmPassword },
              ] as const
            ).map((field) => (
              <div key={field.id} className="space-y-1.5">
                <label htmlFor={field.id} className="label-meta">{field.label}</label>
                <Input
                  id={field.id}
                  type="password"
                  value={field.value}
                  onChange={(e) => (field.onChange as any)(e.target.value)}
                  required
                  minLength={6}
                  className="bg-muted border-border/20 text-foreground placeholder:text-muted-foreground"
                />
              </div>
            ))}
            {passwordError && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2">{passwordError}</p>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => { setShowChangePasswordDialog(false); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setPasswordError(""); }}
                className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity"
              >
                Update Password
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* New Folder Dialog */}
      <Dialog open={showNewFolderDialog} onOpenChange={(open) => { setShowNewFolderDialog(open); if (!open) setNewFolderName(''); }}>
        <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-manrope text-foreground">New Folder</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateFolder} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="label-meta">Folder Name</label>
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="e.g. Vacation 2024"
                required
                autoFocus
                className="bg-muted border-border/20 text-foreground placeholder:text-muted-foreground"
              />
              {currentFolder && (
                <p className="text-xs text-muted-foreground">
                  Will be created inside: <span className="text-foreground font-medium">{currentFolder.name}</span>
                </p>
              )}
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => { setShowNewFolderDialog(false); setNewFolderName(''); }}
                className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreatingFolder || !newFolderName.trim()}
                className="px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isCreatingFolder ? 'Creating…' : 'Create Folder'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={(open) => { if (!isUploading) { setShowUploadDialog(open); if (!open) { setUploadFiles([]); setUploadProgress({}); } } }}>
        <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-manrope text-foreground">Upload Media</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Folder selector */}
            <div className="space-y-1.5">
              <label className="label-meta">Upload to Folder</label>
              <select
                value={uploadTargetPath}
                onChange={(e) => setUploadTargetPath(e.target.value)}
                className="w-full bg-muted border border-border/20 rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
              >
                {allDirectories.map((dir) => (
                  <option key={dir.path} value={dir.path}>{dir.displayName}</option>
                ))}
              </select>
            </div>

            {/* Drop zone */}
            <div>
              <label className="label-meta mb-1.5 block">Files</label>
              <div
                role="button"
                tabIndex={0}
                className="border-2 border-dashed border-border/30 rounded-xl p-8 text-center cursor-pointer hover:border-brand-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); setUploadFiles(Array.from(e.dataTransfer.files)); }}
              >
                <Upload className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  {uploadFiles.length > 0
                    ? `${uploadFiles.length} file(s) selected`
                    : 'Drag & drop or click to select files'}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">Images & videos · Max 1 GB per file</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.heic,.gif,.webp,.bmp,.mp4,.mov,.avi,.mkv,.webm,.m4v"
                  className="hidden"
                  onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
                />
              </div>
            </div>

            {/* File list with progress */}
            {uploadFiles.length > 0 && (
              <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                {uploadFiles.map((file) => (
                  <div key={file.name} className="flex items-center gap-3 bg-muted rounded-xl px-3 py-2">
                    <FileImage className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground truncate">{file.name}</p>
                      {isUploading && (
                        <div className="mt-1.5 h-1 bg-muted-foreground/20 rounded-full overflow-hidden">
                          <div
                            className="h-full gradient-brand rounded-full transition-all duration-300"
                            style={{ width: `${uploadProgress[file.name] ?? 0}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{formatBytes(file.size)}</span>
                    {!isUploading && (
                      <button
                        type="button"
                        onClick={() => setUploadFiles((prev) => prev.filter((f) => f.name !== file.name))}
                        className="p-1 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => { setShowUploadDialog(false); setUploadFiles([]); setUploadProgress({}); }}
                disabled={isUploading}
                className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploadFiles.length === 0 || isUploading}
                className="px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isUploading ? 'Uploading…' : `Upload${uploadFiles.length > 0 ? ` (${uploadFiles.length})` : ''}`}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Logout Confirmation */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card rounded-2xl p-8 max-w-sm w-full mx-4 shadow-ambient border border-border/10 text-center">
            <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
              <LogOut className="w-5 h-5 text-muted-foreground" />
            </div>
            <h2 className="font-manrope text-xl font-bold text-foreground mb-2">Securely signing out?</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Before you leave, ensure all your gallery edits are saved. You will need to sign in again to access your media library.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2.5 rounded-xl border border-border/30 text-sm text-foreground hover:bg-accent transition-all font-medium"
              >
                Return to Dashboard
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="flex-1 py-2.5 rounded-xl gradient-brand text-[#060e20] text-sm font-manrope font-bold shadow-ambient hover:opacity-90 transition-opacity"
              >
                Confirm Logout
              </button>
            </div>
            <p className="label-meta mt-4">The Curated Gallery · Session Security</p>
          </div>
        </div>
      )}
    </div>
  );
}
