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
- `indexed_at` - When file was indexed
- `created_at` - Record creation timestamp
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
| `THUMBNAIL_SIZE` | Thumbnail width/height in pixels | `240` (low mode) |
| `THUMBNAIL_QUALITY` | JPEG quality for thumbnails | `65` (low mode) |
| `PREVIEW_MAX_DIMENSION` | Max width/height for HEIC previews | `1280` (low mode) |
| `PREVIEW_QUALITY` | JPEG quality for HEIC previews | `70` (low mode) |
| `CACHE_CLEANUP_INTERVAL_MINUTES` | Background cleanup interval | `30` (low mode) |
| `THUMBNAIL_CACHE_MAX_AGE_DAYS` | Thumbnail retention window | `30` (low mode) |
| `PREVIEW_CACHE_MAX_AGE_DAYS` | Preview retention window | `7` (low mode) |
| `HLS_CACHE_MAX_AGE_HOURS` | HLS retention window | `24` (low mode) |
| `TRANSCODED_CACHE_MAX_AGE_HOURS` | Transcoded retention window | `2` (low mode) |
| `THUMBNAIL_CACHE_MAX_MB` | Max thumbnail cache size | `250` (low mode) |
| `PREVIEW_CACHE_MAX_MB` | Max preview cache size | `150` (low mode) |
| `HLS_CACHE_MAX_MB` | Max HLS cache size | `500` (low mode) |
| `TRANSCODED_CACHE_MAX_MB` | Max transcoded cache size | `250` (low mode) |

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run db:migrate` - Run database migrations
- `npm run db:seed` - Seed database with default data
- `npm run clean` - Remove build artifacts
