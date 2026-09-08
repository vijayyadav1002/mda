# MDA Hardening Program Design

Date: 2026-09-08
Status: draft, pending user review
Scope: one sequenced program, three phases (tests/CI → cookie session + media auth → non-blocking startup)
Depends on: current Fastify + Mercurius + React Router tree; does not replace the stack

## 1. Executive summary

MDA is a LAN/homelab media library (often Raspberry Pi + Caddy). The product surface is already large. This program does not add features. It makes the app safer and easier to change:

1. Add a real test + CI gate (`node:test`, GitHub Actions, `npm test`).
2. Move the JWT from `localStorage` into an HttpOnly cookie, require that cookie (or `Authorization: Bearer`) on media and file bytes, and slide the session to 30 days of activity.
3. Listen before the initial library index finishes so login and the API work while a large scan runs.

Everyone must sign in once after phase 2. Old `localStorage` tokens are ignored.

## 2. Goals

- Unauthenticated requests for originals, thumbnails, HLS, previews, downloads, and images fail with 401.
- A used session lasts 30 days (sliding). An idle session dies after 30 days.
- GraphQL `Unauthorized` or REST 401 sends the SPA to `/login` and clears the non-secret signed-in flag.
- `npm run dev` and `docker compose` keep working. Dev is same-origin via a Vite proxy; production is already same-origin via Caddy.
- CI is red if `npm run build` or `npm test` fails.
- The HTTP server accepts connections before `indexMediaLibrary()` completes. `/health` reports whether that scan is running or failed.
- README Node version matches `package.json` `engines` (`>=24.0.0`).

## 3. Non-goals

- ORM or query-builder introduction
- Redis/opaque server-side sessions or refresh-token rotation
- Public-internet threat model (open CORS, CDN, WAF)
- Splitting `dashboard.tsx` / `MediaAssetViewer.tsx`
- Search `pg_trgm` / Postgres FTS
- PWA cache expansion beyond the existing shell + `offline.html`
- Seed password policy (`admin` / `admin123`)
- Remaining CodeQL work except `joinWithinRoot` on `media-path.ts` (phase 1, because tests will cover it)
- Dashboard “indexing…” banner
- Frontend component tests, Playwright in CI, Docker-in-CI
- Wiring root `lint` (still no package lint scripts)

## 4. Constraints

- LAN / homelab only. Same-origin cookies are enough; no OAuth, no CSRF tokens beyond `SameSite=Lax`.
- Preserve raw `pg`. Do not change Docker mount paths, `init-db.sql`, or `media-files/`.
- Baseline verification stays `npm run build`. After phase 1, `npm test` is an additional gate. No new test framework (no Vitest/Jest).
- Do not rewrite `fastifyStatic` media serving or range/HLS behavior.
- GraphQL `login` / `createFirstAdmin` keep returning `token` so GraphiQL still works. The SPA does not store that token.
- `Authorization: Bearer` remains a fallback next to the cookie (GraphiQL, scripts).

## 5. Architecture

```
Browser (dev :3000 or Caddy HTTPS)
  └─ same-origin /graphql, /thumbnails, /media, /api, …
        Vite proxy (dev) or Caddy (prod)
           └─ Fastify :4000
                ├─ cookie mda_session = JWT (HttpOnly)
                ├─ requireUser on protected prefixes
                ├─ GraphQL: public login/hasAdmin/createFirstAdmin; rest need context.user
                └─ background: indexMediaLibrary after listen()
```

Credential: existing `@fastify/jwt` payload `{ id, username, role }`, stored in cookie `mda_session`, not in `localStorage`.

Presence flag (not a secret): `localStorage.mda_signed_in = "1"` so existing `if (!getAuthToken())` guards keep working. HttpOnly cookies are invisible to JS.

## 6. Phase 1 — Tests + CI

### 6.1 Runner and layout

- Node built-in `node:test` + `tsx`.
- Files:
  - `apps/backend/src/services/search-query.test.ts`
  - `apps/backend/src/lib/media-path.test.ts`
- `@mda/backend` script: `"test": "tsx --test src/**/*.test.ts"`
- Root script: `"test": "turbo run test"`
- `turbo.json` `test` task: `dependsOn: ["^test"]`, `cache: false`
- `@mda/web` gets no test script in this program.

### 6.2 What to assert

`search-query.ts` (current behavior):

- `parseSearchTerm`: `type:`, `tag:`, `ext:`, `size:>10mb` / `size:<500kb`, quoted `in:"summer trip"`, slash folder syntax (`vacation/beach`), wildcards, unknown keys left as literal text.
- `toLikePattern` / `toDirLikePattern` / `buildNameMatcher`: wildcard vs contains semantics.

`media-path.ts`:

