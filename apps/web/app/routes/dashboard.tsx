import { useState, useEffect } from "react";
import { useNavigate } from "@remix-run/react";
import { createGraphQLClient, getAuthToken, clearAuthToken } from "~/lib/api";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { MediaAssetViewer } from "~/components/MediaAssetViewer";
import { Folder, FileImage, ArrowLeft, ChevronDown, ChevronRight, Trash2, CheckSquare, Square, Moon, Sun, Users, Key, RotateCcw } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

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

const DIRECTORY_TREE_QUERY = `
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

  query GetDirectoryTree {
    directoryTree {
      ...DirNode
      children {
        ...DirNode
        children {
          ...DirNode
          children {
            ...DirNode
            children {
              ...DirNode
              children {
                ...DirNode
              }
            }
          }
        }
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
  thumbnailUrl: string;
  createdAt: string;
}

interface DirectoryNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: DirectoryNode[];
  mediaAsset?: MediaAsset;
}

export default function Dashboard() {
  const [directoryTree, setDirectoryTree] = useState<DirectoryNode | null>(null);
  const [currentFolder, setCurrentFolder] = useState<DirectoryNode | null>(null);
  const [folderHistory, setFolderHistory] = useState<DirectoryNode[]>([]);
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

  const loadData = async () => {
    try {
      const token = getAuthToken();
      if (!token) return;

      const client = createGraphQLClient(token);
      
      // Load directory tree
      const treeData: any = await client.request(DIRECTORY_TREE_QUERY);
      console.log("Directory tree data:", treeData.directoryTree);
      setDirectoryTree(treeData.directoryTree);
      setCurrentFolder(treeData.directoryTree);
      
      // Expand the root folder by default
      if (treeData.directoryTree?.path) {
        setExpandedFolders(new Set([treeData.directoryTree.path]));
      }

      // Also load flat assets for fallback or other views if needed
      // But for now we focus on tree structure
      
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
    try {
      setIsRefreshing(true);
      const token = getAuthToken();
      if (!token) return;

      const client = createGraphQLClient(token);
      const response: any = await client.request(REFRESH_MEDIA_LIBRARY_MUTATION);
      
      console.log("Refresh response:", response);
      
      // Reload the media library
      await loadData();
      alert("Media library refreshed successfully!");
    } catch (err: any) {
      console.error("Failed to refresh media library:", err);
      alert(`Failed to refresh media library: ${err.message || 'Unknown error'}`);
    } finally {
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

      // Clear selections and reload data
      setSelectedAssetIds(new Set());
      setSelectionMode(false);
      await loadData();
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
      
      // Reload data
      await loadData();
    } catch (err) {
      console.error("Failed to delete asset:", err);
      alert("Failed to delete asset. Please try again.");
    }
  };

  const handleFolderClick = (folder: DirectoryNode) => {
    if (currentFolder) {
      setFolderHistory([...folderHistory, currentFolder]);
    }
    setCurrentFolder(folder);
  };

  const handleBackClick = () => {
    if (folderHistory.length === 0) return;
    const newHistory = [...folderHistory];
    const previousFolder = newHistory.pop();
    setFolderHistory(newHistory);
    setCurrentFolder(previousFolder || null);
  };

  const handleCloseViewer = () => {
    setIsViewerOpen(false);
    setSelectedAsset(null);
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const renderTree = (node: DirectoryNode) => {
    if (node.type === 'file') {
      const isSelected = node.mediaAsset ? selectedAssetIds.has(node.mediaAsset.id) : false;
      
      return (
        <div key={node.path} className="relative group">
          <button 
            type="button"
            className={`w-full pl-6 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all duration-150 outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-left ${
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
            <span className="text-sm truncate text-gray-700 dark:text-gray-200 flex-1 font-medium">{node.name}</span>
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

    const isExpanded = expandedFolders.has(node.path);

    return (
      <div key={node.path} className="pl-4">
        <button
          type="button"
          className="w-full py-2.5 flex items-center gap-3 font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all duration-150 outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-left px-2"
          onClick={() => toggleFolder(node.path)}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
          )}
          <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-indigo-500 dark:from-blue-500 dark:to-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
            <Folder className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm">{node.name}</span>
          {node.children && (
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
              {node.children.length}
            </span>
          )}
        </button>
        {isExpanded && node.children && node.children.length > 0 && (
          <div className="border-l-2 border-gray-200 dark:border-gray-700 ml-4 mt-1">
            {node.children.map(child => renderTree(child))}
          </div>
        )}
      </div>
    );
  };

  // Debug logging
  console.log("Current folder:", currentFolder);
  console.log("Current folder children:", currentFolder?.children);

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
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                <Folder className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent">
                Media Asset Manager
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDarkMode(!darkMode)}
              className="rounded-full w-10 h-10 p-0 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {darkMode ? (
                <Sun className="w-5 h-5 text-yellow-500" />
              ) : (
                <Moon className="w-5 h-5 text-gray-600" />
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
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
            {user && (
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{user.username}</p>
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
                    onClick={() => navigate("/users")}
                    className="border-gray-300 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    <Users className="w-4 h-4 mr-2" />
                    Users
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  onClick={handleLogout}
                  className="border-gray-300 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  Logout
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8 flex justify-between items-center flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Media Library</h2>
            {folderHistory.length > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleBackClick} 
                className="flex items-center gap-1 hover:bg-white/50 dark:hover:bg-gray-700/50 backdrop-blur-sm border border-gray-200 dark:border-gray-700"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
            )}
            {currentFolder && currentFolder.path !== directoryTree?.path && (
               <span className="text-sm text-gray-600 dark:text-gray-300 bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 font-medium">
                 {currentFolder.name}
               </span>
            )}
          </div>
          <div className="flex items-center gap-2">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {currentFolder?.children?.map((node) => {
              if (node.type === 'directory') {
                return (
                  <Card
                    key={node.path}
                    className="overflow-hidden cursor-pointer hover:shadow-xl hover:scale-105 transition-all duration-200 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-100 dark:border-blue-800 group backdrop-blur-sm"
                    onClick={() => handleFolderClick(node)}
                  >
                    <CardContent className="p-6 flex flex-col items-center justify-center text-center h-full min-h-[180px]">
                      <div className="w-20 h-20 bg-gradient-to-br from-blue-400 to-indigo-500 dark:from-blue-500 dark:to-indigo-600 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-200 shadow-lg">
                        <Folder className="w-10 h-10 text-white" />
                      </div>
                      <h3 className="font-semibold truncate w-full text-gray-800 dark:text-gray-100 group-hover:text-blue-700 dark:group-hover:text-blue-300">{node.name}</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 bg-white/50 dark:bg-gray-800/50 px-3 py-1 rounded-full">
                        {node.children?.length || 0} items
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
                    <CardContent className="p-4 bg-white dark:bg-gray-800">
                      <h3 className="font-semibold truncate text-gray-900 dark:text-gray-100 mb-1">{asset.fileName}</h3>
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
            
            {currentFolder?.children && currentFolder.children.length > 0 && 
             currentFolder.children.every((node) => node.type === 'file' && !node.mediaAsset) && (
               <div className="col-span-full text-center py-16 text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600">
                 <FileImage className="w-16 h-16 mx-auto mb-4 opacity-30" />
                 <p className="text-lg font-medium">This folder is empty</p>
                 <p className="text-sm mt-2">No media files found in this directory</p>
               </div>
            )}
            
            {(!currentFolder?.children || currentFolder.children.length === 0) && (
               <div className="col-span-full text-center py-16 text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600">
                 <Folder className="w-16 h-16 mx-auto mb-4 opacity-30" />
                 <p className="text-lg font-medium">This folder is empty</p>
                 <p className="text-sm mt-2">No items found in this directory</p>
               </div>
            )}
          </div>
        ) : (
          <div className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-auto max-h-[calc(100vh-280px)]">
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
