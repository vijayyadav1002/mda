import { useState, useEffect } from "react";
import { useNavigate } from "@remix-run/react";
import { createGraphQLClient, getAuthToken, clearAuthToken } from "~/lib/api";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { MediaAssetViewer } from "~/components/MediaAssetViewer";
import { Folder, File as FileIcon } from "lucide-react";

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

const DIRECTORY_ROOT_QUERY = `
  query GetDirectoryRoot {
    directoryRoot {
      name
      path
      type
    }
  }
`;

const DIRECTORY_CHILDREN_QUERY = `
  query GetDirectoryChildren($path: String!) {
    directoryChildren(path: $path) {
      name
      path
      type
      mediaAsset {
        id
        fileName
        filePath
        mimeType
        fileSize
        thumbnailUrl
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
  type: "directory" | "file";
  children?: DirectoryNode[];
  mediaAsset?: {
    id: string;
    fileName: string;
    filePath: string;
    mimeType: string;
    fileSize: string;
    thumbnailUrl: string | null;
  } | null;
}

const SINGLE_MEDIA_ASSET_QUERY = `
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
    }
  }
`;

export default function Dashboard() {
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [user, setUser] = useState<{ id: string; username: string; role: string } | null>(null);
  const [view, setView] = useState<"grid" | "tree">("grid");
  const [loading, setLoading] = useState(true);
  const [rootDir, setRootDir] = useState<DirectoryNode | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [currentChildren, setCurrentChildren] = useState<DirectoryNode[]>([]);
  const [childrenCache, setChildrenCache] = useState<Record<string, DirectoryNode[]>>({});
  const [treeLoading, setTreeLoading] = useState(false);
  const [fetchingPath, setFetchingPath] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      navigate("/login");
      return;
    }

    loadMediaAssets();
    loadDirectoryRoot();
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

  const handleLogout = () => {
    clearAuthToken();
    navigate("/login");
  };

  const handleAssetClick = (asset: MediaAsset) => {
    setSelectedAsset(asset);
    setIsViewerOpen(true);
  };

  const handleCloseViewer = () => {
    setIsViewerOpen(false);
    setSelectedAsset(null);
  };

  const loadMediaAssets = async () => {
    try {
      setLoading(true);
      const token = getAuthToken();
      if (!token) return;

      const client = createGraphQLClient(token);
      const data: any = await client.request(MEDIA_ASSETS_QUERY, {
        limit: 50,
        offset: 0,
      });

      // Clear selected asset if it was deleted
      if (selectedAsset && !data.mediaAssets.find((asset: MediaAsset) => asset.id === selectedAsset.id)) {
        setSelectedAsset(null);
      }
      
      setMediaAssets(data.mediaAssets);
    } catch (err) {
      console.error("Failed to load media assets:", err);
    } finally {
      setLoading(false);
    }
  };

  const normalizePath = (p: string) => p.replace(/\/+$/, "");

  const loadDirectoryRoot = async () => {
    try {
      setTreeLoading(true);
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      const data: any = await client.request(DIRECTORY_ROOT_QUERY);
      const rootPath = data.directoryRoot?.path ? normalizePath(data.directoryRoot.path) : null;
      setRootDir(rootPath ? { ...data.directoryRoot, path: rootPath } : data.directoryRoot);
      setCurrentPath(rootPath || null);
      if (rootPath) {
        await loadChildrenForPath(rootPath, client);
      }
    } catch (err) {
      console.error("Failed to load directory root:", err);
    } finally {
      setTreeLoading(false);
    }
  };

  const loadChildrenForPath = async (path: string, existingClient?: any) => {
    const key = normalizePath(path);
    if (fetchingPath === key) return; // prevent duplicate in-flight calls
    // Cached?
    if (childrenCache[key]) {
      setCurrentChildren(childrenCache[key]);
      return;
    }
    try {
      setTreeLoading(true);
      setFetchingPath(key);
      const token = getAuthToken();
      if (!token) return;
      const client = existingClient || createGraphQLClient(token);
      const data: any = await client.request(DIRECTORY_CHILDREN_QUERY, { path: key });
      setChildrenCache(prev => ({ ...prev, [key]: data.directoryChildren }));
      setCurrentChildren(data.directoryChildren);
    } catch (err) {
      console.error("Failed to load directory children:", err);
    } finally {
      setTreeLoading(false);
      setFetchingPath(null);
    }
  };

  const handleDirClick = (path: string) => {
    const key = normalizePath(path);
    setCurrentPath(key);
    loadChildrenForPath(key);
  };

  const fetchAssetById = async (id: string): Promise<MediaAsset | null> => {
    try {
      const token = getAuthToken();
      if (!token) return null;
      const client = createGraphQLClient(token);
      const data: any = await client.request(SINGLE_MEDIA_ASSET_QUERY, { id });
      return data.mediaAsset as MediaAsset;
    } catch (err) {
      console.error("Failed to fetch media asset:", err);
      return null;
    }
  };

  const handleTreeFileClick = async (node: DirectoryNode) => {
    if (!node.mediaAsset) return;
    // Try to find in already-loaded mediaAssets
    let asset = mediaAssets.find(a => a.id === node.mediaAsset!.id) || null;
    if (!asset) {
      const fetched = await fetchAssetById(node.mediaAsset.id);
      if (fetched) {
        asset = fetched;
      }
    }
    if (asset) {
      handleAssetClick(asset);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Media Asset Manager</h1>
          <div className="flex items-center gap-4">
            {user && (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-medium">{user.username}</p>
                  <p className="text-xs text-gray-500 capitalize">{user.role}</p>
                </div>
                <Button variant="outline" onClick={handleLogout}>
                  Logout
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-6 flex justify-between items-center">
          <h2 className="text-xl font-semibold">Media Library</h2>
          <div className="space-x-2">
            <Button
              variant={view === "grid" ? "default" : "outline"}
              onClick={() => setView("grid")}
            >
              Grid View
            </Button>
            <Button
              variant={view === "tree" ? "default" : "outline"}
              onClick={() => setView("tree")}
            >
              Tree View
            </Button>
          </div>
        </div>

        {view === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {mediaAssets.map((asset) => (
              <Card
                key={asset.id}
                className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => handleAssetClick(asset)}
              >
                <div className="aspect-square bg-gray-200 relative">
                  {asset.thumbnailUrl ? (
                    <img
                      src={`${API_URL}${asset.thumbnailUrl}`}
                      alt={asset.fileName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      No preview
                    </div>
                  )}
                </div>
                <CardContent className="p-4">
                  <h3 className="font-medium truncate">{asset.fileName}</h3>
                  <p className="text-sm text-gray-500">
                    {(Number.parseInt(asset.fileSize) / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <p className="text-xs text-gray-400">{asset.mimeType}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div>
            {/* Breadcrumbs */}
            <div className="flex items-center text-sm text-gray-600 mb-4 gap-2">
              <button
                className="hover:underline"
                onClick={() => {
                  if (rootDir?.path) {
                    const key = normalizePath(rootDir.path);
                    setCurrentPath(key);
                    loadChildrenForPath(key);
                  }
                }}
              >
                Root
              </button>
              <span>/</span>
              {(() => {
                if (!rootDir || !currentPath) return null;
                const rootPath = rootDir.path;
                const rel = currentPath.replace(rootPath, "");
                const parts = rel.split("/").filter(Boolean);
                let acc = rootPath;
                return parts.map((seg, idx) => {
                  acc = acc + (acc.endsWith("/") ? "" : "/") + seg;
                  const isLast = idx === parts.length - 1;
                  return (
                    <span key={acc} className="flex items-center gap-2">
                      <button
                        className={`hover:underline ${isLast ? 'font-semibold text-gray-900' : ''}`}
                        onClick={() => {
                          const key = normalizePath(acc);
                          setCurrentPath(key);
                          if (!isLast) loadChildrenForPath(key);
                        }}
                        disabled={isLast}
                      >
                        {seg}
                      </button>
                      {!isLast && <span>/</span>}
                    </span>
                  );
                });
              })()}
            </div>

            {/* Directory contents */}
            {treeLoading || !rootDir ? (
              <div className="text-center py-12">Loading tree...</div>
            ) : (
              (() => {
                const children = (currentChildren || []).slice().sort((a, b) => {
                  // Directories first
                  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                  return a.name.localeCompare(b.name);
                });
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {children.map((child) => (
                      <Card
                        key={child.path}
                        className={`overflow-hidden transition-shadow ${child.type === 'directory' ? 'cursor-pointer hover:shadow-lg' : (child.mediaAsset ? 'cursor-pointer hover:shadow-lg' : 'opacity-60')}`}
                        onClick={() => child.type === 'directory' ? handleDirClick(child.path) : child.mediaAsset ? handleTreeFileClick(child) : undefined}
                      >
                        <div className="aspect-square bg-gray-100 relative flex items-center justify-center">
                          {child.type === 'directory' ? (
                            <div className="flex flex-col items-center justify-center text-gray-600">
                              <Folder className="w-12 h-12 mb-2" />
                              <span className="text-sm font-medium">{child.name}</span>
                            </div>
                          ) : child.mediaAsset && child.mediaAsset.thumbnailUrl ? (
                            <img
                              src={`${API_URL}${child.mediaAsset.thumbnailUrl}`}
                              alt={child.mediaAsset.fileName}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center text-gray-400">
                              <FileIcon className="w-10 h-10 mb-2" />
                              <span className="text-sm">{child.name}</span>
                              <span className="text-xs">No preview</span>
                            </div>
                          )}
                        </div>
                        {child.type === 'file' && (
                          <CardContent className="p-4">
                            <h3 className="font-medium truncate">{child.mediaAsset?.fileName || child.name}</h3>
                            {child.mediaAsset && (
                              <>
                                <p className="text-sm text-gray-500">
                                  {(Number.parseInt(child.mediaAsset.fileSize) / 1024 / 1024).toFixed(2)} MB
                                </p>
                                <p className="text-xs text-gray-400">{child.mediaAsset.mimeType}</p>
                              </>
                            )}
                          </CardContent>
                        )}
                      </Card>
                    ))}
                  </div>
                );
              })()
            )}
          </div>
        )}

        {view === "grid" && mediaAssets.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No media assets found</p>
          </div>
        )}
      </main>

      <MediaAssetViewer
        asset={selectedAsset}
        isOpen={isViewerOpen}
        onClose={handleCloseViewer}
        onDelete={() => loadMediaAssets()}
        apiUrl={API_URL}
        isAdmin={user?.role === 'admin'}
      />
    </div>
  );
}
