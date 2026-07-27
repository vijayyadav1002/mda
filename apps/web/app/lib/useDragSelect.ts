import { useCallback, useEffect, useRef } from "react";

/**
 * Drag-to-select for a grid of tiles marked with `data-asset-id`.
 *
 * Selection model is anchor → range: the tile the gesture started on and the
 * tile currently under the pointer bound a slice of `orderedIds`, which is
 * added to (or removed from, if the anchor was already selected) a snapshot of
 * the selection taken when the drag began. Recomputing from the snapshot every
 * move makes backtracking and overshoot behave.
 *
 * Indices are resolved from `anchorId` on every apply rather than cached,
 * because the caller's grid is virtualized: a section materializing above the
 * anchor shifts every index.
 *
 * Gestures:
 *  - Mouse: press on a tile, move past a few pixels.
 *  - One finger: horizontal-first drag. The caller is expected to set
 *    `touch-action: pan-y` on the grid, which leaves vertical panning to the
 *    browser (so a vertical-first drag scrolls) while keeping horizontal
 *    movement cancelable here.
 *  - Two fingers: pans the selection as long as finger separation holds within
 *    ±15%. Beyond that it's a pinch, so the gesture is abandoned and the
 *    caller's zoom handler takes over.
 */

const MOUSE_THRESHOLD = 5;
const TOUCH_THRESHOLD = 10;
const PINCH_RATIO = 0.15;
const EDGE_ZONE = 90;
const EDGE_MAX_SPEED = 18;

type GestureKind = "mouse" | "touch1" | "touch2";

interface Gesture {
  kind: GestureKind;
  dragging: boolean;
  anchorId: string;
  snapshot: Set<string>;
  remove: boolean;
  startX: number;
  startY: number;
  startSpread: number;
  lastX: number;
  lastY: number;
}

const centroidOf = (touches: TouchList) => ({
  x: (touches[0].clientX + touches[1].clientX) / 2,
  y: (touches[0].clientY + touches[1].clientY) / 2,
});

const spreadOf = (touches: TouchList) =>
  Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

const idAtPoint = (x: number, y: number): string | null => {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  return (el.closest("[data-asset-id]") as HTMLElement | null)?.dataset.assetId ?? null;
};

