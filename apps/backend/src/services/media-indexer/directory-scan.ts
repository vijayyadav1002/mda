import fs from 'fs/promises';
import path from 'node:path';

export async function scanDirectory(dir: string, maxDepth: number = 20, currentDepth: number = 0, visited: Set<string> = new Set()): Promise<string[]> {
  const files: string[] = [];

  // Prevent stack overflow from circular references
  if (currentDepth > maxDepth) {
    console.warn(`Max directory depth exceeded at ${dir}`);
    return files;
  }

  try {
    // Use a simple string-based visited check first to catch circular refs early
    if (visited.has(dir)) {
      console.warn(`Circular reference detected at ${dir}`);
      return files;
    }

    visited.add(dir);

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden entries entirely — including dot-directories like the
      // `.trash` bin, which must never be re-indexed.
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);

      try {
        // Use lstat to detect symlinks without following them
        const stats = await fs.lstat(fullPath);

        // Skip symlinks to prevent circular references and symlink loops
        if (stats.isSymbolicLink()) {
          console.debug(`Skipping symlink: ${fullPath}`);
          continue;
        }

        if (stats.isDirectory()) {
          // Check visited before recursing
          if (!visited.has(fullPath)) {
            const subFiles = await scanDirectory(fullPath, maxDepth, currentDepth + 1, visited);
            files.push(...subFiles);
          }
        } else if (stats.isFile() && !entry.name.startsWith('.')) {
          files.push(fullPath);
        }
      } catch (entryError) {
        console.warn(`Error processing entry ${fullPath}: ${entryError instanceof Error ? entryError.message : String(entryError)}`);
        // Continue with next entry instead of stopping
        continue;
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dir}:`, error);
  }

  return files;
}
