import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { AppShell } from "~/components/AppShell";
import { Image as ImageIcon, Film } from "lucide-react";

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

export default function RecentRoute() {
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      navigate("/login");
      return;
    }
    loadUser();
    loadRecent();
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

  const loadRecent = async () => {
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      const data: any = await client.request(MEDIA_ASSETS_QUERY, { limit: 50, offset: 0 });
      const sorted = [...data.mediaAssets].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      setAssets(sorted);
    } finally {
      setLoading(false);
    }
  };

  const counts = useMemo(() => {
    const images = assets.filter(a => a.mimeType.startsWith("image/")).length;
    const videos = assets.filter(a => a.mimeType.startsWith("video/")).length;
    return { images, videos };
  }, [assets]);

  return (
    <AppShell username={user?.username} role={user?.role}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Recent</h1>
            <p className="text-sm text-muted-foreground">Latest 50 items</p>
          </div>
          <div className="hidden md:flex gap-3">
            <Card className="p-4 flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Images</div>
                <div className="text-lg font-semibold">{counts.images}</div>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-2">
              <Film className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Videos</div>
                <div className="text-lg font-semibold">{counts.videos}</div>
              </div>
            </Card>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center">Loading...</div>
        ) : assets.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No recent items</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {assets.map((a) => (
              <Card key={a.id} className="overflow-hidden">
                <div className="aspect-square bg-muted/40 flex items-center justify-center">
                  {a.thumbnailUrl ? (
                    // eslint-disable-next-line jsx-a11y/alt-text
                    <img src={`${API_URL}${a.thumbnailUrl}`} alt={a.fileName} className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-xs text-muted-foreground p-2 text-center">No preview</div>
                  )}
                </div>
                <CardContent className="p-3">
                  <div className="truncate text-sm font-medium" title={a.fileName}>{a.fileName}</div>
                  <div className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
