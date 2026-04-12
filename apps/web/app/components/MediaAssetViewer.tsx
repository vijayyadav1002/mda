import { Download, File, Maximize2, Minimize2, X, Share2 } from "lucide-react";
import { useState, useEffect } from "react";

interface MediaAsset {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: string;
  thumbnailUrl: string | null;
  transcodedUrl?: string;
  createdAt: string;
}

interface MediaAssetViewerProps {
  readonly asset: MediaAsset | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly apiUrl: string;
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
}: Readonly<MediaAssetViewerProps>) {
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  useEffect(() => {
    if (!isOpen && currentVideoId) {
      fetch(`${apiUrl}/video/${currentVideoId}/cleanup`, { method: "DELETE" }).catch(() => {});
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
          <video controls autoPlay className="max-w-full max-h-[calc(100vh-120px)] object-contain" preload="metadata">
            <source src={`${apiUrl}/video/${asset.id}`} type="video/mp4" />
            <track kind="captions" />
          </video>
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
            <video
              controls
              className="w-full h-full object-contain max-h-[40vh] md:max-h-[90vh]"
              preload="metadata"
            >
              <source src={`${apiUrl}/video/${asset.id}`} type="video/mp4" />
              <track kind="captions" />
            </video>
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
          <div className="px-6 pb-5 flex gap-2">
            <a
              href={isImage ? originalImageUrl : `${apiUrl}/video/${asset.id}`}
              download={asset.fileName}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity"
            >
              <Download className="w-4 h-4" />
              Download
            </a>
            <button
              type="button"
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border/30 text-sm text-foreground hover:bg-accent transition-all"
            >
              <Share2 className="w-4 h-4" />
              Share
            </button>
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
