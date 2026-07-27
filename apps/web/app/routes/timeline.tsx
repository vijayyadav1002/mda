import type { MetaFunction } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, Check, CheckSquare, ChevronDown, Film, ImageIcon, ListTodo, Minus, Play, Plus, RefreshCw, Settings, Square, Tag as TagIcon, Trash2, X, Zap } from "lucide-react";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { MediaAssetViewer } from "~/components/MediaAssetViewer";
import { CompressDialog } from "~/components/CompressDialog";
import { TagDialog, type TagSuggestion } from "~/components/TagDialog";
import { RemoveTagsDialog } from "~/components/RemoveTagsDialog";
import { createGraphQLClient, getApiUrl, getAuthToken } from "~/lib/api";
import { useDragSelect } from "~/lib/useDragSelect";

export const meta: MetaFunction = () => [{ title: "Timeline — MDA" }];

/* ── GraphQL ────────────────────────────────────────────────────── */

const TIMELINE_BUCKETS_QUERY = `
  query TimelineBuckets($granularity: String!, $coverLimit: Int) {
    timelineBuckets(granularity: $granularity, coverLimit: $coverLimit) {
      period
      count
      coverAssets { id fileName mimeType thumbnailUrl }
    }
  }
`;

const TIMELINE_ASSETS_QUERY = `
  query TimelineAssets($from: String!, $to: String!, $limit: Int, $offset: Int) {
    timelineAssets(from: $from, to: $to, limit: $limit, offset: $offset) {
      totalCount
      assets {
        id fileName filePath mimeType fileSize duration
        thumbnailUrl transcodedUrl createdAt updatedAt
        capturedAt capturedAtPrecision
        tags { id name }
      }
    }
  }
`;

const GENERATE_THUMBNAILS_MUTATION = `
  mutation GenerateThumbnailsForAssets($ids: [ID!]!, $sessionId: String, $force: Boolean) {
    generateThumbnailsForAssets(ids: $ids, sessionId: $sessionId, force: $force)
  }
`;

const TAGS_QUERY = `
  query Tags { tags { id name assetCount } }
`;

const APPLY_TAGS_MUTATION = `
  mutation ApplyTagsToAssets($assetIds: [ID!]!, $tagNames: [String!]!) {
    applyTagsToAssets(assetIds: $assetIds, tagNames: $tagNames) { id tags { id name } }
  }
`;

const REMOVE_TAGS_FROM_ASSETS_MUTATION = `
  mutation RemoveTagsFromAssets($assetIds: [ID!]!, $tagNames: [String!]!) {
    removeTagsFromAssets(assetIds: $assetIds, tagNames: $tagNames)
  }
`;

const REMOVE_TAG_MUTATION = `
  mutation RemoveTagFromAsset($assetId: ID!, $tagName: String!) {
    removeTagFromAsset(assetId: $assetId, tagName: $tagName) { id }
  }
`;

const DELETE_MEDIA_ASSET_MUTATION = `
  mutation DeleteMediaAsset($id: ID!) { deleteMediaAsset(id: $id) }
`;

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

interface AssetTag { id: string; name: string }

interface TimelineAsset {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: string;
  duration: number | null;
  thumbnailUrl: string | null;
  transcodedUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  capturedAt: string | null;
  capturedAtPrecision: string | null;
  tags?: AssetTag[];
}

interface Bucket {
  period: string; // ISO timestamp of bucket start
  count: number;
  coverAssets: Pick<TimelineAsset, "id" | "fileName" | "mimeType" | "thumbnailUrl">[];
}

interface SectionState {
  assets: TimelineAsset[] | null;
  loading: boolean;
  thumbRetries: number;
}

// Zoom levels, iOS-Photos style: 0 = years, 1 = months, 2 = comfy grid, 3 = dense grid
const MIN_ZOOM = 0;
const MAX_ZOOM = 3;
const ZOOM_LEVEL_LABELS = ["Years", "Months", "Grid", "Dense"] as const;
const ZOOM_LABELS = ["Years", "Months", "Grid", "Dense"] as const;
const TILE_SIZE: Record<number, number> = { 2: 168, 3: 96 };
const TILE_GAP: Record<number, number> = { 2: 8, 3: 4 };
const SECTION_HEADER_H = 52;

