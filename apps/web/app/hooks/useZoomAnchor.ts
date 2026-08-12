import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps scroll position stable across zoom-level changes.
 *
 * Before the zoom state changes, records which month/period section is
 * centered in the viewport (via `observedSectionsRef`, populated by
 * `useTimelineSections`); after the new zoom level renders, scrolls back to
 * that same period so the change doesn't feel like a jump.
 *
 * `zoomAnchorRef` is also returned so a caller can set the anchor directly
 * before calling `setZoom` itself — e.g. a year/month summary card jumps
 * more than one zoom level at once, so it doesn't go through
 * `anchorAndSetZoom`.
 */
export function useZoomAnchor({
  zoom,
  setZoom,
  observedSectionsRef,
  minZoom,
  maxZoom,
}: Readonly<{
  zoom: number;
  setZoom: (value: number | ((prev: number) => number)) => void;
  observedSectionsRef: React.RefObject<Map<Element, string>>;
  minZoom: number;
  maxZoom: number;
}>) {
  const zoomAnchorRef = useRef<string | null>(null);

  const anchorAndSetZoom = useCallback((next: number) => {
    setZoom((prev) => {
      const clamped = Math.min(maxZoom, Math.max(minZoom, next));
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

  return { anchorAndSetZoom, zoomAnchorRef };
}
