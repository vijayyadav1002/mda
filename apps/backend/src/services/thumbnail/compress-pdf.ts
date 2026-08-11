import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AdvancedCompressOptions } from './compress-image.js';

const execFileAsync = promisify(execFile);

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
