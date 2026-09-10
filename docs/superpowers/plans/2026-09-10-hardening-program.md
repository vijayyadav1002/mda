# MDA Hardening Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three-phase hardening program: `node:test` + CI, HttpOnly cookie sessions with media 401s, then listen-before-index.

**Architecture:** Keep Fastify + Mercurius + React Router. Phase 1 only adds tests/CI and `joinWithinRoot`. Phase 2 moves the JWT from `localStorage.auth_token` into cookie `mda_session`, same-origin via a Vite proxy, and a shared `requireUser` hook on media/file prefixes. Phase 3 moves `indexMediaLibrary()` after `listen()` and exposes indexing on `/health`.

**Tech Stack:** Node 24, `node:test` + `tsx`, Fastify 5, `@fastify/jwt` + `@fastify/cookie`, Mercurius, React Router 8, graphql-request 7, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-08-hardening-program-design.md`

## Global Constraints

- LAN / homelab only. Same-origin cookies; `SameSite=Lax`; no CSRF tokens, OAuth, Redis sessions, or CORS credentials allowlist.
- Preserve raw `pg`. Do not change Docker mount paths, `init-db.sql`, or `media-files/`.
- Baseline gate stays `npm run build`. After Task 3, `npm test` is an additional gate. No Vitest/Jest, no Playwright in CI, no Docker-in-CI, no frontend component tests.
- Do not rewrite `fastifyStatic` range/HLS behavior.
- GraphQL `login` / `createFirstAdmin` still return `token` (GraphiQL). The SPA does not store that JWT.
- `Authorization: Bearer` remains a fallback next to the cookie.
- Do not implement later-phase code in an earlier task.
- Current tree already has `apps/backend/src/lib/media-path.ts` (`isValidAssetId`, `resolveWithinRoot` only), split route files under `apps/backend/src/routes/`, and `@fastify/rate-limit`. Ignore the stale Aug 10 CodeQL plan file layout (`index.ts` handlers).
- After each task that changes code files, run `graphify update .` if available; if it fails, note that instead of skipping silently.

---

### Task 1: `joinWithinRoot` + media-path tests

**Files:**
- Modify: `apps/backend/src/lib/media-path.ts`
- Create: `apps/backend/src/lib/media-path.test.ts`

**Interfaces:**
- Consumes: existing `isValidAssetId`, `resolveWithinRoot`
- Produces: `joinWithinRoot(root: string, ...segments: string[]): string` — throws `'Path escapes allowed root'` when `path.relative(resolvedRoot, joined)` is `'..'`, starts with `'..' + path.sep`, or is absolute. Empty relative (join equals root) is allowed.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isValidAssetId, resolveWithinRoot, joinWithinRoot } from './media-path.js';

describe('isValidAssetId', () => {
  it('accepts positive integers', () => {
    assert.equal(isValidAssetId('1'), true);
    assert.equal(isValidAssetId('42'), true);
  });
  it('rejects zero, decimals, text, and traversal', () => {
    assert.equal(isValidAssetId('0'), false);
    assert.equal(isValidAssetId('abc'), false);
    assert.equal(isValidAssetId('1.2'), false);
    assert.equal(isValidAssetId('../2'), false);
  });
});

describe('resolveWithinRoot', () => {
  const root = path.resolve('/data/media');
  it('allows paths inside root', () => {
    assert.equal(resolveWithinRoot(root, path.join(root, 'a.jpg')), path.resolve(root, 'a.jpg'));
  });
  it('returns null for .. and absolute escapes', () => {
    assert.equal(resolveWithinRoot(root, path.join(root, '..', 'etc', 'passwd')), null);
    assert.equal(resolveWithinRoot(root, '/etc/passwd'), null);
  });
});

describe('joinWithinRoot', () => {
  const root = path.resolve('/data/media');
  it('joins segments inside root', () => {
    assert.equal(joinWithinRoot(root, 'hls', '12', 'master.m3u8'), path.join(root, 'hls', '12', 'master.m3u8'));
  });
  it('throws when segments escape root', () => {
    assert.throws(() => joinWithinRoot(root, '..', 'etc'), /Path escapes allowed root/);
  });
});
```

- [ ] **Step 2: Run tests (expect FAIL on missing `joinWithinRoot`)**

Run: `cd apps/backend && npx tsx --test src/lib/media-path.test.ts`
Expected: FAIL — `joinWithinRoot` is not exported.

