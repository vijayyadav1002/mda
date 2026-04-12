# Copilot instructions for the MDA repo (proposed updates)

Purpose: concise, action-oriented guidance to help future Copilot sessions understand how to build, run, and reason about this monorepo.

1) Build, test, and lint commands

- Root (monorepo, Turborepo):
  - Install (local/dev):
    - npm install
    - CI reproducible install: npm ci
  - Start all apps in development: npm run dev  # runs `turbo run dev`
  - Build all apps: npm run build  # runs `turbo run build`
  - Lint (across workspace): npm run lint  # runs `turbo run lint`
  - Clean: npm run clean
  - DB migrations (root proxies to workspaces): npm run db:migrate
  - DB seed: npm run db:seed

- Backend (apps/backend):
  - Install: cd apps/backend && npm install
  - Dev: cd apps/backend && npm run dev  # tsx watch src/index.ts
  - Build: cd apps/backend && npm run build  # tsc
  - Start (production): cd apps/backend && npm start
  - Migrate: cd apps/backend && npm run db:migrate
  - Seed: cd apps/backend && npm run db:seed

- Frontend (apps/web):
  - Install: cd apps/web && npm install
  - Dev: cd apps/web && npm run dev  # vite dev
  - Build: cd apps/web && npm run build
  - Start (production): cd apps/web && npm start

- Run a single package script from the repo root:
  - npm --workspace=@mda/backend run dev
  - npm --workspace=@mda/web run dev
  - Or: npx turbo run dev --filter=apps/backend
  - Turbo filter examples:
    - Run dev only for backend (and its deps): npx turbo run dev --filter=apps/backend...
    - Run build only for web: npx turbo run build --filter=apps/web

- Running a single test (if package defines `test`):
  - From package: cd apps/<package> && npm test
  - From root: npm --workspace=@mda/<package> run test

2) High-level architecture (big picture)

- Monorepo managed by Turborepo (root package.json + turbo.json). Key layout:

```
mda/
├── apps/
│   ├── backend/   # Fastify + Mercurius GraphQL API; tsx for dev, tsc for build
│   └── web/       # Remix + Vite frontend
├── packages/      # shared configs (tsconfig, etc.)
├── media-files/   # host media library (mounted into containers)
└── .github/       # workflows, copilot instructions, mcp-servers
```

- Runtime infra: PostgreSQL + Redis (docker-compose). Docker mounts `media-files` into the backend container for processing.
- Backend responsibilities: DB migrations/seeding, media indexing, thumbnail generation, JWT auth, audit logs, FFmpeg/sharp processing.
- Frontend responsibilities: Remix routes, GraphQL client, UI components (shadcn/Radix), PWA support via Caddy (when used in Docker).

3) Key conventions and repo-specific patterns

- Environment:
  - Every app has `.env.example`. Use `cp .env.example .env` and edit values before running.
  - Important env vars: DATABASE_URL, JWT_SECRET, MEDIA_LIBRARY_PATH, THUMBNAIL_CACHE_PATH, VITE_API_URL.
- Media handling:
  - MEDIA_LIBRARY_PATH points to host media root; Docker mounts it to the backend service. Check DOCKER.md for mount path (/data/media in compose).
  - Thumbnail/preview cache controlled by envs: THUMBNAIL_CACHE_PATH, *_CACHE_MAX_AGE_*, *_CACHE_MAX_MB, THUMBNAIL_SIZE.
- DB & migrations:
  - Use `npm run db:migrate` and `npm run db:seed` (package-level or root via turbo). `init-db.sql` is used for Docker initialisation.
- Dev vs build:
  - Backend: `tsx` for dev hot-reload; `tsc` for compiling to dist.
  - Frontend: `vite` + `remix` dev server; `remix vite:build` for production build.
- Workspace tooling:
  - Prefer root `npm run <task>` for workspace-wide tasks. Use `npm --workspace=@mda/<pkg> run <task>` or `npx turbo run <task> --filter=apps/<pkg>` for single-package scope.

4) Files and docs to consult (short pointers)

- README.md (root) — quick start, architecture, GraphQL examples.
- DOCKER.md — docker-compose usage, service roles, mount points, ports.
- apps/backend/README.md — backend-specific env vars, migration and seed commands.
- turbo.json — caching and task orchestration rules.

5) AI-assistant config files (scanned)

- Files normally worth ingesting if present: CLAUDE.md, AGENTS.md, CONVENTIONS.md, AIDER_CONVENTIONS.md, .cursorrules, .windsurfrules, .clinerules, .cline_rules, .cursor/*.
- Current scan result: only `.github/copilot-instructions.md` exists in this repo. If any of the above files are added, incorporate their rules and env notes into this guidance.

6) Suggested improvements (actionable)

- Add explicit `test` scripts to packages that have tests; include example test command in root README.
- Add a short `turbo --filter` example in the canonical copilot-instructions.md (helps quick tasks).
- Add `npm ci` recommendation for CI in README.
- Explicit Node + npm versions (root package.json lists engines and packageManager) — call these out in the instructions.
- Consider adding Playwright or a test runner and an MCP server definition for the web app (useful for E2E).

---

If these proposed edits look good, they can be merged into `.github/copilot-instructions.md` (proposal kept as `.proposed.md` to avoid overwriting).  

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
