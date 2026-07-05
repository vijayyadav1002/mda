# Media and Document Asset Management System (MDA)

A full-stack file library for media, documents, and general files, built with a modern monorepo architecture using Turborepo.

## Features

- 📁 **File Library Management** - Index and manage all regular non-hidden files under the library path
- 🗓️ **Timeline View** - iOS-Photos-style timeline of photos and videos with Years / Months / Grid / Dense zoom levels (pinch, Ctrl+wheel, or on-screen controls), virtualized scrolling, a year scrubber, and multi-select actions. By default dates come from folder names (`2022-02`, `2022/02`, `2021-12-25`), filename patterns (`IMG_20240115...`), or file modified time; admins can switch the timeline date source to embedded EXIF metadata (camera capture date, with folder-name fallback), file creation time, or file modified time from the timeline's settings menu (the whole library is re-dated in the background)
- 🖼️ **Thumbnail Generation** - On-demand thumbnail generation for images, videos, PDFs, Word, Excel, text, and Markdown files, plus force-regeneration from the timeline
- 📄 **Document Preview** - Preview PDFs, `.docx`, `.xlsx`, `.txt`, and `.md` files inside the app
- ✏️ **Text Editing** - Edit `.txt` and Markdown files in place
- 📋 **Copy and Move** - Move, rename, delete, duplicate, upload, and download files and folders
- 🔒 **Role-Based Access Control** - Admin, Editor, and ReadOnly roles
- 🎨 **Modern UI** - React with Remix Router and shadcn UI components
- 🚀 **Fast Backend** - Fastify server with Mercurius GraphQL
- 🗄️ **PostgreSQL Database** - Reliable data persistence
- 📊 **Directory Tree View** - Render exact filesystem structure
- 🔐 **JWT Authentication** - Secure token-based authentication
- 📝 **Audit Logging** - Track operations such as move, delete, rename, duplicate, and tagging
- 🗜️ **Compression Queue** - Compress images, videos, and PDFs with preview/confirm/cancel flow
- 🎞️ **Transcode Queue** - Batch-transcode selected videos to web-compatible MP4; finished transcodes persist on disk and play instantly (evicted only when the size cap is exceeded, oldest first)
- ⚙️ **In-App Cache Settings** - Admins can adjust per-cache size limits and retention from the Cache panel; changes are stored in the database and applied immediately
- 🏷️ **Tags and Search** - Apply tags, filter by tag, and search files/folders with in-field query syntax: wildcards (`IMG_20*`, `*.mp4`), folder scoping (`vacation/beach`, `in:"summer trip"`), and parameters (`type:video`, `tag:family`, `ext:heic`, `size:>10mb`). Folder matches appear alongside files and persist when switching between the All/Images/Videos tabs
- ⚙️ **Monorepo Structure** - Turborepo for efficient build caching and task orchestration

## Architecture

```
mda/
├── apps/
│   ├── backend/          # Fastify + Mercurius GraphQL API
│   └── web/              # Remix React frontend
├── packages/
│   └── tsconfig/         # Shared TypeScript configurations
├── package.json          # Root workspace configuration
└── turbo.json           # Turborepo configuration
```

## Prerequisites

- Node.js >= 18.0.0
- PostgreSQL >= 13 (if running locally without Docker)
- Redis (if running locally without Docker)
- npm >= 10.9.0
- FFmpeg (for video processing if running locally without Docker)
- Ghostscript (for PDF thumbnails and PDF compression if running locally without Docker)
- libheif tools (for HEIC handling if running locally without Docker)
- Docker & Docker Compose (for full containerized setup)

## Quick Start

### Option A: Run Entire App in Docker (recommended)

```bash
docker compose up --build
```

This starts frontend, backend, PostgreSQL, and Redis in containers.
See [DOCKER.md](./DOCKER.md) for service details, ports, and commands.

Default Docker ports:
- Frontend: http://localhost:3000
- Backend API: http://localhost:4000
- GraphiQL: http://localhost:4000/graphiql
- Caddy HTTPS proxy: https://localhost