- [ ] **Step 3: Add `joinWithinRoot`**

Append to `apps/backend/src/lib/media-path.ts` (keep existing `resolveWithinRoot` escape rule: `rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)`):

```ts
export function joinWithinRoot(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const joined = path.join(resolvedRoot, ...segments);
  const rel = path.relative(resolvedRoot, joined);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error('Path escapes allowed root');
  }
  return joined;
}
```

Do not wire callers in this task. This is the only production change in phase 1.

- [ ] **Step 4: Re-run tests**

Run: `cd apps/backend && npx tsx --test src/lib/media-path.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/media-path.ts apps/backend/src/lib/media-path.test.ts
git commit -m "test: add media-path coverage and joinWithinRoot"
```

---

### Task 2: search-query unit tests

**Files:**
- Create: `apps/backend/src/services/search-query.test.ts`
- Read only: `apps/backend/src/services/search-query.ts`

**Interfaces:**
- Consumes: `parseSearchTerm`, `toLikePattern`, `toDirLikePattern`, `buildNameMatcher` (current exports)

- [ ] **Step 1: Write tests for current behavior**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseSearchTerm,
  toLikePattern,
  toDirLikePattern,
  buildNameMatcher,
} from './search-query.js';

describe('parseSearchTerm', () => {
  it('parses type, tag, ext, and size operators', () => {
    const parsed = parseSearchTerm('type:image tag:holiday ext:jpg size:>10mb size:<500kb rest');
    assert.equal(parsed.type, 'image');
    assert.equal(parsed.tag, 'holiday');
    assert.equal(parsed.ext, 'jpg');
    assert.equal(parsed.minSize, 10 * 1024 * 1024);
    assert.equal(parsed.maxSize, 500 * 1024);
    assert.equal(parsed.nameTerm, 'rest');
  });
  it('parses quoted in: and slash folder syntax', () => {
    const quoted = parseSearchTerm('in:"summer trip" photo');
    assert.deepEqual(quoted.dirTerms, ['summer trip']);
    assert.equal(quoted.nameTerm, 'photo');
    const slash = parseSearchTerm('vacation/beach');
    assert.deepEqual(slash.dirTerms, ['vacation']);
    assert.equal(slash.nameTerm, 'beach');
  });
  it('leaves unknown keys as literal text', () => {
    const parsed = parseSearchTerm('foo:bar hello');
    assert.equal(parsed.nameTerm, 'foo:bar hello');
  });
});

