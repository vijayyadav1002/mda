# Per-File Compression Confirm/Discard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single batch confirm/discard in the compression queue with per-file Keep/Skip actions, so each compressed file can be accepted or rejected independently.

**Architecture:** The backend GraphQL mutations (`confirmCompressReplace` and `cancelCompressPreview`) already accept ID arrays, so they work unchanged for single-ID calls — no backend changes needed. The change is entirely frontend: extend `CompressJob` with a `fileStatuses` field for per-file decisions, add per-file handlers in `dashboard.tsx`, fix the 5-second polling loop to preserve `fileStatuses` on update, and update `CompressQueuePanel.tsx` to render per-file Keep/Skip buttons in the results table. Batch "Keep All" / "Discard All" buttons remain for convenience.

**Tech Stack:** React (Remix), TypeScript, graphql-request, Tailwind CSS, shadcn/Radix UI

## Global Constraints

- No backend changes — existing mutations already support single-ID arrays
- `fileStatuses` must survive the 5-second polling cycle; polling currently replaces the full queue (line 1117 of dashboard.tsx), so a merge is required
- Match existing Tailwind/shadcn style in CompressQueuePanel.tsx (bg-muted, rounded-xl, label-meta, text-muted-foreground, brand-primary, emerald-500, etc.)
- Batch "Keep All" / "Discard All" convenience buttons remain; their labels update to "Keep Remaining (N)" when some files are already decided
- Job auto-transitions to `done` when all files are individually confirmed; auto-removes when all are individually skipped

---

## File Structure

**Only two files are modified:**
- `apps/web/app/components/CompressQueuePanel.tsx` — `CompressJob` interface, `CompressQueuePanelProps`, results table rows (lines 232–259), batch buttons (lines 298–318)
- `apps/web/app/routes/dashboard.tsx` — `addToCompressQueue`, queue restore/poll logic, new per-file handlers, updated batch handlers, `<CompressQueuePanel>` JSX props

---

### Task 0: Export plan to project-local path

**Files:**
- Create: `.plan/compression-options-separate-confirmation.plan.md`

- [ ] **Step 1: Create the plan directory and write this plan there**

```bash
mkdir -p /Users/vijay/Projects/mda/.plan
cp /Users/vijay/.claude/plans/prompts-compress-options-prompt-md-stateful-orbit.md \
   /Users/vijay/Projects/mda/.plan/compression-options-separate-confirmation.plan.md
```

Expected: `.plan/compression-options-separate-confirmation.plan.md` exists.

---

### Task 1: Extend CompressJob type with per-file status tracking

**Files:**
- Modify: `apps/web/app/components/CompressQueuePanel.tsx:19-29` — CompressJob interface
- Modify: `apps/web/app/routes/dashboard.tsx:1092-1103` — queue restore
- Modify: `apps/web/app/routes/dashboard.tsx:1114-1119` — polling handler
- Modify: `apps/web/app/routes/dashboard.tsx:1134-1143` — addToCompressQueue job creation

**Interfaces:**
- Produces: `CompressJob.fileStatuses: Record<string, "pending" | "confirming" | "confirmed" | "discarded" | "error">`

- [ ] **Step 1: Add fileStatuses to CompressJob interface**

In `apps/web/app/components/CompressQueuePanel.tsx`, update the exported `CompressJob` interface (lines 19–29):

```typescript
export interface CompressJob {
  id: string;
  assets: MediaAsset[];
  options: { resolution: string; quality: number };
  status: "pending" | "compressing" | "preview_ready" | "confirming" | "done" | "error" | "cancelled";
  progress: Record<string, { percent: number; etaSeconds: number | null }>;
  currentFileId: string | null;
  previews: CompressPreviewResult[];
  fileStatuses: Record<string, "pending" | "confirming" | "confirmed" | "discarded" | "error">;
  addedAt: number;
  errorMessage?: string;
}
```

- [ ] **Step 2: Initialize fileStatuses when enqueuing a new job**

In `apps/web/app/routes/dashboard.tsx`, in `addToCompressQueue` (lines 1134–1143), add `fileStatuses` to the new job object:

```typescript
setCompressQueue(prev => [...prev, {
  id: jobId,
  assets,
  options,
  status: "pending" as const,
  progress: {},
  currentFileId: null,
  previews: [],
  fileStatuses: Object.fromEntries(assets.map(a => [a.id, "pending" as const])),
  addedAt: Date.now(),
}]);
```

- [ ] **Step 3: Add fileStatuses fallback in queue restore (initial load)**

