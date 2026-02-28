# Media Asset Management System (MDA)

A full-stack media asset management system built with a modern monorepo architecture using Turborepo.

## Features

- 📁 **Media Library Management** - Index and manage .heic, .jpeg, .png, .mp4, and other common media formats
- 🖼️ **Thumbnail Generation** - Automatic thumbnail generation and caching for quick previews
- 🔒 **Role-Based Access Control** - Admin (full access) and ReadOnly (view-only) roles
- 🎨 **Modern UI** - React with Remix Router and shadcn UI components
- 🚀 **Fast Backend** - Fastify server with Mercurius GraphQL
- 🗄️ **PostgreSQL Database** - Reliable data persistence
- 📊 **Directory Tree View** - Render exact filesystem structure
- 🔐 **JWT Authentication** - Secure token-based authentication
- 📝 **Audit Logging** - Track all operations (move, delete, rename)
- 🗜️ **Media Compression** - Compress images and videos with quality control
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
- npm >= 10.9.0
- FFmpeg (for video processing if running locally without Docker)
- Docker & Docker Compose (for full containerized setup)

## Quick Start

### Option A: Run Entire App in Docker (recommended)

```bash
docker compose up --build
```

This starts frontend, backend, PostgreSQL, and Redis in containers.
See [DOCKER.md](./DOCKER.md) for service details, ports, and commands.

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
- `JWT_SECRET` - Secret key for JWT tokens (change in production!)
- `MEDIA_LIBRARY_PATH` - Path to your media library
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
4. Login and start managing your media library

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

### Media Queries

```graphql
# Get media assets
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
```

### Media Mutations (Admin Only)

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

# Compress asset
mutation {
  compressMediaAsset(id: "1", quality: 80, overwrite: false) {
    id
    fileSize
  }
}
```

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
│   │   ├── media-indexer.ts  # Media library indexing
│   │   └── thumbnail.ts      # Thumbnail generation
│   ├── config.ts             # Configuration
│   └── index.ts              # Application entry point
└── package.json
```

### Frontend (`apps/web`)

```
web/
├── app/
│   ├── components/
│   │   └── ui/              # shadcn UI components
│   ├── lib/
│   │   ├── api.ts           # GraphQL client
│   │   └── utils.ts         # Utility functions
│   ├── routes/
│   │   ├── _index.tsx       # Home route
│   │   ├── login.tsx        # Login page
│   │   └── dashboard.tsx    # Main dashboard
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
- `JWT_SECRET` - JWT signing secret
- `MEDIA_LIBRARY_PATH` - Path to media files
- `THUMBNAIL_CACHE_PATH` - Thumbnail cache directory
- `LOW_STORAGE_MODE` - Enables storage-saving defaults
- `THUMBNAIL_SIZE` / `THUMBNAIL_QUALITY` - Thumbnail size and JPEG quality
- `PREVIEW_MAX_DIMENSION` / `PREVIEW_QUALITY` - HEIC preview size and quality
- `CACHE_CLEANUP_INTERVAL_MINUTES` - Cache cleanup interval
- `*_CACHE_MAX_AGE_*` / `*_CACHE_MAX_MB` - TTL and size caps for thumbnail/preview/HLS/transcoded caches

### Frontend

- `VITE_API_URL` - Backend API URL

## Security Considerations

1. **Change JWT_SECRET** - Use a strong, random secret in production
2. **Use HTTPS** - Always use HTTPS in production
3. **Database Security** - Secure PostgreSQL with strong credentials
4. **File Permissions** - Ensure proper file system permissions for media library
5. **Rate Limiting** - Consider adding rate limiting for production
6. **CORS** - Configure CORS properly for production domains

## Supported Media Formats

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

### Database connection failed
Check PostgreSQL is running and DATABASE_URL is correct.

### Thumbnails not generating
Ensure THUMBNAIL_CACHE_PATH directory exists and is writable.

## License

MIT

## Support

For issues and questions, please open a GitHub issue.
