# Raise text copy / preview / save size limits

**Goal:** Let text, markdown, and other text-like files well over 2 MB preview, copy, and save in the viewer.

**Classification:** Bounded change to an existing flow (text preview + Copy + edit/save). No new subsystem.

## What is actually blocking you today

The copy button is not a separate clipboard quota. It is gated by the same 2 MB text-content cap that also blocks preview and save.

| Limit | Where | What it does | In this change? |
|---|---|---|---|
| **2 MB `MAX_TEXT_CONTENT_BYTES`** | `apps/backend/src/services/file-types.ts` | GET `/file-preview/:id/content` returns **413** if the file is larger. PUT save also 413s. Frontend then shows “Preview could not be loaded” and Copy never gets content. | **Yes — this is the bug.** |
| Fastify JSON `bodyLimit` (default **1 MB**) | `apps/backend/src/index.ts` (unset) | PUT `{ text }` is JSON. Saves above ~1 MB can fail *before* the 2 MB check. | **Yes — must rise with the new cap.** |
| Frontend `truncated` flag | `DocumentPreview.tsx` | Copy is disabled when `truncated === true`. Backend currently never returns truncated text; it 413s instead. | Keep, but it stays unused unless we later add partial preview. |
| **1 GB multipart upload** | `index.ts` multipart `fileSize` + Upload dialog copy | Caps *all* uploads (images/videos/text). | **No.** Already huge for notes. Disk library itself has no extra per-file quota. |
| Thumbnail snippet | `thumbnail/pdf-doc.ts` | Reads a small text snippet for the grid thumbnail. | **No.** Unrelated to copy. |

Text files dropped into `media-files/` can already be larger than 2 MB on disk. The indexer stores them. The viewer just refuses to load/copy/save them.

Applies to the existing text-like set: `.md` / `.markdown`, `.txt`, `.json`, `.xml`, `.csv`, `.js/.ts/.tsx/.jsx`, `.yaml/.yml`, `.html/.css`, plus `text/*` and the `TEXT_LIKE_APPLICATION_MIMES` list.

## Recommended approach

**Raise the text-content cap from 2 MB to 50 MB** for preview, copy, and save. Do not make it truly unlimited.

Why not “no limit”:

- Preview loads the whole file into Node, then into the browser, then ReactMarkdown / `<pre>`. A multi-hundred-MB log will freeze the tab and the backend process.
- `navigator.clipboard.writeText` also has practical browser limits.
- 50 MB is far above normal notes/docs and is enough that the 2 MB wall goes away for real use.

If you want a different number (100 MB) or a hard “no cap at all,” that is a one-constant change after this.

**Out of scope unless you ask:** raising or removing the 1 GB upload cap. That exists to protect the server from huge video dumps, not from markdown.

## Design

1. **Single shared constant** stays `MAX_TEXT_CONTENT_BYTES`, bumped to `50 * 1024 * 1024` in:
   - `apps/backend/src/services/file-types.ts`
   - `apps/web/app/lib/file-type.ts` (keep in sync even though it is currently unused)

2. **Preview GET** (`file-preview.routes.ts` `readUtf8TextFile`): still reject oversize with 413, but the message uses the new cap. Keep `looksLikeBinary` so a mislabeled binary file is not dumped as UTF-8.

3. **Save PUT**: same 50 MB check on the encoded UTF-8 buffer. Update the error string.

4. **Fastify `bodyLimit`**: set on the Fastify constructor to at least `MAX_TEXT_CONTENT_BYTES` (50 MB). Without this, JSON saves still fail around 1 MB.

5. **Copy UI**: no logic change needed once preview succeeds. Copy already writes `textBody` to the clipboard and is only disabled on `truncated` / loading / empty. After the backend serves files up to 50 MB, Copy works for those files.

6. **Error copy**: keep the existing 413 → “Preview could not be loaded” path for files still over the cap (or binary). Do not add a new settings UI.

## Files

- Modify: `apps/backend/src/services/file-types.ts` — constant + comment
- Modify: `apps/backend/src/routes/file-preview.routes.ts` — error strings that hardcode “max 2 MB”
- Modify: `apps/backend/src/index.ts` — `bodyLimit` aligned with the text cap
- Modify: `apps/web/app/lib/file-type.ts` — matching constant + comment

No schema, migration, or GraphQL changes.

## Implementation steps

1. Change `MAX_TEXT_CONTENT_BYTES` to `50 * 1024 * 1024` on backend and frontend; comments should say it is a safety cap for preview/copy/save, not a library storage quota.
2. Replace hardcoded “max 2 MB” strings in `file-preview.routes.ts` so they stay accurate (either interpolate from the constant or say “file is too large to preview or copy”).
3. Add `bodyLimit: MAX_TEXT_CONTENT_BYTES` (import the constant) on the Fastify instance in `index.ts`.
4. Typecheck: `npm --workspace=@mda/backend run build` and `npm --workspace=@mda/web run build`.
5. Runtime check against a local backend:
   - File **under 2 MB**: preview, Copy (button + Ctrl/⌘⇧C), edit/save still work.
   - File **between 2 MB and 50 MB** (`.md` and `.txt`): preview loads, Copy succeeds, save of a small edit succeeds.
   - File **over 50 MB**: still 413 / preview error (safety net).
   - Binary-looking file: still 415.
6. Browser: open the dashboard viewer on a >2 MB markdown file, copy, then save. Also check a small `.txt` so the existing path did not regress. Desktop viewport is enough (this is the existing viewer chrome, not a layout change).

There is no package-level test script in this repo; do not add a test runner for this.

## Risks (accepted)

- A 50 MB markdown file will be slow to render with `react-markdown`. Acceptable for this change; we are not adding virtualized preview.
- Clipboard of a 50 MB string may fail on some browsers; the existing “Couldn't copy” toast already covers that.
- Fastify will hold a 50 MB JSON body in memory on save. Same class of cost as today’s 2 MB path, larger.

## Not doing

- Removing the 1 GB upload limit or adding “unlimited disk” for the media library.
- Streaming/chunked preview or a dedicated copy-only endpoint.
- Admin-configurable cap.
- Changing Word/Excel preview row/col/size caps.