In `dashboard.tsx`, the queue restore `useEffect` at lines 1092–1103 currently does:
```typescript
setCompressQueue(
  (queue as CompressJob[]).map(job => ({
    ...job,
    progress: {},
    currentFileId: null,
    status: (
      job.status === "compressing" ? "pending"
      : job.status === "confirming" ? "preview_ready"
      : job.status
    ) as CompressJob["status"],
  }))
);
```

Replace with (adds `fileStatuses` fallback for jobs saved before this change):
```typescript
setCompressQueue(
  (queue as CompressJob[]).map(job => ({
    ...job,
    progress: {},
    currentFileId: null,
    fileStatuses: job.fileStatuses ?? Object.fromEntries(
      (job.assets ?? []).map(a => [
        a.id,
        job.status === "done" ? "confirmed" as const : "pending" as const,
      ])
    ),
    status: (
      job.status === "compressing" ? "pending"
      : job.status === "confirming" ? "preview_ready"
      : job.status
    ) as CompressJob["status"],
  }))
);
```

- [ ] **Step 4: Fix polling to preserve local fileStatuses**

In `dashboard.tsx`, line 1117 currently replaces the entire queue:
```typescript
.then(({ queue }) => { if (Array.isArray(queue)) setCompressQueue(queue as CompressJob[]); })
```

Replace with a merge that keeps per-file decisions already made locally:
```typescript
.then(({ queue }) => {
  if (!Array.isArray(queue)) return;
  setCompressQueue(prev =>
    (queue as CompressJob[]).map(serverJob => {
      const local = prev.find(j => j.id === serverJob.id);
      return {
        ...serverJob,
        fileStatuses: local?.fileStatuses ?? Object.fromEntries(
          (serverJob.assets ?? []).map(a => [a.id, "pending" as const])
        ),
      };
    })
  );
})
```

- [ ] **Step 5: Build to verify types compile**

```bash
npm --workspace=@mda/web run build
```

