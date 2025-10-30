import { useState, useEffect } from "react";
import { useNavigate } from "@remix-run/react";
import { createGraphQLClient, getAuthToken, clearAuthToken } from "~/lib/api";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { MediaAssetViewer } from "~/components/MediaAssetViewer";

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

const DIRECTORY_TREE_QUERY = `
  query GetDirectoryTree {
    directoryTree {
      name
      path
      type
      children {
        name
        path
        type
        mediaAsset {
          id
          fileName
          thumbnailUrl
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

export default function Dashboard() {
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [user, setUser] = useState<{ id: string; username: string; role: string } | null>(null);
  const [view, setView] = useState<"grid" | "tree">("grid");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      navigate("/login");
      return;
    }

    loadMediaAssets();
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

        {mediaAssets.length === 0 && (
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
