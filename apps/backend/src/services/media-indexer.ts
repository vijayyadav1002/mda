import fs from 'fs/promises';
import path from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { generateThumbnail } from './thumbnail.js';

const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp', '.bmp'];
const SUPPORTED_VIDEO_FORMATS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
const SUPPORTED_FORMATS = [...SUPPORTED_IMAGE_FORMATS, ...SUPPORTED_VIDEO_FORMATS];

export async function indexMediaLibrary() {
  try {
    const mediaPath = config.mediaLibraryPath;
    
    // Ensure media library path exists
    try {
      await fs.access(mediaPath);
    } catch {
      console.warn(`Media library path does not exist: ${mediaPath}`);
      return;
    }

    // Ensure thumbnail cache directory exists
    await fs.mkdir(config.thumbnailCachePath, { recursive: true });

    const files = await scanDirectory(mediaPath);
    console.log(`Found ${files.length} media files to index`);

    for (const filePath of files) {
      await indexFile(filePath);
    }

    console.log('Initial media indexing completed');
  } catch (error) {
    console.error('Error indexing media library:', error);
    throw error;
  }
}

async function scanDirectory(dir: string, maxDepth: number = 20, currentDepth: number = 0, visited: Set<string> = new Set()): Promise<string[]> {
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
        } else if (stats.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_FORMATS.includes(ext)) {
            files.push(fullPath);
          }
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

export async function indexFile(filePath: string) {
  try {
    // Check if file exists
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch {
      console.log(`File no longer exists: ${filePath}`);
      return;
    }

    // Check if already indexed and up to date
    const existing = await db.query(
      'SELECT id, updated_at FROM media_assets WHERE file_path = $1',
      [filePath]
    );
    
    if (existing.rows.length > 0) {
      const existingUpdated = new Date(existing.rows[0].updated_at);
      if (existingUpdated >= stats.mtime) {
        console.log(`Already indexed and up to date: ${path.basename(filePath)}`);
        return;
      }
      // File was modified, delete old entry and clean up thumbnail
      try {
        const oldResult = await db.query(
          'SELECT thumbnail_path FROM media_assets WHERE id = $1',
          [existing.rows[0].id]
        );
        if (oldResult.rows.length > 0 && oldResult.rows[0].thumbnail_path) {
          try {
            await fs.unlink(oldResult.rows[0].thumbnail_path);
          } catch (e) {
            // Thumbnail may not exist, that's ok
          }
        }
      } catch (e) {
        console.warn(`Could not clean up old thumbnail: ${e}`);
      }
      await db.query('DELETE FROM media_assets WHERE id = $1', [existing.rows[0].id]);
    }

    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();
    
    // Validate file format
    if (!SUPPORTED_FORMATS.includes(ext)) {
      console.log(`Skipping unsupported format: ${ext}`);
      return;
    }

    // Determine mime type
    let mimeType = 'application/octet-stream';
    const isVideo = SUPPORTED_VIDEO_FORMATS.includes(ext);
    
    if (SUPPORTED_IMAGE_FORMATS.includes(ext)) {
      mimeType = `image/${ext.slice(1)}`;
      if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      if (ext === '.heic') mimeType = 'image/heic';
    } else if (isVideo) {
      mimeType = `video/${ext.slice(1)}`;
      if (ext === '.mp4') mimeType = 'video/mp4';
    }

    // Generate thumbnail with better error handling
    let thumbnailPath: string | null = null;
    try {
      thumbnailPath = await generateThumbnail(filePath);
      if (!thumbnailPath) {
        throw new Error('Thumbnail generation returned null');
      }
    } catch (error) {
      console.error(`Error generating thumbnail for ${fileName}: ${error}`);
      // Use a placeholder or skip if thumbnail generation fails
      // For now, we'll continue without a thumbnail
      thumbnailPath = null;
    }

    // Insert into database (without transcoded path - will be generated on-demand)
    await db.query(
      `INSERT INTO media_assets 
       (file_path, file_name, file_size, mime_type, thumbnail_path) 
       VALUES ($1, $2, $3, $4, $5)`,
      [filePath, fileName, stats.size, mimeType, thumbnailPath]
    );

    console.log(`✓ Indexed: ${fileName}${thumbnailPath ? ' (thumbnail generated)' : ' (no thumbnail)'}`);
  } catch (error) {
    console.error(`Error indexing file ${filePath}:`, error);
    throw error; // Re-throw so watcher can log it properly
  }
}

export async function removeFile(filePath: string) {
  try {
    await db.query('DELETE FROM media_assets WHERE file_path = $1', [filePath]);
    console.log(`✓ Removed from index: ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`Error removing file ${filePath} from index:`, error);
  }
}
