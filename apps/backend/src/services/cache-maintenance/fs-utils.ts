import fs from 'node:fs/promises';
import path from 'node:path';

type CacheFile = {
  filePath: string;
  size: number;
  mtimeMs: number;
};

export async function listFiles(rootPath: string, recursive: boolean): Promise<CacheFile[]> {
  const files: CacheFile[] = [];

  const walk = async (dirPath: string) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (recursive) await walk(fullPath);
          continue;
        }

        if (!entry.isFile()) continue;

        try {
          const stats = await fs.stat(fullPath);
          files.push({
            filePath: fullPath,
            size: stats.size,
            mtimeMs: stats.mtimeMs
          });
        } catch {
          // Ignore races with concurrent writes/deletes
        }
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  };

  await walk(rootPath);
  return files;
}

export async function safeUnlink(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false;
    console.warn(`Could not delete cache file ${filePath}:`, error);
    return false;
  }
}

export async function removeEmptyDirectories(rootPath: string): Promise<void> {
  const walk = async (dirPath: string) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          await walk(path.join(dirPath, entry.name));
        }
      }
    } catch {
      return;
    }

    if (dirPath === rootPath) return;

    try {
      const remaining = await fs.readdir(dirPath);
      if (remaining.length === 0) {
        await fs.rmdir(dirPath);
      }
    } catch {
      // Ignore races
    }
  };

  await walk(rootPath);
}
