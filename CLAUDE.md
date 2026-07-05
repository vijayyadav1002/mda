# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Root (monorepo via Turborepo)
```bash
npm install          # install all workspace deps
npm run dev          # start all apps in dev mode
npm run build        # build all apps
npm run lint         # root script exists, but package lint scripts are not currently wired up
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
- Services: `media-indexer`, `thumbnail` (sharp + libheif-js + FFmpeg), `video-transcode`, `queue` (BullMQ: thumbnails, compression, batch transcode), `auth` (bcrypt + JWT), `audit`, `media-watcher` (chokidar), `cache-maintenance`, `capture-date` (timeline dates from folder/filename/mtime), `settings` (DB-backed cache settings)
- DB: raw `pg` client; migrations in `src/db/migrate.ts`

### Frontend flow
- Remix file-based routing under `app/routes/`
- GraphQL client: `graphql-request` configured in `app/lib/api.ts`
- Main route: `dashboard.tsx` (media browser, ~50KB); `timeline.tsx` (zoomable date-based timeline with multi-select)
- Auth route: `login.tsx`; admin routes: `users.tsx`, `audit.tsx`
- UI: Tailwind CSS + shadcn components in `app/components/ui/`

## Key Conventions

**Environment setup**: every app has `.env.example`. Copy and edit before running. Critical vars: `DATABASE_URL`, `JWT_SECRET`, `MEDIA_LIBRARY_PATH`, `THUMBNAIL_CACHE_PATH`, `VITE_API_URL`.

**Media handling**: `MEDIA_LIBRARY_PATH` points to host media root. In Docker it mounts to `/data/media`. Thumbnail/preview cache is controlled by `*_CACHE_MAX_MB`, `PREVIEW_CACHE_MAX_AGE_DAYS`, `HLS_CACHE_MAX_AGE_HOURS`, `THUMBNAIL_SIZE`, `THUMBNAILS_ON_DEMAND`, and `LOW_STORAGE_MODE` env vars. Thumbnails and transcoded videos have no age-based expiry — size-cap eviction only, oldest first. Env values are defaults; admins override cache limits at runtime via the `app_settings` table (`services/settings.ts`, `updateCacheSettings` mutation). Cache eviction also clears stale `thumbnail_path`/`transcoded_path` DB references.

**DB migrations**: `init-db.sql` is used only for Docker initialization. For development, use `npm run db:migrate`.

**TypeScript**: Backend uses ESNext modules (`type: "module"` in package.json); frontend uses Vite ESM. Path alias `~/*` → `./app/*` in the web app.

**Turbo caching**: `build` is cached; `dev`, `db:migrate`, `db:seed`, and `clean` are not cached (see `turbo.json`).

## Docs to Consult

- `README.md` — quick start, supported media formats, GraphQL examples
- `DOCKER.md` — docker-compose usage, service roles, mount points, ports
- `apps/backend/README.md` — backend env vars, migration/seed details
- `.github/mcp-servers/PLAYWRIGHT.md` — Playwright MCP server usage

## Verification

Current baseline verification is `npm run build` from the repository root.

Notes:
- There are no package-level `lint` or `test` scripts currently wired up. Do not claim lint/tests passed unless you add or run an actual script.
- For backend changes, prefer the narrowest meaningful check first, usually `npm --workspace=@mda/backend run build`.
- For frontend changes, prefer `npm --workspace=@mda/web run build`.
- For GraphQL, auth, filesystem, media processing, migrations, queues, or cache behavior, verify with a focused runtime check when practical, not just TypeScript compilation.

## Behavioral Guidelines

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State assumptions explicitly when they affect behavior or scope.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear and a reasonable repo-local assumption would be risky, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions that YOUR changes made unused; leave pre-existing dead code alone.

Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → write tests for invalid inputs, then make them pass
- "Fix the bug" → write a test that reproduces it, then make it pass
- "Refactor X" → ensure tests pass before and after

For multi-step tasks, state a brief plan with a verify step for each item before starting.

## Repo-Specific Guardrails

- Treat `media-files/` as user data. Do not modify, delete, reorganize, or generate files there unless explicitly asked.
- Do not casually rewrite migrations or Docker mount paths. Check `DOCKER.md`, `init-db.sql`, and backend DB code first.
- Keep `init-db.sql` and runtime migrations conceptually separate: Docker initialization uses `init-db.sql`; development migration flow uses `npm run db:migrate`.
- Be careful with generated media derivatives and caches. Prefer changing cache policy/configuration over deleting cache contents unless the user asks.
- Preserve the existing raw `pg` data-access style unless the task explicitly calls for introducing an ORM or query builder.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current when the tool is available. If it is unavailable or fails for environment reasons, mention that in the final response.
