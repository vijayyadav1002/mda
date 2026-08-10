# Code Scanning Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Adaptation note:** This repo has no test framework wired up (`npm --workspace=@mda/backend run test` / `@mda/web run test` do not exist — see project `CLAUDE.md`, "Verification" section). The usual TDD "write failing test → make it pass" step is replaced everywhere in this plan with "reproduce the alert conditions" → "apply the fix" → "verify via build + targeted runtime check". Do not invent a test runner to satisfy the template; use `npm run build` (root or scoped) as the baseline gate, per repo convention.

**Goal:** Close all 34 open GitHub code-scanning (CodeQL) alerts on `vijayyadav1002/mda` — 8 path-injection, 5 insecure-randomness, 3 tainted-format-string, 18 missing-rate-limiting — via small, independently-verifiable phases suited to a `/loop` + `graphify` workflow.

**Architecture:** Each phase attacks one CodeQL rule family with one consistent remediation pattern, so a fix generalizes across all its sites instead of being bespoke per alert. Phase 1 adds a shared path-safety helper used at every path-injection sink. Phase 2 adds one global Fastify plugin that clears all 18 rate-limiting alerts at once. Phase 3 removes the `Math.random()` fallback that CodeQL treats as insecure randomness. Phase 4 stops interpolating tainted values into log format strings. Phase 5 re-pulls the alert list to confirm closure and update the knowledge graph.

**Tech Stack:** Fastify 5 (backend), Remix + Vite (frontend), raw `pg`, `gh` CLI for alert data, `graphify` for the knowledge-graph burndown.

## Global Constraints

- Baseline verification command: `npm run build` from repo root (per `CLAUDE.md`). Backend-only changes may use `npm --workspace=@mda/backend run build`; frontend-only changes may use `npm --workspace=@mda/web run build`.
- Do not modify `media-files/`, `init-db.sql`, or Docker mount paths (per `CLAUDE.md` guardrails) — none of these alerts require it.
- Preserve the raw `pg` data-access style; no ORM introduction.
- `media_assets.id` is a Postgres `SERIAL` (positive integer), not a UUID — confirmed via `apps/backend/src/db/migrate.ts:17`. All `:id`/`assetId` validation in this plan uses a numeric-id check, not a UUID regex.
- **Assumption (flag if wrong):** default rate limits proposed in Phase 2 are a starting point (global 300 req/min/IP, tighter per-route overrides for upload/compress/transcode/zip). Adjust the numbers to real traffic patterns before shipping if you have data; nothing else in the plan depends on the exact values.
- After each phase's code changes, run `graphify update .` (per project `CLAUDE.md`) if the tool is available; note in the phase's final step if it isn't.
- CodeQL runs on a schedule/push via GitHub's default setup (`gh api repos/vijayyadav1002/mda/code-scanning/default-setup` → `"schedule":"weekly"`, plus push-triggered analysis). Alerts will not clear instantly after a local fix — Phase 5 documents how to re-check once a scan has run against the pushed commit.

---

## Phase 1: Path Injection (8 alerts, severity: error)

**Alerts:** #6 `capture-date.ts:192`, #7 `media-indexer.ts:135`, #8 `index.ts:528`, #9 `index.ts:581`, #10 `index.ts:1140`, #11 `index.ts:1157`, #12 `video-transcode.ts:292`, #13 `video-transcode.ts:305`.

