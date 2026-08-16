import { useEffect, useRef, useState } from "react";
import { ArrowUpDown } from "lucide-react";

export type SortOption = "default" | "size-asc" | "size-desc" | "date-asc" | "date-desc";

interface SortMenuProps {
  sortOption: SortOption;
  onSortOptionChange: (option: SortOption) => void;
  searchQuery: string;
  searchLimit: 25 | 50 | 100 | 250 | 0;
  onSearchLimitChange: (limit: 25 | 50 | 100 | 250 | 0) => void;
  minSizeBytes: number;
  onMinSizeBytesChange: (bytes: number) => void;
}

const SORT_OPTIONS: [SortOption, string][] = [
  ["default", "Default"],
  ["size-asc", "Size ↑ (Smallest)"],
  ["size-desc", "Size ↓ (Largest)"],
  ["date-asc", "Date ↑ (Oldest)"],
  ["date-desc", "Date ↓ (Newest)"],
];

export function SortMenu({
  sortOption,
  onSortOptionChange,
  searchQuery,
  searchLimit,
  onSearchLimitChange,
  minSizeBytes,
  onMinSizeBytesChange,
}: SortMenuProps) {
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    };
    if (showSortMenu) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSortMenu]);

  return (
    <>
      <div className="relative" ref={sortMenuRef}>
        <button
          type="button"
          onClick={() => setShowSortMenu((p) => !p)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all ${
            sortOption !== "default"
              ? "text-brand-primary bg-brand-primary/10"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <ArrowUpDown className="w-4 h-4" />
          <span className="hidden sm:inline">
            {sortOption === "default" ? "Sort"
              : sortOption === "size-asc" ? "Size ↑"
              : sortOption === "size-desc" ? "Size ↓"
              : sortOption === "date-asc" ? "Date ↑"
              : "Date ↓"}
          </span>
        </button>
        {showSortMenu && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border/20 rounded-xl shadow-ambient z-50 py-1 overflow-hidden">
            {SORT_OPTIONS.map(([opt, label]) => (
              <button
                key={opt}
                type="button"
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  sortOption === opt
                    ? "text-brand-primary font-medium bg-accent"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
                onClick={() => { onSortOptionChange(opt); setShowSortMenu(false); }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Search result limit — only visible during active search */}
      {searchQuery && (
        <select
          value={searchLimit}
          onChange={(e) => onSearchLimitChange(Number(e.target.value) as typeof searchLimit)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-muted text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-brand-primary/30 cursor-pointer"
          aria-label="Max search results"
        >
          <option value={25}>25 results</option>
          <option value={50}>50 results</option>
          <option value={100}>100 results</option>
          <option value={250}>250 results</option>
          <option value={0}>All results</option>
        </select>
      )}

      {/* File size filter — only visible during active search */}
      {searchQuery && (
        <select
          value={minSizeBytes}
          onChange={(e) => onMinSizeBytesChange(Number(e.target.value))}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-brand-primary/30 cursor-pointer ${
            minSizeBytes > 0
              ? "text-brand-primary bg-brand-primary/10"
              : "bg-muted text-muted-foreground"
          }`}
          aria-label="Minimum file size"
        >
          <option value={0}>Any size</option>
          <option value={10 * 1024 * 1024}>&gt; 10 MB</option>
          <option value={100 * 1024 * 1024}>&gt; 100 MB</option>
          <option value={500 * 1024 * 1024}>&gt; 500 MB</option>
          <option value={1024 * 1024 * 1024}>&gt; 1 GB</option>
          <option value={2 * 1024 * 1024 * 1024}>&gt; 2 GB</option>
          <option value={5 * 1024 * 1024 * 1024}>&gt; 5 GB</option>
        </select>
      )}
    </>
  );
}
