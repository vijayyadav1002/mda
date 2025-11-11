# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Overview

Monorepo with two Node.js apps and one shared package:
- apps/backend — Fastify + GraphQL API server with on‑disk media indexing, thumbnailing, and on‑demand video transcoding backed by PostgreSQL.
- apps/web — React app using Remix (via Vite) as the frontend for browsing and managing media.
- packages/tsconfig — Shared TypeScript configs consumed by both apps.

Core dependencies and services:
- Node.js ≥ 18
- PostgreSQL ≥ 13
- FFmpeg (required for thumbnailing and transcoding)

## Setup and common commands

Install dependencies per app (or use workspace root):
- Workspace root (recommended)
  - npm install
- Backend only
  - cd apps/backend && npm install
- Web only
  - cd apps/web && npm install

Environment files:
- Backend: cp apps/backend/.env.example apps/backend/.env and set DATABASE_URL, JWT_SECRET, MEDIA_LIBRARY_PATH, THUMBNAIL_CACHE_PATH, PORT, HOST
- Web: cp apps/web/.env.example apps/web/.env and set VITE_API_URL (default http://localhost:4000)

Run commonly used tasks:
- Root (Turbo)
  - Build all: turbo run build
  - Dev (per package): turbo run dev --filter=@mda/backend | turbo run dev --filter=@mda/web
  - Type‑check all: turbo run typecheck
  - Lint all: turbo run lint
  - Test all: turbo run test
- Backend (apps/backend)
  - Development server (auto‑reload): npm run dev
  - Build TypeScript: npm run build
  - Start built server: npm start
  - Run DB migrations: npm run db:migrate
  - Seed default admin: npm run db:seed
  - Clean build artifacts: npm run clean
  - Type‑check: npm run typecheck
  - Lint: npm run lint
- Web (apps/web)
  - Development server (Vite @ :3000): npm run dev
  - Build: npm run build
  - Preview production build: npm start
  - Clean build artifacts: npm run clean
  - Type‑check: npm run typecheck
  - Lint: npm run lint
  - Tests: npm test | npm run test:watch | npm run test:ui
  - Run a single test: npm run test -- -t "cn merges"

Notes
- Start backend first (default :4000), then start web (default :3000). GraphiQL is available at http://localhost:4000/graphiql in non‑production environments.

## Environment

Backend .env (apps/backend/.env):
- DATABASE_URL: PostgreSQL connection string
- JWT_SECRET: secret used by @fastify/jwt
- PORT, HOST: Fastify listen target (defaults 4000/0.0.0.0)
- MEDIA_LIBRARY_PATH: absolute path to your media files on disk
- THUMBNAIL_CACHE_PATH: directory for generated thumbnails

Web .env (apps/web/.env):
- VITE_API_URL: backend origin (e.g. http://localhost:4000)

Important: The frontend builds original media URLs using the backend’s static /media prefix and derives a relative file path by splitting the absolute file system path on the segment “/media-files/”. Ensure MEDIA_LIBRARY_PATH contains a “media-files” segment (e.g., /…/media-files/…) or adjust the frontend logic if you change this convention.

## Architecture and flow

Backend (apps/backend)
- Server: Fastify with plugins cors, jwt, multipart, static. Serves:
  - /thumbnails/* from THUMBNAIL_CACHE_PATH
  - /media/* from MEDIA_LIBRARY_PATH with range support and cache headers
  - /health for basic status
- GraphQL (mercurius):
  - Schema: Users, MediaAsset, AuditLog, DirectoryNode
  - Queries: me, users (admin), mediaAssets/mediaAsset, directoryTree, auditLogs (admin)
  - Mutations: login, createFirstAdmin, createUser/deleteUser (admin), move/rename/deleteMediaAsset (admin), compressMediaAsset
  - Context: JWT is verified per request; resolvers enforce auth/roles
- Media indexing and watching:
  - On startup, indexMediaLibrary scans MEDIA_LIBRARY_PATH, filters supported image/video formats, generates thumbnails (sharp/ffmpeg), and persists rows in media_assets.
  - startMediaWatcher (chokidar) watches for add/change/unlink and updates the DB and thumbnails accordingly.
- Video streaming and transcoding:
  - GET /video/:id streams video with HTTP range support. If the source isn’t web‑compatible, it is transcoded on demand (H.264/MP4) into a cache directory adjacent to THUMBNAIL_CACHE_PATH and then streamed.
  - DELETE /video/:id/cleanup removes a transcoded artifact for that asset (the frontend calls this when closing the viewer). A background sweeper also deletes transcoded files after inactivity.
- Database:
  - migrate.ts creates tables users, media_assets, audit_logs (with helpful indexes) and ensures columns exist across upgrades.
  - seed.ts inserts a default admin (username: admin, password: admin123) if no users exist. Change this immediately in non‑dev setups.
- Configuration: src/config.ts reads environment with dotenv and centralizes values.

Frontend (apps/web)
- Build/runtime: Remix via Vite with tsconfig path mapping (~/* → app/*), Tailwind CSS, and shadcn UI components.
- Auth: login page executes GraphQL login or createFirstAdmin mutations; JWT token is stored in localStorage as auth_token and attached to subsequent GraphQL requests.
- Data access: graphql-request client created with VITE_API_URL; queries list media assets and directory tree, and call mutations for destructive actions.
- UI behavior:
  - Dashboard lists media with thumbnails served from backend /thumbnails.
  - MediaAssetViewer renders images using the original file via /media/<relative-path> and plays videos via /video/:id (triggering on‑demand transcoding when required). When the viewer closes for a video, it calls the backend cleanup endpoint.

## Repository structure (high level)
- apps/backend — Fastify server, GraphQL schema/resolvers, DB access (pg), media services (indexing, watcher, thumbnails, transcoding)
- apps/web — Remix + Vite frontend, routes for login and dashboard, UI components, GraphQL client
- packages/tsconfig — shared TypeScript configurations (base, node, react)

## Quickstart
- Terminal 1
  - cd apps/backend && npm run dev
  - Open http://localhost:4000/graphiql to run createFirstAdmin if no admin exists
- Terminal 2
  - cd apps/web && npm run dev
  - Open http://localhost:3000 and log in; set VITE_API_URL to the backend URL if different