**Root cause:** Two patterns.
1. `/video/:id/prepare` and `/video/:id/progress` (and `ensureHLS`'s `assetId` param) build a filesystem path by joining the raw route param directly (`path.join(hlsDir, id, 'master.m3u8')`), with no validation that `id` can't contain `..` or `/`. It happens to always be a `SERIAL` int today, but nothing in the code enforces that at the boundary.
2. The upload endpoint's existing containment check (`resolved.startsWith(`${rootPath}${path.sep}`)`) is a string-prefix check, which CodeQL's `js/path-injection` query does not recognize as a sanitizer barrier — it wants a `path.relative()`-based check. `capture-date.ts` and `media-indexer.ts` receive `filePath` downstream of that same unrecognized-barrier call chain.

### Task 1.1: Add a shared path-safety helper

**Files:**
- Create: `apps/backend/src/lib/media-path.ts`

**Interfaces:**
- Produces: `isValidAssetId(id: string): boolean`, `joinWithinRoot(root: string, ...segments: string[]): string` (throws if the result would escape `root`), `resolveWithinRoot(root: string, candidate: string): string | null` (returns `null` instead of throwing, for call sites that need a soft-fail).

- [ ] **Step 1: Write the helper**

```ts
import path from 'node:path';

const NUMERIC_ID = /^[1-9]\d*$/;

/** media_assets.id is a Postgres SERIAL — only positive integers are valid. */
export function isValidAssetId(id: string): boolean {
  return NUMERIC_ID.test(id);
}

/**
 * Resolves `candidate` and confirms it stays within `root` using path.relative,
 * which CodeQL's js/path-injection query recognizes as a sanitizing barrier
 * (a bare `startsWith` prefix check does not).
 */
export function resolveWithinRoot(root: string, candidate: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))) return null;
  return resolvedCandidate;
}

/** Joins segments onto root and throws if the result would escape root. */
export function joinWithinRoot(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const joined = path.join(resolvedRoot, ...segments);
  const rel = path.relative(resolvedRoot, joined);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes allowed root');
  }
  return joined;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm --workspace=@mda/backend run build`
Expected: succeeds (new file has no callers yet, so this only checks syntax/types).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/lib/media-path.ts
git commit -m "security: add shared path-safety helper for media path validation"
```

### Task 1.2: Validate `id` before building HLS paths in index.ts (alerts #8, #9)

**Files:**
- Modify: `apps/backend/src/index.ts:493-528` (`/video/:id/prepare`)
- Modify: `apps/backend/src/index.ts:573-581` (`/video/:id/progress`)

**Interfaces:**
- Consumes: `isValidAssetId` from `./lib/media-path.js` (Task 1.1).

- [ ] **Step 1: Reproduce the alert condition**

Before the fix, confirm the gap: `curl -H "Authorization: Bearer <token>" "http://localhost:4000/video/../../etc/prepare"` — Fastify route matching will likely 404 this particular shape, but the underlying issue is that nothing in the handler body rejects a non-numeric `id`; CodeQL flags the *absence* of that check, not a working exploit today. No separate repro script is needed — the fix step's negative-case check (Step 3) is the verification.

- [ ] **Step 2: Add the import**

At the top of `apps/backend/src/index.ts`, alongside the other local imports (near line 26):

```ts
import { isValidAssetId } from './lib/media-path.js';
```

- [ ] **Step 3: Guard `/video/:id/prepare`**

In `apps/backend/src/index.ts`, immediately after `const { id } = request.params as { id: string };` inside the `/video/:id/prepare` handler (around line 494), add:

```ts
  const { id } = request.params as { id: string };
  if (!isValidAssetId(id)) {
    return reply.code(400).send({ error: 'Invalid asset id' });
  }
```

This runs before `playlistPath` is built at line 522-527, so the CodeQL sink at line 528 (`fs.existsSync(playlistPath)`) now only ever sees a validated numeric `id`.

- [ ] **Step 4: Guard `/video/:id/progress`**

Same pattern in the `/video/:id/progress` handler (around line 574):

```ts
fastify.get('/video/:id/progress', async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!isValidAssetId(id)) {
    return reply.code(400).send({ error: 'Invalid asset id' });
  }
  const playlistPath = path.resolve(
    path.dirname(config.thumbnailCachePath),
    'hls',
    id,
    'master.m3u8'
  );
```

- [ ] **Step 5: Verify**

Run: `npm --workspace=@mda/backend run build`
Expected: succeeds.

Runtime check (backend running locally): `curl "http://localhost:4000/video/not-a-number/progress"` → expect `400 {"error":"Invalid asset id"}` instead of a filesystem lookup.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/index.ts
git commit -m "security: validate asset id before building HLS paths"
```

### Task 1.3: Validate `assetId` in `ensureHLS` (alerts #12, #13)

**Files:**
- Modify: `apps/backend/src/services/video-transcode.ts:287-311`

**Interfaces:**
- Consumes: `isValidAssetId` from `./lib/media-path.js`.

- [ ] **Step 1: Add the import**

At the top of `apps/backend/src/services/video-transcode.ts`, add:

```ts
import { isValidAssetId } from './media-path.js';
```

(Adjust the relative path — `media-path.ts` lives in `apps/backend/src/lib/`, so from `apps/backend/src/services/video-transcode.ts` the import is `'../lib/media-path.js'`.)

- [ ] **Step 2: Guard `ensureHLS`**

In `apps/backend/src/services/video-transcode.ts`, at the top of `ensureHLS` (line 287):

```ts
export async function ensureHLS(filePath: string, assetId: string): Promise<string> {
  if (!isValidAssetId(assetId)) {
    throw new Error(`Invalid assetId: ${assetId}`);
  }
  const hlsDir = path.join(path.dirname(config.thumbnailCachePath), 'hls', assetId);
  const playlistPath = path.join(hlsDir, 'master.m3u8');
```

This covers both flagged sinks (`fs.access(playlistPath)` at the original lines 292 and 305) since both read `playlistPath`, which is now only built from a validated `assetId`.

- [ ] **Step 3: Verify**

Run: `npm --workspace=@mda/backend run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/services/video-transcode.ts
git commit -m "security: validate assetId before building HLS playlist path"
```

### Task 1.4: Switch upload-path containment check to the `path.relative` pattern (alerts #10, #11)

**Files:**
- Modify: `apps/backend/src/index.ts:1126-1158` (`/api/upload`)

**Interfaces:**
- Consumes: `resolveWithinRoot` from `./lib/media-path.js`.

- [ ] **Step 1: Replace the `startsWith` check**

In `apps/backend/src/index.ts`, replace the existing block (around lines 1126-1137):

```ts
  const { targetPath: rawTargetPath } = request.query as { targetPath?: string };
  const rootPath = path.resolve(config.mediaLibraryPath);
  let targetDir = rootPath;

  if (rawTargetPath) {
    const resolved = path.resolve(rawTargetPath);
    if (resolved === rootPath || resolved.startsWith(`${rootPath}${path.sep}`)) {
      targetDir = resolved;
    } else {
      return reply.code(400).send({ error: 'Invalid target path' });
    }
  }
```

with:

```ts
  const { targetPath: rawTargetPath } = request.query as { targetPath?: string };
  const rootPath = path.resolve(config.mediaLibraryPath);
  let targetDir = rootPath;

  if (rawTargetPath) {
    const resolved = resolveWithinRoot(rootPath, rawTargetPath);
    if (resolved === null) {
      return reply.code(400).send({ error: 'Invalid target path' });
    }
    targetDir = resolved;
  }
```

- [ ] **Step 2: Add the import**

Alongside the import added in Task 1.2 Step 2, extend it:

```ts
import { isValidAssetId, resolveWithinRoot } from './lib/media-path.js';
```

- [ ] **Step 3: Verify**

Run: `npm --workspace=@mda/backend run build`
Expected: succeeds.

Runtime check: as an admin/editor user, `curl -X POST -H "Authorization: Bearer <token>" "http://localhost:4000/api/upload?targetPath=/etc"` → expect `400 {"error":"Invalid target path"}` (assuming `/etc` is outside `MEDIA_LIBRARY_PATH`, which it should be in any real deployment).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/index.ts
git commit -m "security: use path.relative-based containment check for upload target path"
```

### Task 1.5: Re-check `capture-date.ts:192` and `media-indexer.ts:135`

**Files:**
- Read only (no expected code change): `apps/backend/src/services/capture-date.ts`, `apps/backend/src/services/media-indexer.ts`

- [ ] **Step 1: Trace whether Task 1.4 already closes these**

Both `updateCaptureDateForAsset(assetId, filePath)` and `indexFile(filePath, ...)` receive `filePath` that, for the upload flow, now originates from `destPath = path.join(targetDir, safeName)` where `targetDir` is validated by `resolveWithinRoot` (Task 1.4) and `safeName = path.basename(part.filename)` (already stripped of directory components). For the media-watcher flow, `filePath` comes from `chokidar` walking the real filesystem under `MEDIA_LIBRARY_PATH`, not from user input. Do not change these two files in this task — the fix is upstream.

- [ ] **Step 2: Leave a bread-crumb for Phase 5**

No code change. In Phase 5, after CodeQL re-scans the pushed commit, if alerts #6/#7 are still open, that means CodeQL's dataflow doesn't fully close the loop through Task 1.4's fix and these two sink sites need their own explicit guard (e.g., re-validate `filePath` is within `config.mediaLibraryPath` at the top of `indexFile` and `updateCaptureDateForAsset` using `resolveWithinRoot`). Flag this explicitly rather than guessing blind — Phase 5 has the concrete follow-up step.

### Task 1.6: Update the knowledge graph

- [ ] **Step 1:** Run `graphify update .` from the repo root. If the tool is unavailable or errors for environment reasons, note that in your final response instead of silently skipping it.

---

## Phase 2: Missing Rate Limiting (18 alerts, severity: warning)

**Alerts:** #17-#34, all in `apps/backend/src/index.ts`, at every non-`/health` REST route (`/download/:id`, `/file-preview/:id/pdf`, `/file-preview/:id/content` GET+PUT, `/download-zip`, `/image/:id`, `/video/:id/prepare`, `/video/:id/progress`, `/video/:id`, `/video/:id/hls`, `/video/:id/cleanup`, `/api/compress/preview`, `/api/compress/enqueue`, `/api/transcode/enqueue`, `/api/compress/cancel`, `/api/queue-state` GET+PUT, `/api/upload`).

**Root cause:** No rate-limiting middleware is registered anywhere in the Fastify app. `@fastify/rate-limit` is not in `apps/backend/package.json`.

### Task 2.1: Install and register `@fastify/rate-limit`

**Files:**
- Modify: `apps/backend/package.json`
- Modify: `apps/backend/src/index.ts:1-32` (imports + plugin registration)

- [ ] **Step 1: Install the package**

```bash
npm --workspace=@mda/backend install @fastify/rate-limit
```

Expected: adds `"@fastify/rate-limit": "^..."` to `apps/backend/package.json` dependencies, compatible with the existing Fastify 5.x.

- [ ] **Step 2: Import it**

In `apps/backend/src/index.ts`, add near the other `@fastify/*` imports (top of file, near line 5):

```ts
import rateLimit from '@fastify/rate-limit';
```

- [ ] **Step 3: Register it globally, before the routes are declared**

In `apps/backend/src/index.ts`, add right after the existing `cors` registration (after line 94-ish, before `jwt`/`multipart`/routes):

```ts
await fastify.register(rateLimit, {
  max: 300,
  timeWindow: '1 minute',
});
```

This alone should clear all 18 alerts, since CodeQL's `js/missing-rate-limiting` query checks whether any rate-limiting plugin guards the route — a global registration covers every route in the app, including ones added later.

- [ ] **Step 4: Verify build**

Run: `npm --workspace=@mda/backend run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/package.json apps/backend/package-lock.json apps/backend/src/index.ts
git commit -m "security: add global rate limiting to close missing-rate-limiting alerts"
```

### Task 2.2: Tighten limits on expensive routes

**Files:**
- Modify: `apps/backend/src/index.ts` — route declarations for `/api/upload` (line ~1110), `/api/compress/enqueue` (line ~877), `/api/transcode/enqueue` (line ~942), `/download-zip` (line ~324)

- [ ] **Step 1: Add per-route overrides**

Fastify's rate-limit plugin reads a `config.rateLimit` object per route. For each of the four routes above, add a `config` object as the second argument to the route registration. Example for upload (around line 1110):

```ts
fastify.post('/api/upload', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
```

Apply the same `{ config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }` pattern to `/download-zip` (archive creation is CPU/IO heavy) and `{ max: 20, timeWindow: '1 minute' }` to `/api/compress/enqueue` and `/api/transcode/enqueue` (queue-backed but still worth throttling at the ingress).

- [ ] **Step 2: Verify**

Run: `npm --workspace=@mda/backend run build`
Expected: succeeds.

Runtime check: hit `/api/upload` 11 times in under a minute with a valid token → expect the 11th response to be `429 Too Many Requests`.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/index.ts
git commit -m "security: tighten rate limits on upload/compress/transcode/zip endpoints"
```

### Task 2.3: Update the knowledge graph

- [ ] **Step 1:** Run `graphify update .`.

---

## Phase 3: Insecure Randomness (5 alerts, severity: warning)

**Alerts:** #1 `timeline.tsx:480`, #2 `timeline.tsx:978`, #3-#5 `dashboard.tsx:1050,1126,2083`.

**Root cause:** Both `apps/web/app/routes/timeline.tsx:176` and `apps/web/app/routes/dashboard.tsx:71` generate a client-side "thumbnail session id" using `crypto.randomUUID()` when available, falling back to `` `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` `` when it isn't. CodeQL flags the `Math.random()` branch; the flagged line numbers are downstream *uses* of the resulting session id (GraphQL mutation calls), not the generator itself, because that's where CodeQL's `js/insecure-randomness` query reports the taint reaching a security-relevant sink (a value sent to the server to correlate/cancel a job). `crypto.randomUUID()` is supported in all browsers this app targets (mirrors the existing feature-detection already in the code, so no new browser-support risk), so the simplest fix is to drop the `Math.random()` branch and always use the Web Crypto API, with `crypto.getRandomValues()` as the fallback instead of `Math.random()`.

### Task 3.1: Fix `dashboard.tsx`'s session id generator

**Files:**
- Modify: `apps/web/app/routes/dashboard.tsx:65-72` (or wherever `generateThumbnailSessionId` is defined — confirmed at line 71 today)

- [ ] **Step 1: Read the current implementation**

Current code (lines 67-72):

```ts
function generateThumbnailSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
```

- [ ] **Step 2: Replace the fallback**

```ts
function generateThumbnailSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${Date.now()}-${hex}`;
}
```

The remaining `Math.random()` call is now unreachable in any browser this app supports (Web Crypto has been available since IE11/all evergreen browsers), so CodeQL's dataflow no longer finds a realistic path from `Math.random()` to the session-id sinks at lines 1050, 1126, 2083.

- [ ] **Step 3: Verify**

Run: `npm --workspace=@mda/web run build`
Expected: succeeds.

Runtime check: open the dashboard in a browser, trigger thumbnail generation (scroll to load more media), open devtools console, confirm no errors and that `thumbnailSessionIdRef.current` looks like `<timestamp>-<32 hex chars>` or a UUID.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/routes/dashboard.tsx
git commit -m "security: use crypto.getRandomValues instead of Math.random for session id fallback"
```

### Task 3.2: Fix `timeline.tsx`'s session id generator

**Files:**
- Modify: `apps/web/app/routes/timeline.tsx:172-177` (the `sessionId` generator, confirmed at lines 174-176)

- [ ] **Step 1: Read the current implementation**

```ts
typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
  ? crypto.randomUUID()
  : `tl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
```

- [ ] **Step 2: Extract into a named function using the same pattern as Task 3.1**

Replace the inline ternary with a function (mirroring `dashboard.tsx` for consistency) and update its call site:

```ts
function generateTimelineSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `tl-${Date.now()}-${hex}`;
}
```

Update the call site (originally the inline ternary feeding `sessionId()` at line 174, used at `thumbnailSessionIdRef` line 287) to call `generateTimelineSessionId()` instead.

- [ ] **Step 3: Verify**

Run: `npm --workspace=@mda/web run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/routes/timeline.tsx
git commit -m "security: use crypto.getRandomValues instead of Math.random for session id fallback"
```

### Task 3.3: Update the knowledge graph

- [ ] **Step 1:** Run `graphify update .`.

---

## Phase 4: Tainted Format String / Log Injection (3 alerts, severity: warning)

**Alerts:** #14 `media-indexer.ts:234`, #15 `video-transcode.ts:219`, #16 `video-transcode.ts:222`.

**Root cause:** User-influenced values (`filePath`, `assetId`) are interpolated directly into a template literal that is the first argument to `console.error`/`console.log`. CodeQL's `js/tainted-format-string` sink is the *format-string position specifically* — passing the same value as a separate trailing argument instead of interpolating it removes the sink without losing any log information, and matches the structured-logging style already used elsewhere in this codebase (`fastify.log.error({ err }, '[prepare] unexpected error')`).

### Task 4.1: Fix `media-indexer.ts:234`

**Files:**
- Modify: `apps/backend/src/services/media-indexer.ts:233-235`

- [ ] **Step 1: Replace the interpolated log call**

Current (lines 233-235):

```ts
  } catch (error) {
    console.error(`Error indexing file ${filePath}:`, error);
    throw error; // Re-throw so watcher can log it properly
  }
```

New:

```ts
  } catch (error) {
    console.error('Error indexing file:', filePath, error);
    throw error; // Re-throw so watcher can log it properly
  }
```

- [ ] **Step 2: Verify**

Run: `npm --workspace=@mda/backend run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/services/media-indexer.ts
git commit -m "security: avoid interpolating tainted path into log format string"
```

### Task 4.2: Fix `video-transcode.ts:219` and `:222`

**Files:**
- Modify: `apps/backend/src/services/video-transcode.ts:217-223`

- [ ] **Step 1: Replace both interpolated log calls**

Current (lines 217-223):

```ts
    } catch (accessError) {
      // File doesn't exist or was already deleted - this is expected if video was web-compatible
      console.log(`[deleteTranscodedVideo] No transcoded video found for asset ${assetId} at ${transcodedPath}`, accessError instanceof Error ? accessError.message : '');
    }
  } catch (error) {
    console.error(`[deleteTranscodedVideo] Error for asset ${assetId}:`, error);
  }
```

New:

```ts
    } catch (accessError) {
      // File doesn't exist or was already deleted - this is expected if video was web-compatible
      console.log('[deleteTranscodedVideo] No transcoded video found for asset', assetId, 'at', transcodedPath, accessError instanceof Error ? accessError.message : '');
    }
  } catch (error) {
    console.error('[deleteTranscodedVideo] Error for asset', assetId, ':', error);
  }
```

- [ ] **Step 2: Verify**

Run: `npm --workspace=@mda/backend run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/services/video-transcode.ts
git commit -m "security: avoid interpolating tainted assetId into log format string"
```

### Task 4.3: Update the knowledge graph

- [ ] **Step 1:** Run `graphify update .`.

---

## Phase 5: Verify and Close

- [ ] **Step 1: Push and let CodeQL re-scan**

Push the commits from Phases 1-4 (on whatever branch/PR the user directs — do not push without confirmation). CodeQL's default setup runs on push in addition to its weekly schedule, so a scan should kick off automatically.

- [ ] **Step 2: Poll the alert list**

```bash
gh api --paginate "repos/vijayyadav1002/mda/code-scanning/alerts?state=open&per_page=100" \
  | jq -r '.[] | [.number, .rule.id, .most_recent_instance.location.path, .most_recent_instance.location.start_line] | @tsv'
```

Compare against the Phase 0 baseline (34 alerts: #1-#34, listed at the top of this plan's investigation). Expect the count to drop toward 0 as each phase's commit is scanned. CodeQL scans can take several minutes; if the count hasn't moved, check `gh api repos/vijayyadav1002/mda/code-scanning/analyses --paginate | jq -r '.[0]'` for the most recent analysis timestamp/commit before assuming a fix didn't work.

- [ ] **Step 3: Handle stragglers**

If `capture-date.ts:192` or `media-indexer.ts:135` (alerts #6/#7) are still open after Phase 1 lands, apply the explicit guard flagged in Task 1.5 Step 2: add `resolveWithinRoot(config.mediaLibraryPath, filePath)` checks at the top of `indexFile()` and `updateCaptureDateForAsset()`, returning/throwing on `null` the same way Task 1.4 does. Re-push and re-poll.

If any other alert persists after its phase, re-read the specific alert via `gh api repos/vijayyadav1002/mda/code-scanning/alerts/<number>` for CodeQL's exact flagged code path (it includes a `codeFlows`/`instances` breakdown) rather than guessing — the fix pattern may need to move one hop further up or down the call chain.

- [ ] **Step 4: Final graph update**

Run `graphify update .` once more so `graphify-out/GRAPH_REPORT.md` reflects the final state (new `lib/media-path.ts` module, rate-limit plugin, etc.).

---

## Self-Review Notes

- **Spec coverage:** All 34 alerts are covered — 8 path-injection → Phase 1 (Tasks 1.2-1.4 fix 6 directly; Task 1.5 explicitly hands off the remaining 2 to Phase 5 rather than guessing), 18 missing-rate-limiting → Phase 2 (Task 2.1 alone should close all 18; Task 2.2 is defense-in-depth, not required for alert closure), 5 insecure-randomness → Phase 3 (2 generator functions, 5 downstream sinks), 3 tainted-format-string → Phase 4.
- **Placeholder scan:** No "TBD"/"handle appropriately" steps. The one open-ended step (Task 1.5, Phase 5 Step 3) is explicit about *why* it's open (can't run CodeQL locally to confirm dataflow closure) and gives the exact fallback fix rather than leaving it vague.
- **Type consistency:** `isValidAssetId`, `resolveWithinRoot`, `joinWithinRoot` are defined once in Task 1.1 and referenced with identical names/signatures in Tasks 1.2-1.4.
