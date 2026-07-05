# Backend Setup

## Prerequisites

- Node.js >= 18
- PostgreSQL >= 13
- FFmpeg (for video processing)

## Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env`:
```
DATABASE_URL=postgresql://user:password@localhost:5432/mda
JWT_SECRET=your-secret-key-change-this-in-production
PORT=4000
HOST=0.0.0.0
MEDIA_LIBRARY_PATH=/path/to/your/media/library
THUMBNAIL_CACHE_PATH=./cache/thumbnails
LOW_STORAGE_MODE=true
THUMBNAILS_ON_DEMAND=true
```

3. Run database migrations:
```bash
npm run db:migrate
```

4. (Optional) Seed database with default admin:
```bash
npm run db:seed
```

This creates:
- Username: `admin`
- Password: `admin123`
- ⚠️ **Change this immediately in production!**

## Development

Start development server:
```bash
npm run dev
```

The server will be available at:
- API: http://localhost:4000
- GraphiQL: http://localhost:4000/graphiql

## Production

Build for production:
```bash
npm run build
```

Start production server:
```bash
npm start
```

## API Endpoints

### REST Endpoints

- `GET /health` - Health check
- `GET /thumbnails/:filename` - Serve cached thumbnails
- `GET /video/:id/prepare` - Playback negotiation (prefers a cached transcode, then direct MP4, then HLS)
- `POST /api/compress/enqueue` / `POST /api/compress/cancel` - Compression queue
- `POST /api/transcode/enqueue` - Batch video transcode queue (jobs appear in the same per-user queue)
- `GET/PUT /api/queue-state` - Per-user job queue state

### GraphQL Endpoint

- `POST /graphql` - GraphQL API
- `GET /graphiql` - GraphiQL interface (dev only)

## Database Schema

### Users
- `id` - Primary key
- `username` - Unique username
- `password_hash` - Bcrypt hashed password
- `role` - 'admin' or 'readonly'
- `created_at` - Account creation timestamp

### Media Assets
- `id` - Primary key
- `file_path` - Full path to media file
- `file_name` - File name
- `file_size` - File size in bytes
- `mime_type` - MIME type
- `width` - Image/video width (optional)
- `height` - Image/video height (optional)
- `duration` - Video duration in seconds (optional)
- `thumbnail_path` - Path to thumbnail
- `transcoded_path` - Path to cached web-compatible MP4 (set by transcode jobs)
- `captured_at` - Capture date used by the timeline view
- `captured_at_precision` - `day`, `month`, or `year`
- `captured_at_source` - `folder`, `filename`, or `mtime`
- `indexed_at` - When file was indexed
- `created_at` - Record creation timestamp
- `updated_at` - Last update timestamp

Capture dates are derived at index time with folder names taking priority
(`2022-02`, `2022/02`, `2021-12-25`), then filename patterns
(`IMG_20240115_093000`), then file modified time. They are recomputed on
move/rename and backfilled on startup for previously indexed assets.

### App Settings
- `key` - Setting key (e.g. `cache_settings`)
- `value` - JSONB value (runtime overrides for cache limits, editable from the app by admins)
- `updated_at` - Last update timestamp

### Audit Logs
- `id` - Primary key
- `user_id` - User who performed action
- `action` - Action type (LOGIN, MOVE_ASSET, DELETE_ASSET, etc.)
- `resource_type` - Type of resource affected
- `resource_id` - ID of affected resource
- `details` - JSON details about the action
- `created_at` - Timestamp

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/mda` |
| `JWT_SECRET` | Secret for JWT signing | `your-secret-key-change-this` |
| `PORT` | Server port | `4000` |
| `HOST` | Server host | `0.0.0.0` |
| `MEDIA_LIBRARY_PATH` | Path to media files | `./media` |
| `THUMBNAIL_CACHE_PATH` | Thumbnail cache directory | `./cache/thumbnails` |
| `LOW_STORAGE_MODE` | Uses storage-saving defaults for cache/quality | `true` |
| `THUMBNAILS_ON_DEMAND` | Queue thumbnails only for browsed files (when true) | `true` (low mode) |
| `THUMBNAIL_SIZE` | Thumbnail width/height in pixels | `240` (low mode) |
| `THUMBNAIL_QUALITY` | JPEG quality for thumbnails | `65` (low mode) |
| `PREVIEW_MAX_DIMENSION` | Max width/height for HEIC previews | `1280` (low mode) |
| `PREVIEW_QUALITY` | JPEG quality for HEIC previews | `70` (low mode) |
| `HEIC_DECODE_MODE` | `auto` (default), `external` (use `heif-convert`), `libheif-js` (force wasm) | `auto` |
| `CACHE_CLEANUP_INTERVAL_MINUTES` | Background cleanup interval | `30` (low mode) |
| `PREVIEW_CACHE_MAX_AGE_DAYS` | Preview retention window | `7` (low mode) |
| `HLS_CACHE_MAX_AGE_HOURS` | HLS retention window | `24` (low mode) |
| `THUMBNAIL_CACHE_MAX_MB` | Max thumbnail cache size | `250` (low mode) |
| `PREVIEW_CACHE_MAX_MB` | Max preview cache size | `150` (low mode) |
| `HLS_CACHE_MAX_MB` | Max HLS cache size | `500` (low mode) |
| `TRANSCODED_CACHE_MAX_MB` | Max transcoded cache size | `250` (low mode) |

Notes:
- When `THUMBNAILS_ON_DEMAND=true`, initial indexing and filesystem watchers skip thumbnail queueing. Thumbnails are queued when a directory is browsed in the app (or a timeline section scrolls into view).
- Thumbnails and transcoded videos have no age-based retention: once generated they are kept until their cache exceeds the size cap, then evicted oldest-first. When cache eviction removes files, the corresponding database references are cleared automatically.
- Cache limits from env are defaults only. Admins can override them at runtime from the app (Cache panel → Configure limits); overrides live in the `app_settings` table and take precedence.

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run db:migrate` - Run database migrations
- `npm run db:seed` - Seed database with default data
- `npm run clean` - Remove build artifacts
