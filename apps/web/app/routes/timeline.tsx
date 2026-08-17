import type { MetaFunction } from "react-router";
import { useNavigate } from "react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, Check, CheckSquare, ChevronDown, Film, ImageIcon, ListTodo, Minus, Play, Plus, RefreshCw, Settings, Square, Tag as TagIcon, Trash2, X, Zap } from "lucide-react";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { MediaAssetViewer } from "~/components/MediaAssetViewer";
import { CompressDialog } from "~/components/CompressDialog";
import { TagDialog } from "~/components/TagDialog";
import { RemoveTagsDialog } from "~/components/RemoveTagsDialog";
import { createGraphQLClient, getApiUrl, getAuthToken } from "~/lib/api";
import { formatBytes, formatDuration } from "~/lib/format";
import { monthKeyOf, monthShortLabel, monthLabel } from "~/lib/date";
import { useDragSelect } from "~/hooks/useDragSelect";
import { useTimelineSections, type Bucket, type TimelineAsset } from "~/hooks/useTimelineSections";
import { useZoomAnchor } from "~/hooks/useZoomAnchor";
import { useToast } from "~/hooks/useToast";
import { useTimelineSelection } from "~/hooks/useTimelineSelection";
import { useThumbnailRefresh } from "~/hooks/useThumbnailRefresh";
import { useTimelineTagActions } from "~/hooks/useTimelineTagActions";
import { useTimelineAssetActions } from "~/hooks/useTimelineAssetActions";

export const meta: MetaFunction = () => [{ title: "Timeline — MDA" }];

/* ── GraphQL ────────────────────────────────────────────────────── */

const TIMELINE_SETTINGS_QUERY = `
  query TimelineSettings { timelineSettings { dateSource } }
`;

const UPDATE_TIMELINE_DATE_SOURCE_MUTATION = `
  mutation UpdateTimelineDateSource($dateSource: String!) {
    updateTimelineDateSource(dateSource: $dateSource) { dateSource }
  }
`;

const DATE_SOURCE_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  { value: "folder", label: "Folder & file names", description: "Dates from folder names like 2022-02, then filename patterns (default)" },
  { value: "exif", label: "Embedded metadata (EXIF)", description: "Capture date written inside the file by the camera; falls back to folder & file names when missing. Slower to re-index" },
  { value: "created", label: "File creation time", description: "When the file was created on disk" },
  { value: "modified", label: "File modified time", description: "When the file was last changed" },
];

/* ── Types ──────────────────────────────────────────────────────── */

// Zoom levels, iOS-Photos style: 0 = years, 1 = months, 2 = comfy grid, 3 = dense grid
const MIN_ZOOM = 0;
const MAX_ZOOM = 3;
const ZOOM_LEVEL_LABELS = ["Years", "Months", "Grid", "Dense"] as const;
const TILE_SIZE: Record<number, number> = { 2: 168, 3: 96 };
const TILE_GAP: Record<number, number> = { 2: 8, 3: 4 };
const SECTION_HEADER_H = 52;

/* ── Tile ───────────────────────────────────────────────────────── */

