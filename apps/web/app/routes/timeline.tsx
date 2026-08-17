import type { MetaFunction } from "react-router";
import { useNavigate } from "react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CheckSquare, ImageIcon, Play, Square, X, Zap } from "lucide-react";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { MediaAssetViewer } from "~/components/MediaAssetViewer";
import { CompressDialog } from "~/components/CompressDialog";
import { TagDialog } from "~/components/TagDialog";
import { RemoveTagsDialog } from "~/components/RemoveTagsDialog";
import { TimelineHeader } from "~/components/timeline/TimelineHeader";
import { TimelineSelectionBar } from "~/components/timeline/TimelineSelectionBar";
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
import { useTimelineSettings } from "~/hooks/useTimelineSettings";

export const meta: MetaFunction = () => [{ title: "Timeline — MDA" }];

/* ── GraphQL ────────────────────────────────────────────────────── */

/* ── Types ──────────────────────────────────────────────────────── */

// Zoom levels, iOS-Photos style: 0 = years, 1 = months, 2 = comfy grid, 3 = dense grid
const MIN_ZOOM = 0;
const MAX_ZOOM = 3;
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
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement>(null);

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
  const settings = useTimelineSettings({ reloadTimeline, showToast });

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
      <TimelineHeader
        itemCount={monthBuckets ? totalCount : null}
        userRole={userRole}
        canEdit={canEdit}
        isGridLevel={isGridLevel}
        zoom={zoom}
        selectionMode={selectionMode}
        showSettingsMenu={settings.showSettingsMenu}
        settingsMenuRef={settings.settingsMenuRef}
        dateSource={settings.dateSource}
        dateSourceSaving={settings.dateSourceSaving}
        showZoomMenu={showZoomMenu}
        zoomMenuRef={zoomMenuRef}
        onNavigateBack={() => navigate("/dashboard")}
        onToggleSettingsMenu={() => settings.setShowSettingsMenu((p) => !p)}
        onChangeDateSource={settings.handleChangeDateSource}
        onToggleSelectionMode={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
        onZoomChange={anchorAndSetZoom}
        onToggleZoomMenu={() => setShowZoomMenu((p) => !p)}
        onCloseZoomMenu={() => setShowZoomMenu(false)}
      />

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
        <TimelineSelectionBar
          selectedCount={selectedIds.size}
          selectedVideoCount={selectedVideos.length}
          onAddTags={() => { tagActions.setTagTargets(selectedAssets); tagActions.setIsTagDialogOpen(true); }}
          onRemoveTags={() => { tagActions.setTagTargets(selectedAssets); tagActions.setIsRemoveTagsDialogOpen(true); }}
          onCompress={() => assetActions.setIsCompressDialogOpen(true)}
          onTranscode={() => void assetActions.handleTranscode()}
          onRegenerateThumbnails={() => void handleRegenerateThumbnails()}
          onDelete={() => assetActions.setShowDeleteConfirm(true)}
          onExit={exitSelection}
        />
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
