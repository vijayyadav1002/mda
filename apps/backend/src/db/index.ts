import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const db = new Pool({
  connectionString: config.databaseUrl
});

// Type definitions for database models
export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'readonly';
  created_at: Date;
}

export interface MediaAsset {
  id: number;
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  width?: number;
  height?: number;
  duration?: number;
  thumbnail_path?: string;
  indexed_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface AuditLog {
  id: number;
  user_id: number;
  action: string;
  resource_type: string;
  resource_id?: number;
  details?: any;
  created_at: Date;
}