const AssetTile = memo(function AssetTile({
  asset,
  apiUrl,
  onActivate,
  onThumbError,
  selectionMode = false,
  isSelected = false,
}: Readonly<{
  asset: TimelineAsset;
  apiUrl: string;
  onActivate: (asset: TimelineAsset) => void;
  onThumbError: (assetId: string) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
}>) {
  const isVideo = asset.mimeType.startsWith("video/");
  return (
    <button
      type="button"
      data-asset-id={asset.id}
      onClick={() => onActivate(asset)}
      className={`relative w-full aspect-square overflow-hidden bg-muted/40 rounded-[3px] focus:outline-hidden focus:ring-2 focus:ring-brand-primary group/tile ${
        isSelected ? "ring-2 ring-brand-primary" : ""
      }`}
      title={asset.fileName}
    >
      {selectionMode && (
        <span className="absolute top-1 left-1 z-10">
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-brand-primary drop-shadow-sm bg-black/40 rounded-sm" />
          ) : (
            <Square className="w-4 h-4 text-white/80 drop-shadow-sm" />
          )}
        </span>
      )}
      {isSelected && <span className="absolute inset-0 bg-brand-primary/20 z-[5] pointer-events-none" />}
      {asset.thumbnailUrl ? (
        <img
          src={`${apiUrl}${asset.thumbnailUrl}`}
          alt={asset.fileName}
          loading="lazy"
          draggable={false}
          className="w-full h-full object-cover transition-transform duration-300 group-hover/tile:scale-105"
          onError={() => onThumbError(asset.id)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ImageIcon className="w-5 h-5 text-muted-foreground/40" />
        </div>
      )}
      {isVideo && (
        <span
          className="absolute bottom-1 right-1 flex items-center gap-0.5 px-1 py-0.5 rounded-sm bg-black/60 text-white text-[10px] font-mono leading-none"
          title={asset.transcodedUrl ? "Transcoded — plays instantly" : undefined}
        >
          {asset.transcodedUrl && <Zap className="w-2.5 h-2.5 fill-emerald-400 text-emerald-400" />}
          <Play className="w-2.5 h-2.5 fill-current" />
          {asset.duration ? formatDuration(asset.duration) : ""}
        </span>
      )}
      <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded-sm bg-black/60 text-white text-[10px] font-mono leading-none">
        {formatBytes(asset.fileSize)}
      </span>
    </button>
  );
});

/* ── Route ──────────────────────────────────────────────────────── */

