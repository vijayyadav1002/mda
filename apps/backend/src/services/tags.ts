import { db } from '../db/index.js';

export interface TagRow {
  id: number;
  name: string;
  created_at: Date;
}

export interface TagWithCount extends TagRow {
  asset_count: number;
}

const TAG_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function normalizeTagName(input: string): string {
  if (typeof input !== 'string') {
    throw new Error('Tag name must be a string');
  }
  let name = input.trim().toLowerCase();
  if (name.startsWith('#')) name = name.slice(1).trim();
  if (!TAG_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid tag name "${input}". Tags must be 1-64 characters, lowercase letters, digits, "_" or "-", and start with a letter or digit.`
    );
  }
  return name;
}

export async function upsertTag(name: string): Promise<TagRow> {
  const normalized = normalizeTagName(name);
  const result = await db.query(
    `INSERT INTO tags (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [normalized]
  );
  return result.rows[0];
}

export async function attachTags(assetIds: number[], tagIds: number[]): Promise<void> {
  if (assetIds.length === 0 || tagIds.length === 0) return;

  const values: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;
  for (const assetId of assetIds) {
    for (const tagId of tagIds) {
      values.push(`($${paramIdx++}, $${paramIdx++})`);
      params.push(assetId, tagId);
    }
  }

  await db.query(
    `INSERT INTO media_asset_tags (media_asset_id, tag_id) VALUES ${values.join(', ')}
     ON CONFLICT DO NOTHING`,
    params
  );
}

export async function detachTag(assetId: number, tagId: number): Promise<void> {
  await db.query(
    'DELETE FROM media_asset_tags WHERE media_asset_id = $1 AND tag_id = $2',
    [assetId, tagId]
  );
}

/** Remove the given tags from all listed assets. Returns removed link count. */
export async function detachTagsBulk(assetIds: number[], tagNames: string[]): Promise<number> {
  if (assetIds.length === 0 || tagNames.length === 0) return 0;
  const normalized = tagNames.map(normalizeTagName).filter(Boolean);
  if (normalized.length === 0) return 0;

  const result = await db.query(
    `DELETE FROM media_asset_tags
     WHERE media_asset_id = ANY($1::int[])
       AND tag_id IN (SELECT id FROM tags WHERE name = ANY($2))
     RETURNING media_asset_id`,
    [assetIds, normalized]
  );
  return result.rowCount ?? 0;
}

export async function listTags(): Promise<TagWithCount[]> {
  const result = await db.query(
    `SELECT t.id, t.name, t.created_at,
            COUNT(mat.media_asset_id)::int AS asset_count
     FROM tags t
     LEFT JOIN media_asset_tags mat ON mat.tag_id = t.id
     GROUP BY t.id
     ORDER BY t.name`
  );
  return result.rows;
}

export async function getTagByName(name: string): Promise<TagRow | null> {
  const normalized = normalizeTagName(name);
  const result = await db.query('SELECT * FROM tags WHERE name = $1', [normalized]);
  return result.rows[0] ?? null;
}

export async function getTagsForAssets(
  assetIds: number[]
): Promise<Map<number, TagRow[]>> {
  const map = new Map<number, TagRow[]>();
  if (assetIds.length === 0) return map;

  const result = await db.query(
    `SELECT mat.media_asset_id AS asset_id, t.id, t.name, t.created_at
     FROM media_asset_tags mat
     JOIN tags t ON t.id = mat.tag_id
     WHERE mat.media_asset_id = ANY($1::int[])
     ORDER BY t.name`,
    [assetIds]
  );

  for (const row of result.rows) {
    const existing = map.get(row.asset_id);
    const tag: TagRow = { id: row.id, name: row.name, created_at: row.created_at };
    if (existing) {
      existing.push(tag);
    } else {
      map.set(row.asset_id, [tag]);
    }
  }
  return map;
}

export async function getAssetsByTagName(
  name: string,
  limit: number,
  offset: number
): Promise<any[]> {
  const normalized = normalizeTagName(name);
  const result = await db.query(
    `SELECT ma.*
     FROM media_assets ma
     JOIN media_asset_tags mat ON mat.media_asset_id = ma.id
     JOIN tags t ON t.id = mat.tag_id
     WHERE t.name = $1
     ORDER BY ma.created_at DESC
     LIMIT $2 OFFSET $3`,
    [normalized, limit, offset]
  );
  return result.rows;
}

export async function deleteTagByName(name: string): Promise<boolean> {
  const normalized = normalizeTagName(name);
  const result = await db.query('DELETE FROM tags WHERE name = $1', [normalized]);
  return (result.rowCount ?? 0) > 0;
}

export async function renameTag(oldName: string, newName: string): Promise<TagRow> {
  const oldNormalized = normalizeTagName(oldName);
  const newNormalized = normalizeTagName(newName);

  if (oldNormalized === newNormalized) {
    const existing = await getTagByName(oldNormalized);
    if (!existing) throw new Error('Tag not found');
    return existing;
  }

  const conflict = await db.query('SELECT id FROM tags WHERE name = $1', [newNormalized]);
  if (conflict.rows.length > 0) {
    throw new Error(`A tag named "${newNormalized}" already exists`);
  }

  const result = await db.query(
    'UPDATE tags SET name = $1 WHERE name = $2 RETURNING *',
    [newNormalized, oldNormalized]
  );
  if (result.rows.length === 0) throw new Error('Tag not found');
  return result.rows[0];
}
