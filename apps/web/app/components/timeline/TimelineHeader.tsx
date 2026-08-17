import { ArrowLeft, CalendarDays, Check, CheckSquare, ChevronDown, Minus, Plus, Settings } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { MIN_ZOOM, MAX_ZOOM } from "~/hooks/useZoomAnchor";

const ZOOM_LEVEL_LABELS = ["Years", "Months", "Grid", "Dense"] as const;

const DATE_SOURCE_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  { value: "folder", label: "Folder & file names", description: "Dates from folder names like 2022-02, then filename patterns (default)" },
  { value: "exif", label: "Embedded metadata (EXIF)", description: "Capture date written inside the file by the camera; falls back to folder & file names when missing. Slower to re-index" },
  { value: "created", label: "File creation time", description: "When the file was created on disk" },
  { value: "modified", label: "File modified time", description: "When the file was last changed" },
];

interface TimelineHeaderProps {
  itemCount: number | null;
  userRole: string | undefined;
  canEdit: boolean;
  isGridLevel: boolean;
  zoom: number;
  selectionMode: boolean;
  showSettingsMenu: boolean;
  settingsMenuRef: RefObject<HTMLDivElement | null>;
  dateSource: string;
  dateSourceSaving: boolean;
  onNavigateBack: () => void;
  onToggleSettingsMenu: () => void;
  onChangeDateSource: (value: string) => void;
  onToggleSelectionMode: () => void;
  onZoomChange: (zoom: number) => void;
}

export function TimelineHeader({
  itemCount,
  userRole,
  canEdit,
  isGridLevel,
  zoom,
  selectionMode,
  showSettingsMenu,
  settingsMenuRef,
  dateSource,
  dateSourceSaving,
  onNavigateBack,
  onToggleSettingsMenu,
  onChangeDateSource,
  onToggleSelectionMode,
  onZoomChange,
}: TimelineHeaderProps) {
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (zoomMenuRef.current && !zoomMenuRef.current.contains(e.target as Node)) {
        setShowZoomMenu(false);
      }
    };
    if (showZoomMenu) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showZoomMenu]);

  return (
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/20">
      <div className="flex items-center justify-between px-4 md:px-6 py-3 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onNavigateBack}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Collections</span>
          </button>
          <div className="w-px h-5 bg-border/40" />
          <h1 className="font-manrope font-bold text-lg flex items-center gap-2 truncate">
            <CalendarDays className="w-5 h-5 text-brand-primary shrink-0" />
            Timeline
          </h1>
          {itemCount !== null && (
            <span className="hidden md:inline text-xs text-muted-foreground font-mono">
              {itemCount.toLocaleString()} items
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
        {/* Timeline settings (admin only) */}
        {userRole === "admin" && (
          <div className="relative" ref={settingsMenuRef}>
            <button
              type="button"
              onClick={onToggleSettingsMenu}
              className={`p-2 rounded-xl border transition-all ${
                showSettingsMenu
                  ? "bg-accent border-border/50 text-foreground"
                  : "bg-card border-border/30 text-muted-foreground hover:text-foreground"
              }`}
              title="Timeline settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            {showSettingsMenu && (
              <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl bg-card border border-border/30 shadow-ambient p-3 z-40">
                <p className="text-xs font-manrope font-semibold text-foreground px-1 pb-2">
                  Timeline date source
                </p>
                <div className="space-y-1">
                  {DATE_SOURCE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onChangeDateSource(option.value)}
                      disabled={dateSourceSaving}
                      className={`w-full flex items-start gap-2 px-2 py-2 rounded-xl text-left transition-colors disabled:opacity-50 ${
                        dateSource === option.value ? "bg-accent" : "hover:bg-accent/50"
                      }`}
                    >
                      <span className="w-4 pt-0.5 shrink-0">
                        {dateSource === option.value && <Check className="w-4 h-4 text-brand-primary" />}
                      </span>
                      <span>
                        <span className="block text-xs font-medium text-foreground">{option.label}</span>
                        <span className="block text-[10px] text-muted-foreground mt-0.5">{option.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground px-1 pt-2 border-t border-border/20 mt-2">
                  Changing this re-dates the whole library in the background.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Select toggle */}
        {canEdit && isGridLevel && (
          <button
            type="button"
            onClick={onToggleSelectionMode}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
              selectionMode
                ? "gradient-brand text-[#060e20] border-transparent"
                : "bg-card border-border/30 text-muted-foreground hover:text-foreground"
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5" />
            {selectionMode ? "Cancel" : "Select"}
          </button>
        )}

        {/* Zoom controls — segmented on desktop, compact dropdown on mobile */}
        <div className="hidden md:flex items-center gap-1 bg-card rounded-xl border border-border/30 p-1">
          <button
            type="button"
            onClick={() => onZoomChange(zoom - 1)}
            disabled={zoom === MIN_ZOOM}
            className="p-1.5 rounded-lg hover:bg-accent disabled:opacity-30 transition-colors"
            title="Zoom out"
          >
            <Minus className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1 px-1">
            {ZOOM_LEVEL_LABELS.map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => onZoomChange(i)}
                className={`px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                  zoom === i ? "gradient-brand text-[#060e20]" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onZoomChange(zoom + 1)}
            disabled={zoom === MAX_ZOOM}
            className="p-1.5 rounded-lg hover:bg-accent disabled:opacity-30 transition-colors"
            title="Zoom in"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="relative md:hidden" ref={zoomMenuRef}>
          <button
            type="button"
            onClick={() => setShowZoomMenu((p) => !p)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-card border border-border/30 text-xs font-medium text-foreground"
            aria-label="Change zoom level"
          >
            {ZOOM_LEVEL_LABELS[zoom]}
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showZoomMenu ? "rotate-180" : ""}`} />
          </button>
          {showZoomMenu && (
            <div className="absolute right-0 top-full mt-2 w-40 rounded-2xl bg-card border border-border/30 shadow-ambient p-1.5 z-40">
              {ZOOM_LEVEL_LABELS.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    onZoomChange(i);
                    setShowZoomMenu(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left text-xs transition-colors ${
                    zoom === i ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <span className="w-4 shrink-0">
                    {zoom === i && <Check className="w-3.5 h-3.5 text-brand-primary" />}
                  </span>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
    </header>
  );
}
