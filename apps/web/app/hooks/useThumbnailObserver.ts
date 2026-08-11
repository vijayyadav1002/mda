import { useCallback, useEffect, useRef } from "react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";

const GENERATE_THUMBNAILS_FOR_ASSETS_MUTATION = `
  mutation GenerateThumbnailsForAssets($ids: [ID!]!, $sessionId: String, $force: Boolean) {
    generateThumbnailsForAssets(ids: $ids, sessionId: $sessionId, force: $force)
  }
`;

const CANCEL_THUMBNAIL_JOBS_MUTATION = `
  mutation CancelThumbnailJobsForSession($sessionId: String!) {
    cancelThumbnailJobsForSession(sessionId: $sessionId)
  }
`;

// Pre-fetch thumbnails slightly before the card scrolls into view for a
// smoother experience on fast scrolls.
const LAZY_THUMBNAIL_ROOT_MARGIN = "300px";
// Debounce batching window: group viewport hits inside this window into a
// single GraphQL mutation so a single scroll doesn't fire N requests.
const LAZY_THUMBNAIL_FLUSH_MS = 250;

const generateThumbnailSessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${Date.now()}-${hex}`;
};

interface UseThumbnailObserverParams {
  /** Currently open folder; a new value starts a fresh thumbnail session and cancels the previous one. */
  currentPath: string | null;
}

/**
 * Owns viewport-based lazy thumbnail loading: a single shared IntersectionObserver
 * that watches each card's thumbnail placeholder, batches the asset ids that scroll
 * into view, and flushes them to the backend in one GraphQL mutation per debounce
 * window. Also owns the per-folder-visit "session id" sent with every queued-thumbnail
 * mutation so the backend can cancel a whole batch when the user navigates away or the
 * dashboard unmounts.
 *
 * Takes `currentPath` as a parameter (rather than importing `useDirectoryTree` itself)
 * since it only needs to react to folder changes, matching the dependency-injection
 * pattern used by the other extracted dashboard hooks.
 */
export function useThumbnailObserver({ currentPath }: UseThumbnailObserverParams) {
  // Viewport-based dynamic thumbnail loading state. Thumbnails are only
  // queued for media whose card is (near) visible on screen.
  const thumbnailObserverRef = useRef<IntersectionObserver | null>(null);
  const observedThumbnailNodesRef = useRef<Map<Element, string>>(new Map());
  const pendingThumbnailIdsRef = useRef<Set<string>>(new Set());
  const requestedThumbnailIdsRef = useRef<Set<string>>(new Set());
  const flushThumbnailTimerRef = useRef<number | null>(null);
  // Per-folder-visit token. Sent with every queued-thumbnail mutation so the
  // backend can cancel everything from a session when the user navigates away.
  const thumbnailSessionIdRef = useRef<string>(generateThumbnailSessionId());

  // Flush any pending viewport-collected asset IDs to the backend in a single
  // batched GraphQL mutation. Failures clear the "already requested" marker
  // so the next scroll can retry. The mutation carries the current folder's
  // session id so the backend can cancel the whole batch on navigation.
  const flushPendingThumbnailRequests = useCallback(async () => {
    flushThumbnailTimerRef.current = null;
    const ids = Array.from(pendingThumbnailIdsRef.current);
    pendingThumbnailIdsRef.current.clear();
    if (ids.length === 0) return;
    const token = getAuthToken();
    if (!token) return;
    const sessionId = thumbnailSessionIdRef.current;
    try {
      const client = createGraphQLClient(token);
      await client.request(GENERATE_THUMBNAILS_FOR_ASSETS_MUTATION, { ids, sessionId });
    } catch (err) {
      console.error("Failed to queue on-demand thumbnails:", err);
      for (const id of ids) requestedThumbnailIdsRef.current.delete(id);
    }
  }, []);

  // Fire-and-forget request to drop every thumbnail job queued under a session.
  // Used when the user moves to another folder or unmounts the dashboard.
  const cancelThumbnailSessionOnServer = useCallback((sessionId: string) => {
    if (!sessionId) return;
    const token = getAuthToken();
    if (!token) return;
    const client = createGraphQLClient(token);
    client
      .request(CANCEL_THUMBNAIL_JOBS_MUTATION, { sessionId })
      .catch((err) => {
        // Non-blocking — worst case the Pi finishes a few jobs we no longer need.
        console.warn("Failed to cancel thumbnail session on server:", err);
      });
  }, []);

  // Lazily create one shared IntersectionObserver the first time a card's ref
  // callback runs. This must exist before refs fire, so we can't defer it to
  // useEffect (refs run earlier in the commit phase than effects).
  const getThumbnailObserver = useCallback((): IntersectionObserver | null => {
    if (thumbnailObserverRef.current) return thumbnailObserverRef.current;
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return null;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const assetId = observedThumbnailNodesRef.current.get(entry.target);
        if (!assetId) continue;
        observer.unobserve(entry.target);
        observedThumbnailNodesRef.current.delete(entry.target);
        if (requestedThumbnailIdsRef.current.has(assetId)) continue;
        requestedThumbnailIdsRef.current.add(assetId);
        pendingThumbnailIdsRef.current.add(assetId);
      }
      if (pendingThumbnailIdsRef.current.size > 0 && flushThumbnailTimerRef.current == null) {
        flushThumbnailTimerRef.current = window.setTimeout(
          flushPendingThumbnailRequests,
          LAZY_THUMBNAIL_FLUSH_MS,
        );
      }
    }, { rootMargin: LAZY_THUMBNAIL_ROOT_MARGIN });
    thumbnailObserverRef.current = observer;
    return observer;
  }, [flushPendingThumbnailRequests]);

  // Tear down the observer when the Dashboard unmounts.
  useEffect(() => {
    return () => {
      const observer = thumbnailObserverRef.current;
      if (observer) {
        observer.disconnect();
        thumbnailObserverRef.current = null;
      }
      observedThumbnailNodesRef.current.clear();
      if (flushThumbnailTimerRef.current != null) {
        window.clearTimeout(flushThumbnailTimerRef.current);
        flushThumbnailTimerRef.current = null;
      }
      // Cancel any thumbnail jobs the user queued in their last folder so the
      // server stops working on them after the tab/dashboard goes away.
      cancelThumbnailSessionOnServer(thumbnailSessionIdRef.current);
    };
  }, [cancelThumbnailSessionOnServer]);

  // When the user navigates to a different folder, forget which thumbnails we
  // have already asked for so the new folder can request its own assets, and
  // tell the backend to drop any jobs queued during the previous visit.
  useEffect(() => {
    const previousSessionId = thumbnailSessionIdRef.current;
    thumbnailSessionIdRef.current = generateThumbnailSessionId();

    requestedThumbnailIdsRef.current.clear();
    pendingThumbnailIdsRef.current.clear();
    const observer = thumbnailObserverRef.current;
    if (observer) {
      for (const el of observedThumbnailNodesRef.current.keys()) {
        observer.unobserve(el);
      }
    }
    observedThumbnailNodesRef.current.clear();
    if (flushThumbnailTimerRef.current != null) {
      window.clearTimeout(flushThumbnailTimerRef.current);
      flushThumbnailTimerRef.current = null;
    }

    cancelThumbnailSessionOnServer(previousSessionId);
  }, [currentPath, cancelThumbnailSessionOnServer]);

  // Ref callback attached to the thumbnail <div> of each card that is
  // currently missing a thumbnail. Registering an element starts observing it;
  // when the element unmounts React invokes the callback with null, at which
  // point we unobserve the previous node for that asset id.
  const registerLazyThumbnailCard = useCallback(
    (assetId: string) => (element: HTMLDivElement | null) => {
      if (!element) return;
      const observer = getThumbnailObserver();
      if (!observer) return;
      if (requestedThumbnailIdsRef.current.has(assetId)) return;
      if (observedThumbnailNodesRef.current.has(element)) return;
      observedThumbnailNodesRef.current.set(element, assetId);
      observer.observe(element);
    },
    [getThumbnailObserver],
  );

  return {
    thumbnailSessionIdRef,
    registerLazyThumbnailCard,
  };
}
