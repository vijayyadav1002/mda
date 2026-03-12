# Copilot instructions for the MDA repo

This file provides focused guidance to Copilot sessions operating in this repository. Keep entries concise and actionable.

1) Build, test, and lint commands

- Root (monorepo, Turborepo):
  - Install: npm install
  - Start all apps in development: npm run dev  # runs turbo run dev
  - Build all apps: npm run build  # runs turbo run build
  - Lint (across workspace): npm run lint  # runs turbo run lint
  - Run DB migrations (root forwards to workspaces): npm run db:migrate
  - Seed DB: npm run db:seed

- Backend (apps/backend):
  - Dev: cd apps/backend && npm run dev  # tsx watch src/index.ts
  - Build: cd apps/backend && npm run build  # tsc
  - Start (production): cd apps/backend && npm start
  - Migrate: cd apps/backend && npm run db:migrate
  - Seed: cd apps/backend && npm run db:seed

- Frontend (apps/web):
  - Dev: cd apps/web && npm run dev  # vite dev
  - Build: cd apps/web && npm run build
  - Start (production): cd apps/web && npm start

- Docker (full-stack):
  - docker compose up --build  # starts frontend, backend, postgres, redis, caddy
  - docker compose up -d postgres redis  # infrastructure only

- Notes about tests: This repository does not define a top-level or package-level "test" script. If tests are added to a package, run a single package test with:
  - cd apps/<package> && npm test
  - or from root: npm --workspace=@scope/<package> run test

2) High-level architecture (big picture)

- Monorepo managed by Turborepo. Top-level layout:
  - apps/backend  # Fastify + Mercurius GraphQL API
  - apps/web      # Remix React frontend using Vite
  - packages/     # shared configs (e.g. tsconfig)
- Root package.json defines workspace scripts that invoke "turbo run <task>".
- Backend responsibilities: DB migrations/seeding, media indexing, thumbnail generation, JWT auth, audit logs, media processing (FFmpeg, sharp, libheif-js).
- Frontend responsibilities: Remix routes, GraphQL client, UI components (shadcn, Radix), serves client and PWA assets.
- Runtime infra: PostgreSQL and Redis (docker-compose), optional Caddy reverse proxy for HTTPS and PWA support. Docker mounts media-files into container; migrations may run on app startup.

3) Key conventions and repo-specific patterns

- Scripts are often orchestrated through turbo; prefer running root npm scripts for multi-package tasks (dev, build, lint, db:migrate).
- Per-package dev loop:
  - Backend uses tsx for local dev (hot reload), tsc for build.
  - Frontend uses vite and remix dev servers.
- Environment configuration: each app provides a .env.example. Use cp .env.example .env inside the package before running locally.
- Media handling:
  - MEDIA_LIBRARY_PATH points to host media root; in Docker this is mounted to /data/media.
  - Thumbnail cache paths and size/TTL settings are controlled by env vars (THUMBNAIL_CACHE_PATH, *_CACHE_MAX_AGE_*, *_CACHE_MAX_MB).
- DB and migrations:
  - Use npm run db:migrate and npm run db:seed at the package level (backend) or via root turbo scripts.
  - init-db.sql is used by docker-compose to initialize PostgreSQL on first start.
- GraphQL:
  - Backend exposes /graphql and /graphiql (dev). Schema and resolvers live under apps/backend/src/graphql.
- Deploy & Docker:
  - docker compose up --build is the recommended local/full-stack entry point; Caddy provides TLS and PWA-friendly HTTPS.
- Workspaces:
  - Use npm workspaces and turbo for cross-package tasks. To run a script in one package from root use npm --workspace=<pkg> run <script>.

4) Files and docs to consult (short pointers)

- README.md (root) — quick start, architecture, GraphQL examples.
- apps/backend/README.md — backend-specific env vars, dev/prod scripts, migration/seed steps.
- DOCKER.md — docker-compose usage, TLS cert extraction, volumes and service roles.
- turbo.json — task orchestration and caching behavior.

5) AI-assistant config

- No existing .github/copilot-instructions.md or other AI assistant config files were present when this file was created. If CLAUDE.md, AGENTS.md, or other assistant config files are added, incorporate: important environment notes, package-level scripts, and Docker caveats here.

Summary

- Use this file to guide Copilot assistant sessions: preferred commands, where to run them, repository layout, and conventions for env/migrations/media handling.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
