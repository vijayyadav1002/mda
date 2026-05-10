import path from 'node:path';
import { lookup } from 'mime-types';

export type FileCategory = 'image' | 'video' | 'pdf' | 'word' | 'excel' | 'text' | 'markdown' | 'other';

export interface FileClassification {
  category: FileCategory;
  mimeType: string;
  canPreview: boolean;
  canThumbnail: boolean;
  canCompress: boolean;
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp', '.bmp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const WORD_EXTENSIONS = new Set(['.docx']);
const EXCEL_EXTENSIONS = new Set(['.xlsx']);
const TEXT_EXTENSIONS = new Set(['.txt']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

export const SUPPORTED_IMAGE_FORMATS = Array.from(IMAGE_EXTENSIONS);
export const SUPPORTED_VIDEO_FORMATS = Array.from(VIDEO_EXTENSIONS);

const MIME_OVERRIDES: Record<string, string> = {
  '.heic': 'image/heic',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function classifyFile(fileNameOrPath: string, existingMimeType?: string | null): FileClassification {
  const ext = path.extname(fileNameOrPath).toLowerCase();
  const mimeType = MIME_OVERRIDES[ext] || existingMimeType || lookup(fileNameOrPath) || 'application/octet-stream';

  let category: FileCategory = 'other';
  if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith('image/')) category = 'image';
  else if (VIDEO_EXTENSIONS.has(ext) || mimeType.startsWith('video/')) category = 'video';
  else if (PDF_EXTENSIONS.has(ext) || mimeType === 'application/pdf') category = 'pdf';
  else if (WORD_EXTENSIONS.has(ext)) category = 'word';
  else if (EXCEL_EXTENSIONS.has(ext)) category = 'excel';
  else if (MARKDOWN_EXTENSIONS.has(ext)) category = 'markdown';
  else if (TEXT_EXTENSIONS.has(ext) || mimeType.startsWith('text/')) category = 'text';

  return {
    category,
    mimeType,
    canPreview: ['image', 'video', 'pdf', 'word', 'excel', 'text', 'markdown'].includes(category),
    canThumbnail: category === 'image' || category === 'video',
    canCompress: category === 'image' || category === 'video' || category === 'pdf',
  };
}

export function canThumbnailFile(fileNameOrPath: string, existingMimeType?: string | null): boolean {
  return classifyFile(fileNameOrPath, existingMimeType).canThumbnail;
}

export function canCompressFile(fileNameOrPath: string, existingMimeType?: string | null): boolean {
  return classifyFile(fileNameOrPath, existingMimeType).canCompress;
}
