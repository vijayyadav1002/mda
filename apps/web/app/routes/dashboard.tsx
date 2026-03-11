import { useState, useEffect, useRef } from "react";
import { useNavigate } from "@remix-run/react";
import { createGraphQLClient, getApiUrl, getAuthToken, clearAuthToken } from "~/lib/api";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { MediaAssetViewer } from "~/components/MediaAssetViewer";
import { Folder, FileImage, ArrowLeft, ChevronDown, ChevronRight, Trash2, CheckSquare, Square, Moon, Sun, Users, Key, RotateCcw, Menu, X } from "lucide-react";

const API_URL = getApiUrl();

const MEDIA_ASSETS_QUERY = `
  query GetMediaAssets($limit: Int, $offset: Int) {
    mediaAssets(limit: $limit, offset: $offset) {
      id
      fileName
      filePath
      mimeType
      fileSize
      thumbnailUrl
      transcodedUrl
      createdAt
    }
  }
`;

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
  type: 'file' | 'directory';
  children?: DirectoryNode[] | null;
  mediaAsset?: MediaAsset;
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
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('darkMode') === 'true' || 
             (!localStorage.getItem('darkMode') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const refreshInFlightRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('darkMode', darkMode.toString());
      if (darkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
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
      const data: any = await client.request(`
        query {
          me {
            username
            role
          }
        }
      `);

      setUser(data.me);
    } catch (err) {
      console.error("Failed to load user:", err);
    }
  };

  const mergeDirectoryNode = (node: DirectoryNode) => {
    setDirectoryCache(prev => {
      const next = { ...prev };
      const incomingChildren = node.children ?? [];
      const mergedChildren = incomingChildren.map(child => {
        const cachedChild = prev[child.path];
        if (child.type === 'directory' && cachedChild) {
          return { ...child, children: cachedChild.children ?? child.children ?? null };
        }
        return child;
      });

      next[node.path] = { ...node, children: mergedChildren };

      for (const child of mergedChildren) {
        if (child.type === 'directory') {
          const cachedChild = prev[child.path];
          next[child.path] = cachedChild
            ? { ...cachedChild, name: child.name, path: child.path, type: 'directory' }
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
    const data: any = await client.request(DIRECTORY_NODE_QUERY, {
      path: directoryPath ?? null
    });

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
      if (rootNode.path) {
        setExpandedFolders(new Set([rootNode.path]));
      }
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
      await client.request(CHANGE_MY_PASSWORD_MUTATION, {
        currentPassword,
        newPassword
      });
      
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
      
      if (rootPath) {
        await loadDirectoryIntoCache(rootPath);
      }
      if (currentPath && currentPath !== rootPath) {
        await loadDirectoryIntoCache(currentPath);
      }

      alert(response?.refreshMediaLibrary || "Media library refreshed successfully!");
    } catch (err: any) {
      console.error("Failed to refresh media library:", err);
      alert(`Failed to refresh media library: ${err.message || 'Unknown error'}`);
    } finally {
      refreshInFlightRef.current = false;
      setIsRefreshing(false);
    }
  };

  const handleAssetClick = (asset: MediaAsset) => {
    if (selectionMode) {
      toggleAssetSelection(asset.id);
    } else {
      setSelectedAsset(asset);
      setIsViewerOpen(true);
    }
  };

  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssetIds(prev => {
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
    if (selectionMode) {
      // Clear selections when exiting selection mode
      setSelectedAssetIds(new Set());
    }
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
      
      // Delete all selected assets
      await Promise.all(
        Array.from(selectedAssetIds).map(id =>
          client.request(DELETE_MEDIA_ASSET_MUTATION, { id })
        )
      );

      // Clear selections and reload visible directories
      setSelectedAssetIds(new Set());
      setSelectionMode(false);
      if (rootPath) {
        await loadDirectoryIntoCache(rootPath);
      }
      if (currentPath && currentPath !== rootPath) {
        await loadDirectoryIntoCache(currentPath);
      }
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
      
      if (rootPath) {
        await loadDirectoryIntoCache(rootPath);
      }
      if (currentPath && currentPath !== rootPath) {
        await loadDirectoryIntoCache(currentPath);
      }
    } catch (err) {
      console.error("Failed to delete asset:", err);
      alert("Failed to delete asset. Please try again.");
    }
  };

  const handleFolderClick = async (folder: DirectoryNode) => {
    if (currentPath) {
      setFolderHistory(prev => [...prev, currentPath]);
    }

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

    setExpandedFolders(prev => {
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
  const isCurrentFolderLoading = !!currentFolder && currentFolder.children === null;

  const renderTree = (node: DirectoryNode) => {
    if (node.type === 'file') {
      const isSelected = node.mediaAsset ? selectedAssetIds.has(node.mediaAsset.id) : false;
      
      return (
        <div key={node.path} className="relative group">
          <button 
            type="button"
            className={`w-full pl-4 sm:pl-6 py-2 sm:py-2.5 flex items-center gap-2 sm:gap-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all duration-150 outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-left ${
              isSelected ? 'bg-blue-50 dark:bg-blue-900/30 border-l-4 border-blue-500 dark:border-blue-400 shadow-sm' : ''
            }`}
            onClick={() => node.mediaAsset && handleAssetClick(node.mediaAsset)}
          >
            {selectionMode && (
              <div className="flex-shrink-0">
                {isSelected ? (
                  <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                ) : (
                  <Square className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                )}
              </div>
            )}
            <FileImage className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
            <span className="text-xs sm:text-sm truncate text-gray-700 dark:text-gray-200 flex-1 font-medium">{node.name}</span>
            {!selectionMode && node.mediaAsset && (user?.role === 'admin' || user?.role === 'editor') && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteSingle(node.mediaAsset!.id, node.mediaAsset!.fileName);
                }}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-all duration-150"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
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
      <div key={node.path} className="pl-2 sm:pl-4">
        <button
          type="button"
          className="w-full py-2 sm:py-2.5 flex items-center gap-2 sm:gap-3 font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all duration-150 outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-left px-2"
          onClick={() => void toggleFolder(node.path)}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
          )}
          <div className="w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-blue-400 to-indigo-500 dark:from-blue-500 dark:to-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
            <Folder className="w-4 h-4 text-white" />
          </div>
          <span className="text-xs sm:text-sm">{node.name}</span>
          {Array.isArray(children) && (
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
              {children.length}
            </span>
          )}
        </button>
        {isExpanded && children === null && (
          <div className="pl-10 py-2 text-xs text-gray-500 dark:text-gray-400">Loading...</div>
        )}
        {isExpanded && Array.isArray(children) && children.length > 0 && (
          <div className="border-l-2 border-gray-200 dark:border-gray-700 ml-4 mt-1">
            {children.map(child => renderTree(child))}
          </div>
        )}
        {isExpanded && Array.isArray(children) && children.length === 0 && (
          <div className="pl-10 py-2 text-xs text-gray-500 dark:text-gray-400">Empty folder</div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${darkMode ? 'dark bg-gray-900' : 'bg-gradient-to-br from-gray-50 to-gray-100'}`}>
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading your media library...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-gray-900' : 'bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30'}`}>
      <header className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 shadow-sm sticky top-0 z-40">
        <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between sm:hidden">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
                <Folder className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent truncate">
                Media Asset Manager
              </h1>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-9 h-9 p-0 border-gray-300 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700 flex-shrink-0"
              onClick={() => setMobileMenuOpen(prev => !prev)}
              title={mobileMenuOpen ? "Close Menu" : "Open Menu"}
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </Button>
          </div>

          <div className="hidden sm:flex sm:flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
                <Folder className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <h1 className="text-lg sm:text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent truncate">
                Media Asset Manager
              </h1>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-end gap-2 flex-wrap">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDarkMode(!darkMode)}
                  className="rounded-full w-9 h-9 sm:w-10 sm:h-10 p-0 hover:bg-gray-100 dark:hover:bg-gray-700"
                  title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                >
                  {darkMode ? (
                    <Sun className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-500" />
                  ) : (
                    <Moon className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshMediaLibrary}
                  disabled={isRefreshing}
                  className={`border-gray-300 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700 ${isRefreshing ? 'opacity-60 cursor-not-allowed' : ''}`}
                  title="Refresh media library to detect new files"
                >
                  <RotateCcw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
                </Button>
              </div>

              {user && (
                <div className="flex items-center justify-end gap-2 flex-wrap">
                  <div className="text-right mr-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-[140px] sm:max-w-none">{user.username}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{user.role}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowChangePasswordDialog(true)}
                    className="border-gray-300 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                    title="Change Password"
                  >
                    <Key className="w-4 h-4" />
                  </Button>
                  {user.role === 'admin' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate("/users")}
                      className="border-gray-300 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      <Users className="w-4 h-4 sm:mr-2" />
                      <span className="hidden sm:inline">Users</span>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLogout}
                    className="border-gray-300 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    Logout
                  </Button>
                </div>
              )}
            </div>
          </div>

          {mobileMenuOpen && (
            <div className="sm:hidden mt-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 p-3 space-y-2 shadow-lg">
              {user && (
                <div className="pb-2 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{user.username}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{user.role}</p>
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDarkMode(!darkMode);
                  setMobileMenuOpen(false);
                }}
                className="w-full justify-start border-gray-300 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {darkMode ? <Sun className="w-4 h-4 mr-2 text-yellow-500" /> : <Moon className="w-4 h-4 mr-2" />}
                {darkMode ? "Light Mode" : "Dark Mode"}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await handleRefreshMediaLibrary();
                  setMobileMenuOpen(false);
                }}
                disabled={isRefreshing}
                className={`w-full justify-start border-gray-300 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700 ${isRefreshing ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <RotateCcw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? "Refreshing..." : "Refresh Library"}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowChangePasswordDialog(true);
                  setMobileMenuOpen(false);
                }}
                className="w-full justify-start border-gray-300 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <Key className="w-4 h-4 mr-2" />
                Change Password
              </Button>

              {user?.role === 'admin' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigate("/users");
                    setMobileMenuOpen(false);
                  }}
                  className="w-full justify-start border-gray-300 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  <Users className="w-4 h-4 mr-2" />
                  Users
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleLogout();
                }}
                className="w-full justify-start border-gray-300 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Logout
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-8">
        <div className="mb-6 sm:mb-8 flex flex-col gap-3 lg:flex-row lg:justify-between lg:items-center">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Media Library</h2>
            {folderHistory.length > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => void handleBackClick()} 
                className="flex items-center gap-1 hover:bg-white/50 dark:hover:bg-gray-700/50 backdrop-blur-sm border border-gray-200 dark:border-gray-700"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
            )}
            {currentFolder && currentFolder.path !== directoryTree?.path && (
               <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 font-medium max-w-full truncate">
                 {currentFolder.name}
               </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap lg:justify-end">
            {(user?.role === 'admin' || user?.role === 'editor') && (
              <>
                <Button
                  variant={selectionMode ? "default" : "outline"}
                  size="sm"
                  onClick={toggleSelectionMode}
                  className={`flex items-center gap-2 ${
                    selectionMode 
                      ? 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600' 
                      : 'border-gray-300 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <CheckSquare className="w-4 h-4" />
                  {selectionMode ? 'Cancel' : 'Select'}
                </Button>
                {selectionMode && selectedAssetIds.size > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteSelected}
                    className="flex items-center gap-2 bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete ({selectedAssetIds.size})
                  </Button>
                )}
              </>
            )}
            <div className="flex gap-2 bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm p-1 rounded-lg border border-gray-200 dark:border-gray-700">
              <Button
                variant={view === "grid" ? "default" : "ghost"}
                size="sm"
                onClick={() => setView("grid")}
                className={view === "grid" 
                  ? "bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white shadow-sm" 
                  : "hover:bg-white/50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300"
                }
              >
                Grid
              </Button>
              <Button
                variant={view === "tree" ? "default" : "ghost"}
                size="sm"
                onClick={() => setView("tree")}
                className={view === "tree" 
                  ? "bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white shadow-sm" 
                  : "hover:bg-white/50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300"
                }
              >
                Tree
              </Button>
            </div>
          </div>
        </div>

        {view === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-6">
            {currentFolderChildren.map((node) => {
              if (node.type === 'directory') {
                return (
                  <Card
                    key={node.path}
                    className="overflow-hidden cursor-pointer hover:shadow-xl hover:scale-105 transition-all duration-200 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-100 dark:border-blue-800 group backdrop-blur-sm"
                    onClick={() => void handleFolderClick(node)}
                  >
                    <CardContent className="p-4 sm:p-6 flex flex-col items-center justify-center text-center h-full min-h-[140px] sm:min-h-[180px]">
                      <div className="w-14 h-14 sm:w-20 sm:h-20 bg-gradient-to-br from-blue-400 to-indigo-500 dark:from-blue-500 dark:to-indigo-600 rounded-2xl flex items-center justify-center mb-3 sm:mb-4 group-hover:scale-110 transition-transform duration-200 shadow-lg">
                        <Folder className="w-7 h-7 sm:w-10 sm:h-10 text-white" />
                      </div>
                      <h3 className="font-semibold truncate w-full text-sm sm:text-base text-gray-800 dark:text-gray-100 group-hover:text-blue-700 dark:group-hover:text-blue-300">{node.name}</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 bg-white/50 dark:bg-gray-800/50 px-3 py-1 rounded-full">
                        Folder
                      </p>
                    </CardContent>
                  </Card>
                );
              } else if (node.mediaAsset) {
                const asset = node.mediaAsset;
                const isSelected = selectedAssetIds.has(asset.id);
                return (
                    <Card
                      key={asset.id}
                      className={`overflow-hidden cursor-pointer hover:shadow-xl hover:scale-105 transition-all duration-200 group relative bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 ${
                      isSelected ? 'ring-4 ring-blue-500 dark:ring-blue-400 ring-offset-2 dark:ring-offset-gray-900 scale-105 shadow-xl' : ''
                    }`}
                    onClick={() => handleAssetClick(asset)}
                  >
                    {selectionMode && (
                      <div className="absolute top-3 left-3 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-1.5 border border-gray-200 dark:border-gray-700">
                        {isSelected ? (
                          <CheckSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <Square className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                        )}
                      </div>
                    )}
                    {!selectionMode && (user?.role === 'admin' || user?.role === 'editor') && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSingle(asset.id, asset.fileName);
                        }}
                        className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-2.5 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200 border border-gray-200 dark:border-gray-700"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                      </button>
                    )}
                      <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 relative overflow-hidden">
                      {asset.thumbnailUrl ? (
                        <img
                          src={`${API_URL}${asset.thumbnailUrl}`}
                          alt={asset.fileName}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
                          <FileImage className="w-16 h-16 opacity-30" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200"></div>
                    </div>
                    <CardContent className="p-3 sm:p-4 bg-white dark:bg-gray-800">
                      <h3 className="font-semibold truncate text-sm sm:text-base text-gray-900 dark:text-gray-100 mb-1">{asset.fileName}</h3>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-full">
                          {(Number.parseInt(asset.fileSize) / 1024 / 1024).toFixed(2)} MB
                        </span>
                        <span className="text-gray-500 dark:text-gray-500 truncate ml-2">
                          {asset.mimeType.split('/')[0]}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              }
              return null;
            })}
            
            {currentFolderChildren.length > 0 &&
             currentFolderChildren.every((node) => node.type === 'file' && !node.mediaAsset) && (
               <div className="col-span-full text-center py-16 text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600">
                 <FileImage className="w-16 h-16 mx-auto mb-4 opacity-30" />
                 <p className="text-lg font-medium">This folder is empty</p>
                 <p className="text-sm mt-2">No media files found in this directory</p>
               </div>
            )}
            
            {isCurrentFolderLoading && (
               <div className="col-span-full text-center py-16 text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600">
                 <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 dark:border-blue-400 mb-4"></div>
                 <p className="text-lg font-medium">Loading folder...</p>
               </div>
            )}

            {!isCurrentFolderLoading && currentFolderChildren.length === 0 && (
               <div className="col-span-full text-center py-16 text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600">
                 <Folder className="w-16 h-16 mx-auto mb-4 opacity-30" />
                 <p className="text-lg font-medium">This folder is empty</p>
                 <p className="text-sm mt-2">No items found in this directory</p>
               </div>
            )}
          </div>
        ) : (
          <div className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm p-3 sm:p-6 rounded-xl sm:rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-auto max-h-[calc(100vh-230px)] sm:max-h-[calc(100vh-280px)]">
            {directoryTree ? renderTree(directoryTree) : (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <FileImage className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p>No data available</p>
              </div>
            )}
          </div>
        )}
      </main>

      <MediaAssetViewer
        asset={selectedAsset}
        isOpen={isViewerOpen}
        onClose={handleCloseViewer}
        apiUrl={API_URL}
      />

      {/* Change Password Dialog */}
      <Dialog open={showChangePasswordDialog} onOpenChange={setShowChangePasswordDialog}>
        <DialogContent className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-gray-900 dark:text-white">
              Change Password
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label htmlFor="current-password-dash" className="text-sm font-medium mb-1 block text-gray-700 dark:text-gray-300">
                Current Password
              </label>
              <Input
                id="current-password-dash"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="dark:bg-gray-900/50 dark:border-gray-600 dark:text-white"
                placeholder="Enter current password"
              />
            </div>
            <div>
              <label htmlFor="new-password-dash" className="text-sm font-medium mb-1 block text-gray-700 dark:text-gray-300">
                New Password
              </label>
              <Input
                id="new-password-dash"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="dark:bg-gray-900/50 dark:border-gray-600 dark:text-white"
                placeholder="Enter new password"
                minLength={6}
              />
            </div>
            <div>
              <label htmlFor="confirm-password-dash" className="text-sm font-medium mb-1 block text-gray-700 dark:text-gray-300">
                Confirm New Password
              </label>
              <Input
                id="confirm-password-dash"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="dark:bg-gray-900/50 dark:border-gray-600 dark:text-white"
                placeholder="Confirm new password"
                minLength={6}
              />
            </div>
            {passwordError && (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
                {passwordError}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowChangePasswordDialog(false);
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                  setPasswordError("");
                }}
                className="dark:hover:bg-gray-700"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 text-white"
              >
                Change Password
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
