import { Loader2, RotateCcw, Trash2 } from "lucide-react";

interface TrashSelectionBarProps {
  count: number;
  busy: "restore" | "purge" | "empty" | null;
  confirmPurge: boolean;
  onRestore: () => void;
  onPurge: () => void;
  onClear: () => void;
}

export function TrashSelectionBar({ count, busy, confirmPurge, onRestore, onPurge, onClear }: TrashSelectionBarProps) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-card/95 backdrop-blur-md border border-border/30 shadow-ambient max-w-[95vw]">
      <span className="text-xs font-manrope font-semibold px-1.5 whitespace-nowrap">
        {count} selected
      </span>
      <button
        type="button"
        onClick={onRestore}
        disabled={busy !== null}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-brand-primary hover:bg-accent disabled:opacity-40 transition-all whitespace-nowrap"
      >
        {busy === "restore" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
        Restore
      </button>
      <button
        type="button"
        onClick={onPurge}
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
        onClick={onClear}
        className="px-2 py-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
      >
        Clear
      </button>
    </div>
  );
}
