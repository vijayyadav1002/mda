import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Tag as TagIcon, X } from "lucide-react";

interface MediaAsset {
  id: string;
  fileName: string;
}

export interface TagSuggestion {
  id: string;
  name: string;
  assetCount: number;
}

interface TagDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly selectedAssets: MediaAsset[];
  readonly suggestions: TagSuggestion[];
  readonly onApply: (tagNames: string[]) => Promise<void>;
}

const TAG_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function normalize(input: string): string {
  let name = input.trim().toLowerCase();
  if (name.startsWith("#")) name = name.slice(1).trim();
  return name;
}

function isValid(name: string): boolean {
  return TAG_NAME_PATTERN.test(name);
}

export function TagDialog({ isOpen, onClose, selectedAssets, suggestions, onApply }: TagDialogProps) {
  const [pending, setPending] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPending([]);
    setDraft("");
    setError(null);
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const commitDraftPart = (raw: string) => {
    const name = normalize(raw);
    if (!name) return;
    if (!isValid(name)) {
      setError(`"${raw.trim()}" is not a valid tag (use letters, digits, "_" or "-").`);
      return;
    }
    setPending((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setError(null);
  };

  const flushDraft = () => {
    if (!draft.trim()) return;
    const parts = draft.split(/[\s,]+/).filter(Boolean);
    for (const part of parts) commitDraftPart(part);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === " " || e.key === "Tab") {
      if (draft.trim()) {
        e.preventDefault();
        flushDraft();
      }
    } else if (e.key === "Backspace" && !draft && pending.length > 0) {
      setPending((prev) => prev.slice(0, -1));
    }
  };

  const removePending = (name: string) => {
    setPending((prev) => prev.filter((n) => n !== name));
  };

  const handleApply = async () => {
    flushDraft();
    const tags = pending.length > 0 ? pending : (() => {
      const fromDraft = draft.split(/[\s,]+/).map(normalize).filter(Boolean);
      return fromDraft.filter(isValid);
    })();
    if (tags.length === 0) {
      setError("Add at least one tag before applying.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onApply(tags);
      reset();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to apply tags");
      setSubmitting(false);
    }
  };

  const filteredSuggestions = useMemo(() => {
    const query = normalize(draft);
    const taken = new Set(pending);
    return suggestions
      .filter((s) => !taken.has(s.name))
      .filter((s) => (query ? s.name.includes(query) : true))
      .slice(0, 8);
  }, [draft, pending, suggestions]);

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
