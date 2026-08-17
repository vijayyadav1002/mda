import path from 'node:path';
import { config } from '../../config.js';

export type CapturePrecision = 'day' | 'month' | 'year';
export type CaptureSource = 'folder' | 'filename' | 'mtime' | 'btime' | 'exif';

export type CaptureDate = {
  capturedAt: Date;
  precision: CapturePrecision;
  source: CaptureSource;
};

const isValidYear = (year: number) => year >= 1970 && year <= new Date().getFullYear() + 1;

const isValidDate = (year: number, month: number, day: number) => {
  if (!isValidYear(year) || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
};

// Matches YYYY-MM-DD, YYYY_MM_DD, YYYY.MM.DD (optionally followed by more text)
const FOLDER_DAY_RE = /^((?:19|20)\d{2})[-_.](0[1-9]|1[0-2])[-_.](0[1-9]|[12]\d|3[01])(?:\D|$)/;
// Matches YYYY-MM, YYYY_MM, YYYY.MM, "YYYY MM" (optionally followed by more text, e.g. "2022-02 Trip")
const FOLDER_MONTH_RE = /^((?:19|20)\d{2})[-_. ](0[1-9]|1[0-2])(?:\D|$)/;
// Matches a bare year folder like "2022"
const FOLDER_YEAR_RE = /^((?:19|20)\d{2})$/;
// Bare month folder like "02" or "11" (used when the parent folder is a bare year)
const FOLDER_BARE_MONTH_RE = /^(0[1-9]|1[0-2])$/;
// Filename patterns: IMG_20220215, PXL_20220215_..., VID-20220215-WA0001, 20220215_123456, 2022-02-15 ...
const FILENAME_DAY_RE = /(?:^|\D)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:\D|$)/;

/**
 * Derive a capture date from the folder path segments (relative to the media
 * library root), scanning from the deepest folder upward. Supports:
 *   .../2022-02-15/   -> day precision
 *   .../2022-02/      -> month precision
 *   .../2022/02/      -> month precision
 *   .../2022/         -> year precision
 */
export function parseCaptureDateFromFolder(filePath: string): CaptureDate | null {
  const root = path.resolve(config.mediaLibraryPath);
  const dir = path.dirname(path.resolve(filePath));
  if (!dir.startsWith(root)) return null;

  const segments = dir.slice(root.length).split(path.sep).filter(Boolean);

  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];

    const dayMatch = FOLDER_DAY_RE.exec(segment);
    if (dayMatch) {
      const [, y, m, d] = dayMatch;
      if (isValidDate(+y, +m, +d)) {
        return { capturedAt: new Date(+y, +m - 1, +d), precision: 'day', source: 'folder' };
      }
    }

    const monthMatch = FOLDER_MONTH_RE.exec(segment);
    if (monthMatch) {
      const [, y, m] = monthMatch;
      if (isValidYear(+y)) {
        return { capturedAt: new Date(+y, +m - 1, 1), precision: 'month', source: 'folder' };
      }
    }

    // "02" folder nested under a "2022" folder
    const bareMonthMatch = FOLDER_BARE_MONTH_RE.exec(segment);
    if (bareMonthMatch && i > 0) {
      const parentYear = FOLDER_YEAR_RE.exec(segments[i - 1]);
      if (parentYear && isValidYear(+parentYear[1])) {
        return {
          capturedAt: new Date(+parentYear[1], +bareMonthMatch[1] - 1, 1),
          precision: 'month',
          source: 'folder'
        };
      }
    }

    const yearMatch = FOLDER_YEAR_RE.exec(segment);
    if (yearMatch && isValidYear(+yearMatch[1])) {
      return { capturedAt: new Date(+yearMatch[1], 0, 1), precision: 'year', source: 'folder' };
    }
  }

  return null;
}

export function parseCaptureDateFromFilename(fileName: string): CaptureDate | null {
  const match = FILENAME_DAY_RE.exec(fileName);
  if (!match) return null;
  const [, y, m, d] = match;
  if (!isValidDate(+y, +m, +d)) return null;
  return { capturedAt: new Date(+y, +m - 1, +d), precision: 'day', source: 'filename' };
}
