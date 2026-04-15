# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Root (monorepo via Turborepo)
```bash
npm install          # install all workspace deps
npm run dev          # start all apps in dev mode
npm run build        # build all apps
npm run lint         # lint across workspace
npm run clean        # clean build artifacts
npm run db:migrate   # run database migrations
npm run db:seed      # seed the database
```

### Single-package scope
```bash
npm --workspace=@mda/backend run dev
npm --workspace=@mda/web run dev
npx turbo run dev --filter=apps/backend
npx turbo run build --filter=apps/web
```

### Backend (apps/backend)
```bash
npm run dev    # tsx watch src/index.ts (hot-reload)
npm run build  # tsc → dist/
npm start      # production
npm run db:migrate
npm run db:seed
```

### Frontend (apps/web)
```bash
npm run dev    # vite + remix dev server (port 3000)
npm run build  # remix vite:build
npm start      # production
```

## Architecture

Turborepo monorepo with two apps and shared TypeScript configs:

```
mda/
├── apps/
│   ├── backend/   # Fastify + Mercurius GraphQL (ESM, tsx dev / tsc prod)
│   └── web/       # Remix + Vite frontend (React 18, shadcn/Radix UI)
├── packages/
│   └── tsconfig/  # Shared TS configs (base, node, react)
├── media-files/   # Host media library (Docker-mounted at /data/media)
└── infra/         # Caddy reverse proxy config
```

**Runtime infrastructure** (Docker Compose): PostgreSQL 16, Redis, Caddy (HTTPS proxy).

### Backend flow
- Entry: `src/index.ts` (Fastify server, port 4000)
- GraphQL: `src/graphql/schema.ts` + `src/graphql/resolvers.ts` via Mercurius
- Services: `media-indexer`, `thumbnail` (sharp + libheif-js + FFmpeg), `video-transcode`, `queue` (BullMQ), `auth` (bcrypt + JWT), `audit`, `media-watcher` (chokidar), `cache-maintenance`
- DB: raw `pg` client; migrations in `src/db/migrate.ts`

### Frontend flow
- Remix file-based routing under `app/routes/`
- GraphQL client: `graphql-request` configured in `app/lib/api.ts`
- Main route: `dashboard.tsx` (media browser, ~50KB)
- Auth route: `login.tsx`; admin route: `users.tsx`
- UI: Tailwind CSS + shadcn components in `app/components/ui/`

## Key Conventions

**Environment setup**: every app has `.env.example`. Copy and edit before running. Critical vars: `DATABASE_URL`, `JWT_SECRET`, `MEDIA_LIBRARY_PATH`, `THUMBNAIL_CACHE_PATH`, `VITE_API_URL`.

**Media handling**: `MEDIA_LIBRARY_PATH` points to host media root. In Docker it mounts to `/data/media`. Thumbnail/preview cache is controlled by `*_CACHE_MAX_AGE_*`, `*_CACHE_MAX_MB`, `THUMBNAIL_SIZE`, `THUMBNAILS_ON_DEMAND`, and `LOW_STORAGE_MODE` env vars.

**DB migrations**: `init-db.sql` is used only for Docker initialization. For development, use `npm run db:migrate`.

**TypeScript**: Backend uses ESNext modules (`type: "module"` in package.json); frontend uses Vite ESM. Path alias `~/*` → `./app/*` in the web app.

**Turbo caching**: `build` is cached; `dev`, `db:migrate`, `db:seed`, and `clean` are not cached (see `turbo.json`).

## Docs to Consult

- `README.md` — quick start, supported media formats, GraphQL examples
- `DOCKER.md` — docker-compose usage, service roles, mount points, ports
- `apps/backend/README.md` — backend env vars, migration/seed details
- `.github/mcp-servers/PLAYWRIGHT.md` — Playwright MCP server usage

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
