import type { MetaFunction } from "react-router";
import { useNavigate } from "react-router";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { getApiUrl } from "~/lib/api";
import { useTrashItems } from "~/hooks/useTrashItems";
import { TrashGrid } from "~/components/TrashGrid";
import { TrashSelectionBar } from "~/components/TrashSelectionBar";

export const meta: MetaFunction = () => [{ title: "Trash — MDA" }];

export default function Trash() {
  const navigate = useNavigate();
  const API_URL = getApiUrl();
  const trash = useTrashItems(navigate);

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
            {trash.items && (
              <span className="hidden sm:inline text-xs text-muted-foreground font-mono">
                {trash.totalCount} item{trash.totalCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {trash.totalCount > 0 && (
            <button
              type="button"
              onClick={() => void trash.handleEmptyTrash()}
              disabled={trash.busy !== null}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition-all disabled:opacity-40 ${
                trash.confirmEmpty
                  ? "bg-destructive text-white"
                  : "text-destructive border border-destructive/40 hover:bg-destructive/10"
              }`}
            >
              {trash.busy === "empty" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {trash.confirmEmpty ? "Permanently delete everything?" : "Empty Trash"}
            </button>
          )}
        </div>
        <p className="px-4 md:px-6 pb-2 -mt-1 text-[11px] text-muted-foreground">
          Items are kept for 30 days after deletion, then removed permanently. Tap items to select, then restore or delete them.
        </p>
      </header>

      <main className="px-4 md:px-6 pb-28 pt-4 max-w-[1600px] mx-auto">
        {trash.error && <p className="text-xs text-destructive mb-3">{trash.error}</p>}

        {!trash.items && !trash.error && (
          <div className="max-w-lg mx-auto mt-20 text-center text-muted-foreground animate-pulse">
            <p className="text-sm">Loading trash…</p>
          </div>
        )}

        {trash.items && trash.items.length === 0 && (
          <div className="max-w-lg mx-auto mt-20 text-center text-muted-foreground">
            <Trash2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">The trash is empty.</p>
          </div>
        )}

        <TrashGrid
          sections={trash.sections}
          selectedIds={trash.selectedIds}
          apiUrl={API_URL}
          onToggleItem={trash.toggle}
          onToggleSection={trash.toggleSection}
        />
      </main>

      {/* ── Selection action bar ── */}
      {trash.selectedIds.size > 0 && (
        <TrashSelectionBar
          count={trash.selectedIds.size}
          busy={trash.busy}
          confirmPurge={trash.confirmPurge}
          onRestore={() => void trash.runForSelected("restore")}
          onPurge={() => void trash.runForSelected("purge")}
          onClear={trash.clearSelection}
        />
      )}

      {/* ── Notice toast ── */}
      {trash.notice && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 rounded-2xl bg-card/95 backdrop-blur-md border border-border/30 shadow-ambient">
          <span className="text-xs text-foreground whitespace-nowrap">{trash.notice}</span>
        </div>
      )}
    </div>
  );
}
