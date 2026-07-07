import { ChevronLeft, ChevronRight, Download, File, Maximize2, Minimize2, X, ListTodo, Tag as TagIcon, Plus, Pencil, FolderOpen, Save, Copy } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import Hls from "hls.js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getAuthToken } from "~/lib/api";

type VideoSource =
  | { kind: "mp4"; url: string }
  | { kind: "hls"; playlistUrl: string; progressUrl: string; ready: boolean };

interface TranscodeProgress {
  percent: number;
  status: string;
  playlistReady?: boolean;
}

interface AssetTag {
  id: string;
  name: string;
}

interface MediaAsset {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: string;
  thumbnailUrl: string | null;
  transcodedUrl?: string;
  createdAt: string;
  updatedAt: string;
  tags?: AssetTag[];
}

interface MediaAssetViewerProps {
  readonly asset: MediaAsset | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly apiUrl: string;
  readonly userRole?: string;
  readonly onCompress?: () => void;
  readonly onRemoveTag?: (tagName: string) => void | Promise<void>;
  readonly onAddTags?: () => void;
  readonly onRename?: (newName: string) => Promise<void>;
  readonly onMove?: () => void;
  readonly onDuplicate?: () => void;
  readonly onAssetUpdated?: (updates: Partial<Pick<MediaAsset, "fileSize" | "updatedAt">>) => void;
  readonly onNavigate?: (direction: 1 | -1) => void;
  readonly hasPrev?: boolean;
  readonly hasNext?: boolean;
  /** Open text/markdown documents directly in edit mode (used for newly created files). */
  readonly autoEdit?: boolean;
}

type FileCategory = "image" | "video" | "pdf" | "word" | "excel" | "text" | "markdown" | "other";

type DocumentPreview =
  | { kind: "text" | "markdown"; text: string; truncated: boolean }
  | { kind: "word"; html: string; messages: string[] }
  | { kind: "excel"; sheets: { name: string; rows: string[][] }[]; maxRows: number; maxCols: number };

function formatFileSize(bytes: string) {
  const size = parseInt(bytes);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toUpperCase() ?? "FILE";
}

function getFileCategory(asset: MediaAsset): FileCategory {
  const ext = asset.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (asset.mimeType.startsWith("image/")) return "image";
  if (asset.mimeType.startsWith("video/")) return "video";
  if (asset.mimeType === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "docx") return "word";
  if (ext === "xlsx") return "excel";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (asset.mimeType.startsWith("text/") || ext === "txt") return "text";
  return "other";
}

function getFileCategoryLabel(category: FileCategory) {
  const labels: Record<FileCategory, string> = {
    image: "Image",
    video: "Video",
    pdf: "PDF",
    word: "Word",
    excel: "Excel",
    text: "Text",
    markdown: "Markdown",
    other: "File",
  };
  return labels[category];
}

