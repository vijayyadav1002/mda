import { useEffect, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";
import { Card, CardContent } from "~/components/ui/card";
import { MediaAssetViewer } from "~/components/MediaAssetViewer";
import { AppShell } from "~/components/AppShell";
import { Folder, Image as ImageIcon } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const DIRECTORY_ROOT_QUERY = `
  query GetDirectoryRoot {
    directoryRoot { name path type }
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

const SINGLE_MEDIA_ASSET_QUERY = `
  query GetMediaAsset($id: ID!) {
    mediaAsset(id: $id) {
      id
      fileName
      filePath
      mimeType
      fileSize
      thumbnailUrl
      createdAt
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
  mediaAsset?: {
    id: string;
    fileName: string;
    filePath: string;
    mimeType: string;
    fileSize: string;
    thumbnailUrl: string | null;
  } | null;
}

export default function LibraryRoute() {
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [rootDir, setRootDir] = useState<DirectoryNode | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [currentChildren, setCurrentChildren] = useState<DirectoryNode[]>([]);
  const [childrenCache, setChildrenCache] = useState<Record<string, DirectoryNode[]>>({});
  const [treeLoading, setTreeLoading] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      navigate("/login");
      return;
    }

    loadUser();
    loadDirectoryRoot();
  }, []);

  const loadUser = async () => {
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      const data: any = await client.request(`query { me { username role } }`);
      setUser(data.me);
    } catch {}
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
    } finally {
      setTreeLoading(false);
    }
  };

  const loadChildrenForPath = async (path: string, existingClient?: any) => {
    const key = normalizePath(path);
    if (childrenCache[key]) {
      setCurrentChildren(childrenCache[key]);
      return;
    }
    try {
      setTreeLoading(true);
      const token = getAuthToken();
      if (!token) return;
      const client = existingClient || createGraphQLClient(token);
      const data: any = await client.request(DIRECTORY_CHILDREN_QUERY, { path: key });
      setChildrenCache(prev => ({ ...prev, [key]: data.directoryChildren }));
      setCurrentChildren(data.directoryChildren);
    } finally {
      setTreeLoading(false);
    }
  };

  const fetchAssetById = async (id: string): Promise<MediaAsset | null> => {
    try {
      const token = getAuthToken();
      if (!token) return null;
      const client = createGraphQLClient(token);
      const data: any = await client.request(SINGLE_MEDIA_ASSET_QUERY, { id });
      return data.mediaAsset as MediaAsset;
    } catch {
      return null;
    }
  };

  const handleDirClick = (path: string) => {
    const key = normalizePath(path);
    setCurrentPath(key);
    loadChildrenForPath(key);
  };

  const handleTreeFileClick = async (node: DirectoryNode) => {
    if (!node.mediaAsset) return;
    let asset = await fetchAssetById(node.mediaAsset.id);
    if (asset) {
      setSelectedAsset(asset);
      setIsViewerOpen(true);
    }
  };

  return (
    <AppShell username={user?.username} role={user?.role}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Library</h1>
          <p className="text-sm text-muted-foreground">Browse your folders</p>
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center text-sm text-muted-foreground gap-2">
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
                    className={`hover:underline ${isLast ? 'font-semibold text-foreground' : ''}`}
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
          <div className="text-center py-12">Loading...</div>
        ) : (
          (() => {
            const children = (currentChildren || []).slice().sort((a, b) => {
              if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {children.map((child) => (
                  <Card
                    key={child.path}
                    className={`overflow-hidden transition-all hover:shadow-sm border-muted ${child.type === 'directory' ? 'cursor-pointer hover:border-foreground/20' : (child.mediaAsset ? 'cursor-pointer hover:border-foreground/20' : 'opacity-60')}`}
                    onClick={() => child.type === 'directory' ? handleDirClick(child.path) : child.mediaAsset ? handleTreeFileClick(child) : undefined}
                  >
                    <div className="aspect-square bg-muted/40 relative flex items-center justify-center">
                      {child.type === 'directory' ? (
                        <div className="flex flex-col items-center justify-center text-muted-foreground">
                          <Folder className="w-10 h-10 mb-2" />
                          <span className="text-sm font-medium">{child.name}</span>
                        </div>
                      ) : child.mediaAsset && child.mediaAsset.thumbnailUrl ? (
                        // eslint-disable-next-line jsx-a11y/alt-text
                        <img
                          src={`${API_URL}${child.mediaAsset.thumbnailUrl}`}
                          alt={child.mediaAsset.fileName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-muted-foreground">
                          <ImageIcon className="w-8 h-8 mb-2" />
                          <span className="text-sm">{child.name}</span>
                          <span className="text-[10px]">No preview</span>
                        </div>
                      )}
                    </div>
                    {child.type === 'file' && child.mediaAsset && (
                      <CardContent className="p-4">
                        <h3 className="font-medium truncate">{child.mediaAsset.fileName}</h3>
                        <p className="text-sm text-muted-foreground">
                          {(Number.parseInt(child.mediaAsset.fileSize) / 1024 / 1024).toFixed(2)} MB
                        </p>
                        <p className="text-xs text-muted-foreground/70">{child.mediaAsset.mimeType}</p>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            );
          })()
        )}
      </div>

      <MediaAssetViewer
        asset={selectedAsset}
        isOpen={isViewerOpen}
        onClose={() => setIsViewerOpen(false)}
        apiUrl={API_URL}
        isAdmin={user?.role === 'admin'}
      />
    </AppShell>
  );
}
