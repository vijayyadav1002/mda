import { useRef, useState, useEffect } from "react";
import { Download, Minimize2, Film, RefreshCw, Tag as TagIcon, FolderOpen, Trash2, ChevronDown } from "lucide-react";

interface ToolbarActionsProps {
  role?: string;
  selectedCount: number;
  selectedFolderCount: number;
  compressibleCount: number;
  videoCount: number;
  thumbableCount: number;
  onDownload: () => void;
  onCompress: () => void;
  onTranscode: () => void;
  onRegenerateThumbnails: () => void;
  onTag: () => void;
  onUntag: () => void;
  onMove: () => void;
  onDelete: () => void;
}

export function ToolbarActions({
  role,
  selectedCount,
  selectedFolderCount,
  compressibleCount,
  videoCount,
  thumbableCount,
  onDownload,
  onCompress,
  onTranscode,
  onRegenerateThumbnails,
  onTag,
  onUntag,
  onMove,
  onDelete,
}: ToolbarActionsProps) {
  const canEdit = role === "admin" || role === "editor";
  const [showSelectionActionsMenu, setShowSelectionActionsMenu] = useState(false);
  const selectionActionsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (selectionActionsMenuRef.current && !selectionActionsMenuRef.current.contains(e.target as Node)) {
        setShowSelectionActionsMenu(false);
      }
    };
    if (showSelectionActionsMenu) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSelectionActionsMenu]);

  return (
    <>
      <div className="hidden md:flex items-center gap-1.5 md:gap-2 flex-wrap justify-end">
        {selectedCount > 0 && (
          <button
            type="button"
            onClick={onDownload}
            className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-foreground hover:bg-accent transition-all"
            title={`Download ${selectedCount} file(s)`}
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Download</span>
            <span className="text-xs">({selectedCount})</span>
          </button>
        )}
        {selectedCount > 0 && (
          <button
            type="button"
            onClick={onCompress}
            disabled={compressibleCount === 0}
            title={compressibleCount === 0 ? "No selected files can be compressed" : undefined}
            className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-brand-primary hover:bg-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Minimize2 className="w-4 h-4" />
            <span className="hidden sm:inline">Compress</span>
            <span className="text-xs">({compressibleCount})</span>
          </button>
        )}
        {canEdit && selectedCount > 0 && (
          <button
            type="button"
            onClick={onTranscode}
            disabled={videoCount === 0}
            title={videoCount === 0 ? "No videos selected" : "Transcode selected videos to web format"}
            className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-brand-primary hover:bg-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Film className="w-4 h-4" />
            <span className="hidden sm:inline">Transcode</span>
            <span className="text-xs">({videoCount})</span>
          </button>
        )}
        {selectedCount > 0 && (
          <button
            type="button"
            onClick={onRegenerateThumbnails}
            disabled={thumbableCount === 0}
            title={thumbableCount === 0 ? "No selected files support thumbnails" : "Regenerate thumbnails for selected items"}
            className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-brand-primary hover:bg-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Thumbnails</span>
            <span className="text-xs">({thumbableCount})</span>
          </button>
        )}
        {selectedCount > 0 && (
          <button
            type="button"
            onClick={onTag}
            className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-brand-primary hover:bg-accent transition-all"
          >
            <TagIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Tag</span>
            <span className="text-xs">({selectedCount})</span>
          </button>
        )}
        {canEdit && selectedCount > 0 && (
          <button
            type="button"
            onClick={onUntag}
            className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-brand-primary hover:bg-accent transition-all"
            title="Remove tags from selected items"
          >
            <TagIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Untag</span>
            <span className="text-xs">({selectedCount})</span>
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={onMove}
            className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-brand-primary hover:bg-accent transition-all"
          >
            <FolderOpen className="w-4 h-4" />
            <span className="hidden sm:inline">Move</span>
            <span className="text-xs">({selectedCount + selectedFolderCount})</span>
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-sm text-destructive hover:bg-destructive/10 transition-all"
        >
          <Trash2 className="w-4 h-4" />
          <span className="hidden sm:inline">Delete</span>
          <span className="text-xs">({selectedCount})</span>
        </button>
      </div>

      {/* Mobile: selection actions dropdown */}
      <div className="relative md:hidden" ref={selectionActionsMenuRef}>
        <button
          type="button"
          onClick={() => setShowSelectionActionsMenu((p) => !p)}
          className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium text-foreground bg-muted transition-all"
        >
          Actions
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showSelectionActionsMenu ? "rotate-180" : ""}`} />
        </button>
        {showSelectionActionsMenu && (
          <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl bg-card border border-border/30 shadow-ambient p-1.5 z-40">
            {[
              { label: `Download (${selectedCount})`, icon: Download, disabled: selectedCount === 0, destructive: false, show: true, run: onDownload },
              { label: `Compress (${compressibleCount})`, icon: Minimize2, disabled: compressibleCount === 0, destructive: false, show: selectedCount > 0, run: onCompress },
              { label: `Transcode (${videoCount})`, icon: Film, disabled: videoCount === 0, destructive: false, show: canEdit, run: onTranscode },
              { label: `Thumbnails (${thumbableCount})`, icon: RefreshCw, disabled: thumbableCount === 0, destructive: false, show: true, run: onRegenerateThumbnails },
              { label: `Add tags (${selectedCount})`, icon: TagIcon, disabled: selectedCount === 0, destructive: false, show: true, run: onTag },
              { label: `Remove tags (${selectedCount})`, icon: TagIcon, disabled: selectedCount === 0, destructive: false, show: canEdit, run: onUntag },
              { label: `Move (${selectedCount + selectedFolderCount})`, icon: FolderOpen, disabled: false, destructive: false, show: canEdit, run: onMove },
              { label: `Delete (${selectedCount})`, icon: Trash2, disabled: false, destructive: true, show: true, run: onDelete },
            ].filter((item) => item.show).map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => { setShowSelectionActionsMenu(false); item.run(); }}
                disabled={item.disabled}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left text-sm disabled:opacity-40 transition-colors ${
                  item.destructive
                    ? "text-destructive hover:bg-destructive/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