export default function Timeline() {
  const navigate = useNavigate();
  const API_URL = getApiUrl();

  const [userRole, setUserRole] = useState<string | undefined>(undefined);
  const [zoom, setZoom] = useState(2);
  const {
    monthBuckets,
    setMonthBuckets,
    yearBuckets,
    monthCovers,
    sections,
    setSections,
    sectionsRef,
    visibleMonths,
    sortedMonthKeys,
    error,
    registerSection,
    observedSectionsRef,
    refreshSectionThumbnails,
    reloadTimeline,
  } = useTimelineSections(zoom);
  const [containerWidth, setContainerWidth] = useState(0);
  const [currentPeriod, setCurrentPeriod] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<TimelineAsset | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const {
    selectionMode,
    setSelectionMode,
    selectedIds,
    setSelectedIds,
    toggleAssetSelection,
    toggleSectionSelection,
    exitSelection,
  } = useTimelineSelection();
  const { toast, setToast, showToast } = useToast();
  const tagActions = useTimelineTagActions({
    selectionMode,
    exitSelection,
    selectedAsset,
    setSelectedAsset,
    setSections,
    showToast,
  });
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [dateSource, setDateSource] = useState<string>("folder");
  const [dateSourceSaving, setDateSourceSaving] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement>(null);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  const gridRef = useRef<HTMLDivElement>(null);

  /* ── Bootstrapping ── */

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("darkMode");
      const dark = stored !== null ? stored === "true" : true;
      document.documentElement.classList.toggle("dark", dark);
    }
    const token = getAuthToken();
    if (!token) {
      navigate("/login");
      return;
    }
    const client = createGraphQLClient(token);
    client
      .request<{ me: { role: string } | null }>(`query { me { username role } }`)
      .then((data) => setUserRole(data.me?.role))
      .catch(() => navigate("/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Layout math ── */

  // Re-attach whenever the grid container (re)mounts — it unmounts when
  // zooming out to the months/years summaries, so observing once is not enough.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    setContainerWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      if (width > 0) setContainerWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [monthBuckets, zoom]);

  const isGridLevel = zoom >= 2;
  const tileSize = TILE_SIZE[zoom] ?? TILE_SIZE[2];
  const tileGap = TILE_GAP[zoom] ?? TILE_GAP[2];
  const cols = Math.max(2, Math.floor((containerWidth + tileGap) / (tileSize + tileGap)));
  const tileWidth = containerWidth > 0 ? (containerWidth - (cols - 1) * tileGap) / cols : tileSize;

  const sectionHeight = useCallback(
    (count: number) => {
      const rows = Math.ceil(count / cols);
      return SECTION_HEADER_H + rows * tileWidth + (rows - 1) * tileGap + 24;
    },
    [cols, tileWidth, tileGap]
  );

  // Every loaded asset in display order. Backs both lightbox navigation and
  // drag-select ranges; sections missing from it simply aren't loaded yet.
  const flatAssets = useMemo(() => {
    const result: TimelineAsset[] = [];
    for (const key of sortedMonthKeys) {
      const section = sections[key];
      if (section?.assets) result.push(...section.assets);
    }
    return result;
  }, [sortedMonthKeys, sections]);

  const orderedAssetIds = useMemo(() => flatAssets.map((a) => a.id), [flatAssets]);

  const { isDragSelectingRef, consumeDragClick } = useDragSelect({
    enabled: selectionMode && isGridLevel,
    orderedIds: orderedAssetIds,
    selectedIds,
    setSelectedIds,
  });

  const { anchorAndSetZoom, zoomAnchorRef } = useZoomAnchor({
    zoom,
    setZoom,
    observedSectionsRef,
    isDragSelectingRef,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
  });

  /* ── Scroll position → floating period pill ── */

  useEffect(() => {
    if (!isGridLevel) return;
    const onScroll = () => {
      let current: string | null = null;
      for (const [element, key] of observedSectionsRef.current) {
        const rect = (element as HTMLElement).getBoundingClientRect();
        if (rect.top <= 140 && rect.bottom > 140) {
          current = key;
          break;
        }
      }
      if (current) setCurrentPeriod(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [isGridLevel, zoom]);

  /* ── Lightbox ── */

  const viewerIndex = useMemo(
    () => (selectedAsset ? flatAssets.findIndex((a) => a.id === selectedAsset.id) : -1),
    [selectedAsset, flatAssets]
  );

  const handleViewerNavigate = useCallback(
    (direction: 1 | -1) => {
      setSelectedAsset((prev) => {
        if (!prev) return prev;
        const idx = flatAssets.findIndex((a) => a.id === prev.id);
        if (idx === -1) return prev;
        return flatAssets[idx + direction] ?? prev;
      });
    },
    [flatAssets]
  );

  // Preload neighboring images so navigation feels instant
  useEffect(() => {
    if (!isViewerOpen || viewerIndex === -1) return;
    for (const neighbor of [flatAssets[viewerIndex - 1], flatAssets[viewerIndex + 1]]) {
      if (neighbor?.mimeType.startsWith("image/")) {
        const img = new Image();
        img.src = `${API_URL}/image/${neighbor.id}`;
      }
    }
  }, [isViewerOpen, viewerIndex, flatAssets, API_URL]);

  const openAsset = useCallback(
    (asset: TimelineAsset) => {
      // A drag ends with a click on whichever tile the pointer was over —
      // don't let it toggle that tile back off.
      if (consumeDragClick()) return;
      if (selectionMode) {
        toggleAssetSelection(asset.id);
        return;
      }
      setSelectedAsset(asset);
      setIsViewerOpen(true);
    },
    [selectionMode, consumeDragClick]
  );

  /* ── Multi-select actions ── */

  const canEdit = userRole === "admin" || userRole === "editor";
  const selectedAssets = useMemo(
    () => flatAssets.filter((a) => selectedIds.has(a.id)),
    [flatAssets, selectedIds]
  );
  const selectedVideos = useMemo(
    () => selectedAssets.filter((a) => a.mimeType.startsWith("video/")),
    [selectedAssets]
  );

  const assetActions = useTimelineAssetActions({
    apiUrl: API_URL,
    selectedAssets,
    selectedVideos,
    sectionsRef,
    setSections,
    setMonthBuckets,
    showToast,
    exitSelection,
  });

  /* ── Timeline settings (admin) ── */

  // Load current date source when the settings menu is first opened
  useEffect(() => {
    if (!showSettingsMenu) return;
    const token = getAuthToken();
    if (!token) return;
    createGraphQLClient(token)
      .request<{ timelineSettings: { dateSource: string } }>(TIMELINE_SETTINGS_QUERY)
      .then((data) => setDateSource(data.timelineSettings.dateSource))
      .catch(() => {});
  }, [showSettingsMenu]);

  // Close the settings menu on outside click
  useEffect(() => {
    if (!showSettingsMenu) return;
    const handler = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSettingsMenu]);

  // Close the mobile zoom dropdown on outside click
  useEffect(() => {
    if (!showZoomMenu) return;
    const handler = (e: MouseEvent) => {
      if (zoomMenuRef.current && !zoomMenuRef.current.contains(e.target as Node)) {
        setShowZoomMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showZoomMenu]);

  // Close the mobile actions dropdown on outside click
  useEffect(() => {
    if (!showActionsMenu) return;
    const handler = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setShowActionsMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showActionsMenu]);

  const handleChangeDateSource = async (value: string) => {
    if (value === dateSource || dateSourceSaving) return;
    const token = getAuthToken();
    if (!token) return;
    setDateSourceSaving(true);
    try {
      const data = await createGraphQLClient(token).request<{ updateTimelineDateSource: { dateSource: string } }>(
        UPDATE_TIMELINE_DATE_SOURCE_MUTATION,
        { dateSource: value }
      );
      setDateSource(data.updateTimelineDateSource.dateSource);
      setShowSettingsMenu(false);
      showToast("Date source updated — re-dating library in the background…");
      // Give the backend a moment to recompute, then reload. Large libraries
      // may keep reshuffling for a while; scrolling refetches as needed.
      window.setTimeout(reloadTimeline, 4000);
    } catch (err: any) {
      showToast(`Failed to update date source: ${err?.response?.errors?.[0]?.message ?? err.message}`);
    } finally {
      setDateSourceSaving(false);
    }
  };

  const { handleThumbError, handleRegenerateThumbnails } = useThumbnailRefresh({
    sections,
    setSections,
    visibleMonths,
    isGridLevel,
    refreshSectionThumbnails,
    selectedAssets,
    selectedIds,
    showToast,
    exitSelection,
  });

  /* ── Summary card cover mosaic ── */

  const CoverMosaic = ({ covers, fallbackLabel }: { covers: Bucket["coverAssets"]; fallbackLabel: string }) => {
    const withThumbs = covers.filter((c) => c.thumbnailUrl);

    // No usable cover images (thumbnails not generated yet, or still loading):
    // render a decorative "photo stack" card so the tile never looks broken.
    if (withThumbs.length === 0) {
      return (
        <div className="relative w-full aspect-square rounded-xl overflow-hidden border border-border/20 bg-gradient-to-br from-brand-primary/20 via-muted/50 to-transparent">
          {/* Stacked-photos motif */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative w-1/2 aspect-square">
              <div className="absolute inset-0 rounded-lg bg-card/70 border border-border/40 rotate-[-8deg]" />
              <div className="absolute inset-0 rounded-lg bg-card/80 border border-border/40 rotate-[5deg]" />
              <div className="absolute inset-0 rounded-lg bg-card border border-border/50 flex items-center justify-center">
                <ImageIcon className="w-1/3 h-1/3 text-muted-foreground/40" />
              </div>
            </div>
          </div>
          <span className="absolute bottom-2 right-3 font-manrope font-bold text-2xl text-foreground/15 select-none">
            {fallbackLabel}
          </span>
        </div>
      );
    }

    const cells = withThumbs.length >= 4 ? withThumbs.slice(0, 4) : withThumbs.slice(0, 1);
    return (
      <div className={`grid ${cells.length === 4 ? "grid-cols-2" : "grid-cols-1"} gap-0.5 w-full aspect-square overflow-hidden rounded-xl bg-muted/40`}>
        {cells.map((c) => (
          <div key={c.id} className="relative overflow-hidden">
            <img
              src={`${API_URL}${c.thumbnailUrl}`}
              alt={c.fileName}
              loading="lazy"
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          </div>
        ))}
      </div>
    );
  };

  /* ── Render ── */

  const years = useMemo(() => {
    const map = new Map<string, { count: number }>();
    for (const b of monthBuckets ?? []) {
      const year = monthKeyOf(b.period).slice(0, 4);
      map.set(year, { count: (map.get(year)?.count ?? 0) + b.count });
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [monthBuckets]);

  const totalCount = useMemo(
    () => (monthBuckets ?? []).reduce((sum, b) => sum + b.count, 0),
    [monthBuckets]
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/20">
        <div className="flex items-center justify-between px-4 md:px-6 py-3 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
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
            {monthBuckets && (
              <span className="hidden md:inline text-xs text-muted-foreground font-mono">
                {totalCount.toLocaleString()} items
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
          {/* Timeline settings (admin only) */}
          {userRole === "admin" && (
            <div className="relative" ref={settingsMenuRef}>
              <button
                type="button"
                onClick={() => setShowSettingsMenu((p) => !p)}
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
                        onClick={() => void handleChangeDateSource(option.value)}
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
              onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
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
              onClick={() => anchorAndSetZoom(zoom - 1)}
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
                  onClick={() => anchorAndSetZoom(i)}
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
              onClick={() => anchorAndSetZoom(zoom + 1)}
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
                      anchorAndSetZoom(i);
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

      {/* Floating current-period pill */}
      {isGridLevel && currentPeriod && (
        <div className="fixed top-[68px] left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <span className="px-3 py-1.5 rounded-full bg-card/90 backdrop-blur-md border border-border/30 text-xs font-manrope font-semibold shadow-ambient">
            {monthLabel(currentPeriod)}
          </span>
        </div>
      )}

      {/* Year scrubber (grid levels, desktop) */}
      {isGridLevel && years.length > 1 && (
        <nav className="hidden lg:flex fixed right-2 top-1/2 -translate-y-1/2 z-20 flex-col gap-0.5 max-h-[70vh] overflow-y-auto">
          {years.map(([year]) => (
            <button
              key={year}
              type="button"
              onClick={() => {
                const firstMonth = sortedMonthKeys.find((k) => k.startsWith(year));
                if (firstMonth) {
                  document.getElementById(`tl-sec-${firstMonth}`)?.scrollIntoView({ block: "start" });
                  window.scrollBy(0, -80);
                }
              }}
              className="px-2 py-0.5 rounded-md text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {year}
            </button>
          ))}
        </nav>
      )}

      <main className="px-4 md:px-6 pb-16 pt-4">
        {error && (
          <div className="max-w-lg mx-auto mt-20 text-center text-muted-foreground">
            <CalendarDays className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {!error && !monthBuckets && (
          <div className="max-w-lg mx-auto mt-20 text-center text-muted-foreground animate-pulse">
            <p className="text-sm">Loading timeline…</p>
          </div>
        )}

        {!error && monthBuckets && monthBuckets.length === 0 && (
          <div className="max-w-lg mx-auto mt-20 text-center text-muted-foreground">
            <CalendarDays className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">No dated media yet. The library may still be indexing.</p>
          </div>
        )}

        {/* ── Level 0: Years ── */}
        {monthBuckets && zoom === 0 && (
          <div className="max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {(yearBuckets ?? years.map(([year, { count }]) => ({ period: `${year}-01-01T00:00:00.000Z`, count, coverAssets: [] }))).map((bucket) => {
              const year = bucket.period.slice(0, 4);
              return (
                <button
                  key={year}
                  id={`tl-year-${year}`}
                  type="button"
                  onClick={() => {
                    zoomAnchorRef.current = sortedMonthKeys.find((k) => k.startsWith(year)) ?? null;
                    setZoom(1);
                  }}
                  className="text-left group focus:outline-hidden"
                >
                  <CoverMosaic covers={bucket.coverAssets} fallbackLabel={year} />
                  <p className="mt-2 font-manrope font-bold text-xl group-hover:text-brand-primary transition-colors">{year}</p>
                  <p className="text-xs text-muted-foreground">{bucket.count.toLocaleString()} items</p>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Level 1: Months ── */}
        {monthBuckets && zoom === 1 && (
          <div className="max-w-6xl mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {(monthCovers ?? monthBuckets).map((bucket) => {
              const key = monthKeyOf(bucket.period);
              return (
                <button
                  key={key}
                  id={`tl-month-${key}`}
                  type="button"
                  onClick={() => {
                    zoomAnchorRef.current = key;
                    setZoom(2);
                  }}
                  className="text-left group focus:outline-hidden"
                >
                  <CoverMosaic covers={bucket.coverAssets} fallbackLabel={monthShortLabel(key)} />
                  <p className="mt-2 font-manrope font-semibold text-sm group-hover:text-brand-primary transition-colors">
                    {monthLabel(key)}
                  </p>
                  <p className="text-xs text-muted-foreground">{bucket.count.toLocaleString()} items</p>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Levels 2–3: virtualized photo grid with month sections ── */}
        {monthBuckets && isGridLevel && (
          <div
            ref={gridRef}
            className="max-w-[1600px] mx-auto"
            // `pan-y` hands vertical scrolling to the browser while leaving
            // horizontal and multi-touch movement for drag-select to claim.
            style={selectionMode ? { touchAction: "pan-y", userSelect: "none" } : undefined}
          >
            {monthBuckets.map((bucket) => {
              const key = monthKeyOf(bucket.period);
              const section = sections[key];
              const materialized = visibleMonths.has(key) && section?.assets;
              return (
                <div
                  key={key}
                  id={`tl-sec-${key}`}
                  ref={registerSection(key)}
                  style={{ minHeight: containerWidth > 0 ? sectionHeight(bucket.count) : undefined }}
                >
                  <div className="flex items-baseline gap-2 pt-4 pb-2 h-[52px]">
                    <h2 className="font-manrope font-bold text-base md:text-lg">{monthLabel(key)}</h2>
                    <span className="text-xs text-muted-foreground font-mono">{bucket.count.toLocaleString()}</span>
                    {selectionMode && materialized && (() => {
                      const sectionAssets = section!.assets!;
                      const allSelected = sectionAssets.length > 0 && sectionAssets.every((a) => selectedIds.has(a.id));
                      return (
                        <button
                          type="button"
                          onClick={() => toggleSectionSelection(sectionAssets)}
                          className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium text-brand-primary hover:bg-accent transition-colors"
                        >
                          {allSelected ? (
                            <><Square className="w-3 h-3" /> Unselect all</>
                          ) : (
                            <><CheckSquare className="w-3 h-3" /> Select all</>
                          )}
                        </button>
                      );
                    })()}
                  </div>
                  {materialized ? (
                    <div
                      className="grid"
                      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: tileGap }}
                    >
                      {section!.assets!.map((asset) => (
                        <AssetTile
                          key={asset.id}
                          asset={asset}
                          apiUrl={API_URL}
                          onActivate={openAsset}
                          onThumbError={handleThumbError}
                          selectionMode={selectionMode}
                          isSelected={selectedIds.has(asset.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div
                      className="grid"
                      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: tileGap }}
                    >
                      {Array.from({ length: Math.min(bucket.count, cols) }).map((_, i) => (
                        <div key={i} className="w-full aspect-square rounded-[3px] bg-muted/30 animate-pulse" />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Selection action bar — full bar on desktop, dropdown on mobile ── */}
      {selectionMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-card/95 backdrop-blur-md border border-border/30 shadow-ambient max-w-[95vw]">
          <span className="text-xs font-manrope font-semibold px-1.5 whitespace-nowrap">
            {selectedIds.size} selected
          </span>

          {/* Desktop: inline actions */}
          <div className="hidden md:flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => { tagActions.setTagTargets(selectedAssets); tagActions.setIsTagDialogOpen(true); }}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-all whitespace-nowrap"
            >
              <TagIcon className="w-3.5 h-3.5" /> Tags
            </button>
            <button
              type="button"
              onClick={() => { tagActions.setTagTargets(selectedAssets); tagActions.setIsRemoveTagsDialogOpen(true); }}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-all whitespace-nowrap"
              title="Remove tags from selected items"
            >
              <TagIcon className="w-3.5 h-3.5" /> Untag
            </button>
            <button
              type="button"
              onClick={() => assetActions.setIsCompressDialogOpen(true)}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-all whitespace-nowrap"
            >
              <ListTodo className="w-3.5 h-3.5" /> Compress
            </button>
            <button
              type="button"
              onClick={() => void assetActions.handleTranscode()}
              disabled={selectedVideos.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-all whitespace-nowrap"
              title="Transcode selected videos to web format"
            >
              <Film className="w-3.5 h-3.5" /> Transcode{selectedVideos.length > 0 ? ` (${selectedVideos.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => void handleRegenerateThumbnails()}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-all whitespace-nowrap"
              title="Regenerate thumbnails for selected items"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Thumbnails
            </button>
            <button
              type="button"
              onClick={() => assetActions.setShowDeleteConfirm(true)}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-all whitespace-nowrap"
              title="Move selected items to the Trash"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>

          {/* Mobile: actions dropdown (opens upward) */}
          <div className="relative md:hidden" ref={actionsMenuRef}>
            <button
              type="button"
              onClick={() => setShowActionsMenu((p) => !p)}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-foreground bg-muted disabled:opacity-40 transition-all"
            >
              Actions
              <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showActionsMenu ? "" : "rotate-180"}`} />
            </button>
            {showActionsMenu && (
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 rounded-2xl bg-card border border-border/30 shadow-ambient p-1.5 z-50">
                {[
                  { label: "Add tags", icon: TagIcon, disabled: selectedIds.size === 0, destructive: false, run: () => { tagActions.setTagTargets(selectedAssets); tagActions.setIsTagDialogOpen(true); } },
                  { label: "Remove tags", icon: TagIcon, disabled: selectedIds.size === 0, destructive: false, run: () => { tagActions.setTagTargets(selectedAssets); tagActions.setIsRemoveTagsDialogOpen(true); } },
                  { label: "Compress", icon: ListTodo, disabled: selectedIds.size === 0, destructive: false, run: () => assetActions.setIsCompressDialogOpen(true) },
                  { label: `Transcode${selectedVideos.length > 0 ? ` (${selectedVideos.length})` : ""}`, icon: Film, disabled: selectedVideos.length === 0, destructive: false, run: () => void assetActions.handleTranscode() },
                  { label: "Regenerate thumbnails", icon: RefreshCw, disabled: selectedIds.size === 0, destructive: false, run: () => void handleRegenerateThumbnails() },
                  { label: "Delete", icon: Trash2, disabled: selectedIds.size === 0, destructive: true, run: () => assetActions.setShowDeleteConfirm(true) },
                ].map((item) => (
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
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={exitSelection}
            className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
            title="Exit selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-card/95 backdrop-blur-md border border-border/30 shadow-ambient">
          <span className="text-xs text-foreground whitespace-nowrap">{toast.message}</span>
          {toast.queueLink && (
            <button
              type="button"
              onClick={() => navigate("/dashboard?queue=open")}
              className="text-xs font-semibold text-brand-primary hover:underline whitespace-nowrap"
            >
              View queue
            </button>
          )}
          <button
            type="button"
            onClick={() => setToast(null)}
            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Dialogs ── */}
      <TagDialog
        isOpen={tagActions.isTagDialogOpen}
        onClose={() => tagActions.setIsTagDialogOpen(false)}
        selectedAssets={tagActions.tagTargets as any}
        suggestions={tagActions.tagSuggestions}
        onApply={tagActions.handleApplyTags}
      />
      <RemoveTagsDialog
        isOpen={tagActions.isRemoveTagsDialogOpen}
        onClose={() => tagActions.setIsRemoveTagsDialogOpen(false)}
        selectedAssets={tagActions.tagTargets as any}
        onRemove={tagActions.handleRemoveTagsBulk}
      />
      <ConfirmDialog
        open={assetActions.showDeleteConfirm}
        onOpenChange={assetActions.setShowDeleteConfirm}
        title="Delete Items"
        description={`Delete ${selectedIds.size} selected item${selectedIds.size === 1 ? "" : "s"}?`}
        warning="Items are moved to the Trash and kept for 30 days before permanent deletion."
        onConfirm={assetActions.handleDeleteSelected}
      />
      <CompressDialog
        isOpen={assetActions.isCompressDialogOpen}
        onClose={() => assetActions.setIsCompressDialogOpen(false)}
        selectedAssets={selectedAssets as any}
        onAddToQueue={(options) => {
          void assetActions.handleAddToCompressQueue(options);
          assetActions.setIsCompressDialogOpen(false);
        }}
      />

      {/* ── Lightbox ── */}
      <MediaAssetViewer
        asset={selectedAsset as any}
        isOpen={isViewerOpen}
        onClose={() => {
          setIsViewerOpen(false);
          setSelectedAsset(null);
        }}
        apiUrl={API_URL}
        userRole={userRole}
        onNavigate={handleViewerNavigate}
        hasPrev={viewerIndex > 0}
        hasNext={viewerIndex >= 0 && viewerIndex < flatAssets.length - 1}
        onAddTags={canEdit && selectedAsset ? () => {
          tagActions.setTagTargets(selectedAsset ? [selectedAsset] : []);
          tagActions.setIsTagDialogOpen(true);
        } : undefined}
        onRemoveTag={canEdit ? tagActions.handleRemoveSingleTag : undefined}
      />
    </div>
  );
}
