import path from 'path';

// Thumbnail filenames are derived from the file path, so a regenerated
// thumbnail keeps the same URL. Version the URL with the row's updated_at
// (bumped on every thumbnail save) so browsers fetch the fresh image.
export const buildThumbnailUrl = (row: any): string | null => {
  if (!row.thumbnail_path) return null;
  const version = row.updated_at instanceof Date ? `?v=${row.updated_at.getTime()}` : '';
  return `/thumbnails/${path.basename(row.thumbnail_path)}${version}`;
};

export const mapMediaAssetRow = (row: any) => ({
  id: row.id,
  filePath: row.file_path,
  fileName: row.file_name,
  fileSize: row.file_size.toString(),
  mimeType: row.mime_type,
  width: row.width,
  height: row.height,
  duration: row.duration,
  thumbnailPath: row.thumbnail_path,
  thumbnailUrl: buildThumbnailUrl(row),
  transcodedPath: row.transcoded_path,
  transcodedUrl: row.transcoded_path ? `/transcoded/${path.basename(row.transcoded_path)}` : null,
  indexedAt: row.indexed_at.toISOString(),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  capturedAt: row.captured_at ? row.captured_at.toISOString() : null,
  capturedAtPrecision: row.captured_at_precision ?? null
});

export const mapTagRow = (row: any) => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  assetCount: typeof row.asset_count === 'number' ? row.asset_count : 0
});
