/* ── Search term parsing ─────────────────────────────────────────
 * Supports in-field operators and patterns:
 *   type:image | type:video      media type (overrides the UI tab)
 *   in:<folder> / folder:<name>  scope to files under matching folders
 *   tag:<name>                   filter by tag
 *   ext:jpg                      filter by file extension
 *   size:>10mb | size:<500kb     size bounds (b/kb/mb/gb)
 *   dir/name                     slash syntax: folder part + file part
 *   * and ?                      wildcards in any name pattern
 * Values with spaces can be quoted: in:"summer trip"
 */

export type ParsedSearch = {
  nameTerm: string | null;
  dirTerms: string[];
  type: 'image' | 'video' | null;
  tag: string | null;
  ext: string | null;
  minSize: number | null;
  maxSize: number | null;
};

const SIZE_UNIT_BYTES: Record<string, number> = {
  b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3
};

export const parseSizeExpr = (value: string): { bytes: number; bound: 'min' | 'max' } | null => {
  const match = /^(>=|<=|>|<)?\s*([\d.]+)\s*(b|kb?|mb?|gb?)?$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number.parseFloat(match[2]);
  if (!Number.isFinite(amount)) return null;
  const unit = (match[3] ?? 'b').toLowerCase();
  const bytes = Math.floor(amount * (SIZE_UNIT_BYTES[unit] ?? 1));
  const bound = (match[1] ?? '>').startsWith('<') ? 'max' : 'min';
  return { bytes, bound };
};

export const parseSearchTerm = (raw: string): ParsedSearch => {
  const parsed: ParsedSearch = {
    nameTerm: null, dirTerms: [], type: null, tag: null, ext: null, minSize: null, maxSize: null
  };

  const rest = raw.replace(/(\w+):(?:"([^"]*)"|(\S+))/g, (full, key: string, quoted: string | undefined, bare: string | undefined) => {
    const value = (quoted ?? bare ?? '').trim();
    if (!value) return '';
    switch (key.toLowerCase()) {
      case 'type': {
        const v = value.toLowerCase();
        if (['image', 'img', 'photo', 'photos', 'images'].includes(v)) parsed.type = 'image';
        else if (['video', 'vid', 'videos', 'movie'].includes(v)) parsed.type = 'video';
        return '';
      }
      case 'in':
      case 'folder':
        parsed.dirTerms.push(value);
        return '';
      case 'tag':
        parsed.tag = value.toLowerCase();
        return '';
      case 'ext':
        parsed.ext = value.replace(/^\./, '').toLowerCase();
        return '';
      case 'size': {
        const size = parseSizeExpr(value);
        if (size) {
          if (size.bound === 'min') parsed.minSize = size.bytes;
          else parsed.maxSize = size.bytes;
        }
        return '';
      }
      default:
        return full; // unknown key — treat as literal text
    }
  });

  let text = rest.trim().replace(/\s+/g, ' ');

  // Slash syntax: "vacation/beach" → folder pattern + file pattern; "vacation/" → all files inside
  if (text.includes('/')) {
    const idx = text.lastIndexOf('/');
    const dirPart = text.slice(0, idx).trim();
    const namePart = text.slice(idx + 1).trim();
    if (dirPart) parsed.dirTerms.push(...dirPart.split('/').map((s) => s.trim()).filter(Boolean));
    text = namePart;
  }

  parsed.nameTerm = text.length > 0 ? text : null;
  return parsed;
};

/** Convert a user pattern (supports * and ?) to an ILIKE pattern. Without
 * wildcards the match is "contains"; with wildcards the pattern is used
 * as written (so "*.jpg" anchors to the end, "IMG*" to the start). */
export const toLikePattern = (term: string): string => {
  const escaped = term
    .replace(/[\\%_]/g, (ch) => `\\${ch}`)
    .replace(/\*/g, '%')
    .replace(/\?/g, '_');
  return /[*?]/.test(term) ? escaped : `%${escaped}%`;
};

/** ILIKE pattern requiring the term to appear in a folder component of a path. */
export const toDirLikePattern = (dirTerm: string): string => {
  const core = dirTerm
    .replace(/[\\%_]/g, (ch) => `\\${ch}`)
    .replace(/\*/g, '%')
    .replace(/\?/g, '_');
  return `%${core}%/%`;
};

/** Wildcard-aware folder-name matcher for filesystem folder search. */
export const buildNameMatcher = (terms: string[]): ((name: string) => boolean) => {
  const testers = terms.map((term) => {
    if (/[*?]/.test(term)) {
      const source = term
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      const regex = new RegExp(`^${source}$`, 'i');
      return (name: string) => regex.test(name);
    }
    const needle = term.toLowerCase();
    return (name: string) => name.toLowerCase().includes(needle);
  });
  return (name: string) => testers.some((test) => test(name));
};
