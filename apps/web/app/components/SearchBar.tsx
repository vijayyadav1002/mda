import { useCallback, useEffect, useRef, useState } from "react";
import { FileImage, FileVideo, Search, X } from "lucide-react";

type MediaTypeFilter = "all" | "image" | "video";

interface SearchBarProps {
  onSearch: (term: string, mediaType: string) => void;
  onClear: () => void;
  className?: string;
  placeholder?: string;
}

export function SearchBar({
  onSearch,
  onClear,
  className,
  placeholder = "Search files and folders…",
}: SearchBarProps) {
  const [term, setTerm] = useState("");
  const [mediaType, setMediaType] = useState<MediaTypeFilter>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus on "/" keypress from anywhere on the page
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      const isEditable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
      if (isEditable) return;
      if (e.key !== "/") return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleClear = useCallback(() => {
    setTerm("");
    setMediaType("all");
    onClear();
  }, [onClear]);

  const handleChipClick = useCallback(
    (type: MediaTypeFilter) => {
      setMediaType(type);
      // Immediate results for type chips — fire right away
      if (type === "all" && !term.trim()) {
        onClear();
      } else {
        onSearch(term, type);
      }
    },
    [term, onSearch, onClear]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = term.trim();
      if (!trimmed && mediaType === "all") {
        onClear();
      } else {
        onSearch(trimmed, mediaType);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleClear();
      inputRef.current?.blur();
    }
  };

  const hasTerm = term.trim().length > 0;

  return (
    <div className={`${className ?? ""}`.trim()}>
      {/* Input row */}
      <div className="relative flex items-center">
        <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Search files and folders"
          className="w-full pl-9 pr-9 py-2 rounded-xl bg-muted text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-primary/30 transition-all"
        />
        {hasTerm ? (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="absolute right-3 hidden md:flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <kbd className="px-1.5 py-0.5 rounded border border-border/30 font-mono">/</kbd>
          </span>
        )}
      </div>

      {/* Type filter chips */}
      <div className="flex items-center gap-1 mt-1.5">
        {(["all", "image", "video"] as MediaTypeFilter[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => handleChipClick(type)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
              mediaType === type
                ? "bg-brand-primary text-[#060e20]"
                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            {type === "image" && <FileImage className="w-3 h-3" />}
            {type === "video" && <FileVideo className="w-3 h-3" />}
            {type === "all" ? "All" : type === "image" ? "Images" : "Videos"}
          </button>
        ))}
        {hasTerm && (
          <span className="ml-auto text-[10px] text-muted-foreground/60">
            ↵ to search
          </span>
        )}
      </div>
    </div>
  );
}
