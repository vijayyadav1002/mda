import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../../config.js';

type HeicJpegOptions =
  | { kind: 'cover'; width: number; height: number; quality?: number }
  | { kind: 'inside'; maxWidth: number; maxHeight: number; quality?: number };

const execFileAsync = promisify(execFile);

const heicDecodeMode = (process.env.HEIC_DECODE_MODE || 'auto').toLowerCase();
export const shouldPreferExternalHeic =
  heicDecodeMode === 'external' ||
  (heicDecodeMode === 'auto' && process.platform === 'linux' && process.arch.startsWith('arm'));

export async function decodeHeicToRgba(inputPath: string): Promise<{ data: Buffer; width: number; height: number }> {
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