- `isValidAssetId`: positive integers only (`1` yes; `0`, `abc`, `1.2`, `../2` no).
- `resolveWithinRoot`: stays inside root; `..` and absolute escape return `null`.
- Add `joinWithinRoot(root, ...segments)` (throws if the joined path would escape `root`). Use the same escape rule as `resolveWithinRoot`: reject when `path.relative` is `'..'`, starts with `'..' + sep`, or is absolute. This is the only production code change in phase 1. Test join and escape.

### 6.3 CI

New file `.github/workflows/ci.yml`:

- Triggers: `push` and `pull_request` to `main`
- Node 24, `npm ci`, `npm run build`, `npm test`
- No Docker, Postgres, Redis, or Playwright

### 6.4 Docs

- Root `README.md`, `apps/backend/README.md`, and `apps/web/README.md`: Node `>=18` → `>=24` to match `engines`.
- `CLAUDE.md` verification: mention `npm test` once the script exists.

### 6.5 Phase 1 success

`npm test` fails if a search pattern or path helper regresses. CI is red without a passing build and test. No running server required.

## 7. Phase 2 — Cookie session + media auth

### 7.1 Cookie

Name: `mda_session`
Value: JWT from existing `@fastify/jwt` (`id`, `username`, `role`, `exp`)
Flags:

- `HttpOnly: true`
- `Path: /`
- `SameSite: Lax`
- `Max-Age: 2592000` (30 days)
- `Secure: true` when the request is HTTPS (Caddy production); `false` on HTTP localhost dev

Plugin: `@fastify/cookie`. Configure `@fastify/jwt` with `cookie: { cookieName: 'mda_session', signed: false }` so `jwtVerify()` reads the cookie when no `Authorization` header is present.

Login and `createFirstAdmin`: `Set-Cookie` plus the existing GraphQL `token` field.

Logout: new GraphQL `logout` mutation that clears `mda_session` (`maxAge: 0` / empty value). If the cookie is already missing or expired, the mutation may return Unauthorized; the SPA still `clearAuthToken()` and navigates to `/login`.

### 7.2 Sliding

On successful auth for GraphQL (except the three public operations) and for non-GET media-mutating/API routes (`POST`/`PUT`/`PATCH`/`DELETE` under `/api`, `/file-preview` PUT, upload, compress, transcode, queue-state writes): re-sign with `exp = now + 30 days` and `Set-Cookie` again.

Do **not** refresh the cookie on GET `/thumbnails`, `/media`, `/hls`, `/compress-preview`, `/image`, `/video`, `/download` (high volume).

Idle ~30 days after the last refreshing request → expired JWT → 401 / Unauthorized.

### 7.3 Protected vs public

**Public (no cookie required):**

- `GET /health`
- `GET /health/queues`
- GraphQL operations `login`, `hasAdminUser`, `createFirstAdmin`
- GraphiQL UI when `NODE_ENV !== 'production'` (API calls still need a cookie or Bearer after login)

**Protected (valid cookie or Bearer, else 401):**

- `/thumbnails/*`
- `/media/*`
- `/hls/*`
- `/compress-preview/*`
- `GET /image/:id`
- `/video/*`
- `GET /download/:id`, `GET /download-zip`
- `/file-preview/*`
- `/api/*` (upload, compress, transcode, queue-state)

Keep `fastifyStatic`. Attach a shared `onRequest` hook that runs `requireUser` when the path prefix is protected.

Replace copied Bearer parsing in `upload.routes.ts`, `compress.routes.ts`, `queue-state.routes.ts`, `transcode.routes.ts`, and `file-preview.routes.ts` with `requireUser`.

Drop file-preview `?token=` query authentication. Same-origin cookies cover PDF iframes. Bearer header remains.

`requireUser` must reject missing/invalid JWT and JWTs whose `id` is not a row in `users`.

### 7.4 CORS and same-origin

Stop `cors({ origin: true })`.

Dev: Vite `server.proxy` so the browser only talks to `:3000`. Cookie is set on the page origin. Proxy at least:

`/graphql`, `/api`, `/thumbnails`, `/media`, `/hls`, `/image`, `/video`, `/download`, `/download-zip`, `/file-preview`, `/compress-preview`, `/health`

Target: `http://127.0.0.1:4000` (or `localhost:4000`).

`getApiUrl()` returns `''` in the browser (same-origin relative URLs). `VITE_API_URL`, if set, remains an override; document that cookies require same-origin (do not add a CORS credentials allowlist in this program).

Production Caddy already same-origin. After this change, operators must use the Caddy origin (or Vite in dev). Hitting `:3000` and expecting the browser to call `:4000` with a cookie is unsupported; `getApiUrl()` no longer special-cases port 3000.

### 7.5 Frontend session flag

`apps/web/app/lib/api.ts`:

