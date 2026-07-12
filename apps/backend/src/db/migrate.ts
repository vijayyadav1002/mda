import { db } from './index.js';
import fs from 'fs/promises';
import path from 'path';

const SQL_SCHEMA = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'readonly')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Media assets table
CREATE TABLE IF NOT EXISTS media_assets (
  id SERIAL PRIMARY KEY,
  file_path TEXT UNIQUE NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  width INTEGER,
  height INTEGER,
  duration NUMERIC,
  thumbnail_path TEXT,
  transcoded_path TEXT,
  indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add transcoded_path column if it doesn't exist (for existing databases)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'media_assets' AND column_name = 'transcoded_path'
  ) THEN
    ALTER TABLE media_assets ADD COLUMN transcoded_path TEXT;
  END IF;
END $$;

-- Add capture date columns if they don't exist (for existing databases)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'media_assets' AND column_name = 'captured_at'
  ) THEN
    ALTER TABLE media_assets ADD COLUMN captured_at TIMESTAMP;
    ALTER TABLE media_assets ADD COLUMN captured_at_precision VARCHAR(10);
    ALTER TABLE media_assets ADD COLUMN captured_at_source VARCHAR(20);
  END IF;
END $$;

-- App settings table (key/value overrides for runtime configuration)
CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trash bin: soft-deleted files/folders awaiting restore or purge
CREATE TABLE IF NOT EXISTS trash_items (
  id SERIAL PRIMARY KEY,
  original_path TEXT NOT NULL,
  trash_path TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT,
  mime_type VARCHAR(100),
  item_type VARCHAR(10) NOT NULL CHECK (item_type IN ('file', 'folder')),
  deleted_by INTEGER REFERENCES users(id),
  deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id INTEGER,
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tags table (global, shared, normalized to lowercase)
CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(64) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Junction table linking media assets to tags
CREATE TABLE IF NOT EXISTS media_asset_tags (
  media_asset_id INTEGER REFERENCES media_assets(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (media_asset_id, tag_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_media_assets_file_path ON media_assets(file_path);
CREATE INDEX IF NOT EXISTS idx_media_assets_mime_type ON media_assets(mime_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_media_asset_tags_tag ON media_asset_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_captured_at ON media_assets(captured_at DESC NULLS LAST);
`;

export async function migrate() {
  try {
    console.log('Running database migrations...');
    await db.query(SQL_SCHEMA);
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Run migrations if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => {
      console.log('Done');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
