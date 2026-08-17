import fs from 'fs/promises';
import path from 'path';

export const cleanupCompressPreviewFiles = async (previewDir: string, ids: string[]) => {
  if (ids.length === 0) return;
  let entries: string[];
  try {
    entries = await fs.readdir(previewDir);
  } catch {
    return;
  }

  const idSet = new Set(ids);
  const deletions = entries
    .filter((name) => {
      const markerIndex = name.lastIndexOf('_preview');
      if (markerIndex <= 0) return false;
      const assetId = name.slice(0, markerIndex);
      return idSet.has(assetId);
    })
    .map((name) => fs.unlink(path.join(previewDir, name)).catch(() => {}));

  await Promise.all(deletions);
};
