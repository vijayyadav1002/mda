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

/** Soft cap for text preview / clipboard copy (~2 MB). */
export const MAX_TEXT_CONTENT_BYTES = 2 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp', '.bmp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const WORD_EXTENSIONS = new Set(['.docx']);
const EXCEL_EXTENSIONS = new Set(['.xlsx']);
/** Plain-text and common code/config extensions treated as text-like. */
export const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.json',
  '.xml',
  '.csv',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.yaml',
  '.yml',
  '.html',
  '.htm',
  '.css',
]);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

/**
 * Explicit application/* MIME types that are safe to treat as UTF-8 text
 * for preview and clipboard copy (in addition to text/*).
 */
export const TEXT_LIKE_APPLICATION_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-yaml',
  'application/yaml',
]);

export const SUPPORTED_IMAGE_FORMATS = Array.from(IMAGE_EXTENSIONS);
export const SUPPORTED_VIDEO_FORMATS = Array.from(VIDEO_EXTENSIONS);

const MIME_OVERRIDES: Record<string, string> = {
  '.heic': 'image/heic',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.jsx': 'application/javascript',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function isTextLikeMime(mimeType: string): boolean {
  if (!mimeType) return false;
  if (mimeType.startsWith('text/')) return true;
  if (mimeType === 'text/markdown') return true;
  return TEXT_LIKE_APPLICATION_MIMES.has(mimeType);
}

/** True when the asset may be previewed / copied as UTF-8 text (not binary). */
export function isTextLikeFile(classification: FileClassification): boolean {
  if (classification.category === 'text' || classification.category === 'markdown') return true;
  return isTextLikeMime(classification.mimeType);
}

/** Reject buffers that contain NUL bytes (almost certainly binary). */
export function looksLikeBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

export function classifyFile(fileNameOrPath: string, existingMimeType?: string | null): FileClassification {
  const ext = path.extname(fileNameOrPath).toLowerCase();
  const mimeType = MIME_OVERRIDES[ext] || existingMimeType || lookup(fileNameOrPath) || 'application/octet-stream';

  let category: FileCategory = 'other';
  if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith('image/')) category = 'image';
  else if (VIDEO_EXTENSIONS.has(ext) || mimeType.startsWith('video/')) category = 'video';
  else if (PDF_EXTENSIONS.has(ext) || mimeType === 'application/pdf') category = 'pdf';
  else if (WORD_EXTENSIONS.has(ext)) category = 'word';
  else if (EXCEL_EXTENSIONS.has(ext)) category = 'excel';
  else if (MARKDOWN_EXTENSIONS.has(ext) || mimeType === 'text/markdown') category = 'markdown';
  else if (
    TEXT_EXTENSIONS.has(ext) ||
    mimeType.startsWith('text/') ||
    TEXT_LIKE_APPLICATION_MIMES.has(mimeType)
  ) {
    category = 'text';
  }

  return {
    category,
    mimeType,
    canPreview: ['image', 'video', 'pdf', 'word', 'excel', 'text', 'markdown'].includes(category),
    canThumbnail: ['image', 'video', 'pdf', 'word', 'excel', 'text', 'markdown'].includes(category),
    canCompress: category === 'image' || category === 'video' || category === 'pdf',
  };
}

export function canThumbnailFile(fileNameOrPath: string, existingMimeType?: string | null): boolean {
  return classifyFile(fileNameOrPath, existingMimeType).canThumbnail;
}

export function canCompressFile(fileNameOrPath: string, existingMimeType?: string | null): boolean {
  return classifyFile(fileNameOrPath, existingMimeType).canCompress;
}
