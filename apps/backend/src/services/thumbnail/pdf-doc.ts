import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../../config.js';
import { classifyFile } from '../file-types.js';
import type { ThumbnailGenerationOptions } from './index.js';

export const DOCUMENT_THUMBNAIL_FORMATS = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.xlsx'];

const execFileAsync = promisify(execFile);

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapText(input: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  const normalized = input.replace(/\r\n/g, '\n').replace(/\t/g, '  ');
  for (const rawLine of normalized.split('\n')) {
    const words = rawLine.trimEnd().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
    } else {
      let current = '';
      for (const word of words) {
        if (!current) {
          current = word;
        } else if ((current.length + word.length + 1) <= maxChars) {
          current += ` ${word}`;
        } else {
          lines.push(current);
          current = word;
        }
        while (current.length > maxChars) {
          lines.push(current.slice(0, maxChars));
          current = current.slice(maxChars);
        }
        if (lines.length >= maxLines) return lines;
      }
      if (current) lines.push(current);
    }
    if (lines.length >= maxLines) return lines;
  }
  return lines.slice(0, maxLines);
}

async function readTextSnippet(inputPath: string, maxBytes = 12_000): Promise<string> {
  const handle = await fs.open(inputPath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function extractDocumentSnippet(inputPath: string): Promise<{ title: string; body: string }> {
  const classification = classifyFile(inputPath);
  const title = path.basename(inputPath);

  if (classification.category === 'text' || classification.category === 'markdown') {
    return { title, body: await readTextSnippet(inputPath) };
  }

  if (classification.category === 'word') {
    const mammoth = await import('mammoth');
    const extracted = await mammoth.extractRawText({ path: inputPath });
    return { title, body: extracted.value };
  }

  if (classification.category === 'excel') {
    // Thumbnail generation runs unattended (triggered by the media watcher on
    // any file drop), and exceljs's non-streaming reader parses the whole
    // file into memory -- so cap how large a spreadsheet we're willing to
    // fully parse just for a 12-row snippet. Files over this are skipped and
    // fall back to the generic "no previewable text" placeholder.
    const MAX_EXCEL_SNIPPET_BYTES = 25 * 1024 * 1024;
    const stat = await fs.stat(inputPath);
    if (stat.size > MAX_EXCEL_SNIPPET_BYTES) {
      return { title, body: '' };
    }
    const { readExcelPreview } = await import('../excel.js');
    const sheets = await readExcelPreview(inputPath, { maxSheets: 3, maxRows: 12, maxCols: 6 });
    const sheetText = sheets.map(({ name, rows }) => `${name}\n${rows.map((row) => row.join('    ')).join('\n')}`).join('\n\n');
    return { title, body: sheetText };
  }

  return { title, body: '' };
}

async function generateTextSnapshotThumbnail(inputPath: string, outputPath: string): Promise<void> {
  const { title, body } = await extractDocumentSnippet(inputPath);
  const size = config.thumbnailSize;
  const lines = wrapText(body || 'No previewable text found in this file.', 48, 17);
  const titleLines = wrapText(title, 34, 2);
  const lineHeight = 22;
  const bodyStartY = 104;
  const textNodes = lines.map((line, index) => (
    `<text x="48" y="${bodyStartY + index * lineHeight}" class="body">${escapeXml(line || ' ')}</text>`
  )).join('');
  const titleNodes = titleLines.map((line, index) => (
    `<text x="48" y="${54 + index * 24}" class="title">${escapeXml(line)}</text>`
  )).join('');

  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" fill="#f8fafc"/>
      <rect x="28" y="24" width="456" height="464" rx="20" fill="#ffffff" stroke="#d9e2ec" stroke-width="2"/>
      <rect x="28" y="24" width="456" height="76" rx="20" fill="#eef6ff"/>
      <rect x="28" y="78" width="456" height="22" fill="#eef6ff"/>
      <style>
        .title { font: 700 20px Arial, sans-serif; fill: #102a43; }
        .body { font: 400 15px "Menlo", "Consolas", monospace; fill: #334e68; }
      </style>
      ${titleNodes}
      ${textNodes}
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .resize(size, size, { fit: 'cover' })
    .jpeg({ quality: config.thumbnailQuality })
    .toFile(outputPath);
}

async function generatePdfThumbnail(inputPath: string, outputPath: string, options?: ThumbnailGenerationOptions): Promise<void> {
  if (options?.signal?.aborted) return;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mda-pdf-thumb-'));
  const tempJpeg = path.join(tempDir, 'page.jpg');
  try {
    await execFileAsync('gs', [
      '-dSAFER',
      '-dBATCH',
      '-dNOPAUSE',
      '-dFirstPage=1',
      '-dLastPage=1',
      '-sDEVICE=jpeg',
      '-r120',
      `-sOutputFile=${tempJpeg}`,
      inputPath,
    ]);
    if (options?.signal?.aborted) return;
    await sharp(tempJpeg)
      .resize(config.thumbnailSize, config.thumbnailSize, { fit: 'cover', position: 'top' })
      .jpeg({ quality: config.thumbnailQuality })
      .toFile(outputPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function generateDocumentThumbnail(
  inputPath: string,
  outputPath: string,
  options?: ThumbnailGenerationOptions
): Promise<void> {
  const classification = classifyFile(inputPath);
  if (classification.category === 'pdf') {
    await generatePdfThumbnail(inputPath, outputPath, options);
    return;
  }
  await generateTextSnapshotThumbnail(inputPath, outputPath);
}
