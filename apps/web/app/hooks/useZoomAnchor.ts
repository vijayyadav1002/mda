import { useCallback, useEffect, useRef } from "react";

// Zoom levels, iOS-Photos style: 0 = years, 1 = months, 2 = comfy grid, 3 = dense grid
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 3;

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
interface UseZoomAnchorParams {
  zoom: number;
  setZoom: (value: number | ((prev: number) => number)) => void;
  /** Populated by `useTimelineSections`; scanned for the section nearest the top of the viewport. */
  observedSectionsRef: React.RefObject<Map<Element, string>>;
  /** Suppresses pinch-to-zoom while a two-finger drag-select gesture is in progress. */
  isDragSelectingRef: React.RefObject<boolean>;
  minZoom: number;
  maxZoom: number;
}

export function useZoomAnchor({
  zoom,
  setZoom,
  observedSectionsRef,
  isDragSelectingRef,
  minZoom,
  maxZoom,
}: UseZoomAnchorParams) {
  const zoomAnchorRef = useRef<string | null>(null);
  const wheelAccumRef = useRef(0);
  const pinchDistanceRef = useRef<number | null>(null);

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

  return { anchorAndSetZoom, zoomAnchorRef };
}
