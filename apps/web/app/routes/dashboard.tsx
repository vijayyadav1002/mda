import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { createGraphQLClient, getApiUrl, getAuthToken, clearAuthToken } from "~/lib/api";
import { Input } from "~/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { MediaAssetViewer } from "~/components/MediaAssetViewer";
import { CompressDialog } from "~/components/CompressDialog";
import { CompressQueuePanel, type CompressJob } from "~/components/CompressQueuePanel";
import { TagDialog, type TagSuggestion } from "~/components/TagDialog";
import { RemoveTagsDialog } from "~/components/RemoveTagsDialog";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { SearchBar } from "~/components/SearchBar";
import { formatDate, formatBytes } from "~/lib/format";
import { getFileCategory, canCompressAsset, type FileCategory } from "~/lib/file-type";
import type { MediaAsset, DirectoryNode, CacheStats, CacheSettingsData } from "~/lib/types";
import { useDirectoryTree } from "~/hooks/useDirectoryTree";
import { useMediaSelection } from "~/hooks/useMediaSelection";
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

const GENERATE_THUMBNAILS_FOR_ASSETS_MUTATION = `
  mutation GenerateThumbnailsForAssets($ids: [ID!]!, $sessionId: String, $force: Boolean) {
    generateThumbnailsForAssets(ids: $ids, sessionId: $sessionId, force: $force)
  }
`;

const CANCEL_THUMBNAIL_JOBS_MUTATION = `
  mutation CancelThumbnailJobsForSession($sessionId: String!) {
    cancelThumbnailJobsForSession(sessionId: $sessionId)
  }
`;

// Pre-fetch thumbnails slightly before the card scrolls into view for a
// smoother experience on fast scrolls.
const LAZY_THUMBNAIL_ROOT_MARGIN = "300px";
// Debounce batching window: group viewport hits inside this window into a
// single GraphQL mutation so a single scroll doesn't fire N requests.
const LAZY_THUMBNAIL_FLUSH_MS = 250;

const generateThumbnailSessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${Date.now()}-${hex}`;
};

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

const CACHE_LIMIT_FIELDS: Array<{ key: keyof CacheSettingsData; label: string; unit: string }> = [
  { key: "thumbnailCacheMaxMb", label: "Thumbnails", unit: "MB" },
  { key: "previewCacheMaxMb", label: "Previews", unit: "MB" },
  { key: "hlsCacheMaxMb", label: "HLS", unit: "MB" },
  { key: "transcodedCacheMaxMb", label: "Transcoded", unit: "MB" },
  { key: "previewCacheMaxAgeDays", label: "Preview age", unit: "days" },
  { key: "hlsCacheMaxAgeHours", label: "HLS age", unit: "hrs" },
];

function CachePanelBody({
  cacheStats,
  cacheSettings,
  onClear,
  onSaveSettings,
}: Readonly<{
  cacheStats: CacheStats;
  cacheSettings: CacheSettingsData | null;
  onClear: (type: "thumbnails" | "previews" | "hls" | "transcoded" | "all") => void;
  onSaveSettings: (input: Partial<CacheSettingsData>) => Promise<void>;
}>) {
  const [showLimits, setShowLimits] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openEditor = () => {
    if (!showLimits && cacheSettings) {
      setDraft(Object.fromEntries(CACHE_LIMIT_FIELDS.map(({ key }) => [key, String(cacheSettings[key])])));
      setSaveError(null);
    }
    setShowLimits((p) => !p);
  };

  const handleSave = async () => {
    const input: Partial<CacheSettingsData> = {};
    for (const { key } of CACHE_LIMIT_FIELDS) {
      const value = Number.parseInt(draft[key] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) {
        setSaveError("All values must be positive numbers");
        return;
      }
      input[key] = value;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSaveSettings(input);
      setShowLimits(false);
    } catch (err: any) {
      setSaveError(err?.response?.errors?.[0]?.message ?? err?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-3 pb-3 pt-2 space-y-2 border-t border-border/20">
      {(["thumbnails", "previews", "hls", "transcoded"] as const).map((key) => {
        const s = cacheStats[key];
        const usage = s.maxBytes > 0 ? Math.min(100, (s.bytes / s.maxBytes) * 100) : 0;
        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground truncate">{s.label}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-foreground">
                  {formatBytes(s.bytes)}
                  <span className="text-muted-foreground"> / {formatBytes(s.maxBytes)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onClear(key)}
                  className="text-destructive hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="h-1 rounded-full bg-muted/60 overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${usage > 90 ? "bg-destructive" : "gradient-brand"}`}
                style={{ width: `${Math.max(usage, 2)}%` }}
              />
            </div>
          </div>
        );
      })}

      {cacheSettings && (
        <button
          type="button"
          onClick={openEditor}
          className="w-full text-xs text-muted-foreground border border-border/40 rounded-lg py-1.5 hover:text-foreground hover:bg-accent transition-colors"
        >
          {showLimits ? "Hide limits" : "Configure limits"}
        </button>
      )}

      {showLimits && cacheSettings && (
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            {CACHE_LIMIT_FIELDS.map(({ key, label, unit }) => (
              <label key={key} className="text-[10px] text-muted-foreground space-y-0.5 block">
                <span className="block truncate">{label} ({unit})</span>
                <input
                  type="number"
                  min={1}
                  value={draft[key] ?? ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="w-full px-2 py-1 rounded-lg bg-background border border-border/40 text-xs font-mono text-foreground focus:outline-hidden focus:border-brand-primary"
                />
              </label>
            ))}
          </div>
          {saveError && <p className="text-[10px] text-destructive">{saveError}</p>}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="w-full text-xs font-semibold gradient-brand text-[#060e20] rounded-lg py-1.5 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Limits"}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => onClear("all")}
        className="w-full text-xs text-destructive border border-destructive/40 rounded-lg py-1.5 hover:bg-destructive/10 transition-colors"
      >
        Clear All
      </button>
    </div>
  );
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
  const [showSelectionActionsMenu, setShowSelectionActionsMenu] = useState(false);
  const selectionActionsMenuRef = useRef<HTMLDivElement>(null);
  const [isCompressDialogOpen, setIsCompressDialogOpen] = useState(false);
  const [compressDialogAssets, setCompressDialogAssets] = useState<MediaAsset[]>([]);
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
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheSettings, setCacheSettings] = useState<CacheSettingsData | null>(null);
  const [showCachePanel, setShowCachePanel] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    warning?: string;
    confirmLabel?: string;
    onConfirm: () => Promise<void>;
  }>({ open: false, title: "", description: "", onConfirm: async () => {} });
  const [searchQuery, setSearchQuery] = useState<{ term: string; mediaType: string } | null>(null);
  const [searchAssets, setSearchAssets] = useState<MediaAsset[]>([]);
  const [searchFolders, setSearchFolders] = useState<{ name: string; path: string; parentPath?: string | null }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLimit, setSearchLimit] = useState<25 | 50 | 100 | 250 | 0>(25);
  const [minSizeBytes, setMinSizeBytes] = useState<number>(0); // 0 = no filter
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refreshInFlightRef = useRef(false);
  const thumbnailPollTimerRef = useRef<number | null>(null);
  const thumbnailPollAttemptsRef = useRef(0);
  const thumbnailPollInFlightRef = useRef(false);
  // Viewport-based dynamic thumbnail loading state. Thumbnails are only
  // queued for media whose card is (near) visible on screen.
  const thumbnailObserverRef = useRef<IntersectionObserver | null>(null);
  const observedThumbnailNodesRef = useRef<Map<Element, string>>(new Map());
  const pendingThumbnailIdsRef = useRef<Set<string>>(new Set());
  const requestedThumbnailIdsRef = useRef<Set<string>>(new Set());
  const flushThumbnailTimerRef = useRef<number | null>(null);
  // Per-folder-visit token. Sent with every queued-thumbnail mutation so the
  // backend can cancel everything from a session when the user navigates away.
  const thumbnailSessionIdRef = useRef<string>(generateThumbnailSessionId());
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
  }, [activeTagFilter, currentPath, loadTagFilterAssets, refreshTagSuggestions, rootPath]);

  const removeTagsFromAssets = useCallback(async (assetIds: string[], tagNames: string[]) => {
    const token = getAuthToken();
    if (!token) throw new Error("Not authenticated");
    const client = createGraphQLClient(token);
    await client.request(REMOVE_TAGS_FROM_ASSETS_MUTATION, { assetIds, tagNames });
    await refreshTagSuggestions();
    if (currentPath) await loadDirectoryIntoCache(currentPath);
    if (rootPath && rootPath !== currentPath) await loadDirectoryIntoCache(rootPath);
    if (activeTagFilter) await loadTagFilterAssets(activeTagFilter);
  }, [activeTagFilter, currentPath, loadTagFilterAssets, refreshTagSuggestions, rootPath]);

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
  }, [activeTagFilter, currentPath, loadTagFilterAssets, refreshTagSuggestions]);

  const openConfirm = useCallback((opts: {
    title: string;
    description: string;
    warning?: string;
    confirmLabel?: string;
    onConfirm: () => Promise<void>;
  }) => {
    setConfirmDialog({ ...opts, open: true });
  }, []);

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
  }, [activeTagFilter, currentPath, loadTagFilterAssets, refreshTagSuggestions]);

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
  }, [openConfirm, activeTagFilter, currentPath, refreshTagSuggestions]);

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

  // Thumbnails are always requested on demand as cards enter the viewport
  // (see IntersectionObserver + registerLazyThumbnailCard below). No folder
  // is bulk-queued up front — that used to generate thumbnails for files the
  // user never actually scrolled to.

  // Flush any pending viewport-collected asset IDs to the backend in a single
  // batched GraphQL mutation. Failures clear the "already requested" marker
  // so the next scroll can retry. The mutation carries the current folder's
  // session id so the backend can cancel the whole batch on navigation.
  const flushPendingThumbnailRequests = useCallback(async () => {
    flushThumbnailTimerRef.current = null;
    const ids = Array.from(pendingThumbnailIdsRef.current);
    pendingThumbnailIdsRef.current.clear();
    if (ids.length === 0) return;
    const token = getAuthToken();
    if (!token) return;
    const sessionId = thumbnailSessionIdRef.current;
    try {
      const client = createGraphQLClient(token);
      await client.request(GENERATE_THUMBNAILS_FOR_ASSETS_MUTATION, { ids, sessionId });
    } catch (err) {
      console.error("Failed to queue on-demand thumbnails:", err);
      for (const id of ids) requestedThumbnailIdsRef.current.delete(id);
    }
  }, []);

  // Fire-and-forget request to drop every thumbnail job queued under a session.
  // Used when the user moves to another folder or unmounts the dashboard.
  const cancelThumbnailSessionOnServer = useCallback((sessionId: string) => {
    if (!sessionId) return;
    const token = getAuthToken();
    if (!token) return;
    const client = createGraphQLClient(token);
    client
      .request(CANCEL_THUMBNAIL_JOBS_MUTATION, { sessionId })
      .catch((err) => {
        // Non-blocking — worst case the Pi finishes a few jobs we no longer need.
        console.warn("Failed to cancel thumbnail session on server:", err);
      });
  }, []);

  // Lazily create one shared IntersectionObserver the first time a card's ref
  // callback runs. This must exist before refs fire, so we can't defer it to
  // useEffect (refs run earlier in the commit phase than effects).
  const getThumbnailObserver = useCallback((): IntersectionObserver | null => {
    if (thumbnailObserverRef.current) return thumbnailObserverRef.current;
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return null;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const assetId = observedThumbnailNodesRef.current.get(entry.target);
        if (!assetId) continue;
        observer.unobserve(entry.target);
        observedThumbnailNodesRef.current.delete(entry.target);
        if (requestedThumbnailIdsRef.current.has(assetId)) continue;
        requestedThumbnailIdsRef.current.add(assetId);
        pendingThumbnailIdsRef.current.add(assetId);
      }
      if (pendingThumbnailIdsRef.current.size > 0 && flushThumbnailTimerRef.current == null) {
        flushThumbnailTimerRef.current = window.setTimeout(
          flushPendingThumbnailRequests,
          LAZY_THUMBNAIL_FLUSH_MS,
        );
      }
    }, { rootMargin: LAZY_THUMBNAIL_ROOT_MARGIN });
    thumbnailObserverRef.current = observer;
    return observer;
  }, [flushPendingThumbnailRequests]);

  // Tear down the observer when the Dashboard unmounts.
  useEffect(() => {
    return () => {
      const observer = thumbnailObserverRef.current;
      if (observer) {
        observer.disconnect();
        thumbnailObserverRef.current = null;
      }
      observedThumbnailNodesRef.current.clear();
      if (flushThumbnailTimerRef.current != null) {
        window.clearTimeout(flushThumbnailTimerRef.current);
        flushThumbnailTimerRef.current = null;
      }
      // Cancel any thumbnail jobs the user queued in their last folder so the
      // server stops working on them after the tab/dashboard goes away.
      cancelThumbnailSessionOnServer(thumbnailSessionIdRef.current);
    };
  }, [cancelThumbnailSessionOnServer]);

  // When the user navigates to a different folder, forget which thumbnails we
  // have already asked for so the new folder can request its own assets, and
  // tell the backend to drop any jobs queued during the previous visit.
  useEffect(() => {
    const previousSessionId = thumbnailSessionIdRef.current;
    thumbnailSessionIdRef.current = generateThumbnailSessionId();

    requestedThumbnailIdsRef.current.clear();
    pendingThumbnailIdsRef.current.clear();
    const observer = thumbnailObserverRef.current;
    if (observer) {
      for (const el of observedThumbnailNodesRef.current.keys()) {
        observer.unobserve(el);
      }
    }
    observedThumbnailNodesRef.current.clear();
    if (flushThumbnailTimerRef.current != null) {
      window.clearTimeout(flushThumbnailTimerRef.current);
      flushThumbnailTimerRef.current = null;
    }

    cancelThumbnailSessionOnServer(previousSessionId);
  }, [currentPath, cancelThumbnailSessionOnServer]);

  // Ref callback attached to the thumbnail <div> of each card that is
  // currently missing a thumbnail. Registering an element starts observing it;
  // when the element unmounts React invokes the callback with null, at which
  // point we unobserve the previous node for that asset id.
  const registerLazyThumbnailCard = useCallback(
    (assetId: string) => (element: HTMLDivElement | null) => {
      if (!element) return;
      const observer = getThumbnailObserver();
      if (!observer) return;
      if (requestedThumbnailIdsRef.current.has(assetId)) return;
      if (observedThumbnailNodesRef.current.has(element)) return;
      observedThumbnailNodesRef.current.set(element, assetId);
      observer.observe(element);
    },
    [getThumbnailObserver],
  );

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
    setActiveTagFilter(null);
    setTagFilterAssets([]);
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
  }, [currentPath, directoryCache]);

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

  const tagFilterNodes = useMemo<DirectoryNode[]>(() => {
    return tagFilterAssets.map((asset) => ({
      name: asset.fileName,
      path: asset.filePath,
      type: "file",
      children: null,
      mediaAsset: asset,
    }));
  }, [tagFilterAssets]);

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
    const handleClickOutside = (e: MouseEvent) => {
      if (tagFilterMenuRef.current && !tagFilterMenuRef.current.contains(e.target as Node)) {
        setShowTagFilterMenu(false);
      }
    };
    if (showTagFilterMenu) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showTagFilterMenu]);

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
    if (user?.role !== "admin") return;
    void fetchCacheStats();
    const id = window.setInterval(fetchCacheStats, 10_000);
    return () => window.clearInterval(id);
  }, [user?.role, fetchCacheStats]);

  useEffect(() => {
    if (user?.role !== "admin") return;
    const token = getAuthToken();
    if (!token) return;
    const client = createGraphQLClient(token);
    client
      .request<{ cacheSettings: CacheSettingsData }>(CACHE_SETTINGS_QUERY)
      .then((data) => setCacheSettings(data.cacheSettings))
      .catch(() => { /* non-critical */ });
  }, [user?.role]);

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
                onClick={() => { setShowCachePanel((p) => { if (!p) void fetchCacheStats(); return !p; }); }}
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
                      onClick={() => { setShowCachePanel((p) => { if (!p) void fetchCacheStats(); return !p; }); }}
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
      <Dialog open={showDuplicateDialog} onOpenChange={(open) => { if (!open) { setShowDuplicateDialog(false); setDuplicateTargetFolderPath(''); setDuplicateSourceFolder(null); } }}>
        <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-manrope font-bold text-foreground">
              {duplicateSourceFolder ? 'Duplicate Folder' : 'Duplicate File'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-1">
            Choose where to place a copy of{' '}
            <strong className="text-foreground font-medium">
              {duplicateSourceFolder?.name ?? selectedAsset?.fileName}
            </strong>
          </p>
          <div className="max-h-60 overflow-y-auto space-y-1 border border-border/20 rounded-xl p-2 mt-1">
            {allAvailableFolders.map((folder) => {
              const relPath = rootPath && folder.path !== rootPath
                ? folder.path.replace(rootPath, '') || '/'
                : '/';
              const isPickerSelected = duplicateTargetFolderPath === folder.path;
              const currentFolderPath = selectedAsset?.filePath.substring(0, selectedAsset.filePath.lastIndexOf('/'));
              const sourceFolderPath = duplicateSourceFolder?.path;
              const isCurrent = duplicateSourceFolder
                ? sourceFolderPath?.substring(0, sourceFolderPath.lastIndexOf('/')) === folder.path
                : currentFolderPath === folder.path;
              const isInvalidDest = !!sourceFolderPath && (
                folder.path === sourceFolderPath || folder.path.startsWith(`${sourceFolderPath}/`)
              );
              return (
                <button
                  key={folder.path}
                  type="button"
                  disabled={isInvalidDest}
                  onClick={() => setDuplicateTargetFolderPath(folder.path)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all text-left ${
                    isPickerSelected
                      ? 'bg-brand-primary/20 text-brand-primary'
                      : isInvalidDest
                        ? 'opacity-40 cursor-not-allowed text-foreground'
                        : 'hover:bg-accent text-foreground'
                  }`}
                >
                  <Folder className="w-4 h-4 shrink-0" />
                  <span className="font-mono text-xs truncate">{relPath}</span>
                  {isCurrent && <span className="ml-auto text-xs text-muted-foreground">current</span>}
                  {isInvalidDest && <span className="ml-auto text-xs text-muted-foreground">inside source</span>}
                </button>
              );
            })}
            {allAvailableFolders.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No folders available</p>
            )}
          </div>
          <div className="flex gap-3 mt-2">
            <button
              type="button"
              onClick={() => { setShowDuplicateDialog(false); setDuplicateTargetFolderPath(''); setDuplicateSourceFolder(null); }}
              className="flex-1 py-2.5 rounded-xl border border-border/30 text-sm text-foreground hover:bg-accent transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!duplicateTargetFolderPath || isDuplicating}
              onClick={() => void handleDuplicateAsset()}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm disabled:opacity-50 transition-all"
            >
              <Copy className="w-4 h-4" />
              {isDuplicating ? 'Duplicating…' : 'Duplicate Here'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Move Asset */}
      <Dialog open={showMoveDialog} onOpenChange={(open) => { if (!open) { setShowMoveDialog(false); setMoveTargetFolderPath(''); } }}>
        <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-manrope font-bold text-foreground">
              {selectionMode ? 'Move Items' : 'Move File'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-1">
            {selectionMode
              ? <>Move <strong className="text-foreground font-medium">{selectedAssetIds.size + selectedFolderPaths.size} selected items</strong> to a new location</>
              : <>Select destination for <strong className="text-foreground font-medium">{selectedAsset?.fileName}</strong></>
            }
          </p>
          <div className="max-h-60 overflow-y-auto space-y-1 border border-border/20 rounded-xl p-2 mt-1">
            {allAvailableFolders.map((folder) => {
              const relPath = rootPath && folder.path !== rootPath
                ? folder.path.replace(rootPath, '') || '/'
                : '/';
              const isPickerSelected = moveTargetFolderPath === folder.path;
              const isCurrent = !selectionMode && selectedAsset
                ? selectedAsset.filePath.substring(0, selectedAsset.filePath.lastIndexOf('/')) === folder.path
                : false;
              const isInvalidDest = selectionMode && (
                selectedFolderPaths.has(folder.path) ||
                [...selectedFolderPaths].some(fp => folder.path.startsWith(fp + '/'))
              );
              const isDisabled = isCurrent || isInvalidDest;
              return (
                <button
                  key={folder.path}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => setMoveTargetFolderPath(folder.path)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all text-left ${
                    isPickerSelected
                      ? 'bg-brand-primary/20 text-brand-primary'
                      : isDisabled
                        ? 'opacity-40 cursor-not-allowed text-foreground'
                        : 'hover:bg-accent text-foreground'
                  }`}
                >
                  <Folder className="w-4 h-4 shrink-0" />
                  <span className="font-mono text-xs truncate">{relPath}</span>
                  {isCurrent && <span className="ml-auto text-xs text-muted-foreground">current</span>}
                  {isInvalidDest && <span className="ml-auto text-xs text-muted-foreground">selected</span>}
                </button>
              );
            })}
            {allAvailableFolders.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No folders available</p>
            )}
          </div>
          <div className="flex gap-3 mt-2">
            <button
              type="button"
              onClick={() => { setShowMoveDialog(false); setMoveTargetFolderPath(''); }}
              className="flex-1 py-2.5 rounded-xl border border-border/30 text-sm text-foreground hover:bg-accent transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!moveTargetFolderPath || isMoving}
              onClick={() => void (selectionMode ? handleBulkMove() : handleMoveAsset())}
              className="flex-1 py-2.5 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm disabled:opacity-50 transition-all"
            >
              {isMoving ? 'Moving…' : 'Move Here'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename Folder */}
      <Dialog open={!!renamingFolder} onOpenChange={(open) => { if (!open) { setRenamingFolder(null); setRenameFolderValue(''); } }}>
        <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-manrope font-bold text-foreground">Rename Folder</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleRenameFolder(e)} className="space-y-4 mt-1">
            <div className="space-y-1.5">
              <label className="label-meta">New name</label>
              <Input
                autoFocus
                value={renameFolderValue}
                onChange={(e) => setRenameFolderValue(e.target.value)}
                placeholder={renamingFolder?.name ?? ''}
                className="bg-muted border-border/20 text-foreground"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setRenamingFolder(null); setRenameFolderValue(''); }}
                className="flex-1 py-2.5 rounded-xl border border-border/30 text-sm text-foreground hover:bg-accent transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!renameFolderValue.trim() || isRenamingFolder}
                className="flex-1 py-2.5 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm disabled:opacity-50 transition-all"
              >
                {isRenamingFolder ? 'Renaming…' : 'Rename'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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

      {/* New File Dialog */}
      <Dialog open={showNewFileDialog} onOpenChange={(open) => { setShowNewFileDialog(open); if (!open) setNewFileName(''); }}>
        <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-manrope text-foreground">New File</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateFile} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="label-meta">File Name</label>
              <div className="flex items-center gap-2">
                <Input
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="e.g. notes"
                  required
                  autoFocus
                  className="bg-muted border-border/20 text-foreground placeholder:text-muted-foreground"
                />
                {!/\.(txt|md|markdown)$/i.test(newFileName.trim()) && (
                  <div className="flex items-center gap-1 shrink-0">
                    {(["md", "txt"] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setNewFileType(type)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                          newFileType === type
                            ? "bg-brand-primary text-[#060e20] font-semibold"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        .{type}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {currentFolder && (
                <p className="text-xs text-muted-foreground">
                  Will be created inside: <span className="text-foreground font-medium">{currentFolder.name}</span>
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Opens in the editor right away. Markdown files render as a formatted preview after saving.
              </p>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => { setShowNewFileDialog(false); setNewFileName(''); }}
                className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreatingFile || !newFileName.trim()}
                className="px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isCreatingFile ? 'Creating…' : 'Create File'}
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
                className="w-full bg-muted border border-border/20 rounded-xl px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-brand-primary/30"
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
                <p className="text-xs text-muted-foreground/60 mt-1">Any file type · Max 1 GB per file</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
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
                    <FileImage className="w-4 h-4 text-muted-foreground shrink-0" />
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
                    <span className="text-xs text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
                    {!isUploading && (
                      <button
                        type="button"
                        onClick={() => setUploadFiles((prev) => prev.filter((f) => f.name !== file.name))}
                        className="p-1 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
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
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
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
