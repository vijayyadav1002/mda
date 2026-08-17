import type { RefObject } from "react";
import { CheckSquare, Square } from "lucide-react";
import { monthKeyOf, monthShortLabel, monthLabel } from "~/lib/date";
import type { Bucket, SectionState, TimelineAsset } from "~/hooks/useTimelineSections";
import { AssetTile } from "./AssetTile";
import { CoverMosaic } from "./CoverMosaic";

interface TimelineGridProps {
  zoom: number;
  monthBuckets: Bucket[];
  yearBuckets: Bucket[] | null;
  monthCovers: Bucket[] | null;
  years: Array<[string, { count: number }]>;
  sortedMonthKeys: string[];
  sections: Record<string, SectionState>;
  visibleMonths: Set<string>;
  containerWidth: number;
  cols: number;
  tileGap: number;
  sectionHeight: (count: number) => number;
  gridRef: RefObject<HTMLDivElement | null>;
  registerSection: (monthKey: string) => (element: HTMLDivElement | null) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  toggleSectionSelection: (assets: TimelineAsset[]) => void;
  apiUrl: string;
  onActivate: (asset: TimelineAsset) => void;
  onThumbError: (assetId: string) => void;
  setZoom: (zoom: number) => void;
  zoomAnchorRef: RefObject<string | null>;
}

export function TimelineGrid({
  zoom,
  monthBuckets,
  yearBuckets,
  monthCovers,
  years,
  sortedMonthKeys,
  sections,
  visibleMonths,
  containerWidth,
  cols,
  tileGap,
  sectionHeight,
  gridRef,
  registerSection,
  selectionMode,
  selectedIds,
  toggleSectionSelection,
  apiUrl,
  onActivate,
  onThumbError,
  setZoom,
  zoomAnchorRef,
}: TimelineGridProps) {
  return (
    <>
      {/* ── Level 0: Years ── */}
      {zoom === 0 && (
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
                <CoverMosaic covers={bucket.coverAssets} fallbackLabel={year} apiUrl={apiUrl} />
                <p className="mt-2 font-manrope font-bold text-xl group-hover:text-brand-primary transition-colors">{year}</p>
                <p className="text-xs text-muted-foreground">{bucket.count.toLocaleString()} items</p>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Level 1: Months ── */}
      {zoom === 1 && (
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
                <CoverMosaic covers={bucket.coverAssets} fallbackLabel={monthShortLabel(key)} apiUrl={apiUrl} />
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
      {zoom >= 2 && (
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
                        apiUrl={apiUrl}
                        onActivate={onActivate}
                        onThumbError={onThumbError}
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
    </>
  );
}
