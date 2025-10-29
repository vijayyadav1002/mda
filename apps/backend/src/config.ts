import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/mda',
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-this',
  mediaLibraryPath: process.env.MEDIA_LIBRARY_PATH || './media',
  thumbnailCachePath: process.env.THUMBNAIL_CACHE_PATH || './cache/thumbnails'
};