Expected: No TypeScript errors. `fileStatuses` is now a required field on `CompressJob`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/CompressQueuePanel.tsx apps/web/app/routes/dashboard.tsx
git commit -m "feat: extend CompressJob with fileStatuses for per-file decision tracking"
```

---

### Task 2: Add per-file confirm and discard handlers in dashboard.tsx

**Files:**
- Modify: `apps/web/app/routes/dashboard.tsx:1160-1198` — update batch handlers
- Modify: `apps/web/app/routes/dashboard.tsx` — insert two new handlers after line 1198
- Modify: `apps/web/app/components/CompressQueuePanel.tsx:31-40` — add optional props to Props
- Modify: `apps/web/app/components/CompressQueuePanel.tsx:83-85` — destructure new props
- Modify: `apps/web/app/routes/dashboard.tsx:2993-3002` — pass new props to panel

**Interfaces:**
- Consumes: `CompressJob.fileStatuses` (Task 1)
- Consumes: `CONFIRM_COMPRESS_MUTATION` (line 73) — `mutation ConfirmCompressReplace($ids: [ID!]!)`
- Consumes: `CANCEL_COMPRESS_MUTATION` (line 79) — `mutation CancelCompressPreview($ids: [ID!]!)`
- Produces: `confirmSingleCompressFile(jobId: string, assetId: string): Promise<void>`
- Produces: `discardSingleCompressFile(jobId: string, assetId: string): Promise<void>`

- [ ] **Step 1: Update confirmCompressJob to only act on pending files**

Replace `confirmCompressJob` (lines 1160–1179) with:

```typescript
const confirmCompressJob = useCallback(async (jobId: string) => {
  const job = compressQueueRef.current.find(j => j.id === jobId);
  if (!job) return;
  const pendingIds = job.assets
    .filter(a => (job.fileStatuses?.[a.id] ?? "pending") === "pending")
    .map(a => a.id);
  if (pendingIds.length === 0) return;

  setCompressQueue(prev => prev.map(j => j.id !== jobId ? j : {
    ...j,
    status: "confirming" as const,
    fileStatuses: {
      ...j.fileStatuses,
      ...Object.fromEntries(pendingIds.map(id => [id, "confirming" as const])),
    },
  }));
  try {
    const token = getAuthToken();
    if (!token) throw new Error("Not authenticated");
    await createGraphQLClient(token).request(CONFIRM_COMPRESS_MUTATION, { ids: pendingIds });
    const updated = compressQueueRef.current.map(j => j.id !== jobId ? j : {
      ...j,
      status: "done" as const,
      fileStatuses: {
        ...j.fileStatuses,
        ...Object.fromEntries(pendingIds.map(id => [id, "confirmed" as const])),
      },
    });
    setCompressQueue(updated);
    saveQueueToServer(updated);
    if (currentPath) await loadDirectoryIntoCache(currentPath);
    if (rootPath && rootPath !== currentPath) await loadDirectoryIntoCache(rootPath);
  } catch (err: any) {
    setCompressQueue(prev => prev.map(j => j.id !== jobId ? j : {
      ...j,
      status: "error" as const,
      fileStatuses: {
        ...j.fileStatuses,
        ...Object.fromEntries(pendingIds.map(id => [id, "pending" as const])),
      },
      errorMessage: err.message || "Failed to apply compression",
    }));
  }
}, [currentPath, rootPath, saveQueueToServer]);
```

- [ ] **Step 2: Update dismissCompressJob to cancel only pending-file previews**

Replace `dismissCompressJob` (lines 1181–1198) with:

```typescript
const dismissCompressJob = useCallback((jobId: string) => {
  const job = compressQueueRef.current.find(j => j.id === jobId);
  if (!job) return;
  const pendingIds = job.assets
    .filter(a => (job.fileStatuses?.[a.id] ?? "pending") === "pending")
    .map(a => a.id);
  if (pendingIds.length > 0) {
    const token = getAuthToken();
    if (token) {
      createGraphQLClient(token)
        .request(CANCEL_COMPRESS_MUTATION, { ids: pendingIds })
        .catch(() => {});
    }
  }
  setCompressQueue(prev => {
    const updated = prev.filter(j => j.id !== jobId);
    saveQueueToServer(updated);
    return updated;
  });
}, [saveQueueToServer]);
```

- [ ] **Step 3: Add confirmSingleCompressFile handler (insert after dismissCompressJob)**

```typescript
const confirmSingleCompressFile = useCallback(async (jobId: string, assetId: string) => {
  setCompressQueue(prev => prev.map(j => j.id !== jobId ? j : {
    ...j,
    fileStatuses: { ...j.fileStatuses, [assetId]: "confirming" as const },
  }));
  try {
    const token = getAuthToken();
    if (!token) throw new Error("Not authenticated");
    await createGraphQLClient(token).request(CONFIRM_COMPRESS_MUTATION, { ids: [assetId] });
    setCompressQueue(prev => {
      const updated = prev.map(j => {
        if (j.id !== jobId) return j;
        const newStatuses = { ...j.fileStatuses, [assetId]: "confirmed" as const };
        const allDecided = Object.values(newStatuses).every(
          s => s === "confirmed" || s === "discarded" || s === "error"
        );
        return { ...j, fileStatuses: newStatuses, status: allDecided ? "done" as const : j.status };
      });
      saveQueueToServer(updated);
      return updated;
    });
    if (currentPath) await loadDirectoryIntoCache(currentPath);
    if (rootPath && rootPath !== currentPath) await loadDirectoryIntoCache(rootPath);
  } catch (err: any) {
    setCompressQueue(prev => prev.map(j => j.id !== jobId ? j : {
      ...j,
      fileStatuses: { ...j.fileStatuses, [assetId]: "error" as const },
    }));
  }
}, [currentPath, rootPath, saveQueueToServer]);
```

- [ ] **Step 4: Add discardSingleCompressFile handler (insert after confirmSingleCompressFile)**

```typescript
const discardSingleCompressFile = useCallback(async (jobId: string, assetId: string) => {
  try {
    const token = getAuthToken();
    if (token) {
      await createGraphQLClient(token).request(CANCEL_COMPRESS_MUTATION, { ids: [assetId] });
    }
  } catch {
    // best-effort preview cleanup — don't block the UI update
  }
  setCompressQueue(prev => {
    const updated = prev.map(j => {
      if (j.id !== jobId) return j;
      const newStatuses = { ...j.fileStatuses, [assetId]: "discarded" as const };
      const allDecided = Object.values(newStatuses).every(
        s => s === "confirmed" || s === "discarded" || s === "error"
      );
      const anyConfirmed = Object.values(newStatuses).some(s => s === "confirmed");
      if (allDecided && !anyConfirmed) return null; // all skipped → remove job
      return { ...j, fileStatuses: newStatuses, status: allDecided ? "done" as const : j.status };
    }).filter((j): j is CompressJob => j !== null);
    saveQueueToServer(updated);
    return updated;
  });
}, [saveQueueToServer]);
```

- [ ] **Step 5: Add optional onConfirmFile / onDiscardFile to CompressQueuePanelProps**

In `apps/web/app/components/CompressQueuePanel.tsx`, update the Props interface (lines 31–40) and destructure (line 83–85):

```typescript
interface CompressQueuePanelProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly jobs: CompressJob[];
  readonly onConfirm: (jobId: string) => void;
  readonly onDismiss: (jobId: string) => void;
  readonly onCancel: (jobId: string) => void;
  readonly onClearCompleted: () => void;
  readonly onConfirmFile?: (jobId: string, assetId: string) => void;
  readonly onDiscardFile?: (jobId: string, assetId: string) => void;
  readonly apiUrl: string;
}
```

```typescript
export function CompressQueuePanel({
  isOpen, onClose, jobs, onConfirm, onDismiss, onCancel, onClearCompleted,
  onConfirmFile, onDiscardFile, apiUrl,
}: CompressQueuePanelProps) {
```

- [ ] **Step 6: Pass new handlers to CompressQueuePanel**

In `dashboard.tsx`, update the `<CompressQueuePanel>` JSX (lines 2993–3002):

```jsx
<CompressQueuePanel
  isOpen={showQueuePanel}
  onClose={() => setShowQueuePanel(false)}
  jobs={compressQueue}
  onConfirm={confirmCompressJob}
  onDismiss={dismissCompressJob}
  onCancel={cancelCompressJob}
  onClearCompleted={clearCompletedJobs}
  onConfirmFile={confirmSingleCompressFile}
  onDiscardFile={discardSingleCompressFile}
  apiUrl={API_URL}
/>
```

- [ ] **Step 7: Build to verify types compile**

```bash
npm --workspace=@mda/web run build
```

Expected: No TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/routes/dashboard.tsx apps/web/app/components/CompressQueuePanel.tsx
git commit -m "feat: add per-file compress confirm/discard handlers and wire to panel"
```

---

### Task 3: Update CompressQueuePanel UI with per-file action buttons

**Files:**
- Modify: `apps/web/app/components/CompressQueuePanel.tsx:31-40` — make props required
- Modify: `apps/web/app/components/CompressQueuePanel.tsx:232-318` — results table + batch buttons

**Interfaces:**
- Consumes: `onConfirmFile(jobId: string, assetId: string)` — required (Task 2)
- Consumes: `onDiscardFile(jobId: string, assetId: string)` — required (Task 2)
- Consumes: `CompressJob.fileStatuses` (Task 1)
- Consumes: `previewAssetId` state (line 87) and `setPreviewAssetId` for the inline preview toggle

- [ ] **Step 1: Make onConfirmFile and onDiscardFile required in Props**

In `CompressQueuePanel.tsx`, remove the `?` from the two new props:

```typescript
interface CompressQueuePanelProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly jobs: CompressJob[];
  readonly onConfirm: (jobId: string) => void;
  readonly onDismiss: (jobId: string) => void;
  readonly onCancel: (jobId: string) => void;
  readonly onClearCompleted: () => void;
  readonly onConfirmFile: (jobId: string, assetId: string) => void;
  readonly onDiscardFile: (jobId: string, assetId: string) => void;
  readonly apiUrl: string;
}
```

- [ ] **Step 2: Replace results table rows (lines 232–259) with per-file action columns**

The current results grid is `grid-cols-[1fr_68px_68px_52px_32px]` (5 columns: File, Before, After, Saved, Eye). Replace the entire `<div className="bg-muted rounded-xl overflow-hidden">` block (lines 232–259) with a 6-column layout that adds a Keep/Skip column:

```jsx
{/* Results table */}
<div className="bg-muted rounded-xl overflow-hidden">
  <div className="grid grid-cols-[1fr_68px_68px_52px_28px_96px] gap-1 px-3 py-2">
    {["File", "Before", "After", "Saved", "", ""].map((h, i) => (
      <span key={i} className={`label-meta ${h && h !== "File" ? "text-right" : ""}`}>{h}</span>
    ))}
  </div>
  <div className="max-h-44 overflow-auto divide-y divide-border/10">
    {job.previews.map(p => {
      const asset = job.assets.find(a => a.id === p.assetId);
      const fileStatus = job.fileStatuses?.[p.assetId] ?? "pending";
      const isPending = fileStatus === "pending";
      const isConfirming = fileStatus === "confirming";
      const isConfirmed = fileStatus === "confirmed";
      const isDiscarded = fileStatus === "discarded";
      return (
        <div
          key={p.assetId}
          className={`grid grid-cols-[1fr_68px_68px_52px_28px_96px] gap-1 px-3 py-2 items-center text-xs transition-opacity ${
            isConfirmed ? "opacity-50" : isDiscarded ? "opacity-30" : ""
          }`}
        >
          <span className={`truncate text-foreground ${isDiscarded ? "line-through text-muted-foreground" : ""}`}>
            {asset?.fileName ?? p.assetId}
          </span>
          <span className="text-right text-muted-foreground">{fmt(p.originalSize)}</span>
          <span className="text-right text-foreground">{fmt(p.compressedSize)}</span>
          <span className="text-right text-emerald-400 font-medium">{savings(p.originalSize, p.compressedSize)}</span>
          {/* Preview eye */}
          <button
            type="button"
            onClick={() => setPreviewAssetId(previewAssetId === p.assetId ? null : p.assetId)}
            disabled={isDiscarded}
            className="p-1 hover:bg-accent rounded-lg transition-colors flex justify-center disabled:opacity-30"
            title="Preview"
          >
            <Eye className="w-3 h-3 text-brand-primary" />
          </button>
          {/* Per-file action */}
          <div className="flex justify-end gap-1">
            {isConfirmed && (
              <span className="text-emerald-400 text-[10px] flex items-center gap-0.5">
                <Check className="w-3 h-3" /> Kept
              </span>
            )}
            {isDiscarded && (
              <span className="text-muted-foreground text-[10px]">Skipped</span>
            )}
            {(isPending || isConfirming) && (
              <>
                <button
                  type="button"
                  onClick={() => onConfirmFile(job.id, p.assetId)}
                  disabled={isConfirming || job.status === "confirming"}
                  className="px-1.5 py-0.5 text-[10px] rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 disabled:opacity-40 transition-colors"
                  title="Keep this file"
                >
                  {isConfirming ? "…" : "Keep"}
                </button>
                <button
                  type="button"
                  onClick={() => onDiscardFile(job.id, p.assetId)}
                  disabled={isConfirming || job.status === "confirming"}
                  className="px-1.5 py-0.5 text-[10px] rounded-lg bg-muted hover:bg-accent text-muted-foreground disabled:opacity-40 transition-colors"
                  title="Skip this file"
                >
                  Skip
                </button>
              </>
            )}
          </div>
        </div>
      );
    })}
  </div>
</div>
```

- [ ] **Step 3: Update batch buttons (lines 298–318) to show pending-aware labels**

Replace the entire `<div className="flex gap-2 justify-end">` block (lines 298–318) with:

```jsx
{(() => {
  const pendingCount = job.previews.filter(
    p => (job.fileStatuses?.[p.assetId] ?? "pending") === "pending"
  ).length;
  const allPending = pendingCount === job.previews.length;
  const hasPending = pendingCount > 0;
  return (
    <div className="flex gap-2 justify-end">
      <button
        type="button"
        onClick={() => onDismiss(job.id)}
        disabled={job.status === "confirming" || !hasPending}
        className="px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all disabled:opacity-40"
      >
        {allPending ? "Discard All" : `Skip Remaining (${pendingCount})`}
      </button>
      <button
        type="button"
        onClick={() => onConfirm(job.id)}
        disabled={job.status === "confirming" || !hasPending}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-manrope font-bold text-sm transition-colors disabled:opacity-50"
      >
        {job.status === "confirming"
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Check className="w-3.5 h-3.5" />}
        {allPending ? "Keep All" : `Keep Remaining (${pendingCount})`}
      </button>
    </div>
  );
})()}
```

- [ ] **Step 4: Build to verify types compile**

```bash
npm --workspace=@mda/web run build
```

Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/CompressQueuePanel.tsx
git commit -m "feat: add per-file Keep/Skip buttons to compression queue panel results table"
```

---

## Verification

End-to-end manual test (run `npm run dev` and open http://localhost:3000):

1. **Compress multiple files**: Select 3+ compressible files (images/videos/PDFs). Click Compress, set quality, add to queue. Queue panel opens — job shows Pending → Compressing.

2. **Preview ready**: Job transitions to "Review Needed". Expand it — results table shows per-file rows with Before/After/Saved columns and **Keep** / **Skip** buttons on each row.

3. **Per-file Keep**: Click "Keep" on file 1 — button shows "…" briefly, then row grays out and shows "✓ Kept". Batch button updates to "Keep Remaining (2)".

4. **Per-file Skip**: Click "Skip" on file 2 — row shows "Skipped" and file name strikes through. Batch button updates to "Keep Remaining (1)".

5. **Batch Keep Remaining**: Click "Keep Remaining (1)" — last pending file is confirmed, job transitions to "Done".

6. **Directory refresh**: After any Keep action, the directory reloads and replaced files show updated file sizes.

7. **All-skip path**: Start fresh, Skip all files individually — job disappears from queue automatically.

8. **Reload persistence**: While a job is in "Review Needed" with some files already kept, reload the page — queue is restored with `fileStatuses` intact (kept files still show "Kept").

9. **Build check**: `npm --workspace=@mda/web run build` — no errors.