/* ── Helpers ────────────────────────────────────────────────────── */

const monthKeyOf = (iso: string) => iso.slice(0, 7); // "2022-02"

const monthKeyToRange = (key: string): { from: string; to: string } => {
  const [y, m] = key.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return { from: from.toISOString(), to: to.toISOString() };
};

const monthShortLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
};

const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

const formatBytes = (bytes: string | number) => {
  const n = typeof bytes === "string" ? parseInt(bytes) : bytes;
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const formatDuration = (seconds: number) => {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return `${m}:${String(rest).padStart(2, "0")}`;
};

const sessionId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `tl-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
      className={`relative w-full aspect-square overflow-hidden bg-muted/40 rounded-[3px] focus:outline-none focus:ring-2 focus:ring-brand-primary group/tile ${
        isSelected ? "ring-2 ring-brand-primary" : ""
      }`}
      title={asset.fileName}
    >
      {selectionMode && (
        <span className="absolute top-1 left-1 z-10">
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-brand-primary drop-shadow bg-black/40 rounded" />
          ) : (
            <Square className="w-4 h-4 text-white/80 drop-shadow" />
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
          className="absolute bottom-1 right-1 flex items-center gap-0.5 px-1 py-0.5 rounded bg-black/60 text-white text-[10px] font-mono leading-none"
          title={asset.transcodedUrl ? "Transcoded — plays instantly" : undefined}
        >
          {asset.transcodedUrl && <Zap className="w-2.5 h-2.5 fill-emerald-400 text-emerald-400" />}
          <Play className="w-2.5 h-2.5 fill-current" />
          {asset.duration ? formatDuration(asset.duration) : ""}
        </span>
      )}
      <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/60 text-white text-[10px] font-mono leading-none">
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
  const [monthBuckets, setMonthBuckets] = useState<Bucket[] | null>(null);
  const [yearBuckets, setYearBuckets] = useState<Bucket[] | null>(null);
  const [monthCovers, setMonthCovers] = useState<Bucket[] | null>(null);
  const [zoom, setZoom] = useState(2);
  const [sections, setSections] = useState<Record<string, SectionState>>({});
  const [visibleMonths, setVisibleMonths] = useState<Set<string>>(new Set());
  const [containerWidth, setContainerWidth] = useState(0);
  const [currentPeriod, setCurrentPeriod] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<TimelineAsset | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
  const [isRemoveTagsDialogOpen, setIsRemoveTagsDialogOpen] = useState(false);
  const [tagTargets, setTagTargets] = useState<TimelineAsset[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);
  const [isCompressDialogOpen, setIsCompressDialogOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; queueLink?: boolean } | null>(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [dateSource, setDateSource] = useState<string>("folder");
  const [dateSourceSaving, setDateSourceSaving] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement>(null);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  const sectionObserverRef = useRef<IntersectionObserver | null>(null);
  const observedSectionsRef = useRef<Map<Element, string>>(new Map());
  const requestedThumbIdsRef = useRef<Set<string>>(new Set());
  const thumbnailSessionIdRef = useRef<string>(sessionId());
  const wheelAccumRef = useRef(0);
  const pinchDistanceRef = useRef<number | null>(null);
  const zoomAnchorRef = useRef<string | null>(null);
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

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

    client
      .request<{ timelineBuckets: Bucket[] }>(TIMELINE_BUCKETS_QUERY, { granularity: "month", coverLimit: 0 })
      .then((data) => setMonthBuckets(data.timelineBuckets))
      .catch((err) => {
        console.error("Failed to load timeline:", err);
        setError("Could not load the timeline. Try refreshing the library first.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazily fetch cover mosaics when entering the year / month summary levels
  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;
    const client = createGraphQLClient(token);
    if (zoom === 0 && !yearBuckets) {
      client
        .request<{ timelineBuckets: Bucket[] }>(TIMELINE_BUCKETS_QUERY, { granularity: "year", coverLimit: 4 })
        .then((data) => setYearBuckets(data.timelineBuckets))
        .catch((err) => console.error("Failed to load years:", err));
    }
    if (zoom === 1 && !monthCovers) {
      client
        .request<{ timelineBuckets: Bucket[] }>(TIMELINE_BUCKETS_QUERY, { granularity: "month", coverLimit: 1 })
        .then((data) => setMonthCovers(data.timelineBuckets))
        .catch((err) => console.error("Failed to load month covers:", err));
    }
  }, [zoom, yearBuckets, monthCovers]);

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

  const sortedMonthKeys = useMemo(
    () => (monthBuckets ?? []).map((b) => monthKeyOf(b.period)),
    [monthBuckets]
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

  /* ── Section fetching (virtualized) ── */

  const fetchSection = useCallback(async (monthKey: string, expectedCount: number) => {
    const existing = sectionsRef.current[monthKey];
    if (existing?.loading || existing?.assets) return;
    setSections((prev) => ({ ...prev, [monthKey]: { assets: null, loading: true, thumbRetries: 0 } }));

    const token = getAuthToken();
    if (!token) return;
    const client = createGraphQLClient(token);
    const { from, to } = monthKeyToRange(monthKey);

    try {
      const all: TimelineAsset[] = [];
      let offset = 0;
      for (;;) {
        const data = await client.request<{ timelineAssets: { totalCount: number; assets: TimelineAsset[] } }>(
          TIMELINE_ASSETS_QUERY,
          { from, to, limit: 500, offset }
        );
        all.push(...data.timelineAssets.assets);
        offset += data.timelineAssets.assets.length;
        if (offset >= data.timelineAssets.totalCount || data.timelineAssets.assets.length === 0) break;
        if (offset > Math.max(expectedCount, 5000)) break; // safety valve
      }
      setSections((prev) => ({ ...prev, [monthKey]: { assets: all, loading: false, thumbRetries: 0 } }));
    } catch (err) {
      console.error(`Failed to load section ${monthKey}:`, err);
      setSections((prev) => ({ ...prev, [monthKey]: { assets: null, loading: false, thumbRetries: 0 } }));
    }
  }, []);

  // Refetch a section's assets (used to pick up freshly generated thumbnails)
  const refreshSectionThumbnails = useCallback(async (monthKey: string) => {
    const token = getAuthToken();
    if (!token) return;
    const client = createGraphQLClient(token);
    const { from, to } = monthKeyToRange(monthKey);
    try {
      const all: TimelineAsset[] = [];
      let offset = 0;
      for (;;) {
        const data = await client.request<{ timelineAssets: { totalCount: number; assets: TimelineAsset[] } }>(
          TIMELINE_ASSETS_QUERY,
          { from, to, limit: 500, offset }
        );
        all.push(...data.timelineAssets.assets);
        offset += data.timelineAssets.assets.length;
        if (offset >= data.timelineAssets.totalCount || data.timelineAssets.assets.length === 0) break;
      }
      setSections((prev) => {
        const current = prev[monthKey];
        if (!current) return prev;
        return { ...prev, [monthKey]: { ...current, assets: all, thumbRetries: current.thumbRetries + 1 } };
      });
    } catch {
      // Best-effort; tiles keep their placeholder
    }
  }, []);

  // Queue on-demand thumbnail generation for loaded, visible sections
  useEffect(() => {
    if (!isGridLevel) return;
    const missing: string[] = [];
    const monthsWithMissing: string[] = [];
    for (const key of visibleMonths) {
      const section = sections[key];
      if (!section?.assets) continue;
      const ids = section.assets
        .filter((a) => !a.thumbnailUrl && !requestedThumbIdsRef.current.has(a.id))
        .map((a) => a.id);
      if (ids.length > 0) {
        missing.push(...ids);
        if (section.thumbRetries < 4) monthsWithMissing.push(key);
      }
    }
    if (missing.length === 0) return;
    for (const id of missing) requestedThumbIdsRef.current.add(id);

    const token = getAuthToken();
    if (!token) return;
    const client = createGraphQLClient(token);
    void client
      .request(GENERATE_THUMBNAILS_MUTATION, { ids: missing.slice(0, 300), sessionId: thumbnailSessionIdRef.current })
      .catch((err) => console.error("Failed to queue thumbnails:", err));

    const timer = window.setTimeout(() => {
      for (const key of monthsWithMissing) void refreshSectionThumbnails(key);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [visibleMonths, sections, isGridLevel, refreshSectionThumbnails]);

  // IntersectionObserver drives which month sections are materialized
  const registerSection = useCallback(
    (monthKey: string) => (element: HTMLDivElement | null) => {
      if (!element) return;
      if (!sectionObserverRef.current) {
        sectionObserverRef.current = new IntersectionObserver(
          (entries) => {
            setVisibleMonths((prev) => {
              const next = new Set(prev);
              for (const entry of entries) {
                const key = observedSectionsRef.current.get(entry.target);
                if (!key) continue;
                if (entry.isIntersecting) next.add(key);
                else next.delete(key);
              }
              return next;
            });
          },
          { rootMargin: "900px 0px" }
        );
      }
      if (!observedSectionsRef.current.has(element)) {
        observedSectionsRef.current.set(element, monthKey);
        sectionObserverRef.current.observe(element);
      }
    },
    []
  );

  useEffect(() => () => sectionObserverRef.current?.disconnect(), []);

  // Fetch assets for months that became visible
  useEffect(() => {
    if (!isGridLevel || !monthBuckets) return;
    for (const key of visibleMonths) {
      const bucket = monthBuckets.find((b) => monthKeyOf(b.period) === key);
      if (bucket) void fetchSection(key, bucket.count);
    }
  }, [visibleMonths, isGridLevel, monthBuckets, fetchSection]);

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

  /* ── Zoom interactions ── */

  const anchorAndSetZoom = useCallback((next: number) => {
    setZoom((prev) => {
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      if (clamped === prev) return prev;
      zoomAnchorRef.current = currentPeriodRefValue();
      return clamped;
    });

    function currentPeriodRefValue() {
      for (const [element, key] of observedSectionsRef.current) {
        const rect = (element as HTMLElement).getBoundingClientRect();
        if (rect.bottom > 140) return key;
      }
      return null;
    }
  }, []);

  // Restore scroll position to the anchored month after a zoom-level change
  useEffect(() => {
    const anchor = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    if (!anchor) return;
    requestAnimationFrame(() => {
      const target = document.getElementById(`tl-${zoom >= 2 ? "sec" : zoom === 1 ? "month" : "year"}-${zoom === 0 ? anchor.slice(0, 4) : anchor}`);
      target?.scrollIntoView({ block: "start" });
      window.scrollBy(0, -80);
    });
  }, [zoom]);

  // Ctrl+wheel / trackpad pinch
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      wheelAccumRef.current += -e.deltaY;
      if (wheelAccumRef.current > 60) {
        wheelAccumRef.current = 0;
        anchorAndSetZoom(zoom + 1);
      } else if (wheelAccumRef.current < -60) {
        wheelAccumRef.current = 0;
        anchorAndSetZoom(zoom - 1);
      }
    };
    window.addEventListener("wheel", handler, { passive: false });
    return () => window.removeEventListener("wheel", handler);
  }, [zoom, anchorAndSetZoom]);

  // Touch pinch
  useEffect(() => {
    const distance = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinchDistanceRef.current = distance(e);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchDistanceRef.current === null) return;
      e.preventDefault();
      // A two-finger drag-select owns the gesture; don't also change zoom.
      if (isDragSelectingRef.current) return;
      const ratio = distance(e) / pinchDistanceRef.current;
      if (ratio > 1.3) {
        pinchDistanceRef.current = distance(e);
        anchorAndSetZoom(zoom + 1);
      } else if (ratio < 0.77) {
        pinchDistanceRef.current = distance(e);
        anchorAndSetZoom(zoom - 1);
      }
    };
    const onTouchEnd = () => {
      pinchDistanceRef.current = null;
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [zoom, anchorAndSetZoom]);

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
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(asset.id)) next.delete(asset.id);
          else next.add(asset.id);
          return next;
        });
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

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  // Toggle selection of every (loaded) asset in a month section
  const toggleSectionSelection = useCallback((assets: TimelineAsset[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = assets.every((a) => next.has(a.id));
      for (const asset of assets) {
        if (allSelected) next.delete(asset.id);
        else next.add(asset.id);
      }
      return next;
    });
  }, []);

  const showToast = useCallback((message: string, queueLink = false) => {
    setToast({ message, queueLink });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Load tag suggestions once selection mode or the tag dialog is first used
  useEffect(() => {
    if ((!selectionMode && !isTagDialogOpen) || tagSuggestions.length > 0) return;
    const token = getAuthToken();
    if (!token) return;
    createGraphQLClient(token)
      .request<{ tags: TagSuggestion[] }>(TAGS_QUERY)
      .then((data) => setTagSuggestions(data.tags))
      .catch(() => {});
  }, [selectionMode, isTagDialogOpen, tagSuggestions.length]);

  // Apply the given tags map to loaded sections + the open viewer asset
  const updateLocalAssetTags = useCallback((updated: Array<{ id: string; tags: AssetTag[] }>) => {
    const byId = new Map(updated.map((u) => [u.id, u.tags]));
    setSections((prev) => {
      const next: typeof prev = {};
      for (const [key, section] of Object.entries(prev)) {
        if (section.assets?.some((a) => byId.has(a.id))) {
          next[key] = {
            ...section,
            assets: section.assets.map((a) => (byId.has(a.id) ? { ...a, tags: byId.get(a.id) } : a)),
          };
        } else {
          next[key] = section;
        }
      }
      return next;
    });
    setSelectedAsset((prev) => (prev && byId.has(prev.id) ? { ...prev, tags: byId.get(prev.id) } : prev));
  }, []);

  const handleApplyTags = async (tagNames: string[]) => {
    const token = getAuthToken();
    if (!token) return;
    const data = await createGraphQLClient(token).request<{ applyTagsToAssets: Array<{ id: string; tags: AssetTag[] }> }>(
      APPLY_TAGS_MUTATION,
      { assetIds: tagTargets.map((a) => a.id), tagNames }
    );
    updateLocalAssetTags(data.applyTagsToAssets);
    showToast(`Tagged ${tagTargets.length} item${tagTargets.length !== 1 ? "s" : ""}`);
    if (selectionMode) exitSelection();
  };

  const handleRemoveTagsBulk = async (tagNames: string[]) => {
    const token = getAuthToken();
    if (!token) return;
    await createGraphQLClient(token).request(REMOVE_TAGS_FROM_ASSETS_MUTATION, {
      assetIds: tagTargets.map((a) => a.id),
      tagNames,
    });
    updateLocalAssetTags(
      tagTargets.map((a) => ({
        id: a.id,
        tags: (a.tags ?? []).filter((t) => !tagNames.includes(t.name)),
      }))
    );
    showToast(`Removed tags from ${tagTargets.length} item${tagTargets.length !== 1 ? "s" : ""}`);
    if (selectionMode) exitSelection();
  };

  const handleRemoveSingleTag = async (tagName: string) => {
    if (!selectedAsset) return;
    const token = getAuthToken();
    if (!token) return;
    await createGraphQLClient(token).request(REMOVE_TAG_MUTATION, {
      assetId: selectedAsset.id,
      tagName,
    });
    updateLocalAssetTags([
      { id: selectedAsset.id, tags: (selectedAsset.tags ?? []).filter((t) => t.name !== tagName) },
    ]);
  };

  const handleDeleteSelected = async () => {
    const token = getAuthToken();
    if (!token || selectedAssets.length === 0) return;
    const client = createGraphQLClient(token);
    let deleted = 0;
    const deletedIds = new Set<string>();
    for (const asset of selectedAssets) {
      try {
        await client.request(DELETE_MEDIA_ASSET_MUTATION, { id: asset.id });
        deleted += 1;
        deletedIds.add(asset.id);
      } catch (err) {
        console.error(`Failed to delete asset ${asset.id}:`, err);
      }
    }

    if (deletedIds.size > 0) {
      // Remove deleted assets from loaded sections and shrink bucket counts
      const removedPerMonth = new Map<string, number>();
      for (const [key, section] of Object.entries(sectionsRef.current)) {
        const removed = section.assets?.filter((a) => deletedIds.has(a.id)).length ?? 0;
        if (removed > 0) removedPerMonth.set(key, removed);
      }
      setSections((prev) => {
        const next: typeof prev = {};
        for (const [key, section] of Object.entries(prev)) {
          next[key] = section.assets?.some((a) => deletedIds.has(a.id))
            ? { ...section, assets: section.assets.filter((a) => !deletedIds.has(a.id)) }
            : section;
        }
        return next;
      });
      setMonthBuckets((prev) =>
        prev
          ? prev
              .map((b) => {
                const removed = removedPerMonth.get(monthKeyOf(b.period)) ?? 0;
                return removed > 0 ? { ...b, count: Math.max(0, b.count - removed) } : b;
              })
              .filter((b) => b.count > 0)
          : prev
      );
    }

    showToast(
      deleted === selectedAssets.length
        ? `Moved ${deleted} item${deleted !== 1 ? "s" : ""} to Trash`
        : `Moved ${deleted} of ${selectedAssets.length} items to Trash — some failed`
    );
    exitSelection();
  };

  const handleAddToCompressQueue = async (options: { resolution: string; quality: number }) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/compress/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: selectedAssets.map((a) => a.id), options }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      showToast("Compression job queued", true);
      exitSelection();
    } catch (err: any) {
      showToast(`Failed to queue compression: ${err.message}`);
    }
  };

  const handleTranscode = async () => {
    const token = getAuthToken();
    if (!token || selectedVideos.length === 0) return;
    try {
      const res = await fetch(`${API_URL}/api/transcode/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: selectedVideos.map((a) => a.id) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Server error ${res.status}`);
      }
      showToast(`Transcoding ${selectedVideos.length} video${selectedVideos.length !== 1 ? "s" : ""}`, true);
      exitSelection();
    } catch (err: any) {
      showToast(`Failed to queue transcode: ${err.message}`);
    }
  };

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

  const reloadTimeline = useCallback(() => {
    const token = getAuthToken();
    if (!token) return;
    setSections({});
    setVisibleMonths(new Set());
    setYearBuckets(null);
    setMonthCovers(null);
    createGraphQLClient(token)
      .request<{ timelineBuckets: Bucket[] }>(TIMELINE_BUCKETS_QUERY, { granularity: "month", coverLimit: 0 })
      .then((data) => setMonthBuckets(data.timelineBuckets))
      .catch(() => {});
  }, []);

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

  const handleRegenerateThumbnails = async () => {
    const token = getAuthToken();
    if (!token || selectedAssets.length === 0) return;
    const ids = selectedAssets.map((a) => a.id);
    try {
      await createGraphQLClient(token).request(GENERATE_THUMBNAILS_MUTATION, {
        ids,
        sessionId: thumbnailSessionIdRef.current,
        force: true,
      });
      // Prevent the on-demand effect from double-queueing while we wait
      for (const id of ids) requestedThumbIdsRef.current.add(id);
      // Show placeholders right away; the refetch below picks up fresh thumbs
      const affectedMonths = new Set<string>();
      setSections((prev) => {
        const next: typeof prev = {};
        for (const [key, section] of Object.entries(prev)) {
          if (section.assets?.some((a) => selectedIds.has(a.id))) {
            affectedMonths.add(key);
            next[key] = {
              ...section,
              assets: section.assets.map((a) =>
                selectedIds.has(a.id) ? { ...a, thumbnailUrl: null } : a
              ),
            };
          } else {
            next[key] = section;
          }
        }
        return next;
      });
      window.setTimeout(() => {
        for (const key of affectedMonths) void refreshSectionThumbnails(key);
      }, 6000);
      showToast(`Regenerating ${ids.length} thumbnail${ids.length !== 1 ? "s" : ""}`);
      exitSelection();
    } catch (err: any) {
      showToast(`Failed to queue thumbnails: ${err.message}`);
    }
  };

  // A tile's thumbnail URL can go stale if cache eviction removed the file
  // after the section was fetched. Clear it locally so the on-demand
  // generation effect re-queues it and the section refetch picks up the
  // fresh thumbnail — the tile shows a placeholder in the meantime.
  const handleThumbError = useCallback((assetId: string) => {
    requestedThumbIdsRef.current.delete(assetId);
    setSections((prev) => {
      let changed = false;
      const next: typeof prev = {};
      for (const [key, section] of Object.entries(prev)) {
        if (section.assets?.some((a) => a.id === assetId && a.thumbnailUrl)) {
          changed = true;
          next[key] = {
            ...section,
            assets: section.assets.map((a) => (a.id === assetId ? { ...a, thumbnailUrl: null } : a)),
          };
        } else {
          next[key] = section;
        }
      }
      return changed ? next : prev;
    });
  }, []);

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
              <CalendarDays className="w-5 h-5 text-brand-primary flex-shrink-0" />
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
                        <span className="w-4 pt-0.5 flex-shrink-0">
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
                    <span className="w-4 flex-shrink-0">
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
                  className="text-left group focus:outline-none"
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
                  className="text-left group focus:outline-none"
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
              onClick={() => { setTagTargets(selectedAssets); setIsTagDialogOpen(true); }}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-all whitespace-nowrap"
            >
              <TagIcon className="w-3.5 h-3.5" /> Tags
            </button>
            <button
              type="button"
              onClick={() => { setTagTargets(selectedAssets); setIsRemoveTagsDialogOpen(true); }}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-all whitespace-nowrap"
              title="Remove tags from selected items"
            >
              <TagIcon className="w-3.5 h-3.5" /> Untag
            </button>
            <button
              type="button"
              onClick={() => setIsCompressDialogOpen(true)}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-all whitespace-nowrap"
            >
              <ListTodo className="w-3.5 h-3.5" /> Compress
            </button>
            <button
              type="button"
              onClick={() => void handleTranscode()}
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
              onClick={() => setShowDeleteConfirm(true)}
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
                  { label: "Add tags", icon: TagIcon, disabled: selectedIds.size === 0, destructive: false, run: () => { setTagTargets(selectedAssets); setIsTagDialogOpen(true); } },
                  { label: "Remove tags", icon: TagIcon, disabled: selectedIds.size === 0, destructive: false, run: () => { setTagTargets(selectedAssets); setIsRemoveTagsDialogOpen(true); } },
                  { label: "Compress", icon: ListTodo, disabled: selectedIds.size === 0, destructive: false, run: () => setIsCompressDialogOpen(true) },
                  { label: `Transcode${selectedVideos.length > 0 ? ` (${selectedVideos.length})` : ""}`, icon: Film, disabled: selectedVideos.length === 0, destructive: false, run: () => void handleTranscode() },
                  { label: "Regenerate thumbnails", icon: RefreshCw, disabled: selectedIds.size === 0, destructive: false, run: () => void handleRegenerateThumbnails() },
                  { label: "Delete", icon: Trash2, disabled: selectedIds.size === 0, destructive: true, run: () => setShowDeleteConfirm(true) },
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
                    <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
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
        isOpen={isTagDialogOpen}
        onClose={() => setIsTagDialogOpen(false)}
        selectedAssets={tagTargets as any}
        suggestions={tagSuggestions}
        onApply={handleApplyTags}
      />
      <RemoveTagsDialog
        isOpen={isRemoveTagsDialogOpen}
        onClose={() => setIsRemoveTagsDialogOpen(false)}
        selectedAssets={tagTargets as any}
        onRemove={handleRemoveTagsBulk}
      />
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Items"
        description={`Delete ${selectedIds.size} selected item${selectedIds.size === 1 ? "" : "s"}?`}
        warning="Items are moved to the Trash and kept for 30 days before permanent deletion."
        onConfirm={handleDeleteSelected}
      />
      <CompressDialog
        isOpen={isCompressDialogOpen}
        onClose={() => setIsCompressDialogOpen(false)}
        selectedAssets={selectedAssets as any}
        onAddToQueue={(options) => {
          void handleAddToCompressQueue(options);
          setIsCompressDialogOpen(false);
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
          setTagTargets(selectedAsset ? [selectedAsset] : []);
          setIsTagDialogOpen(true);
        } : undefined}
        onRemoveTag={canEdit ? handleRemoveSingleTag : undefined}
      />
    </div>
  );
}