- `createGraphQLClient(token?: string)` keeps its optional argument so existing call sites compile; the argument is ignored. The client always uses `credentials: 'include'` and does not set `Authorization`.
- `getAuthToken()` reads `localStorage.mda_signed_in` (returns `"1"` or `null`). Call sites keep `if (!getAuthToken())`.
- `setAuthToken()` sets the flag to `"1"` (ignores the JWT string).
- `clearAuthToken()` removes the flag.

Login: after successful mutation, `setAuthToken('1')` (or the returned token string; it is not stored as a credential).

Logout: call `logout` mutation with credentials, then `clearAuthToken()`, then navigate to `/login`.

All `fetch` / XHR that currently send `Authorization: Bearer` (`useCompressQueue`, `useFileUpload`, `useActiveQueueCount`, `useTimelineAssetActions`, `MediaAssetViewer`, dashboard zip/download) switch to `credentials: 'include'` and drop the header.

Auth failure: GraphQL error message `Unauthorized` or HTTP 401 → `clearAuthToken()` → navigate `/login`. Implement this in the GraphQL client `fetch` wrapper and in REST helpers, not by rewriting every hook’s control flow.

### 7.6 CSRF and errors

| Case | Behavior |
|---|---|
| No cookie on protected media/API | HTTP 401; `<img>` shows broken if logged out |
| Expired JWT | 401 / GraphQL `Unauthorized` → login |
| Cookie valid, user row gone | 401 |
| Cross-site POST | cookie not sent (`SameSite=Lax`) |

### 7.7 Phase 2 tests and verification

Unit tests: cookie option builder (`secure` true iff HTTPS), public-vs-protected path matcher, sliding applies only to the refreshing method/path set.

Runtime (dev server, not CI):

- `curl -I` without cookie on `/thumbnails/...` and `/image/1` → 401
- Login via GraphQL, replay `mda_session` → 200 on a thumbnail
- Browser: login, dashboard thumbs load, logout, thumbs 401, Application storage has `mda_signed_in` only (no JWT)

## 8. Phase 3 — Non-blocking startup

### 8.1 Order

Still **before** `listen()` (failure here still `process.exit`):

1. `db.query('SELECT NOW()')`
2. `ensureAdminExists()`

Then `fastify.listen()`.

Then, without blocking listen:

- `startWorkers()`, `startCacheMaintenance()`, `startMediaWatcher()` (watcher already `ignoreInitial: true`)
- `indexMediaLibrary()` in the background
- on successful index settle: `backfillCaptureDates()` (already fire-and-forget)

`indexFile` is already idempotent (`up_to_date`). Overlap between watcher and the initial scan is acceptable. No new global index lock.

If `indexMediaLibrary()` throws: log the error, do **not** `process.exit`. Serve traffic anyway.

### 8.2 Health

`GET /health` remains HTTP 200 when the process can serve. JSON:

```json
{
  "status": "ok",
  "timestamp": "<ISO>",
  "indexing": true,
  "indexError": null
}
```

- `indexing`: `true` while the initial scan is in flight, else `false`
- `indexError`: error message string after a failed initial scan, else `null`

Docker Compose does not healthcheck the app container; postgres/redis healthchecks are unchanged.

No UI banner for indexing.

### 8.3 Module

Small `indexing-status` helper (idle / running / failed) used by `start()` and `/health`. Unit-test state transitions. Do not boot Fastify in unit tests.

### 8.4 Phase 3 verification

Start backend against a library large enough that index takes several seconds. Immediately: `GET /health` is 200 with `indexing: true`; `hasAdminUser` / login GraphQL works. When logs show indexing completed, `/health` has `indexing: false` and `indexError: null`.

## 9. Rollout and breaking change

Ship in phase order. Phase 2 logs everyone out.

Operators: open the app, sign in once. No DB migration. No cookie domain config for LAN hostnames; `Path=/` on the page origin is enough.

## 10. Testing strategy (program-wide)

| Kind | Where | When |
|---|---|---|
| Unit (`node:test`) | search-query, media-path, cookie flags, path matcher, indexing-status | CI |
| `npm run build` | both workspaces | CI |
| Runtime curl / browser | cookie 401/200, login/logout, listen-during-index | phase 2–3 locally; not CI |

Do not add a test Postgres or Playwright job in this program.

## 11. Success

- CI runs on `main` push/PR and fails on build or unit-test failure.
- Unauthenticated media and file routes return 401.
- Cookie session is HttpOnly, 30-day sliding, LAN same-origin.
- SPA has no JWT in `localStorage`.
- Server listens before the initial index finishes; `/health` exposes indexing state.
- Node docs say `>=24`.

## 12. Implementation note

Do not implement until this spec is approved. Next step is an implementation plan (`writing-plans`), not code.