describe('toLikePattern / toDirLikePattern / buildNameMatcher', () => {
  it('uses contains without wildcards and raw pattern with wildcards', () => {
    assert.equal(toLikePattern('cat'), '%cat%');
    assert.equal(toLikePattern('*.jpg'), '%.jpg');
    assert.equal(toDirLikePattern('beach'), '%beach%/%');
  });
  it('matches folder names with contains or wildcards', () => {
    const contains = buildNameMatcher(['Beach']);
    assert.equal(contains('summer-beach'), true);
    const wild = buildNameMatcher(['vac*']);
    assert.equal(wild('vacation'), true);
    assert.equal(wild('trip'), false);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd apps/backend && npx tsx --test src/services/search-query.test.ts`
Expected: PASS against current parser (no production change). If a case fails, fix the test to match current `search-query.ts` — do not change parser behavior.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/services/search-query.test.ts
git commit -m "test: cover search-query operators and wildcards"
```

---

### Task 3: `npm test`, Turbo, CI, Node docs

**Files:**
- Modify: `apps/backend/package.json` (add `"test": "tsx --test src/**/*.test.ts"`)
- Modify: `package.json` (add `"test": "turbo run test"`)
- Modify: `turbo.json` (add `test` task: `dependsOn: ["^test"]`, `cache: false`)
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`, `apps/backend/README.md`, `apps/web/README.md` (Node `>=18` → `>=24`)
- Modify: `Claude.md` Verification: mention `npm test`; remove “no test scripts wired up”

**Interfaces:**
- Consumes: test files from Tasks 1–2
- Produces: root `npm test` runs backend tests; `@mda/web` has no test script

- [ ] **Step 1: Wire scripts**

`apps/backend/package.json` scripts:

```json
"test": "tsx --test src/**/*.test.ts"
```

Root `package.json` scripts:

```json
"test": "turbo run test"
```

`turbo.json` tasks:

```json
"test": {
  "dependsOn": ["^test"],
  "cache": false
}
```

Do not add a test script to `@mda/web`. Turbo 2 skips packages that lack the task.

- [ ] **Step 2: Add CI**

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test
```

No Docker, Postgres, Redis, or Playwright.

- [ ] **Step 3: Docs**

Replace Node `>=18` / `>=18.0.0` with `>=24` / `>=24.0.0` in the three READMEs to match root `engines`.

In `Claude.md` Verification, change to: baseline is still `npm run build`; `npm test` is an additional gate (`tsx --test` in `@mda/backend` via Turbo). Keep the “do not claim lint passed” note.

- [ ] **Step 4: Verify**

Run: `npm --workspace=@mda/backend test` then `npm test` then `npm run build`
Expected: tests pass; build passes. If `npm test` errors because `@mda/web` lacks the task, stop and report — do not add a fake web test script.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/package.json package.json turbo.json .github/workflows/ci.yml README.md apps/backend/README.md apps/web/README.md Claude.md
git commit -m "ci: add node:test gate and Node 24 docs"
```

---

### Task 4: Session cookie helpers

**Files:**
- Create: `apps/backend/src/lib/session-cookie.ts`
- Create: `apps/backend/src/lib/session-cookie.test.ts`

**Interfaces:**
- Produces:
  - `SESSION_COOKIE_NAME = 'mda_session'`
  - `SESSION_MAX_AGE_SECONDS = 2592000`
  - `sessionCookieOptions(request: { protocol: string }): { httpOnly: true; path: '/'; sameSite: 'lax'; maxAge: 2592000; secure: boolean; signed: false }`
  - `clearSessionCookieOptions(request)` — same flags with `maxAge: 0`
  - `secure` is `true` iff `request.protocol === 'https'`

- [ ] **Step 1: Write failing tests**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sessionCookieOptions } from './session-cookie.js';

describe('sessionCookieOptions', () => {
  it('sets Secure on HTTPS and not on HTTP', () => {
    const httpsOpts = sessionCookieOptions({ protocol: 'https' });
    assert.equal(httpsOpts.secure, true);
    assert.equal(httpsOpts.httpOnly, true);
    assert.equal(httpsOpts.path, '/');
    assert.equal(httpsOpts.sameSite, 'lax');
    assert.equal(httpsOpts.maxAge, 2592000);
    const httpOpts = sessionCookieOptions({ protocol: 'http' });
    assert.equal(httpOpts.secure, false);
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `cd apps/backend && npx tsx --test src/lib/session-cookie.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
export const SESSION_COOKIE_NAME = 'mda_session';
export const SESSION_MAX_AGE_SECONDS = 2592000;

export function sessionCookieOptions(request: { protocol: string }) {
  return {
    httpOnly: true as const,
    path: '/' as const,
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: request.protocol === 'https',
    signed: false as const,
  };
}

export function clearSessionCookieOptions(request: { protocol: string }) {
  return { ...sessionCookieOptions(request), maxAge: 0 };
}
```

- [ ] **Step 4: Re-run tests and commit**

Run: `cd apps/backend && npx tsx --test src/lib/session-cookie.test.ts`
Expected: PASS

```bash
git add apps/backend/src/lib/session-cookie.ts apps/backend/src/lib/session-cookie.test.ts
git commit -m "feat: add session cookie option builder"
```

---

### Task 5: Protected-path matcher + `requireUser`

**Files:**
- Create: `apps/backend/src/lib/protected-path.ts`
- Create: `apps/backend/src/lib/protected-path.test.ts`
- Create: `apps/backend/src/lib/require-user.ts`
- Create: `apps/backend/src/lib/slide-session.ts`
- Create: `apps/backend/src/lib/slide-session.test.ts`

**Interfaces:**
- Produces:
  - `isPublicPath(url: string): boolean` — `GET /health`, `GET /health/queues` (pathname only; ignore query). GraphQL and GraphiQL are not decided here.
  - `isProtectedMediaPath(url: string): boolean` — prefixes `/thumbnails/`, `/media/`, `/hls/`, `/compress-preview/`, `/file-preview/`, `/api/`, `/image/`, `/video/`, `/download/`, exact `/download-zip`
  - `shouldSlideSession(method: string, url: string): boolean` — `false` for GET on `/thumbnails`, `/media`, `/hls`, `/compress-preview`, `/image`, `/video`, `/download` (including `/download-zip`). `true` for POST/PUT/PATCH/DELETE under `/api` and `/file-preview`. GraphQL sliding is handled in Task 7, not here.
  - `requireUser(request, reply): Promise<boolean>` — `jwtVerify()`, then `SELECT id, username, role FROM users WHERE id = $1`. On failure send HTTP 401 `{ error: 'Unauthorized' }` and return `false`. On success assign `request.user` and return `true`.

- [ ] **Step 1: Write matcher tests**

Cover: `/health` public; `/thumbnails/x` protected; GET `/thumbnails/x` does not slide; POST `/api/upload` slides; GET `/download-zip` does not slide; PUT `/file-preview/1/content` slides.

- [ ] **Step 2: Implement matchers (no Fastify boot in tests)**

Keep helpers pure string/method checks. `requireUser` uses `request.jwtVerify()` and `db.query`; do not unit-test it against a live DB in this task.

- [ ] **Step 3: Run tests and commit**

Run: `cd apps/backend && npx tsx --test src/lib/protected-path.test.ts src/lib/slide-session.test.ts`
Expected: PASS

```bash
git add apps/backend/src/lib/protected-path.ts apps/backend/src/lib/protected-path.test.ts apps/backend/src/lib/require-user.ts apps/backend/src/lib/slide-session.ts apps/backend/src/lib/slide-session.test.ts
git commit -m "feat: add media path auth matcher and requireUser"
```

---

### Task 6: Fastify cookie, JWT, CORS, onRequest hook

**Files:**
- Modify: `apps/backend/package.json` (add `@fastify/cookie`, Fastify 5 compatible)
- Modify: `apps/backend/src/index.ts`

**Interfaces:**
- Consumes: Task 4–5 helpers
- Produces: cookie plugin registered; JWT reads cookie `mda_session`; CORS `origin: true` removed; `onRequest` runs `requireUser` on protected media/API prefixes and slides when `shouldSlideSession` is true

- [ ] **Step 1: Install cookie plugin**

```bash
npm --workspace=@mda/backend install @fastify/cookie
```

- [ ] **Step 2: Register plugins in `index.ts`**

Replace the current CORS block (`origin: true`, `credentials: true`) by removing the `cors` registration entirely (same-origin only). Keep the import deleted if unused.

After rate-limit, before JWT:

```ts
import cookie from '@fastify/cookie';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './lib/session-cookie.js';
import { isProtectedMediaPath } from './lib/protected-path.js';
import { requireUser } from './lib/require-user.js';
import { shouldSlideSession } from './lib/slide-session.js';

await fastify.register(cookie);
await fastify.register(jwt, {
  secret: config.jwtSecret,
  sign: { expiresIn: '30d' },
  cookie: { cookieName: SESSION_COOKIE_NAME, signed: false },
});
```

Add `onRequest` after plugins/routes are registered (so `jwtVerify` exists), before `start()`:

```ts
fastify.addHook('onRequest', async (request, reply) => {
  const pathOnly = request.url.split('?')[0];
  if (!isProtectedMediaPath(pathOnly)) return;
  const ok = await requireUser(request, reply);
  if (!ok) return;
  if (shouldSlideSession(request.method, pathOnly)) {
    const token = await reply.jwtSign({
      id: (request.user as any).id,
      username: (request.user as any).username,
      role: (request.user as any).role,
    });
    reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(request));
  }
});
```

Do not protect `/graphql` at this hook — public GraphQL ops must work without a cookie.

- [ ] **Step 3: Build**

Run: `npm --workspace=@mda/backend run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/package.json package-lock.json apps/backend/src/index.ts
git commit -m "feat: require cookie or bearer on media and file routes"
```

---

### Task 7: GraphQL login cookie, logout, public-op gate

**Files:**
- Modify: `apps/backend/src/graphql/schema/auth.sdl.ts` (optional; mutation lives in root SDL)
- Modify: `apps/backend/src/graphql/schema/index.ts` — add `logout: Boolean!`
- Modify: `apps/backend/src/graphql/resolvers/auth.resolvers.ts`
- Modify: `apps/backend/src/graphql/context.ts`
- Modify: `apps/backend/src/index.ts` (Mercurius `preExecution`)

**Interfaces:**
- Consumes: `SESSION_COOKIE_NAME`, `sessionCookieOptions`, `clearSessionCookieOptions`
- Produces: login / createFirstAdmin `Set-Cookie` + existing `token` field; `logout` clears cookie; non-public GraphQL ops throw `Unauthorized` without `context.user`; successful non-public GraphQL slides the cookie

- [ ] **Step 1: Set cookie on login / createFirstAdmin**

In both resolvers, `await` `jwtSign` (current code does not await the promise):

```ts
const token = await context.reply.jwtSign({
  id: user.id,
  username: user.username,
  role: user.role,
});
context.reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(context.request));
```

Keep returning `{ token, user }`.

- [ ] **Step 2: Add logout**

```ts
logout: async (_: any, __: any, context: GraphQLContext) => {
  context.reply.clearCookie(SESSION_COOKIE_NAME, clearSessionCookieOptions(context.request));
  return true;
}
```

If jwt/cookie is already missing, still clear and return true so the SPA can proceed. Do not throw Unauthorized from logout itself.

- [ ] **Step 3: Public-op gate + sliding**

Keep `buildContext` optional `jwtVerify` (and after verify, load the user row; if the id is gone, leave `user` unset).

In Mercurius `preExecution`, collect root field names from the document. Public set: `login`, `hasAdminUser`, `createFirstAdmin`. If any other field is present and `!context.user`, throw `new Error('Unauthorized')`. If `context.user` is set and the operation is not public-only, re-sign and `setCookie` (GraphQL sliding).

- [ ] **Step 4: Build and commit**

Run: `npm --workspace=@mda/backend run build`

```bash
git add apps/backend/src/graphql apps/backend/src/index.ts
git commit -m "feat: store session JWT in HttpOnly cookie and add logout"
```

---

### Task 8: Replace copied Bearer parsers in REST routes

**Files:**
- Modify: `apps/backend/src/routes/upload.routes.ts`
- Modify: `apps/backend/src/routes/compress.routes.ts`
- Modify: `apps/backend/src/routes/queue-state.routes.ts`
- Modify: `apps/backend/src/routes/transcode.routes.ts`
- Modify: `apps/backend/src/routes/file-preview.routes.ts`

**Interfaces:**
- Consumes: `request.user` from Task 6 `onRequest` `requireUser`
- Produces: no local `Authorization: Bearer` parsing; no `?token=` query auth on file-preview

- [ ] **Step 1: Drop duplicate JWT parsing**

The onRequest hook already 401s unauthenticated requests. In each handler, delete the `authHeader` / `jwt.verify` block. Keep role checks using `request.user` (upload/compress/transcode still require admin/editor where they do today).

file-preview: delete `query.token` fallback in `authenticateRequest`. Use `request.user` from the hook (or call `requireUser` only if you must keep a local helper — prefer the hook). PDF iframes rely on the same-origin cookie after Task 9.

- [ ] **Step 2: Build and commit**

Run: `npm --workspace=@mda/backend run build`

```bash
git add apps/backend/src/routes
git commit -m "refactor: use requireUser instead of copied bearer parsing"
```

---

### Task 9: Vite same-origin proxy + `getApiUrl`

**Files:**
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/app/lib/api.ts`

**Interfaces:**
- Produces: browser `getApiUrl()` returns `''`; `VITE_API_URL` remains an override (document that cookies need same-origin). Dev proxy targets `http://127.0.0.1:4000`. Drop the port-3000 special case that pointed at `:4000`.

- [ ] **Step 1: Add Vite proxy**

```ts
server: {
  port: 3000,
  proxy: {
    '/graphql': 'http://127.0.0.1:4000',
    '/api': 'http://127.0.0.1:4000',
    '/thumbnails': 'http://127.0.0.1:4000',
    '/media': 'http://127.0.0.1:4000',
    '/hls': 'http://127.0.0.1:4000',
    '/image': 'http://127.0.0.1:4000',
    '/video': 'http://127.0.0.1:4000',
    '/download': 'http://127.0.0.1:4000',
    '/download-zip': 'http://127.0.0.1:4000',
    '/file-preview': 'http://127.0.0.1:4000',
    '/compress-preview': 'http://127.0.0.1:4000',
    '/health': 'http://127.0.0.1:4000',
  },
},
```

- [ ] **Step 2: Change `getApiUrl`**

```ts
export function getApiUrl() {
  if (explicitApiUrl) return explicitApiUrl.replace(/\/$/, '');
  if (typeof window !== 'undefined') return '';
  return import.meta.env.DEV ? 'http://localhost:4000' : '';
}
```

- [ ] **Step 3: Build web and commit**

Run: `npm --workspace=@mda/web run build`

```bash
git add apps/web/vite.config.ts apps/web/app/lib/api.ts
git commit -m "feat: same-origin Vite proxy for cookie sessions"
```

---

### Task 10: Frontend session flag + credentials + auth failure

**Files:**
- Modify: `apps/web/app/lib/api.ts`
- Modify: `apps/web/app/routes/login.tsx`

**Interfaces:**
- Produces:
  - `getAuthToken()` reads `localStorage.mda_signed_in` (`"1"` or `null`)
  - `setAuthToken()` sets that flag to `"1"` (ignores JWT string)
  - `clearAuthToken()` removes the flag
  - `createGraphQLClient(token?: string)` ignores `token`; uses `credentials: 'include'`; no `Authorization` header
  - On HTTP 401 or GraphQL error message `Unauthorized`: `clearAuthToken()` and navigate `/login` (browser only)

- [ ] **Step 1: Rewrite auth helpers in `api.ts`**

Use graphql-request’s fetch options (`credentials: 'include'`). Wrap `fetch` so 401 clears the flag. For GraphQL errors, in a small `request` helper or by catching `ClientError` whose `response.errors` include `Unauthorized`. Call sites keep `if (!getAuthToken())` and `createGraphQLClient(token)`.

Do not store the JWT. Login may call `setAuthToken(result.token)` — `setAuthToken` must ignore the string and write `"1"`.

- [ ] **Step 2: Login still calls `setAuthToken` then `navigate("/dashboard")`**

No other login UI changes.

- [ ] **Step 3: Build web and commit**

Run: `npm --workspace=@mda/web run build`

```bash
git add apps/web/app/lib/api.ts apps/web/app/routes/login.tsx
git commit -m "feat: keep signed-in flag in localStorage, cookie is HttpOnly"
```

---

### Task 11: Drop SPA Bearer headers and `?token=`

**Files:**
- Modify: `apps/web/app/routes/dashboard.tsx` (logout + zip/download fetch)
- Modify: `apps/web/app/routes/audit.tsx`, `apps/web/app/routes/users.tsx` (logout)
- Modify: `apps/web/app/components/MediaAssetViewer.tsx`
- Modify: `apps/web/app/lib/useActiveQueueCount.ts`
- Modify: `apps/web/app/hooks/useTimelineAssetActions.ts`
- Modify: `apps/web/app/hooks/useCompressQueue.ts`
- Modify: `apps/web/app/hooks/useFileUpload.ts`

**Interfaces:**
- Consumes: cookie via `credentials: 'include'`
- Produces: no `Authorization: Bearer` on `fetch`/`XHR`; PDF URL has no `?token=`; logout calls `logout` mutation then `clearAuthToken()` then `/login`

- [ ] **Step 1: REST fetches**

Every `fetch`/`XHR` that sets `Authorization: Bearer ${token}` must instead use `credentials: 'include'` (XHR: `xhr.withCredentials = true`) and drop the header. Keep `if (!getAuthToken()) return` guards.

MediaAssetViewer PDF:

```ts
const pdfPreviewUrl = `${apiUrl}/file-preview/${asset.id}/pdf`;
```

- [ ] **Step 2: Logout**

Shared pattern (dashboard/audit/users):

```ts
try {
  const client = createGraphQLClient();
  await client.request(`mutation { logout }`);
} catch {
  // cookie already missing/expired is fine
}
clearAuthToken();
navigate("/login");
```

- [ ] **Step 3: Build web and commit**

Run: `npm --workspace=@mda/web run build`

```bash
git add apps/web
git commit -m "feat: send cookies on REST calls and drop query tokens"
```

---

### Task 12: Non-blocking startup + health indexing

**Files:**
- Create: `apps/backend/src/lib/indexing-status.ts`
- Create: `apps/backend/src/lib/indexing-status.test.ts`
- Modify: `apps/backend/src/index.ts` `start()`
- Modify: `apps/backend/src/routes/health.routes.ts`

**Interfaces:**
- Produces: `markIndexingStarted()`, `markIndexingSucceeded()`, `markIndexingFailed(message: string)`, `getIndexingStatus(): { indexing: boolean; indexError: string | null }`
- Startup still `process.exit` if `db.query('SELECT NOW()')` or `ensureAdminExists()` throws, **before** `listen()`
- After `listen()`: `startWorkers()`, `startCacheMaintenance()`, `startMediaWatcher()`, then background `indexMediaLibrary()`; on success `backfillCaptureDates()`; on throw log and do not `process.exit`
- `GET /health` stays HTTP 200 with `{ status, timestamp, indexing, indexError }`

- [ ] **Step 1: Write indexing-status tests**

Idle: `{ indexing: false, indexError: null }`. Started: `{ indexing: true, indexError: null }`. Success: `{ indexing: false, indexError: null }`. Failed: `{ indexing: false, indexError: 'boom' }`. Do not boot Fastify.

- [ ] **Step 2: Reorder `start()`**

```ts
await db.query('SELECT NOW()');
await ensureAdminExists();
await fastify.listen({ port: config.port, host: config.host });

cacheMaintenanceTimer = startCacheMaintenance();
workerHandles = startWorkers();
startMediaWatcher();

markIndexingStarted();
void indexMediaLibrary()
  .then(() => {
    markIndexingSucceeded();
    void backfillCaptureDates().catch((error) => {
      fastify.log.error({ err: error }, 'Capture date backfill failed');
    });
  })
  .catch((error) => {
    fastify.log.error({ err: error }, 'Initial media library indexing failed');
    markIndexingFailed(error instanceof Error ? error.message : String(error));
  });
```

- [ ] **Step 3: Health JSON**

```ts
fastify.get('/health', async () => {
  const indexing = getIndexingStatus();
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    indexing: indexing.indexing,
    indexError: indexing.indexError,
  };
});
```

Leave `/health/queues` unchanged. No UI banner.

- [ ] **Step 4: Test, build, commit**

Run: `cd apps/backend && npx tsx --test src/lib/indexing-status.test.ts` then `npm test` then `npm run build`

```bash
git add apps/backend/src/lib/indexing-status.ts apps/backend/src/lib/indexing-status.test.ts apps/backend/src/index.ts apps/backend/src/routes/health.routes.ts
git commit -m "feat: listen before initial library index and report it on /health"
```

---

### Task 13: Runtime verification (local, not CI)

**Files:** none required unless a check fails

- [ ] **Step 1: Phase 2 curl**

With backend running: `curl -I` without cookie on a real `/thumbnails/...` and `/image/1` → 401. Login via GraphQL, replay `mda_session` → 200 on a thumbnail.

- [ ] **Step 2: Browser**

Login, dashboard thumbs load, logout, thumbs 401. Application storage has `mda_signed_in` only (no JWT). Confirm GraphiQL can still use returned `token` as Bearer.

- [ ] **Step 3: Phase 3 health**

Against a library large enough that index takes several seconds: immediately `GET /health` is 200 with `indexing: true`; `hasAdminUser` / login work. After index logs complete: `indexing: false`, `indexError: null`.

- [ ] **Step 4: `graphify update .` if available**

---

## Self-Review

- **Spec coverage:** Phase 1 tests/CI/docs/`joinWithinRoot` → Tasks 1–3. Cookie flags, protected prefixes, sliding exceptions, CORS removal, Vite proxy, SPA flag, 401/Unauthorized redirect, drop `?token=` → Tasks 4–11. Listen-before-index + health fields → Task 12. Runtime curl/browser → Task 13.
- **Placeholder scan:** No TBD. Turbo-missing-web-test is an explicit stop-and-report, not a fake script.
- **Type consistency:** `SESSION_COOKIE_NAME`, `sessionCookieOptions`, `requireUser`, `isProtectedMediaPath`, `shouldSlideSession`, `getIndexingStatus` names are stable across tasks.
- **Stale CodeQL plan:** Do not edit `apps/backend/src/index.ts` route handlers that no longer exist; REST lives in `apps/backend/src/routes/*.routes.ts`.

## Execution Handoff

After this plan is approved, save a copy to `docs/superpowers/plans/2026-09-10-hardening-program.md` and execute task-by-task.

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks

**2. Inline Execution** — executing-plans in this session with checkpoints
