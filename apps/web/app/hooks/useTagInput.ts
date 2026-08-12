import { useMemo, useState } from "react";

export interface TagSuggestion {
  id: string;
  name: string;
  assetCount: number;
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

/**
 * Owns `TagDialog`'s tag-entry state machine: the pending tag chips, the
 * free-text draft, validation/error messages, and apply-in-flight state.
 * Also derives the filtered existing-tag suggestion list shown below the
 * input. `TagDialog` stays responsible for rendering; this hook is the
 * logic behind it.
 */
export function useTagInput({
  suggestions,
  onApply,
  onClose,
}: {
  suggestions: TagSuggestion[];
  onApply: (tagNames: string[]) => Promise<void>;
  onClose: () => void;
}) {
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

  return {
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
  };
}
