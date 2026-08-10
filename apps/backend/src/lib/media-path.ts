import path from 'node:path';

const NUMERIC_ID = /^[1-9]\d*$/;

/** media_assets.id is a Postgres SERIAL — only positive integers are valid. */
export function isValidAssetId(id: string): boolean {
  return NUMERIC_ID.test(id);
}

/**
 * Resolves `candidate` and confirms it stays within `root` using path.relative,
 * which CodeQL's js/path-injection query recognizes as a sanitizing barrier
 * (a bare `startsWith` prefix check does not).
 */
export function resolveWithinRoot(root: string, candidate: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))) return null;
  return resolvedCandidate;
}

/** Joins segments onto root and throws if the result would escape root. */
export function joinWithinRoot(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const joined = path.join(resolvedRoot, ...segments);
  const rel = path.relative(resolvedRoot, joined);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes allowed root');
  }
  return joined;
}