### Option B: Run App Locally (without Docker)

1. Install dependencies:

```bash
npm install
```

2. Start infrastructure (PostgreSQL + Redis) via Docker:

```bash
docker compose up -d postgres redis
```

3. Setup backend:

```bash
cd apps/backend
cp .env.example .env
```

Edit `.env` and configure:
- `DATABASE_URL` - Use `postgresql://postgres:postgres@localhost:5433/mda` if using Docker Compose from this repo
- `REDIS_HOST` / `REDIS_PORT` - Use `localhost` / `6379` if using Docker Compose from this repo
- `JWT_SECRET` - Secret key for JWT tokens (change in production!)
- `MEDIA_LIBRARY_PATH` - Path to your file library
- `THUMBNAIL_CACHE_PATH` - Path for thumbnail cache

4. Setup database:

```bash
# Run migrations (from apps/backend)
npm run db:migrate

# Optional: Seed with default admin user (username: admin, password: admin123)
npm run db:seed
```

5. Setup frontend:

```bash
cd apps/web
cp .env.example .env
```

Edit `.env`:
- `VITE_API_URL` - Backend API URL (default: http://localhost:4000)

6. Start development:

From the root directory:

```bash
npm run dev
```

This starts:
- Backend API: http://localhost:4000
- GraphiQL: http://localhost:4000/graphiql
- Frontend: http://localhost:3000

## First Time Setup

When no admin users exist:

1. Visit http://localhost:3000/login
2. Click "First Time Setup"
3. Create your admin account
4. Login and start managing your file library

## GraphQL API

### Authentication Mutations

```graphql
# Login
mutation {
  login(username: "admin", password: "yourpassword") {
    token
    user {
      id
      username
      role
    }
  }
}

# Create first admin (only works if no admins exist)
mutation {
  createFirstAdmin(username: "admin", password: "yourpassword") {
    token
    user {
      id
      username
      role
    }
  }
}
```

### File Queries

```graphql
# Get indexed files
query {
  mediaAssets(limit: 50, offset: 0) {
    id
    fileName
    filePath
    mimeType
    fileSize
    thumbnailUrl
    createdAt
  }
}

# Get directory tree
query {
  directoryTree {
    name
    path
    type
    children {
      name
      type
      mediaAsset {
        id
        fileName
        thumbnailUrl
      }
    }
  }
}

# Timeline: photo/video counts per year, month, or day (with optional covers)
query {
  timelineBuckets(granularity: "month", coverLimit: 4) {
    period
    count
    coverAssets { id thumbnailUrl }
  }
}

# Timeline: assets within a date range
query {
  timelineAssets(from: "2022-02-01", to: "2022-03-01", limit: 200, offset: 0) {
    totalCount
    assets { id fileName capturedAt capturedAtPrecision thumbnailUrl }
  }
}

# Cache settings (admin): read and update runtime cache limits
query { cacheSettings { thumbnailCacheMaxMb transcodedCacheMaxMb } }

mutation {
  updateCacheSettings(input: { thumbnailCacheMaxMb: 500 }) {
    thumbnailCacheMaxMb
  }
}
```

### File Mutations (Admin or Editor)

```graphql
# Move asset
mutation {
  moveMediaAsset(id: "1", newPath: "/new/path/file.jpg") {
    id
    filePath
  }
}

# Rename asset
mutation {
  renameMediaAsset(id: "1", newName: "newname.jpg") {
    id
    fileName
  }
}

# Delete asset
mutation {
  deleteMediaAsset(id: "1")
}

# Duplicate asset to its current folder or a selected destination folder
mutation {
  duplicateMediaAsset(id: "1", destinationFolder: "/library/folder") {
    id
    fileName
    filePath
  }
}

# Duplicate folder
mutation {
  duplicateFolder(path: "/library/folder", destinationFolder: "/library/other-folder") {
    name
    path
  }
}

# Queue compression preview/replace flow for supported files
mutation {
  previewCompressAssets(ids: ["1"], options: { quality: 80, resolution: "original" }) {
    assetId
    originalSize
    compressedSize
    previewUrl
  }
}
```

## REST API

- `POST /api/upload` - Upload arbitrary files to a target folder.
- `GET /download/:id` - Download a file.
- `GET /download-zip?ids=...` - Download multiple files as a ZIP.
- `GET /file-preview/:id/pdf` - Stream a PDF inline.
- `GET /file-preview/:id/content` - Return preview content for `.txt`, `.md`, `.docx`, and `.xlsx`.
- `PUT /file-preview/:id/content` - Save edits to `.txt` and Markdown files in place.
- `GET /video/:id/prepare` and related `/video` endpoints - Prepare web playback and HLS. Prefers a cached transcode when one exists.
- `/api/compress/*` and `/api/queue-state` - Compression preview queue support.
- `POST /api/transcode/enqueue` - Queue selected videos for background transcoding to web-compatible MP4 (shares the queue panel and cancel endpoint with compression jobs).

## Project Structure

### Backend (`apps/backend`)

```
backend/
├── src/
│   ├── db/
│   │   ├── index.ts          # Database connection
│   │   ├── migrate.ts        # Schema migrations
│   │   └── seed.ts           # Database seeding
│   ├── graphql/
│   │   ├── schema.ts         # GraphQL schema
│   │   ├── resolvers.ts      # GraphQL resolvers
│   │   └── context.ts        # Request context builder
│   ├── services/
│   │   ├── auth.ts           # Authentication logic
│   │   ├── audit.ts          # Audit logging
│   │   ├── cache-maintenance.ts  # Size/age eviction + stale DB reference sweeps
│   │   ├── capture-date.ts   # Timeline capture dates (folder name → filename → mtime)
│   │   ├── file-types.ts     # File classification and capabilities
│   │   ├── media-indexer.ts  # Media library indexing
│   │   ├── media-watcher.ts  # Filesystem watcher
│   │   ├── queue.ts          # BullMQ queues and workers (thumbnails, compression, transcode)
│   │   ├── settings.ts       # DB-backed runtime cache settings (env values as defaults)
│   │   ├── tags.ts           # Tag management
│   │   ├── thumbnail.ts      # Thumbnail, document snapshots, compression helpers
│   │   └── video-transcode.ts
│   ├── config.ts             # Configuration
│   └── index.ts              # Application entry point
└── package.json
```

### Frontend (`apps/web`)

```
web/
├── app/
│   ├── components/
│   │   ├── ui/              # shadcn UI components
│   │   ├── MediaAssetViewer.tsx
│   │   ├── CompressDialog.tsx
│   │   ├── CompressQueuePanel.tsx
│   │   ├── SearchBar.tsx
│   │   └── TagDialog.tsx
│   ├── lib/
│   │   ├── api.ts           # GraphQL client
│   │   └── utils.ts         # Utility functions
│   ├── routes/
│   │   ├── _index.tsx       # Home route
│   │   ├── login.tsx        # Login page
│   │   ├── dashboard.tsx    # Main file library dashboard
│   │   ├── timeline.tsx     # Date-based timeline view (zoomable grid + multi-select)
│   │   ├── audit.tsx        # Audit log viewer
│   │   └── users.tsx        # User administration
│   ├── styles/
│   │   └── globals.css      # Global styles
│   └── root.tsx             # Root layout
└── package.json
```

## Development Scripts

```bash
# Run all apps in development mode
npm run dev

# Build all apps
npm run build

# Run migrations
npm run db:migrate

# Seed database
npm run db:seed

# Clean all build artifacts
npm run clean
```

## Production Build

```bash
# Build all packages
npm run build

# Start backend (from apps/backend)
npm start

# Start frontend (from apps/web)
npm start
```

## Environment Variables

### Backend

- `PORT` - Server port (default: 4000)
- `HOST` - Server host (default: 0.0.0.0)
- `DATABASE_URL` - PostgreSQL connection URL
- `REDIS_HOST` / `REDIS_PORT` - Redis connection for BullMQ queues
- `JWT_SECRET` - JWT signing secret
- `MEDIA_LIBRARY_PATH` - Path to library files
- `THUMBNAIL_CACHE_PATH` - Thumbnail cache directory
- `THUMBNAILS_ON_DEMAND` - Generate thumbnails lazily as cards enter the viewport
- `LOW_STORAGE_MODE` - Enables storage-saving defaults
- `THUMBNAIL_SIZE` / `THUMBNAIL_QUALITY` - Thumbnail size and JPEG quality
- `PREVIEW_MAX_DIMENSION` / `PREVIEW_QUALITY` - Preview image size and quality
- `CACHE_CLEANUP_INTERVAL_MINUTES` - Cache cleanup interval
- `*_CACHE_MAX_MB` - Size caps for thumbnail/preview/HLS/transcoded caches
- `PREVIEW_CACHE_MAX_AGE_DAYS` / `HLS_CACHE_MAX_AGE_HOURS` - Age limits for previews and HLS only

Thumbnails and transcoded videos are never expired by age — once generated they stay until their size cap is exceeded, then the oldest files are evicted first. Cache limits set via env are defaults only; admins can override them at runtime from the app (sidebar → Cache → Configure limits), and overrides are persisted in the `app_settings` table.

### Frontend

- `VITE_API_URL` - Backend API URL

## Security Considerations

1. **Change JWT_SECRET** - Use a strong, random secret in production
2. **Use HTTPS** - Always use HTTPS in production
3. **Database Security** - Secure PostgreSQL with strong credentials
4. **File Permissions** - Ensure proper file system permissions for the file library
5. **Rate Limiting** - Consider adding rate limiting for production
6. **CORS** - Configure CORS properly for production domains

## Supported File Types

All regular non-hidden files under `MEDIA_LIBRARY_PATH` can be indexed, uploaded, downloaded, moved, renamed, deleted, tagged, duplicated, and included in ZIP downloads.

### In-App Preview
- Images: JPEG, PNG, HEIC, GIF, WebP, BMP
- Videos: MP4, MOV, AVI, MKV, WebM, M4V
- PDF (`.pdf`)
- Word (`.docx`)
- Excel (`.xlsx`)
- Text (`.txt`)
- Markdown (`.md`, `.markdown`)

### Editable In-App
- Text (`.txt`)
- Markdown (`.md`, `.markdown`)

### Thumbnail Generation
- Images and videos
- PDF first page
- Text and Markdown content snippets
- Word extracted text snippets
- Excel sheet row snippets

### Compression
- Images
- Videos
- PDFs

Legacy `.doc` and `.xls` files are managed as regular files but are not previewed in app.

## Recognized Image and Video Extensions

### Images
- JPEG (.jpg, .jpeg)
- PNG (.png)
- HEIC (.heic)
- GIF (.gif)
- WebP (.webp)
- BMP (.bmp)

### Videos
- MP4 (.mp4)
- MOV (.mov)
- AVI (.avi)
- MKV (.mkv)
- WebM (.webm)
- M4V (.m4v)

## Troubleshooting

### FFmpeg not found
Install FFmpeg for video processing:
- macOS: `brew install ffmpeg`
- Ubuntu: `sudo apt-get install ffmpeg`
- Windows: Download from https://ffmpeg.org/

### Ghostscript not found
Install Ghostscript for PDF thumbnails and PDF compression:
- macOS: `brew install ghostscript`
- Ubuntu: `sudo apt-get install ghostscript`

### Database connection failed
Check PostgreSQL is running and DATABASE_URL is correct.

### Redis connection failed
Check Redis is running and `REDIS_HOST` / `REDIS_PORT` are correct.

### Thumbnails not generating
Ensure `THUMBNAIL_CACHE_PATH` exists and is writable. In low-storage/on-demand mode, thumbnails are generated when file cards enter the viewport or when you use the Generate Thumbnails action.

## License

MIT

## Support

For issues and questions, please open a GitHub issue.
