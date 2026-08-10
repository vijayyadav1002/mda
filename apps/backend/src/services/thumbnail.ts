import sharp, { type Sharp } from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { classifyFile } from './file-types.js';

const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp', '.bmp'];
const SUPPORTED_VIDEO_FORMATS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
const DOCUMENT_THUMBNAIL_FORMATS = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.xlsx'];

type HeicJpegOptions =
  | { kind: 'cover'; width: number; height: number; quality?: number }
  | { kind: 'inside'; maxWidth: number; maxHeight: number; quality?: number };

const execFileAsync = promisify(execFile);

const heicDecodeMode = (process.env.HEIC_DECODE_MODE || 'auto').toLowerCase();
const shouldPreferExternalHeic =
  heicDecodeMode === 'external' ||
  (heicDecodeMode === 'auto' && process.platform === 'linux' && process.arch.startsWith('arm'));

async function decodeHeicToRgba(inputPath: string): Promise<{ data: Buffer; width: number; height: number }> {
  // @ts-ignore - libheif-js has no types.
  const libheif = (await import('libheif-js')).default;
  const file = await fs.readFile(inputPath);

  // @ts-ignore
  const decoder = new libheif.HeifDecoder();
  // @ts-ignore
  const decoded = decoder.decode(file);

  if (!decoded || decoded.length === 0) {
    throw new Error('HEIC decode returned no images');
  }

  const image = decoded[0];
  const width = image.get_width();
  const height = image.get_height();

  const displayData = await new Promise<{ data: Uint8ClampedArray; width: number; height: number }>((resolve, reject) => {
    const rgba = new Uint8ClampedArray(width * height * 4);
    image.display({ data: rgba, width, height }, (result: any) => {
      if (!result) return reject(new Error('HEIC display returned null'));
      resolve(result);
    });
  });

  return { data: Buffer.from(displayData.data), width: displayData.width, height: displayData.height };
}

export async function renderHeicToJpeg(inputPath: string, outputPath: string, options: HeicJpegOptions): Promise<void> {
  if (shouldPreferExternalHeic) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mda-heic-'));
    const tempJpeg = path.join(tempDir, 'source.jpg');
    try {
      await execFileAsync('heif-convert', [inputPath, tempJpeg]);
      const pipeline = sharp(tempJpeg).rotate();

      if (options.kind === 'cover') {
        await pipeline
          .resize(options.width, options.height, { fit: 'cover', position: 'center' })
          .jpeg({ quality: options.quality ?? config.thumbnailQuality })
          .toFile(outputPath);
        return;
      }

      await pipeline
        .resize(options.maxWidth, options.maxHeight, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: options.quality ?? config.previewQuality })
        .toFile(outputPath);
      return;
    } catch (error) {
      if (heicDecodeMode === 'external') {
        throw error;
      }
      // Fall back to libheif-js when auto mode is enabled.
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const decoded = await decodeHeicToRgba(inputPath);

  const pipeline = sharp(decoded.data, {
    raw: {
      width: decoded.width,
      height: decoded.height,
      channels: 4
    }
  });

  if (options.kind === 'cover') {
    await pipeline
      .resize(options.width, options.height, { fit: 'cover', position: 'center' })
      .jpeg({ quality: options.quality ?? config.thumbnailQuality })
      .toFile(outputPath);
    return;
  }

  await pipeline
    .resize(options.maxWidth, options.maxHeight, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: options.quality ?? config.previewQuality })
    .toFile(outputPath);
}

export interface ThumbnailGenerationOptions {
  signal?: AbortSignal;
}

