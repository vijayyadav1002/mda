import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Square, Tag as TagIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";

interface AssetTag {
  id: string;
  name: string;
}

interface TaggableAsset {
  id: string;
  fileName: string;
  tags?: AssetTag[];
}

interface RemoveTagsDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly selectedAssets: TaggableAsset[];
  readonly onRemove: (tagNames: string[]) => Promise<void>;
}

export function RemoveTagsDialog({ isOpen, onClose, selectedAssets, onRemove }: RemoveTagsDialogProps) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPicked(new Set());
      setSubmitting(false);
      setError(null);
    }
  }, [isOpen]);

  // Union of tags across the selection, with how many selected items carry each
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of selectedAssets) {
      for (const tag of asset.tags ?? []) {
        counts.set(tag.name, (counts.get(tag.name) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [selectedAssets]);

  const toggle = (name: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleRemove = async () => {
    if (picked.size === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onRemove([...picked]);
      onClose();
    } catch (err: any) {
      setError(err?.response?.errors?.[0]?.message ?? err?.message ?? "Failed to remove tags");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="w-[95vw] sm:w-auto max-w-md p-0 flex flex-col bg-card border-border/10 shadow-ambient rounded-2xl">
        <DialogHeader className="px-6 py-4 bg-muted/40">
          <DialogTitle className="font-manrope text-foreground">Remove Tags</DialogTitle>
        </DialogHeader>

        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            {selectedAssets.length} item{selectedAssets.length !== 1 ? "s" : ""} selected — pick the tags to remove from all of them.
          </p>

          {tagCounts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <TagIcon className="w-8 h-8 opacity-20" />
              <p className="text-sm">The selected items have no tags.</p>
            </div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-auto">
              {tagCounts.map(([name, count]) => {
                const isPicked = picked.has(name);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggle(name)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors ${
                      isPicked ? "bg-destructive/10" : "hover:bg-accent/50"
                    }`}
                  >
                    {isPicked ? (
                      <Check className="w-4 h-4 text-destructive shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <span className={`text-sm flex-1 truncate ${isPicked ? "text-destructive line-through" : "text-foreground"}`}>
                      #{name}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {count} of {selectedAssets.length}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={picked.size === 0 || submitting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-destructive hover:bg-destructive/90 text-white font-manrope font-bold text-sm transition-colors disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Remove{picked.size > 0 ? ` (${picked.size})` : ""}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
