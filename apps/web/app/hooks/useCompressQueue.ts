import { useCallback, useEffect, useRef, useState } from "react";
import { createGraphQLClient, getApiUrl, getAuthToken } from "~/lib/api";
import type { MediaAsset } from "~/lib/types";
import type { CompressJob } from "~/components/CompressQueuePanel";

const API_URL = getApiUrl();

const CONFIRM_COMPRESS_MUTATION = `
  mutation ConfirmCompressReplace($ids: [ID!]!) {
    confirmCompressReplace(ids: $ids) { id fileName fileSize }
  }
`;

const CANCEL_COMPRESS_MUTATION = `
  mutation CancelCompressPreview($ids: [ID!]!) {
    cancelCompressPreview(ids: $ids)
  }
`;

interface UseCompressQueueParams {
  /** Gates the load-on-login and poll effects; only their presence (as a user) matters. */
  user: { username: string; role: string } | null;
  /** Currently open folder; re-fetched after a confirm so its cached children pick up the new file size. */
  currentPath: string | null;
  /** Library root; re-fetched alongside `currentPath` for confirms that touch it. */
  rootPath: string | null;
  /** From `useDirectoryTree` — refreshes a path's cached `DirectoryNode` after a confirm. */
  loadDirectoryIntoCache: (directoryPath?: string | null) => Promise<unknown>;
}

/**
 * Owns the dashboard's background compression queue: the compress dialog and
 * queue panel open/selection state, the persisted job list (synced to the
 * server via `/api/queue-state`), and the enqueue/confirm/dismiss/cancel
 * actions for whole jobs or individual files within a job.
 *
 * Takes `user`, the current/root paths, and the directory-tree cache
 * accessor as parameters rather than owning them, since all are shared with
 * other dashboard features.
 */
export function useCompressQueue({ user, currentPath, rootPath, loadDirectoryIntoCache }: UseCompressQueueParams) {
  const [isCompressDialogOpen, setIsCompressDialogOpen] = useState(false);
  const [compressDialogAssets, setCompressDialogAssets] = useState<MediaAsset[]>([]);
  const [compressQueue, setCompressQueue] = useState<CompressJob[]>([]);
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const compressQueueRef = useRef<CompressJob[]>([]);

  // Keep queue ref in sync so confirmCompressJob can read current jobs without stale closures
  useEffect(() => { compressQueueRef.current = compressQueue; }, [compressQueue]);

  // Load queue from server on login
  useEffect(() => {
    if (!user) return;
    const token = getAuthToken();
    if (!token) return;
    fetch(`${API_URL}/api/queue-state`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(({ queue }) => {
        if (!Array.isArray(queue) || queue.length === 0) return;
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
              job.status === "compressing" ? "pending"       // BullMQ retries the job
              : job.status === "transcoding" ? "pending"     // BullMQ retries the job
              : job.status === "confirming" ? "preview_ready" // let user retry confirm
              : job.status
            ) as CompressJob["status"],
          }))
        );
      })
      .catch(() => {});
  }, [user?.username]);

  // Poll for queue updates every 5 s when jobs are active
  const hasActiveJobs = compressQueue.some(j => j.status === "pending" || j.status === "compressing" || j.status === "transcoding");
  useEffect(() => {
    if (!hasActiveJobs || !user) return;
    const token = getAuthToken();
    if (!token) return;
    const intervalId = setInterval(() => {
      fetch(`${API_URL}/api/queue-state`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
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
        .catch(() => {});
    }, 5000);
    return () => clearInterval(intervalId);
  }, [hasActiveJobs, user]);

  const addToCompressQueue = useCallback(async (assets: MediaAsset[], options: { resolution: string; quality: number }) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/compress/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: assets.map(a => a.id), options }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const { jobId } = await res.json();
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
      setShowQueuePanel(true);
    } catch (err: any) {
      console.error("Failed to enqueue compression job:", err.message);
    }
  }, []);

  const saveQueueToServer = useCallback((updatedQueue: CompressJob[]) => {
    const token = getAuthToken();
    if (!token || !user) return;
    fetch(`${API_URL}/api/queue-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ queue: updatedQueue }),
    }).catch(() => {});
  }, [user]);

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
  }, [currentPath, rootPath, saveQueueToServer, loadDirectoryIntoCache]);

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
  }, [currentPath, rootPath, saveQueueToServer, loadDirectoryIntoCache]);

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

  const cancelCompressJob = useCallback(async (jobId: string) => {
    const token = getAuthToken();
    if (!token) return;
    // Optimistic UI: mark cancelled locally right away so the user gets feedback.
    setCompressQueue(prev => prev.map(j => j.id === jobId
      ? { ...j, status: "cancelled" as const, currentFileId: null, progress: {} }
      : j));
    try {
      const res = await fetch(`${API_URL}/api/compress/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
    } catch (err: any) {
      console.error("Failed to cancel compression job:", err.message);
      // Roll back to error state so the user knows the cancel didn't land.
      setCompressQueue(prev => prev.map(j => j.id === jobId
        ? { ...j, status: "error" as const, errorMessage: "Failed to cancel job" }
        : j));
    }
  }, []);

  const clearCompletedJobs = useCallback(() => {
    const isFinished = (s: CompressJob["status"]) => s === "done" || s === "error" || s === "cancelled";
    setCompressQueue(prev => {
      const updated = prev.filter(j => !isFinished(j.status));
      // Cancel preview files for completed jobs that had previews
      const toCancel = prev.filter(j => isFinished(j.status) && j.previews.length > 0);
      if (toCancel.length > 0) {
        const token = getAuthToken();
        if (token) {
          const ids = toCancel.flatMap(j => j.assets.map(a => a.id));
          createGraphQLClient(token).request(CANCEL_COMPRESS_MUTATION, { ids }).catch(() => {});
        }
      }
      saveQueueToServer(updated);
      return updated;
    });
  }, [saveQueueToServer]);

  return {
    isCompressDialogOpen,
    setIsCompressDialogOpen,
    compressDialogAssets,
    setCompressDialogAssets,
    compressQueue,
    compressQueueRef,
    showQueuePanel,
    setShowQueuePanel,
    addToCompressQueue,
    saveQueueToServer,
    confirmCompressJob,
    dismissCompressJob,
    confirmSingleCompressFile,
    discardSingleCompressFile,
    cancelCompressJob,
    clearCompletedJobs,
  };
}
