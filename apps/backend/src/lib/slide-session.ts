const SLIDE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function pathname(url: string): string {
  return url.split('?')[0];
}

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function shouldSlideSession(method: string, url: string): boolean {
  if (!SLIDE_METHODS.has(method.toUpperCase())) return false;
  const path = pathname(url);
  return underPrefix(path, '/api') || underPrefix(path, '/file-preview');
}