export async function generateThumbnail(
  filePath: string,
  options?: ThumbnailGenerationOptions
): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();
  const hash = crypto.createHash('md5').update(filePath).digest('hex');
  const thumbnailFileName = `${hash}.jpg`;
  const thumbnailPath = path.join(config.thumbnailCachePath, thumbnailFileName);

  // Check if thumbnail already exists
  try {
    const st = await fs.stat(thumbnailPath);
    if (st.size > 0) return thumbnailPath;
    await fs.unlink(thumbnailPath).catch(() => undefined);
  } catch {
    // Thumbnail doesn't exist, generate it
  }

  if (options?.signal?.aborted) return null;

  if (SUPPORTED_IMAGE_FORMATS.includes(ext)) {
    await generateImageThumbnail(filePath, thumbnailPath);
  } else if (SUPPORTED_VIDEO_FORMATS.includes(ext)) {
    await generateVideoThumbnail(filePath, thumbnailPath, options);
  } else if (DOCUMENT_THUMBNAIL_FORMATS.includes(ext)) {
    await generateDocumentThumbnail(filePath, thumbnailPath, options);
  } else {
    return null;
  }

  if (options?.signal?.aborted) {
    await fs.unlink(thumbnailPath).catch(() => undefined);
    return null;
  }

  try {
    const st = await fs.stat(thumbnailPath);
    if (st.size > 0) return thumbnailPath;
    // Clean up empty/corrupt outputs so future attempts can retry.
    await fs.unlink(thumbnailPath).catch(() => undefined);
    return null;
  } catch {
    return null;
  }
}

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
    const { readExcelPreview } = await import('./excel.js');
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

async function generateDocumentThumbnail(
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

async function generateImageThumbnail(inputPath: string, outputPath: string) {
  const ext = path.extname(inputPath).toLowerCase();

  // Fast path: let sharp handle the decode if it supports it.
  try {
    await sharp(inputPath)
      .rotate() // honor EXIF orientation where present
      .resize(config.thumbnailSize, config.thumbnailSize, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: config.thumbnailQuality })
      .toFile(outputPath);
    return;
  } catch (error: any) {
    if (ext !== '.heic') {
      console.error(`Error generating image thumbnail for ${inputPath}:`, error);
      throw error;
    }

    // Fallback: decode HEIC via libheif-js and re-encode with sharp.
    try {
      await renderHeicToJpeg(inputPath, outputPath, {
        kind: 'cover',
        width: config.thumbnailSize,
        height: config.thumbnailSize,
        quality: config.thumbnailQuality
      });
      return;
    } catch (fallbackError: any) {
      console.warn(`Skipping HEIC thumbnail generation for ${inputPath}: ${fallbackError?.message ?? String(fallbackError)}`);
      return; // Avoid worker retries; the asset can still be indexed.
    }
  }
}

async function generateVideoThumbnail(
  inputPath: string,
  outputPath: string,
  options?: ThumbnailGenerationOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new Error('Thumbnail generation cancelled'));
      return;
    }

    let cancelled = false;
    const cmd = ffmpeg(inputPath)
      .screenshots({
        count: 1,
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: `${config.thumbnailSize}x${config.thumbnailSize}`
      });

    const onAbort = () => {
      cancelled = true;
      try { cmd.kill('SIGKILL'); } catch { /* ignore */ }
    };
    options?.signal?.addEventListener('abort', onAbort, { once: true });

    cmd
      .on('end', () => {
        options?.signal?.removeEventListener('abort', onAbort);
        resolve();
      })
      .on('error', (err) => {
        options?.signal?.removeEventListener('abort', onAbort);
        if (cancelled) {
          reject(new Error('Thumbnail generation cancelled'));
        } else {
          console.error(`Error generating video thumbnail for ${inputPath}:`, err);
          reject(err);
        }
      });
  });
}

export async function compressImage(inputPath: string, outputPath: string, quality: number = 80) {
  await sharp(inputPath)
    .jpeg({ quality })
    .toFile(outputPath);
}

