import { useCallback, useEffect, useState } from "react";
import { Clock, File, Folder, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { createGraphQLClient, getAuthToken } from "~/lib/api";

const TRASH_ITEMS_QUERY = `
  query TrashItems {
    trashItems {
      id fileName originalPath itemType fileSize mimeType deletedAt expiresAt
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

interface TrashItem {
  id: string;
  fileName: string;
  originalPath: string;
  itemType: "file" | "folder";
  fileSize: string | null;
  mimeType: string | null;
  deletedAt: string;
  expiresAt: string;
}

interface TrashPanelProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** Called after a restore so the caller can refresh the library view. */
  readonly onRestored: () => void;
}

function formatSize(bytes: string | null): string {
  if (!bytes) return "—";
  const n = parseInt(bytes);
  if (!Number.isFinite(n)) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function daysLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function TrashPanel({ isOpen, onClose, onRestored }: TrashPanelProps) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmPurgeId, setConfirmPurgeId] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = getAuthToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await createGraphQLClient(token).request<{ trashItems: TrashItem[] }>(TRASH_ITEMS_QUERY);
      setItems(data.trashItems);
    } catch (err: any) {
      setError(err?.response?.errors?.[0]?.message ?? "Could not load the trash");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void load();
      setConfirmPurgeId(null);
      setConfirmEmpty(false);
    }
  }, [isOpen, load]);

  const handleRestore = async (item: TrashItem) => {
    const token = getAuthToken();
    if (!token || busyId) return;
    setBusyId(item.id);
    try {
      await createGraphQLClient(token).request(RESTORE_TRASH_ITEM_MUTATION, { id: item.id });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      onRestored();
    } catch (err: any) {
      setError(err?.response?.errors?.[0]?.message ?? "Restore failed");
    } finally {
      setBusyId(null);
    }
  };

  const handlePurge = async (item: TrashItem) => {
    const token = getAuthToken();
    if (!token || busyId) return;
    if (confirmPurgeId !== item.id) {
      setConfirmPurgeId(item.id);
      return;
    }
    setBusyId(item.id);
    try {
      await createGraphQLClient(token).request(PURGE_TRASH_ITEM_MUTATION, { id: item.id });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err: any) {
      setError(err?.response?.errors?.[0]?.message ?? "Delete failed");
    } finally {
      setBusyId(null);
      setConfirmPurgeId(null);
    }
  };

  const handleEmpty = async () => {
    const token = getAuthToken();
    if (!token || busyId) return;
    if (!confirmEmpty) {
      setConfirmEmpty(true);
      return;
    }
    setBusyId("__empty__");
    try {
      await createGraphQLClient(token).request(EMPTY_TRASH_MUTATION);
      setItems([]);
    } catch (err: any) {
      setError(err?.response?.errors?.[0]?.message ?? "Empty trash failed");
    } finally {
      setBusyId(null);
      setConfirmEmpty(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[85vh] overflow-hidden p-0 flex flex-col bg-card border-border/10 shadow-ambient rounded-2xl">
        <DialogHeader className="px-6 py-4 bg-muted/40 flex-shrink-0 border-b border-border/10">
          <DialogTitle className="font-manrope text-foreground flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Trash
          </DialogTitle>
          <p className="text-xs font-normal text-muted-foreground mt-1">
            Items are kept for 30 days, then deleted permanently
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto divide-y divide-border/10">
          {loading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Trash2 className="w-10 h-10 opacity-20" />
              <p className="text-sm">The trash is empty.</p>
            </div>
          )}
          {!loading && items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-5 py-3">
              <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                {item.itemType === "folder"
                  ? <Folder className="w-4 h-4 text-muted-foreground" />
                  : <File className="w-4 h-4 text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{item.fileName}</p>
                <p className="text-xs text-muted-foreground truncate font-mono">
                  {item.originalPath}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatSize(item.fileSize)} · expires in {daysLeft(item.expiresAt)} day{daysLeft(item.expiresAt) !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => void handleRestore(item)}
                  disabled={busyId !== null}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-brand-primary hover:bg-accent disabled:opacity-40 transition-all"
                  title="Restore to original location"
                >
                  {busyId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  Restore
                </button>
                <button
                  type="button"
                  onClick={() => void handlePurge(item)}
                  disabled={busyId !== null}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs disabled:opacity-40 transition-all ${
                    confirmPurgeId === item.id
                      ? "bg-destructive text-white"
                      : "text-destructive hover:bg-destructive/10"
                  }`}
                  title="Delete permanently"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {confirmPurgeId === item.id ? "Confirm?" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 bg-muted/40 flex items-center justify-between border-t border-border/10">
          {error ? <p className="text-xs text-destructive truncate">{error}</p> : <span />}
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => void handleEmpty()}
              disabled={busyId !== null}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs disabled:opacity-40 transition-all ${
                confirmEmpty
                  ? "bg-destructive text-white"
                  : "text-destructive border border-destructive/40 hover:bg-destructive/10"
              }`}
            >
              {busyId === "__empty__" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {confirmEmpty ? "Permanently delete everything?" : `Empty Trash (${items.length})`}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
