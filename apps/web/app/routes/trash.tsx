import type { MetaFunction } from "react-router";
import { useNavigate } from "react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckSquare, Clock, File, FileText, Folder, Loader2, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { createGraphQLClient, getApiUrl, getAuthToken } from "~/lib/api";

export const meta: MetaFunction = () => [{ title: "Trash — MDA" }];

/* ── GraphQL ────────────────────────────────────────────────────── */

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

/* ── Types & helpers ────────────────────────────────────────────── */

interface TrashItem {
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

const formatSize = (bytes: string | null): string => {
  if (!bytes) return "";
  const n = parseInt(bytes);
  if (!Number.isFinite(n)) return "";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const daysLeft = (expiresAt: string): number =>
  Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

const dayKeyOf = (iso: string) => iso.slice(0, 10);

const dayLabel = (key: string): string => {
  const today = new Date();
  const toKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (key === toKey(today)) return "Deleted today";
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (key === toKey(yesterday)) return "Deleted yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return `Deleted ${new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
};

function TileIcon({ item }: Readonly<{ item: TrashItem }>) {
  if (item.itemType === "folder") return <Folder className="w-8 h-8 text-muted-foreground/40" />;
  if (item.mimeType?.startsWith("video/")) return <Play className="w-8 h-8 text-muted-foreground/40" />;
  if (item.mimeType?.startsWith("image/")) return <File className="w-8 h-8 text-muted-foreground/40" />;
  return <FileText className="w-8 h-8 text-muted-foreground/40" />;
}

/* ── Route ──────────────────────────────────────────────────────── */

export default function Trash() {
  const navigate = useNavigate();
  const API_URL = getApiUrl();

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/20">
        <div className="flex items-center justify-between px-4 md:px-6 py-3 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Collections</span>
            </button>
            <div className="w-px h-5 bg-border/40" />
            <h1 className="font-manrope font-bold text-lg flex items-center gap-2 truncate">
              <Trash2 className="w-5 h-5 text-brand-primary shrink-0" />
              Trash
            </h1>
            {items && (
              <span className="hidden sm:inline text-xs text-muted-foreground font-mono">
                {totalCount} item{totalCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {totalCount > 0 && (
            <button
              type="button"
              onClick={() => void handleEmptyTrash()}
              disabled={busy !== null}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition-all disabled:opacity-40 ${
                confirmEmpty
                  ? "bg-destructive text-white"
                  : "text-destructive border border-destructive/40 hover:bg-destructive/10"
              }`}
            >
              {busy === "empty" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {confirmEmpty ? "Permanently delete everything?" : "Empty Trash"}
            </button>
          )}
        </div>
        <p className="px-4 md:px-6 pb-2 -mt-1 text-[11px] text-muted-foreground">
          Items are kept for 30 days after deletion, then removed permanently. Tap items to select, then restore or delete them.
        </p>
      </header>

      <main className="px-4 md:px-6 pb-28 pt-4 max-w-[1600px] mx-auto">
        {error && <p className="text-xs text-destructive mb-3">{error}</p>}

        {!items && !error && (
          <div className="max-w-lg mx-auto mt-20 text-center text-muted-foreground animate-pulse">
            <p className="text-sm">Loading trash…</p>
          </div>
        )}

        {items && items.length === 0 && (
          <div className="max-w-lg mx-auto mt-20 text-center text-muted-foreground">
            <Trash2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">The trash is empty.</p>
          </div>
        )}

        {sections.map(([dayKey, sectionItems]) => {
          const allSelected = sectionItems.every((i) => selectedIds.has(i.id));
          return (
            <section key={dayKey}>
              <div className="flex items-baseline gap-2 pt-4 pb-2">
                <h2 className="font-manrope font-bold text-base md:text-lg">{dayLabel(dayKey)}</h2>
                <span className="text-xs text-muted-foreground font-mono">{sectionItems.length}</span>
                <button
                  type="button"
                  onClick={() => toggleSection(sectionItems)}
                  className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium text-brand-primary hover:bg-accent transition-colors"
                >
                  {allSelected ? (
                    <><Square className="w-3 h-3" /> Unselect all</>
                  ) : (
                    <><CheckSquare className="w-3 h-3" /> Select all</>
                  )}
                </button>
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                {sectionItems.map((item) => {
                  const isSelected = selectedIds.has(item.id);
                  const left = daysLeft(item.expiresAt);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggle(item.id)}
                      className={`relative text-left rounded-xl overflow-hidden bg-card border transition-all focus:outline-hidden ${
                        isSelected ? "border-brand-primary ring-2 ring-brand-primary" : "border-border/20 hover:border-border/50"
                      }`}
                      title={item.originalPath}
                    >
                      <span className="absolute top-1.5 left-1.5 z-10">
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-brand-primary drop-shadow-sm bg-black/40 rounded-sm" />
                        ) : (
                          <Square className="w-4 h-4 text-white/80 drop-shadow-sm" />
                        )}
                      </span>
                      {isSelected && <span className="absolute inset-0 bg-brand-primary/15 z-[5] pointer-events-none" />}

                      <div className="aspect-square bg-muted/40 flex items-center justify-center overflow-hidden">
                        {item.thumbnailUrl ? (
                          <img
                            src={`${API_URL}${item.thumbnailUrl}`}
                            alt={item.fileName}
                            loading="lazy"
                            className="w-full h-full object-cover"
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                          />
                        ) : (
                          <TileIcon item={item} />
                        )}
                      </div>

                      <div className="p-2">
                        <p className="text-xs font-medium text-foreground truncate">{item.fileName}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5 shrink-0" />
                          {left} day{left !== 1 ? "s" : ""} left{item.fileSize ? ` · ${formatSize(item.fileSize)}` : ""}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>

      {/* ── Selection action bar ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-card/95 backdrop-blur-md border border-border/30 shadow-ambient max-w-[95vw]">
          <span className="text-xs font-manrope font-semibold px-1.5 whitespace-nowrap">
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={() => void runForSelected("restore")}
            disabled={busy !== null}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-brand-primary hover:bg-accent disabled:opacity-40 transition-all whitespace-nowrap"
          >
            {busy === "restore" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            Restore
          </button>
          <button
            type="button"
            onClick={() => void runForSelected("purge")}
            disabled={busy !== null}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs disabled:opacity-40 transition-all whitespace-nowrap ${
              confirmPurge ? "bg-destructive text-white" : "text-destructive hover:bg-destructive/10"
            }`}
          >
            {busy === "purge" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            {confirmPurge ? "Confirm permanent delete?" : "Delete forever"}
          </button>
          <button
            type="button"
            onClick={() => { setSelectedIds(new Set()); setConfirmPurge(false); }}
            className="px-2 py-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Notice toast ── */}
      {notice && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 rounded-2xl bg-card/95 backdrop-blur-md border border-border/30 shadow-ambient">
          <span className="text-xs text-foreground whitespace-nowrap">{notice}</span>
        </div>
      )}
    </div>
  );
}
