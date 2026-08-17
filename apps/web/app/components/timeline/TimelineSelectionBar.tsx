import { useEffect, useRef, useState } from "react";
import { ChevronDown, Film, ListTodo, Tag as TagIcon, RefreshCw, Trash2, X } from "lucide-react";

interface TimelineSelectionBarProps {
  selectedCount: number;
  selectedVideoCount: number;
  onAddTags: () => void;
  onRemoveTags: () => void;
  onCompress: () => void;
  onTranscode: () => void;
  onRegenerateThumbnails: () => void;
  onDelete: () => void;
  onExit: () => void;
}

export function TimelineSelectionBar({
  selectedCount,
  selectedVideoCount,
  onAddTags,
  onRemoveTags,
  onCompress,
  onTranscode,
  onRegenerateThumbnails,
  onDelete,
  onExit,
}: TimelineSelectionBarProps) {
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showActionsMenu) return;
    const onClick = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setShowActionsMenu(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showActionsMenu]);

  const actions = [
    { label: "Tags", menuLabel: "Add tags", icon: TagIcon, disabled: selectedCount === 0, destructive: false, run: onAddTags },
    { label: "Untag", menuLabel: "Remove tags", icon: TagIcon, disabled: selectedCount === 0, destructive: false, run: onRemoveTags, title: "Remove tags from selected items" },
    { label: "Compress", menuLabel: "Compress", icon: ListTodo, disabled: selectedCount === 0, destructive: false, run: onCompress },
    {
      label: `Transcode${selectedVideoCount > 0 ? ` (${selectedVideoCount})` : ""}`,
      menuLabel: `Transcode${selectedVideoCount > 0 ? ` (${selectedVideoCount})` : ""}`,
      icon: Film,
      disabled: selectedVideoCount === 0,
      destructive: false,
      run: onTranscode,
      title: "Transcode selected videos to web format",
    },
    { label: "Thumbnails", menuLabel: "Regenerate thumbnails", icon: RefreshCw, disabled: selectedCount === 0, destructive: false, run: onRegenerateThumbnails, title: "Regenerate thumbnails for selected items" },
    { label: "Delete", menuLabel: "Delete", icon: Trash2, disabled: selectedCount === 0, destructive: true, run: onDelete, title: "Move selected items to the Trash" },
  ];

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-card/95 backdrop-blur-md border border-border/30 shadow-ambient max-w-[95vw]">
      <span className="text-xs font-manrope font-semibold px-1.5 whitespace-nowrap">
        {selectedCount} selected
      </span>

      {/* Desktop: inline actions */}
      <div className="hidden md:flex items-center gap-1.5">
        {actions.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.run}
            disabled={item.disabled}
            title={item.title}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs disabled:opacity-40 transition-all whitespace-nowrap ${
              item.destructive ? "text-destructive hover:bg-destructive/10" : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            <item.icon className="w-3.5 h-3.5" /> {item.label}
          </button>
        ))}
      </div>

      {/* Mobile: actions dropdown (opens upward) */}
      <div className="relative md:hidden" ref={actionsMenuRef}>
        <button
          type="button"
          onClick={() => setShowActionsMenu((p) => !p)}
          disabled={selectedCount === 0}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-foreground bg-muted disabled:opacity-40 transition-all"
        >
          Actions
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showActionsMenu ? "" : "rotate-180"}`} />
        </button>
        {showActionsMenu && (
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 rounded-2xl bg-card border border-border/30 shadow-ambient p-1.5 z-50">
            {actions.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => { setShowActionsMenu(false); item.run(); }}
                disabled={item.disabled}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left text-xs disabled:opacity-40 transition-colors ${
                  item.destructive
                    ? "text-destructive hover:bg-destructive/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                <item.icon className="w-3.5 h-3.5 shrink-0" />
                {item.menuLabel}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onExit}
        className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
        title="Exit selection"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
