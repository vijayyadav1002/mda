import path from 'node:path';
import exifr from 'exifr';
import ffmpeg from 'fluent-ffmpeg';

const EXIF_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.heic', '.heif', '.png', '.tiff', '.tif', '.avif', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);

const isSaneDate = (d: unknown): d is Date =>
  d instanceof Date &&
  !Number.isNaN(d.getTime()) &&
  d.getFullYear() >= 1971 &&
  d.getFullYear() <= new Date().getFullYear() + 1;

/**
 * Read the capture date embedded in the file itself: EXIF DateTimeOriginal /
 * CreateDate for images (via exifr), container creation_time for videos
 * (via ffprobe). Returns null when the file carries no usable metadata.
 */
export async function extractEmbeddedDate(filePath: string): Promise<Date | null> {
  const ext = path.extname(filePath).toLowerCase();

  if (EXIF_IMAGE_EXTENSIONS.has(ext)) {
    try {
      const parsed = await exifr.parse(filePath, { pick: ['DateTimeOriginal', 'CreateDate'] });
      const candidate = parsed?.DateTimeOriginal ?? parsed?.CreateDate;
      if (isSaneDate(candidate)) return candidate;
    } catch {
      // Corrupt/unsupported metadata — treat as absent.
    }
    return null;
  }

  if (VIDEO_EXTENSIONS.has(ext)) {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return resolve(null);
        const raw = metadata?.format?.tags?.creation_time;
        if (typeof raw !== 'string') return resolve(null);
        const parsed = new Date(raw);
        resolve(isSaneDate(parsed) ? parsed : null);
      });
    });
  }

  return null;
}
