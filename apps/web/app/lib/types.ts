export interface TagSummary {
  id: string;
  name: string;
}

export interface MediaAsset {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: string;
  thumbnailUrl: string | null;
  transcodedUrl?: string | null;
  createdAt: string;
  updatedAt?: string;
  capturedAt?: string | null;
  tags?: TagSummary[];
}

export interface DirectoryNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: DirectoryNode[] | null;
  mediaAsset?: MediaAsset;
  size?: number | null;
}

export interface CacheTypeStats {
  label: string;
  bytes: number;
  fileCount: number;
  maxBytes: number;
}

export interface CacheStats {
  thumbnails: CacheTypeStats;
  previews: CacheTypeStats;
  hls: CacheTypeStats;
  transcoded: CacheTypeStats;
  totalBytes: number;
}

export interface CacheSettingsData {
  thumbnailCacheMaxMb: number;
  previewCacheMaxMb: number;
  hlsCacheMaxMb: number;
  transcodedCacheMaxMb: number;
  previewCacheMaxAgeDays: number;
  hlsCacheMaxAgeHours: number;
}