export function MediaAssetViewer({
  asset,
  isOpen,
  onClose,
  apiUrl,
  userRole,
  onCompress,
  onRemoveTag,
  onAddTags,
  onRename,
  onMove,
  onDuplicate,
  onAssetUpdated,
  onNavigate,
  hasPrev = false,
  hasNext = false,
  autoEdit = false,
}: Readonly<MediaAssetViewerProps>) {
  const canEdit = userRole === "admin" || userRole === "editor";
  const canEditTags = canEdit;
  const [removingTag, setRemovingTag] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoSource, setVideoSource] = useState<VideoSource | null>(null);
  const [transcodeProgress, setTranscodeProgress] = useState<TranscodeProgress | null>(null);
  const [hlsReloadKey, setHlsReloadKey] = useState(0);
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null);
  const [documentPreviewStatus, setDocumentPreviewStatus] = useState<"idle" | "loading" | "error">("idle");
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [isEditingDocument, setIsEditingDocument] = useState(false);
  const [editorText, setEditorText] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");
  const autoEditConsumedRef = useRef<string | null>(null);
  const documentScrollRef = useRef<HTMLDivElement | null>(null);
  const videoSourceKindRef = useRef<VideoSource["kind"] | null>(null);
  const splitVideoRef = useRef<HTMLVideoElement | null>(null);
  const fullscreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setImageDimensions({ width: 0, height: 0 });
      setIsFullscreen(false);
      setIsRenaming(false);
      setRenameValue("");
      setDocumentPreview(null);
      setDocumentPreviewStatus("idle");
      setActiveSheetIndex(0);
      setIsEditingDocument(false);
      setEditorText("");
      setSaveStatus("idle");
    }
  }, [isOpen, asset?.id]);

  useEffect(() => {
    if (isOpen && asset?.mimeType.startsWith("video/")) {
      setCurrentVideoId(asset.id);
    }
  }, [isOpen, asset]);

  // Start at the top when switching between edit and preview so the editor's
  // top edge (and the beginning of the document) is never hidden under the
  // sticky toolbar.
  useEffect(() => {
    documentScrollRef.current?.scrollTo({ top: 0 });
  }, [isEditingDocument, documentPreview]);

  // Jump straight into the editor for a freshly created document (once per asset)
  useEffect(() => {
    if (!isOpen || !autoEdit || !asset) return;
    if (autoEditConsumedRef.current === asset.id) return;
    const isEditableKind =
      documentPreview && (documentPreview.kind === "text" || documentPreview.kind === "markdown");
    if (isEditableKind && (userRole === "admin" || userRole === "editor")) {
      autoEditConsumedRef.current = asset.id;
      setIsEditingDocument(true);
    }
  }, [isOpen, autoEdit, asset, documentPreview, userRole]);

  useEffect(() => {
    if (!isOpen || !asset) return;
    const category = getFileCategory(asset);
    if (!["word", "excel", "text", "markdown"].includes(category)) {
      setDocumentPreview(null);
      setDocumentPreviewStatus("idle");
      return;
    }

    const token = getAuthToken();
    const controller = new AbortController();
    setDocumentPreviewStatus("loading");
    setDocumentPreview(null);
    setActiveSheetIndex(0);
    setIsEditingDocument(false);
    setEditorText("");
    setSaveStatus("idle");

    fetch(`${apiUrl}/file-preview/${asset.id}/content`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Preview failed (${response.status})`);
        return response.json();
      })
      .then((preview: DocumentPreview) => {
        setDocumentPreview(preview);
        if (preview.kind === "text" || preview.kind === "markdown") {
          setEditorText(preview.text);
        }
        setDocumentPreviewStatus("idle");
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setDocumentPreviewStatus("error");
      });

    return () => controller.abort();
  }, [isOpen, asset?.id, apiUrl]);

  // Negotiate playback (mp4 fast path vs. HLS progressive) when a video opens
  useEffect(() => {
    if (!isOpen || !asset || !asset.mimeType.startsWith("video/")) {
      setVideoSource(null);
      setTranscodeProgress(null);
      setHlsReloadKey(0);
      return;
    }
    let cancelled = false;
    fetch(`${apiUrl}/video/${asset.id}/prepare`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.type === "mp4") {
          setVideoSource({ kind: "mp4", url: `${apiUrl}${data.url}` });
        } else if (data.type === "hls") {
          setVideoSource({
            kind: "hls",
            playlistUrl: `${apiUrl}${data.playlistUrl}`,
            progressUrl: `${apiUrl}${data.progressUrl}`,
            ready: Boolean(data.ready),
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, asset?.id, apiUrl]);

  // Wait for the HLS playlist to exist before attaching hls.js — avoids fatal 404 on first load
  const canLoadHls = Boolean(
    videoSource?.kind === "hls" && (videoSource.ready || transcodeProgress?.playlistReady)
  );

  // Attach source to the active <video> element
  useEffect(() => {
    const video = isFullscreen ? fullscreenVideoRef.current : splitVideoRef.current;
    if (!video || !videoSource) return;

    videoSourceKindRef.current = videoSource.kind;

    if (videoSource.kind === "mp4") {
      video.src = videoSource.url;
      return;
    }

    // HLS — don't attach until we know the playlist is on disk
    if (!canLoadHls) return;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = videoSource.playlistUrl;
      return;
    }
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(videoSource.playlistUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        }
      });
      hlsRef.current = hls;
      return () => {
        hls.destroy();
        if (hlsRef.current === hls) hlsRef.current = null;
      };
    }
  }, [videoSource, isFullscreen, canLoadHls, hlsReloadKey]);

  // Poll transcoding progress while the HLS job runs
  useEffect(() => {
    if (videoSource?.kind !== "hls" || videoSource.ready) {
      setTranscodeProgress(null);
      return;
    }
    let active = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      fetch(videoSource.progressUrl)
        .then((r) => r.json())
        .then((p: TranscodeProgress) => {
          if (!active) return;
          setTranscodeProgress(p);
          if (p.status === "ready") {
            // Force the hls.js instance to tear down and re-attach against the now-finalized
            // VOD playlist. Without this, a player that attached during transcoding stays stuck
            // in live mode and the play button does nothing.
            setHlsReloadKey((k) => k + 1);
          }
          if (p.status === "ready" || p.status === "error") {
            if (intervalId) clearInterval(intervalId);
            intervalId = null;
          }
        })
        .catch(() => {});
    };
    tick();
    intervalId = setInterval(tick, 2000);
    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [videoSource]);

  // Clean up hls.js on dialog close
  useEffect(() => {
    if (!isOpen) {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen && currentVideoId) {
      // Transcoded MP4s are kept on disk (evicted only by the size-based
      // cache limit), so closing the viewer no longer deletes them.
      videoSourceKindRef.current = null;
      setCurrentVideoId(null);
    }
  }, [isOpen, currentVideoId, apiUrl]);

  // Close on Escape; navigate with arrow keys
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isFullscreen) setIsFullscreen(false);
        else onClose();
        return;
      }
      // Don't hijack arrows while typing in a rename field or document editor
      if (isRenaming || isEditingDocument) return;
      if (e.key === "ArrowLeft" && onNavigate && hasPrev) {
        e.preventDefault();
        onNavigate(-1);
      } else if (e.key === "ArrowRight" && onNavigate && hasNext) {
        e.preventDefault();
        onNavigate(1);
      }
    };
    if (isOpen) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, isFullscreen, onClose, onNavigate, hasPrev, hasNext, isRenaming, isEditingDocument]);

  if (!asset || !isOpen) return null;

  const originalImageUrl = `${apiUrl}/image/${asset.id}`;
  const fileCategory = getFileCategory(asset);
  const isImage = fileCategory === "image";
  const isVideo = fileCategory === "video";
  const isPdf = fileCategory === "pdf";
  const isEditableDocument = fileCategory === "text" || fileCategory === "markdown";
  const canFullscreen = isImage || isVideo || isPdf;
  const token = getAuthToken();
  const pdfPreviewUrl = `${apiUrl}/file-preview/${asset.id}/pdf${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  const originalDocumentText =
    documentPreview?.kind === "text" || documentPreview?.kind === "markdown" ? documentPreview.text : "";
  const hasDocumentEdits = isEditableDocument && editorText !== originalDocumentText;

  const saveDocumentContent = async () => {
    if (!asset || !isEditableDocument || saveStatus === "saving") return;
    const authToken = getAuthToken();
    if (!authToken) {
      setSaveStatus("error");
      return;
    }

    setSaveStatus("saving");
    try {
      const response = await fetch(`${apiUrl}/file-preview/${asset.id}/content`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: editorText }),
      });
      if (!response.ok) throw new Error(`Save failed (${response.status})`);
      const updated = await response.json();
      setDocumentPreview({
        kind: fileCategory,
        text: updated.text,
        truncated: false,
      } as DocumentPreview);
      setEditorText(updated.text);
      setIsEditingDocument(false);
      setSaveStatus("idle");
      onAssetUpdated?.({ fileSize: updated.fileSize, updatedAt: updated.updatedAt });
    } catch {
      setSaveStatus("error");
    }
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  };

  // Prev/next chevrons + mobile tap zones, overlaid on the media area
  const navigationOverlay = onNavigate ? (
    <>
      {/* Mobile tap zones (images only, so video controls stay usable) */}
      {isImage && (
        <>
          {hasPrev && (
            <button
              type="button"
              aria-label="Previous"
              onClick={(e) => { e.stopPropagation(); onNavigate(-1); }}
              className="md:hidden absolute left-0 top-0 h-full w-1/4 z-10 focus:outline-none"
            />
          )}
          {hasNext && (
            <button
              type="button"
              aria-label="Next"
              onClick={(e) => { e.stopPropagation(); onNavigate(1); }}
              className="md:hidden absolute right-0 top-0 h-full w-1/4 z-10 focus:outline-none"
            />
          )}
        </>
      )}
      {hasPrev && (
        <button
          type="button"
          aria-label="Previous"
          onClick={(e) => { e.stopPropagation(); onNavigate(-1); }}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-black/40 hover:bg-black/70 text-white backdrop-blur-sm transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          aria-label="Next"
          onClick={(e) => { e.stopPropagation(); onNavigate(1); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-black/40 hover:bg-black/70 text-white backdrop-blur-sm transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}
    </>
  ) : null;

  // ── Fullscreen overlay ────────────────────────────────────────────
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex items-center justify-center group">
        {navigationOverlay}
        <div className="absolute top-4 right-4 z-30 flex gap-2">
          <button
            type="button"
            onClick={() => setIsFullscreen(false)}
            className="p-3 bg-black/50 hover:bg-black/70 text-white rounded-xl backdrop-blur-sm transition-all"
            title="Exit Fullscreen"
          >
            <Minimize2 className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-3 bg-black/50 hover:bg-black/70 text-white rounded-xl backdrop-blur-sm transition-all"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isImage && (
          <button type="button" onClick={() => setIsFullscreen(false)} className="focus:outline-none">
            <img
              src={originalImageUrl}
              alt={asset.fileName}
              className="max-w-full max-h-[calc(100vh-120px)] object-contain"
            />
          </button>
        )}
        {isVideo && (
          <div className="relative flex items-center justify-center">
            <video
              ref={fullscreenVideoRef}
              controls
              autoPlay
              className="max-w-full max-h-[calc(100vh-120px)] object-contain"
              preload="metadata"
            >
              <track kind="captions" />
            </video>
            {transcodeProgress && transcodeProgress.status !== "ready" && transcodeProgress.status !== "unknown" && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm text-white">
                <p className="font-manrope font-semibold mb-3">
                  {transcodeProgress.status === "queued" ? "Preparing video…" : "Transcoding for playback"}
                </p>
                <div className="w-64 h-2 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 transition-[width] duration-500"
                    style={{ width: `${Math.max(2, Math.round(transcodeProgress.percent))}%` }}
                  />
                </div>
                <p className="text-xs text-white/70 mt-2">
                  {Math.round(transcodeProgress.percent)}% — playback will start automatically when ready
                </p>
              </div>
            )}
          </div>
        )}
        {isPdf && (
          <iframe
            src={pdfPreviewUrl}
            title={asset.fileName}
            className="w-screen h-screen border-0 bg-white"
          />
        )}

        <div className="absolute bottom-4 left-4 right-4 max-w-3xl mx-auto bg-black/50 backdrop-blur-md text-white p-4 rounded-2xl">
          <p className="font-manrope font-semibold truncate">{asset.fileName}</p>
          <div className="flex gap-4 text-xs text-white/70 mt-1 flex-wrap">
            <span>{formatFileSize(asset.fileSize)}</span>
            <span>{asset.mimeType}</span>
            {imageDimensions.width > 0 && (
              <span>{imageDimensions.width} × {imageDimensions.height} px</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Split-panel dialog ────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-5xl max-h-[90vh] rounded-2xl overflow-hidden flex flex-col md:flex-row bg-card shadow-ambient border border-border/10">

        {/* Left — media preview */}
        <div className="relative flex-1 bg-[#060e20] flex items-center justify-center group min-h-[220px] md:min-h-[400px]">
          {navigationOverlay}
          {isImage && (
            <img
              src={originalImageUrl}
              alt={asset.fileName}
              className="w-full h-full object-contain max-h-[40vh] md:max-h-[90vh]"
              onLoad={handleImageLoad}
              onError={(e) => {
                if (asset.thumbnailUrl) e.currentTarget.src = `${apiUrl}${asset.thumbnailUrl}`;
              }}
            />
          )}
          {isVideo && (
            <div className="relative w-full h-full flex items-center justify-center">
              <video
                ref={splitVideoRef}
                controls
                className="w-full h-full object-contain max-h-[40vh] md:max-h-[90vh]"
                preload="metadata"
              >
                <track kind="captions" />
              </video>
              {transcodeProgress && transcodeProgress.status !== "ready" && transcodeProgress.status !== "unknown" && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm text-white">
                  <p className="font-manrope font-semibold mb-3">
                    {transcodeProgress.status === "queued" ? "Preparing video…" : "Transcoding for playback"}
                  </p>
                  <div className="w-64 h-2 bg-white/20 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-400 transition-[width] duration-500"
                      style={{ width: `${Math.max(2, Math.round(transcodeProgress.percent))}%` }}
                    />
                  </div>
                  <p className="text-xs text-white/70 mt-2">
                    {Math.round(transcodeProgress.percent)}% — playback will start automatically when ready
                  </p>
                </div>
              )}
            </div>
          )}
          {isPdf && (
            <iframe
              src={pdfPreviewUrl}
              title={asset.fileName}
              className="w-full h-full min-h-[400px] max-h-[40vh] md:max-h-[90vh] border-0 bg-white"
            />
          )}
          {(fileCategory === "text" || fileCategory === "markdown" || fileCategory === "word" || fileCategory === "excel") && (
            <div ref={documentScrollRef} className="w-full h-full max-h-[40vh] md:max-h-[90vh] overflow-auto bg-background text-foreground">
              {documentPreviewStatus === "loading" && (
                <div className="h-full min-h-[260px] flex items-center justify-center text-sm text-muted-foreground">
                  Loading preview…
                </div>
              )}
              {documentPreviewStatus === "error" && (
                <div className="h-full min-h-[260px] flex items-center justify-center text-sm text-muted-foreground">
                  Preview could not be loaded
                </div>
              )}
              {isEditableDocument && documentPreview && (documentPreview.kind === "text" || documentPreview.kind === "markdown") && (
                <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/20 bg-background/95 px-5 py-3 backdrop-blur">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">
                      {isEditingDocument ? "Editing" : "Previewing"} {getFileCategoryLabel(fileCategory).toLowerCase()}
                    </p>
                    {saveStatus === "error" && <p className="text-xs text-red-400 mt-0.5">Could not save changes</p>}
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap justify-end gap-2">
                      {isEditingDocument ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditorText(originalDocumentText);
                              setIsEditingDocument(false);
                              setSaveStatus("idle");
                            }}
                            className="px-3 py-1.5 rounded-lg border border-border/30 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={saveDocumentContent}
                            disabled={!hasDocumentEdits || saveStatus === "saving"}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-primary text-[#060e20] text-xs font-semibold disabled:opacity-50 transition-opacity"
                          >
                            <Save className="w-3.5 h-3.5" />
                            {saveStatus === "saving" ? "Saving…" : "Save"}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditorText(originalDocumentText);
                            setIsEditingDocument(true);
                            setSaveStatus("idle");
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/30 text-xs text-foreground hover:bg-accent transition-all"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="p-5">
              {documentPreview?.kind === "text" && isEditingDocument && (
                <textarea
                  value={editorText}
                  onChange={(e) => {
                    setEditorText(e.target.value);
                    if (saveStatus === "error") setSaveStatus("idle");
                  }}
                  className="min-h-[360px] w-full resize-y rounded-xl border border-border/30 bg-muted/20 p-4 font-mono text-sm leading-6 text-foreground outline-none focus:border-brand-primary/70 focus:ring-2 focus:ring-brand-primary/20"
                  spellCheck={false}
                />
              )}
              {documentPreview?.kind === "text" && !isEditingDocument && (
                <pre className="whitespace-pre-wrap break-words text-sm leading-6 font-mono">{documentPreview.text}</pre>
              )}
              {documentPreview?.kind === "markdown" && isEditingDocument && (
                <textarea
                  value={editorText}
                  onChange={(e) => {
                    setEditorText(e.target.value);
                    if (saveStatus === "error") setSaveStatus("idle");
                  }}
                  className="min-h-[360px] w-full resize-y rounded-xl border border-border/30 bg-muted/20 p-4 font-mono text-sm leading-6 text-foreground outline-none focus:border-brand-primary/70 focus:ring-2 focus:ring-brand-primary/20"
                  spellCheck={false}
                />
              )}
              {documentPreview?.kind === "markdown" && !isEditingDocument && (
                <div className="text-sm leading-6 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-bold [&_h3]:font-semibold [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_pre]:overflow-auto [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:p-3">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{documentPreview.text}</ReactMarkdown>
                </div>
              )}
              {documentPreview?.kind === "word" && (
                <div
                  className="text-sm leading-6 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-bold [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                  dangerouslySetInnerHTML={{ __html: documentPreview.html }}
                />
              )}
              {documentPreview?.kind === "excel" && (
                <div className="space-y-3">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {documentPreview.sheets.map((sheet, index) => (
                      <button
                        key={sheet.name}
                        type="button"
                        onClick={() => setActiveSheetIndex(index)}
                        className={`px-3 py-1.5 rounded-lg text-xs flex-shrink-0 ${
                          activeSheetIndex === index ? "bg-brand-primary text-[#060e20]" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {sheet.name}
                      </button>
                    ))}
                  </div>
                  <div className="overflow-auto rounded-xl border border-border/20">
                    <table className="min-w-full border-collapse text-xs">
                      <tbody>
                        {(documentPreview.sheets[activeSheetIndex]?.rows ?? []).map((row, rowIndex) => (
                          <tr key={rowIndex} className={rowIndex === 0 ? "bg-muted/70" : "odd:bg-muted/20"}>
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex} className="border border-border/10 px-2 py-1.5 max-w-[220px] truncate">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              </div>
            </div>
          )}
          {!isImage && !isVideo && !isPdf && !["word", "excel", "text", "markdown"].includes(fileCategory) && (
            <div className="flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <File className="w-20 h-20 opacity-20" />
              <p className="text-sm">Preview not available</p>
            </div>
          )}

          {/* Fullscreen button */}
          {canFullscreen && (
            <button
              type="button"
              onClick={() => setIsFullscreen(true)}
              className="absolute top-4 right-4 p-2.5 bg-black/40 hover:bg-black/60 text-white rounded-xl backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all"
              title="View Fullscreen"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}

          {/* Asset status */}
          <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="label-meta text-white/80">Active in Gallery</span>
          </div>
        </div>

        {/* Right — metadata panel */}
        <div className="w-full md:w-80 flex-shrink-0 flex flex-col bg-card overflow-y-auto max-h-[50vh] md:max-h-[90vh]">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 flex items-start justify-between">
            {isRenaming ? (
              <form
                className="flex-1 min-w-0"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!renameValue.trim() || renameLoading || !onRename) return;
                  setRenameLoading(true);
                  try {
                    await onRename(renameValue.trim());
                    setIsRenaming(false);
                    setRenameValue("");
                  } catch (err: any) {
                    alert(`Failed to rename: ${err.message || "Unknown error"}`);
                  } finally {
                    setRenameLoading(false);
                  }
                }}
              >
                <p className="label-meta">Rename File</p>
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="w-full font-manrope font-bold text-base text-foreground mt-1 bg-transparent border-b border-brand-primary/50 focus:outline-none focus:border-brand-primary pb-0.5"
                />
                <div className="flex gap-3 mt-2">
                  <button
                    type="submit"
                    disabled={renameLoading || !renameValue.trim()}
                    className="text-xs text-brand-primary hover:underline disabled:opacity-50"
                  >
                    {renameLoading ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsRenaming(false); setRenameValue(""); }}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex-1 min-w-0">
                <p className="label-meta">Master Asset</p>
                <h2 className="font-manrope font-bold text-lg text-foreground mt-1 leading-tight break-all">
                  {asset.fileName}
                </h2>
                <p className="text-xs text-muted-foreground mt-1 truncate">{asset.filePath}</p>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="ml-3 p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-all flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Action buttons */}
          <div className="px-6 pb-5 flex flex-col gap-2">
            <a
              href={`${apiUrl}/download/${asset.id}`}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity"
            >
              <Download className="w-4 h-4" />
              Download
            </a>
            {canEditTags && onAddTags && (
              <button
                type="button"
                onClick={onAddTags}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border/30 text-sm text-foreground hover:bg-accent transition-all"
              >
                <TagIcon className="w-4 h-4" />
                Add Tags
              </button>
            )}
            {(userRole === "admin" || userRole === "editor") && onCompress && (
              <button
                type="button"
                onClick={onCompress}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border/30 text-sm text-foreground hover:bg-accent transition-all"
              >
                <ListTodo className="w-4 h-4" />
                Add to Compress Queue
              </button>
            )}
            {canEdit && onRename && (
              <button
                type="button"
                onClick={() => { setRenameValue(asset.fileName); setIsRenaming(true); }}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border/30 text-sm text-foreground hover:bg-accent transition-all"
              >
                <Pencil className="w-4 h-4" />
                Rename File
              </button>
            )}
            {canEdit && onMove && (
              <button
                type="button"
                onClick={onMove}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border/30 text-sm text-foreground hover:bg-accent transition-all"
              >
                <FolderOpen className="w-4 h-4" />
                Move to Folder
              </button>
            )}
            {canEdit && onDuplicate && (
              <button
                type="button"
                onClick={onDuplicate}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border/30 text-sm text-foreground hover:bg-accent transition-all"
              >
                <Copy className="w-4 h-4" />
                Duplicate File
              </button>
            )}
          </div>

          {/* Divider */}
          <div className="h-px bg-border/10 mx-6" />

          {/* Technical inventory */}
          <div className="px-6 py-5">
            <p className="label-meta mb-4">Technical Inventory</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              {[
                {
                  label: "Dimensions",
                  value: imageDimensions.width > 0
                    ? `${imageDimensions.width} × ${imageDimensions.height} px`
                    : "—",
                  sub: imageDimensions.width > 0 ? "Full Resolution" : "",
                },
                {
                  label: "File Size",
                  value: formatFileSize(asset.fileSize),
                  sub: "Lossless Format",
                },
                {
                  label: "Format",
                  value: getExtension(asset.fileName),
                  sub: asset.mimeType,
                },
                {
                  label: "Created",
                  value: formatDate(asset.createdAt),
                  sub: new Date(asset.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
                },
                ...(isVideo
                  ? [{
                      label: "Playback",
                      value: asset.transcodedUrl ? "⚡ Transcoded" : "Original",
                      sub: asset.transcodedUrl ? "Cached web-ready MP4 — plays instantly" : "Transcodes on demand if needed",
                    }]
                  : []),
              ].map((item) => (
                <div key={item.label}>
                  <p className="label-meta">{item.label}</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{item.value}</p>
                  {item.sub && <p className="text-xs text-muted-foreground mt-0.5">{item.sub}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-border/10 mx-6" />

          {/* Taxonomy / Tags */}
          <div className="px-6 py-5">
            <p className="label-meta mb-3">Format Type</p>
            <div className="flex flex-wrap gap-2">
              {[
                getFileCategoryLabel(fileCategory),
                getExtension(asset.fileName),
                asset.mimeType.split("/")[1]?.toUpperCase(),
              ]
                .filter(Boolean)
                .map((tag) => (
                  <span
                    key={tag}
                    className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium"
                  >
                    {tag}
                  </span>
                ))}
            </div>

            <div className="flex items-center justify-between mt-5 mb-3">
              <p className="label-meta">Tags</p>
              {canEditTags && onAddTags && (
                <button
                  type="button"
                  onClick={onAddTags}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-brand-primary transition-colors"
                  title="Add tags"
                >
                  <Plus className="w-3 h-3" />
                  Add
                </button>
              )}
            </div>
            {asset.tags && asset.tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {asset.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-primary/10 text-brand-primary text-xs font-medium pl-3 pr-1 py-1"
                  >
                    <span>#{tag.name}</span>
                    {canEditTags && onRemoveTag && (
                      <button
                        type="button"
                        disabled={removingTag === tag.name}
                        onClick={async () => {
                          setRemovingTag(tag.name);
                          try {
                            await onRemoveTag(tag.name);
                          } finally {
                            setRemovingTag(null);
                          }
                        }}
                        className="p-1 rounded-full hover:bg-brand-primary/20 transition-colors disabled:opacity-50"
                        aria-label={`Remove ${tag.name}`}
                        title={`Remove #${tag.name}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              canEditTags && onAddTags ? (
                <button
                  type="button"
                  onClick={onAddTags}
                  className="text-xs text-muted-foreground hover:text-brand-primary transition-colors"
                >
                  No tags yet — click to add
                </button>
              ) : (
                <p className="text-xs text-muted-foreground">No tags</p>
              )
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* File path */}
          <div className="px-6 pb-6">
            <p className="label-meta mb-2">File Path</p>
            <p className="text-xs font-mono text-muted-foreground bg-muted px-3 py-2 rounded-xl break-all">
              {asset.filePath}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
