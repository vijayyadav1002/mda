const PROTECTED_PREFIXES = [
  '/thumbnails/',
  '/media/',
  '/hls/',
  '/compress-preview/',
  '/file-preview/',
  '/api/',
  '/image/',
  '/video/',
  '/download/',
] as const;

function pathname(url: string): string {
  return url.split('?')[0];
}

export function isPublicPath(url: string): boolean {
  const path = pathname(url);
  return path === '/health' || path === '/health/queues';
}

export function isProtectedMediaPath(url: string): boolean {
  const path = pathname(url);
  if (path === '/download-zip') return true;
  return PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix));
}
