import { Download, File, Maximize2, Minimize2, X, ListTodo } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import Hls from "hls.js";

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
}

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

export function MediaAssetViewer({
  asset,
  isOpen,
  onClose,
  apiUrl,
  userRole,
  onCompress,
  onRemoveTag,
}: Readonly<MediaAssetViewerProps>) {
  const canEditTags = userRole === "admin" || userRole === "editor";
  const [removingTag, setRemovingTag] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoSource, setVideoSource] = useState<VideoSource | null>(null);
  const [transcodeProgress, setTranscodeProgress] = useState<TranscodeProgress | null>(null);
  const [hlsReloadKey, setHlsReloadKey] = useState(0);
  const videoSourceKindRef = useRef<VideoSource["kind"] | null>(null);
  const splitVideoRef = useRef<HTMLVideoElement | null>(null);
  const fullscreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setImageDimensions({ width: 0, height: 0 });
      setIsFullscreen(false);
    }
  }, [isOpen, asset?.id]);

  useEffect(() => {
    if (isOpen && asset?.mimeType.startsWith("video/")) {
      setCurrentVideoId(asset.id);
    }
  }, [isOpen, asset]);

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
      // Only clean up transient MP4 transcode cache; keep HLS segments for fast re-open.
      if (videoSourceKindRef.current === "mp4") {
        fetch(`${apiUrl}/video/${currentVideoId}/cleanup`, { method: "DELETE" }).catch(() => {});
      }
      videoSourceKindRef.current = null;
      setCurrentVideoId(null);
    }
  }, [isOpen, currentVideoId, apiUrl]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isFullscreen) setIsFullscreen(false);
        else onClose();
      }
    };
    if (isOpen) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, isFullscreen, onClose]);

  if (!asset || !isOpen) return null;

  const originalImageUrl = `${apiUrl}/image/${asset.id}`;
  const isImage = asset.mimeType.startsWith("image/");
  const isVideo = asset.mimeType.startsWith("video/");

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  };

  // ── Fullscreen overlay ────────────────────────────────────────────
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
        <div className="absolute top-4 right-4 z-10 flex gap-2">
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
          {!isImage && !isVideo && (
            <div className="flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <File className="w-20 h-20 opacity-20" />
              <p className="text-sm">Preview not available</p>
            </div>
          )}

          {/* Fullscreen button */}
          <button
            type="button"
            onClick={() => setIsFullscreen(true)}
            className="absolute top-4 right-4 p-2.5 bg-black/40 hover:bg-black/60 text-white rounded-xl backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all"
            title="View Fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>

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
            <div className="flex-1 min-w-0">
              <p className="label-meta">Master Asset</p>
              <h2 className="font-manrope font-bold text-lg text-foreground mt-1 leading-tight break-all">
                {asset.fileName}
              </h2>
              <p className="text-xs text-muted-foreground mt-1 truncate">{asset.filePath}</p>
            </div>
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
                isImage ? "Image" : "Video",
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

            {(asset.tags && asset.tags.length > 0) && (
              <>
                <p className="label-meta mt-5 mb-3">Tags</p>
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
              </>
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
