import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";
import { monthKeyOf, monthKeyToRange } from "~/lib/date";

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

/* ── Types ──────────────────────────────────────────────────────── */

export interface AssetTag { id: string; name: string }

export interface TimelineAsset {
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

export interface Bucket {
  period: string; // ISO timestamp of bucket start
  count: number;
  coverAssets: Pick<TimelineAsset, "id" | "fileName" | "mimeType" | "thumbnailUrl">[];
}

export interface SectionState {
  assets: TimelineAsset[] | null;
  loading: boolean;
  thumbRetries: number;
}

/**
 * Owns the timeline's month-bucket data: the top-level `monthBuckets` list
 * (and the `yearBuckets` / `monthCovers` cover-mosaic variants fetched
 * lazily for the year/month summary zoom levels), plus the per-month asset
 * pagination that materializes a month's assets once its section scrolls
 * into view (`sections`, `visibleMonths`, `registerSection`).
 *
 * Takes `zoom` as a parameter (rather than the whole zoom-control state)
 * since it only needs the current zoom level to decide which bucket
 * granularity to fetch and when to start paginating month sections.
 */
export function useTimelineSections(zoom: number) {
  const [monthBuckets, setMonthBuckets] = useState<Bucket[] | null>(null);
  const [yearBuckets, setYearBuckets] = useState<Bucket[] | null>(null);
  const [monthCovers, setMonthCovers] = useState<Bucket[] | null>(null);
  const [sections, setSections] = useState<Record<string, SectionState>>({});
  const [visibleMonths, setVisibleMonths] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const sectionObserverRef = useRef<IntersectionObserver | null>(null);
  const observedSectionsRef = useRef<Map<Element, string>>(new Map());
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  const isGridLevel = zoom >= 2;

  /* ── Bootstrapping ── */

  // Initial month-bucket fetch, driving the whole timeline.
  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;
    const client = createGraphQLClient(token);
    client
      .request<{ timelineBuckets: Bucket[] }>(TIMELINE_BUCKETS_QUERY, { granularity: "month", coverLimit: 0 })
      .then((data) => setMonthBuckets(data.timelineBuckets))
      .catch((err) => {
        console.error("Failed to load timeline:", err);
        setError("Could not load the timeline. Try refreshing the library first.");
      });
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

  const sortedMonthKeys = useMemo(
    () => (monthBuckets ?? []).map((b) => monthKeyOf(b.period)),
    [monthBuckets]
  );

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

  return {
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
  };
}
