import fs from 'fs/promises';
import path from 'path';
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
    console.log(`Found ${files.length} media files`);

    for (const filePath of files) {
      await indexFile(filePath);
    }

    console.log('Media indexing completed');
  } catch (error) {
    console.error('Error indexing media library:', error);
    throw error;
  }
}

async function scanDirectory(dir: string): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        const subFiles = await scanDirectory(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_FORMATS.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dir}:`, error);
  }
  
  return files;
}

async function indexFile(filePath: string) {
  try {
    // Check if already indexed
    const existing = await db.query(
      'SELECT id FROM media_assets WHERE file_path = $1',
      [filePath]
    );
    
    if (existing.rows.length > 0) {
      return; // Already indexed
    }

    const stats = await fs.stat(filePath);
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();
    
    // Determine mime type
    let mimeType = 'application/octet-stream';
    if (SUPPORTED_IMAGE_FORMATS.includes(ext)) {
      mimeType = `image/${ext.slice(1)}`;
      if (ext === '.jpg') mimeType = 'image/jpeg';
    } else if (SUPPORTED_VIDEO_FORMATS.includes(ext)) {
      mimeType = `video/${ext.slice(1)}`;
    }

    // Generate thumbnail
    const thumbnailPath = await generateThumbnail(filePath);

    // Insert into database
    await db.query(
      `INSERT INTO media_assets 
       (file_path, file_name, file_size, mime_type, thumbnail_path) 
       VALUES ($1, $2, $3, $4, $5)`,
      [filePath, fileName, stats.size, mimeType, thumbnailPath]
    );

    console.log(`Indexed: ${fileName}`);
  } catch (error) {
    console.error(`Error indexing file ${filePath}:`, error);
  }
}

export async function reindexFile(filePath: string) {
  // Remove existing entry
  await db.query('DELETE FROM media_assets WHERE file_path = $1', [filePath]);
  // Reindex
  await indexFile(filePath);
}