export async function compressVideo(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .output(outputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .output(outputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

export async function generateAndSaveThumbnail(
  filePath: string,
  assetId: string,
  options?: ThumbnailGenerationOptions
) {
  try {
    const thumbnailPath = await generateThumbnail(filePath, options);
    if (options?.signal?.aborted) return;
    if (thumbnailPath) {
      await db.query('UPDATE media_assets SET thumbnail_path = $1, updated_at = NOW() WHERE id = $2', [thumbnailPath, assetId]);
      console.log(`✓ Updated thumbnail for asset ${assetId}`);
    }
  } catch (error) {
    if (options?.signal?.aborted) return; // Cancellation is expected — don't log as failure.
    console.error(`Failed to generate/save thumbnail for ${filePath}:`, error);
  }
}

export interface AdvancedCompressOptions {
  resolution?: string; // e.g. "1920x1080", "1280x720", "original"
  quality?: number;    // 1-100 for images; maps to CRF for videos
}

/**
 * Compress an image with resolution and quality options.
 * Preserves original format (HEIC outputs as JPEG).
 */
export async function compressImageAdvanced(
  inputPath: string,
  outputPath: string,
  options: AdvancedCompressOptions
): Promise<void> {
  const ext = path.extname(inputPath).toLowerCase();
  const quality = options.quality ?? 80;

  let pipeline: Sharp;

  // HEIC needs special decoding
  if (ext === '.heic') {
    if (shouldPreferExternalHeic) {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mda-compress-'));
      const tempJpeg = path.join(tempDir, 'source.jpg');
      try {
        await execFileAsync('heif-convert', [inputPath, tempJpeg]);
        pipeline = sharp(tempJpeg).rotate();
      } catch {
        const decoded = await decodeHeicToRgba(inputPath);
        pipeline = sharp(decoded.data, {
          raw: { width: decoded.width, height: decoded.height, channels: 4 }
        });
      }
    } else {
      const decoded = await decodeHeicToRgba(inputPath);
      pipeline = sharp(decoded.data, {
        raw: { width: decoded.width, height: decoded.height, channels: 4 }
      });
    }
  } else {
    pipeline = sharp(inputPath).rotate();
  }

  // Apply resolution resize
  if (options.resolution && options.resolution !== 'original') {
    const [w, h] = options.resolution.split('x').map(Number);
    if (w && h) {
      pipeline = pipeline.resize(w, h, { fit: 'inside', withoutEnlargement: true });
    }
  }

  // Output in the closest matching format
  const outExt = path.extname(outputPath).toLowerCase();
  if (outExt === '.png') {
    await pipeline.png({ quality }).toFile(outputPath);
  } else if (outExt === '.webp') {
    await pipeline.webp({ quality }).toFile(outputPath);
  } else {
    // Default to JPEG for jpg, jpeg, heic, bmp, gif, and anything else
    await pipeline.jpeg({ quality }).toFile(outputPath);
  }
}

/**
 * Compress a video with resolution and CRF options.
 * Preserves the original container format. Audio is copied (no re-encode).
 */
export async function compressVideoAdvanced(
  inputPath: string,
  outputPath: string,
  options: AdvancedCompressOptions & { onProgress?: (percent: number) => void; signal?: AbortSignal }
): Promise<void> {
  // Map quality (1-100) to CRF (51-0). Higher quality = lower CRF.
  const quality = options.quality ?? 70;
  const crf = Math.round(51 - (quality / 100) * 51);

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('Compression cancelled'));
      return;
    }

    const cmd = ffmpeg(inputPath);

    const outputOptions: string[] = [
      '-c:v libx264',
      `-crf ${crf}`,
      '-preset medium',
      '-c:a copy',
      '-movflags +faststart',
      '-pix_fmt yuv420p'
    ];

    // Apply resolution scaling if specified
    if (options.resolution && options.resolution !== 'original') {
      const [w, h] = options.resolution.split('x').map(Number);
      if (w && h) {
        // Scale to fit within WxH while maintaining aspect ratio; ensure even dimensions
        outputOptions.push(`-vf scale='min(${w},iw)':min'(${h},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`);
      }
    }

    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      try { cmd.kill('SIGKILL'); } catch { /* ignore */ }
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    cmd
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('progress', (progress) => {
        if (options.onProgress && progress.percent != null) {
          options.onProgress(Math.min(Math.round(progress.percent), 100));
        }
      })
      .on('end', () => {
        options.signal?.removeEventListener('abort', onAbort);
        resolve();
      })
      .on('error', (err) => {
        options.signal?.removeEventListener('abort', onAbort);
        if (cancelled) {
          reject(new Error('Compression cancelled'));
        } else {
          reject(err);
        }
      })
      .run();
  });
}

function pdfPresetForQuality(quality: number | undefined): '/screen' | '/ebook' | '/printer' | '/prepress' {
  const bounded = Math.max(10, Math.min(100, quality ?? 70));
  if (bounded <= 40) return '/screen';
  if (bounded <= 70) return '/ebook';
  if (bounded <= 90) return '/printer';
  return '/prepress';
}

export async function compressPdfAdvanced(
  inputPath: string,
  outputPath: string,
  options: AdvancedCompressOptions & { signal?: AbortSignal }
): Promise<void> {
  await execFileAsync('gs', [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    `-dPDFSETTINGS=${pdfPresetForQuality(options.quality)}`,
    '-dNOPAUSE',
    '-dQUIET',
    '-dBATCH',
    `-sOutputFile=${outputPath}`,
    inputPath,
  ], { signal: options.signal });
}
