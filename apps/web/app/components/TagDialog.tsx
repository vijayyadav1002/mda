import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Tag as TagIcon, X } from "lucide-react";
import { useTagInput, type TagSuggestion } from "~/hooks/useTagInput";

export type { TagSuggestion };

interface MediaAsset {
  id: string;
  fileName: string;
}

interface TagDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly selectedAssets: MediaAsset[];
  readonly suggestions: TagSuggestion[];
  readonly onApply: (tagNames: string[]) => Promise<void>;
}

export function TagDialog({ isOpen, onClose, selectedAssets, suggestions, onApply }: TagDialogProps) {
  const {
    pending,
    draft,
    setDraft,
    submitting,
    error,
    setError,
    handleClose,
    commitDraftPart,
    flushDraft,
    handleKeyDown,
    removePending,
    handleApply,
    filteredSuggestions,
  } = useTagInput({ suggestions, onApply, onClose });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="w-[95vw] sm:w-auto max-w-md p-0 flex flex-col bg-card border-border/10 shadow-ambient rounded-2xl">
        <DialogHeader className="px-6 py-4 bg-muted/40">
          <DialogTitle className="font-manrope text-foreground">Apply Tags</DialogTitle>
        </DialogHeader>

        <div className="p-5 space-y-5">
          <div className="bg-muted rounded-2xl p-4">
            <p className="text-sm font-medium text-foreground">
              {selectedAssets.length} file{selectedAssets.length !== 1 ? "s" : ""} selected
            </p>
            <div className="mt-2 space-y-1 max-h-24 overflow-auto">
              {selectedAssets.map((a) => (
                <p key={a.id} className="text-xs text-muted-foreground truncate">{a.fileName}</p>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="label-meta">Tags</label>
            <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5 rounded-xl bg-muted border border-border/20 focus-within:border-brand-primary/60 transition-colors">
              {pending.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-primary/15 text-brand-primary text-xs font-medium px-2 py-0.5"
                >
                  #{name}
                  <button
                    type="button"
                    onClick={() => removePending(name)}
                    className="hover:bg-brand-primary/20 rounded-full p-0.5"
                    aria-label={`Remove ${name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={draft}
                placeholder={pending.length === 0 ? "e.g. compress, review" : ""}
                onChange={(e) => { setDraft(e.target.value); setError(null); }}
                onKeyDown={handleKeyDown}
                onBlur={flushDraft}
                disabled={submitting}
                className="flex-1 min-w-[120px] bg-transparent outline-hidden text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Press Enter, comma, or space to add. Tags are case-insensitive.
            </p>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          {filteredSuggestions.length > 0 && (
            <div className="space-y-1.5">
              <label className="label-meta">Existing tags</label>
              <div className="flex flex-wrap gap-1.5">
                {filteredSuggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => commitDraftPart(s.name)}
                    className="inline-flex items-center gap-1 rounded-full bg-accent text-foreground text-xs px-2 py-0.5 hover:bg-brand-primary/15 hover:text-brand-primary transition-colors"
                  >
                    #{s.name}
                    <span className="text-muted-foreground">({s.assetCount})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 bg-muted/40 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={submitting || (pending.length === 0 && !draft.trim()) || selectedAssets.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <TagIcon className="w-4 h-4" />
            {submitting
              ? "Applying…"
              : `Apply${pending.length > 0 ? ` ${pending.length}` : ""} to ${selectedAssets.length}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
