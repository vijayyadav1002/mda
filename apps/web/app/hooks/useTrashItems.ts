import { useEffect, useMemo, useState } from "react";
import type { NavigateFunction } from "react-router";
import { createGraphQLClient, getAuthToken } from "~/lib/api";

const TRASH_ITEMS_QUERY = `
  query TrashItems {
    trashItems {
      id fileName originalPath itemType fileSize mimeType thumbnailUrl deletedAt expiresAt
    }
  }
`;

const RESTORE_TRASH_ITEM_MUTATION = `
  mutation RestoreTrashItem($id: ID!) { restoreTrashItem(id: $id) }
`;

const PURGE_TRASH_ITEM_MUTATION = `
  mutation PurgeTrashItem($id: ID!) { purgeTrashItem(id: $id) }
`;

const EMPTY_TRASH_MUTATION = `
  mutation EmptyTrash { emptyTrash }
`;

export interface TrashItem {
  id: string;
  fileName: string;
  originalPath: string;
  itemType: "file" | "folder";
  fileSize: string | null;
  mimeType: string | null;
  thumbnailUrl: string | null;
  deletedAt: string;
  expiresAt: string;
}

const dayKeyOf = (iso: string) => iso.slice(0, 10);

/**
 * Owns trash item list/loading state, selection, and the restore/purge/empty
 * mutations for the trash page. `navigate` is injected so the hook can
 * redirect to /login (no token) or /dashboard (access error) exactly as the
 * original page did inline.
 */
export function useTrashItems(navigate: NavigateFunction) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"restore" | "purge" | "empty" | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("darkMode");
      document.documentElement.classList.toggle("dark", stored !== null ? stored === "true" : true);
    }
    const token = getAuthToken();
    if (!token) {
      navigate("/login");
      return;
    }
    createGraphQLClient(token)
      .request<{ trashItems: TrashItem[] }>(TRASH_ITEMS_QUERY)
      .then((data) => setItems(data.trashItems))
      .catch((err) => {
        const message = err?.response?.errors?.[0]?.message ?? "Could not load the trash";
        if (/access required|unauthorized/i.test(message)) navigate("/dashboard");
        else setError(message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Reset destructive confirmations whenever the selection changes
  useEffect(() => {
    setConfirmPurge(false);
  }, [selectedIds]);

  const sections = useMemo(() => {
    const map = new Map<string, TrashItem[]>();
    for (const item of items ?? []) {
      const key = dayKeyOf(item.deletedAt);
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);

  const selectedItems = useMemo(
    () => (items ?? []).filter((i) => selectedIds.has(i.id)),
    [items, selectedIds]
  );

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSection = (sectionItems: TrashItem[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = sectionItems.every((i) => next.has(i.id));
      for (const item of sectionItems) {
        if (allSelected) next.delete(item.id);
        else next.add(item.id);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setConfirmPurge(false);
  };

  const runForSelected = async (kind: "restore" | "purge") => {
    const token = getAuthToken();
    if (!token || busy || selectedItems.length === 0) return;
    if (kind === "purge" && !confirmPurge) {
      setConfirmPurge(true);
      return;
    }
    setBusy(kind);
    setError(null);
    const client = createGraphQLClient(token);
    const mutation = kind === "restore" ? RESTORE_TRASH_ITEM_MUTATION : PURGE_TRASH_ITEM_MUTATION;
    let done = 0;
    const failed: string[] = [];
    for (const item of selectedItems) {
      try {
        await client.request(mutation, { id: item.id });
        done += 1;
        setItems((prev) => (prev ? prev.filter((i) => i.id !== item.id) : prev));
      } catch {
        failed.push(item.fileName);
      }
    }
    setSelectedIds(new Set());
    setConfirmPurge(false);
    setBusy(null);
    if (failed.length > 0) {
      setError(`${failed.length} item${failed.length !== 1 ? "s" : ""} failed: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}`);
    }
    if (done > 0) {
      setNotice(kind === "restore"
        ? `Restored ${done} item${done !== 1 ? "s" : ""} to their original location`
        : `Permanently deleted ${done} item${done !== 1 ? "s" : ""}`);
    }
  };

  const handleEmptyTrash = async () => {
    const token = getAuthToken();
    if (!token || busy) return;
    if (!confirmEmpty) {
      setConfirmEmpty(true);
      return;
    }
    setBusy("empty");
    setError(null);
    try {
      await createGraphQLClient(token).request(EMPTY_TRASH_MUTATION);
      setItems([]);
      setSelectedIds(new Set());
      setNotice("Trash emptied");
    } catch (err: any) {
      setError(err?.response?.errors?.[0]?.message ?? "Empty trash failed");
    } finally {
      setBusy(null);
      setConfirmEmpty(false);
    }
  };

  const totalCount = items?.length ?? 0;

  return {
    items,
    selectedIds,
    busy,
    confirmPurge,
    confirmEmpty,
    error,
    notice,
    sections,
    selectedItems,
    totalCount,
    toggle,
    toggleSection,
    clearSelection,
    runForSelected,
    handleEmptyTrash,
  };
}