export function useDragSelect({
  enabled,
  orderedIds,
  selectedIds,
  setSelectedIds,
}: Readonly<{
  enabled: boolean;
  orderedIds: string[];
  selectedIds: Set<string>;
  setSelectedIds: (next: Set<string>) => void;
}>) {
  const gestureRef = useRef<Gesture | null>(null);
  const indexMapRef = useRef<Map<string, number>>(new Map());
  const orderedIdsRef = useRef(orderedIds);
  const selectedIdsRef = useRef(selectedIds);
  const setSelectedIdsRef = useRef(setSelectedIds);
  const moveRafRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  /** True while a drag owns the gesture — lets the caller stand down its own touch handlers. */
  const isDragSelectingRef = useRef(false);
  /** Set when a drag actually changed the selection, so the caller can swallow the trailing click. */
  const didDragRef = useRef(false);

  selectedIdsRef.current = selectedIds;
  setSelectedIdsRef.current = setSelectedIds;

  useEffect(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < orderedIds.length; i++) map.set(orderedIds[i], i);
    indexMapRef.current = map;
    orderedIdsRef.current = orderedIds;
  }, [orderedIds]);

  const applyRange = useCallback((toIndex: number) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const anchorIndex = indexMapRef.current.get(gesture.anchorId);
    if (anchorIndex === undefined) return;

    const ids = orderedIdsRef.current;
    const lo = Math.min(anchorIndex, toIndex);
    const hi = Math.max(anchorIndex, toIndex);
    const next = new Set(gesture.snapshot);
    for (let i = lo; i <= hi; i++) {
      const id = ids[i];
      if (id === undefined) continue;
      if (gesture.remove) next.delete(id);
      else next.add(id);
    }
    setSelectedIdsRef.current(next);
  }, []);

  const applyAtPoint = useCallback(
    (x: number, y: number) => {
      const id = idAtPoint(x, y);
      if (!id) return;
      const index = indexMapRef.current.get(id);
      if (index !== undefined) applyRange(index);
    },
    [applyRange]
  );

  // Scrolling near a viewport edge keeps the drag alive past the fold, and
  // re-runs the hit test because new tiles slide under a stationary pointer.
  const autoScrollTick = useCallback(() => {
    const gesture = gestureRef.current;
    if (!gesture?.dragging) {
      scrollRafRef.current = null;
      return;
    }
    const height = window.innerHeight;
    let delta = 0;
    if (gesture.lastY < EDGE_ZONE) {
      delta = -EDGE_MAX_SPEED * (1 - gesture.lastY / EDGE_ZONE);
    } else if (gesture.lastY > height - EDGE_ZONE) {
      delta = EDGE_MAX_SPEED * (1 - (height - gesture.lastY) / EDGE_ZONE);
    }
    if (delta !== 0) {
      window.scrollBy(0, delta);
      applyAtPoint(gesture.lastX, gesture.lastY);
    }
    scrollRafRef.current = requestAnimationFrame(autoScrollTick);
  }, [applyAtPoint]);

  const promote = useCallback(
    (gesture: Gesture) => {
      gesture.dragging = true;
      isDragSelectingRef.current = true;
      didDragRef.current = true;
      if (scrollRafRef.current === null) {
        scrollRafRef.current = requestAnimationFrame(autoScrollTick);
      }
    },
    [autoScrollTick]
  );

  const trackMove = useCallback(
    (x: number, y: number) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      gesture.lastX = x;
      gesture.lastY = y;
      if (moveRafRef.current !== null) return;
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = null;
        const current = gestureRef.current;
        if (!current?.dragging) return;
        applyAtPoint(current.lastX, current.lastY);
      });
    },
    [applyAtPoint]
  );

  const endGesture = useCallback(() => {
    gestureRef.current = null;
    isDragSelectingRef.current = false;
    if (moveRafRef.current !== null) {
      cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = null;
    }
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);

  const beginGesture = useCallback(
    (kind: GestureKind, anchorId: string, x: number, y: number, startSpread: number) => {
      const snapshot = new Set(selectedIdsRef.current);
      didDragRef.current = false;
      gestureRef.current = {
        kind,
        dragging: false,
        anchorId,
        snapshot,
        remove: snapshot.has(anchorId),
        startX: x,
        startY: y,
        startSpread,
        lastX: x,
        lastY: y,
      };
    },
    []
  );

  useEffect(() => {
    if (!enabled) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const id = idAtPoint(e.clientX, e.clientY);
      if (!id) return;
      beginGesture("mouse", id, e.clientX, e.clientY, 0);
    };

    const onPointerMove = (e: PointerEvent) => {
      const gesture = gestureRef.current;
      if (gesture?.kind !== "mouse") return;
      if (!gesture.dragging) {
        if (Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) < MOUSE_THRESHOLD) return;
        promote(gesture);
      }
      trackMove(e.clientX, e.clientY);
    };

    const onTouchStart = (e: TouchEvent) => {
      // A finger landing mid-drag shouldn't reset the anchor.
      if (gestureRef.current?.dragging) return;
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const id = idAtPoint(touch.clientX, touch.clientY);
        if (!id) return;
        beginGesture("touch1", id, touch.clientX, touch.clientY, 0);
      } else if (e.touches.length === 2) {
        const centroid = centroidOf(e.touches);
        const id =
          idAtPoint(centroid.x, centroid.y) ??
          idAtPoint(e.touches[0].clientX, e.touches[0].clientY) ??
          idAtPoint(e.touches[1].clientX, e.touches[1].clientY);
        if (!id) return;
        beginGesture("touch2", id, centroid.x, centroid.y, spreadOf(e.touches));
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;

      if (gesture.kind === "touch1") {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        if (!gesture.dragging) {
          const dx = touch.clientX - gesture.startX;
          const dy = touch.clientY - gesture.startY;
          if (Math.hypot(dx, dy) < TOUCH_THRESHOLD) return;
          // Vertical intent belongs to the browser's `pan-y` scroll.
          if (Math.abs(dx) <= Math.abs(dy)) {
            gestureRef.current = null;
            return;
          }
          promote(gesture);
        }
        e.preventDefault();
        trackMove(touch.clientX, touch.clientY);
        return;
      }

      if (gesture.kind === "touch2") {
        if (e.touches.length !== 2) return;
        const centroid = centroidOf(e.touches);
        const ratio = spreadOf(e.touches) / gesture.startSpread;
        if (!gesture.dragging && Math.abs(ratio - 1) > PINCH_RATIO) {
          // Separation changed too much to be a pan — it's a pinch. Let go.
          gestureRef.current = null;
          return;
        }
        if (!gesture.dragging) {
          if (Math.hypot(centroid.x - gesture.startX, centroid.y - gesture.startY) < TOUCH_THRESHOLD) return;
          promote(gesture);
        }
        e.preventDefault();
        trackMove(centroid.x, centroid.y);
      }
    };

    const onTouchEnd = () => endGesture();

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endGesture);
    window.addEventListener("pointercancel", endGesture);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endGesture);
      window.removeEventListener("pointercancel", endGesture);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      endGesture();
      didDragRef.current = false;
    };
  }, [enabled, beginGesture, endGesture, promote, trackMove]);

  /** Reads and clears the "a drag just happened" flag, for suppressing the click that follows. */
  const consumeDragClick = useCallback(() => {
    if (!didDragRef.current) return false;
    didDragRef.current = false;
    return true;
  }, []);

  return { isDragSelectingRef, consumeDragClick };
}
