import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { createGraphQLClient, getApiUrl, getAuthToken } from "~/lib/api";
import { Loader2, Check, X, ChevronDown, Eye, Clock } from "lucide-react";

const API_URL = getApiUrl();

const CONFIRM_COMPRESS_MUTATION = `
  mutation ConfirmCompressReplace($ids: [ID!]!) {
    confirmCompressReplace(ids: $ids) {
      id
      fileName
      fileSize
    }
  }
`;

const CANCEL_COMPRESS_MUTATION = `
  mutation CancelCompressPreview($ids: [ID!]!) {
    cancelCompressPreview(ids: $ids)
  }
`;

interface MediaAsset {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

interface CompressPreviewResult {
  assetId: string;
  originalSize: string;
  compressedSize: string;
  previewUrl: string;
}

interface CompressProgress {
  percent: number;
  etaSeconds: number | null;
}

interface CompressDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly selectedAssets: MediaAsset[];
  readonly onComplete: () => void;
}

const RESOLUTION_OPTIONS = [
  { value: "original", label: "Original" },
  { value: "1920x1080", label: "1920 × 1080 (1080p)" },
  { value: "1280x720", label: "1280 × 720 (720p)" },
  { value: "960x540", label: "960 × 540 (540p)" },
  { value: "640x360", label: "640 × 360 (360p)" },
];

function formatFileSize(bytes: string | number): string {
  const size = typeof bytes === "string" ? Number.parseInt(bytes) : bytes;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function calcSavings(original: string, compressed: string): string {
  const o = Number.parseInt(original);
  const c = Number.parseInt(compressed);
  if (o === 0) return "0%";
  const pct = ((o - c) / o) * 100;
  return `${pct.toFixed(1)}%`;
}

function formatEta(seconds: number | null): string {
  if (seconds == null) return "calculating...";
  if (seconds < 60) return `${seconds}s remaining`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s remaining`;
}

type Phase = "configure" | "compressing" | "preview" | "replacing" | "done";

export function CompressDialog({
  isOpen,
  onClose,
  selectedAssets,
  onComplete,
}: Readonly<CompressDialogProps>) {
  const [phase, setPhase] = useState<Phase>("configure");
  const [resolution, setResolution] = useState("original");
  const [quality, setQuality] = useState(70);
  const [previews, setPreviews] = useState<CompressPreviewResult[]>([]);
  const [progress, setProgress] = useState<Record<string, CompressProgress>>({});
  const [currentCompressingId, setCurrentCompressingId] = useState<string | null>(null);
  const [overallEta, setOverallEta] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [showResDropdown, setShowResDropdown] = useState(false);

  const totalOriginalSize = selectedAssets.reduce(
    (sum, a) => sum + Number.parseInt(a.fileSize),
    0
  );

  const handleClose = async () => {
    // Clean up preview files if they exist
    if (previews.length > 0) {
      try {
        const token = getAuthToken();
        if (token) {
          const client = createGraphQLClient(token);
          await client.request(CANCEL_COMPRESS_MUTATION, {
            ids: selectedAssets.map((a) => a.id),
          });
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    setPreviews([]);
    setProgress({});
    setPhase("configure");
    setError(null);
    setPreviewAssetId(null);
    setCurrentCompressingId(null);
    setOverallEta(null);
    onClose();
  };

  const handlePreview = async () => {
    setError(null);
    setPhase("compressing");
    setProgress({});
    setCurrentCompressingId(null);
    setOverallEta(null);
    
    // Initialize progress for all
    const initProgress: Record<string, CompressProgress> = {};
    for (const a of selectedAssets) {
      initProgress[a.id] = { percent: 0, etaSeconds: null };
    }
    setProgress(initProgress);

    try {
      const token = getAuthToken();
      if (!token) throw new Error("Not authenticated");

      const response = await fetch(`${API_URL}/api/compress/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ids: selectedAssets.map(a => a.id),
          options: {
            resolution: resolution === "original" ? null : resolution,
            quality
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No readable stream");
      
      const decoder = new TextDecoder();
      let buffer = "";
      
      const newPreviews: CompressPreviewResult[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? "";
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'file_start') {
              setCurrentCompressingId(event.assetId);
            } else if (event.type === 'file_progress') {
              setProgress(prev => ({
                ...prev,
                [event.assetId]: { percent: event.percent, etaSeconds: event.etaSeconds }
              }));
            } else if (event.type === 'file_complete') {
              newPreviews.push({
                assetId: event.assetId,
                originalSize: event.originalSize,
                compressedSize: event.compressedSize,
                previewUrl: event.previewUrl
              });
              setProgress(prev => ({
                ...prev,
                [event.assetId]: { percent: 100, etaSeconds: 0 }
              }));
              if (event.overallEtaSeconds != null) {
                setOverallEta(event.overallEtaSeconds);
              }
            } else if (event.type === 'file_error') {
               console.error(`File compression error for ${event.assetId}:`, event.error);
            }
          } catch(e) {
            console.error("NDJSON parse error:", e);
          }
        }
      }
      
      setPreviews(newPreviews);
      setPhase("preview");
      
    } catch (err: any) {
      setError(err.message || "Compression failed");
      setPhase("configure");
    }
  };

  const handleConfirm = async () => {
    setError(null);
    setPhase("replacing");

    try {
      const token = getAuthToken();
      if (!token) throw new Error("Not authenticated");

      const client = createGraphQLClient(token);
      await client.request(CONFIRM_COMPRESS_MUTATION, {
        ids: selectedAssets.map((a) => a.id),
      });

      setPhase("done");
      setTimeout(() => {
        setPreviews([]);
        setPhase("configure");
        setPreviewAssetId(null);
        onComplete();
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Replacement failed");
      setPhase("preview");
    }
  };

  const totalCompressedSize = previews.reduce(
    (sum, p) => sum + Number.parseInt(p.compressedSize),
    0
  );
  const totalSavings =
    totalOriginalSize > 0
      ? (((totalOriginalSize - totalCompressedSize) / totalOriginalSize) * 100).toFixed(1)
      : "0";

  const getAssetForPreview = (p: CompressPreviewResult) =>
    selectedAssets.find((a) => a.id === p.assetId);

  const previewingItem = previewAssetId
    ? previews.find((p) => p.assetId === previewAssetId)
    : null;
  const previewingAsset = previewingItem
    ? getAssetForPreview(previewingItem)
    : null;

  const currentAsset = selectedAssets.find(a => a.id === currentCompressingId);
  const currentProgress = currentCompressingId ? progress[currentCompressingId] : null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] sm:w-auto max-w-2xl max-h-[90vh] overflow-hidden p-0 flex flex-col bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
        <DialogHeader className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <DialogTitle className="text-gray-900 dark:text-white flex items-center gap-2">
            {phase === "done" ? (
              <>
                <Check className="w-5 h-5 text-green-500" />
                Compression Complete
              </>
            ) : (
              "Compress Media"
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              {error}
            </div>
          )}

          {/* CONFIGURE PHASE */}
          {phase === "configure" && (
            <>
              {/* Summary */}
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {selectedAssets.length} file{selectedAssets.length !== 1 ? "s" : ""} selected
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Total size: {formatFileSize(totalOriginalSize)}
                    </p>
                  </div>
                </div>
                {/* File list */}
                <div className="mt-3 space-y-1.5 max-h-32 overflow-auto">
                  {selectedAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-gray-700 dark:text-gray-300 truncate flex-1 mr-3">
                        {asset.fileName}
                      </span>
                      <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                        {formatFileSize(asset.fileSize)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Resolution */}
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
                  Resolution
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowResDropdown((p) => !p)}
                    className="w-full flex items-center justify-between px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white hover:border-blue-400 transition-colors"
                  >
                    {RESOLUTION_OPTIONS.find((o) => o.value === resolution)?.label}
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  </button>
                  {showResDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1 overflow-hidden">
                      {RESOLUTION_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                            resolution === opt.value
                              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                              : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                          onClick={() => {
                            setResolution(opt.value);
                            setShowResDropdown(false);
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Quality */}
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
                  Quality: {quality}%
                </label>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  className="w-full accent-blue-600"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>Smaller file</span>
                  <span>Higher quality</span>
                </div>
              </div>
            </>
          )}

          {/* COMPRESSING PHASE */}
          {phase === "compressing" && (
            <div className="flex flex-col items-center justify-center py-8 gap-6">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
              
              <div className="text-center w-full max-w-sm">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2 truncate px-4">
                  Compressing {currentAsset ? currentAsset.fileName : "..."}
                </p>
                
                {/* Progress bar */}
                <div className="w-full bg-gray-200 dark:bg-gray-700 h-2 rounded-full overflow-hidden mb-2">
                  <div 
                    className="bg-blue-500 h-full transition-all duration-300 ease-out"
                    style={{ width: `${currentProgress?.percent ?? 0}%` }}
                  />
                </div>
                
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>{currentProgress?.percent ?? 0}%</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatEta(currentProgress?.etaSeconds ?? null)}
                  </span>
                </div>
              </div>

              <div className="text-xs text-gray-400 dark:text-gray-500 flex flex-col items-center gap-1 mt-2 border-t border-gray-100 dark:border-gray-800 pt-4 w-full">
                <span>Total overall ETA</span>
                <span className="font-medium text-gray-600 dark:text-gray-300">
                   {formatEta(overallEta)}
                </span>
              </div>
            </div>
          )}

          {/* PREVIEW PHASE */}
          {phase === "preview" && (
            <>
              {/* Summary bar */}
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-300">
                      Compression Preview Ready
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                      {formatFileSize(totalOriginalSize)} → {formatFileSize(totalCompressedSize)}
                      {" · "}
                      <span className="font-semibold">{totalSavings}% saved</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Results table */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_80px_60px_40px] gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-900/50 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <span>File</span>
                  <span className="text-right">Original</span>
                  <span className="text-right">Compressed</span>
                  <span className="text-right">Saved</span>
                  <span />
                </div>
                <div className="max-h-48 overflow-auto divide-y divide-gray-100 dark:divide-gray-700/50">
                  {previews.map((p) => {
                    const asset = getAssetForPreview(p);
                    return (
                      <div
                        key={p.assetId}
                        className="grid grid-cols-[1fr_80px_80px_60px_40px] gap-2 px-3 py-2.5 items-center text-xs"
                      >
                        <span className="truncate text-gray-800 dark:text-gray-200 font-medium">
                          {asset?.fileName ?? p.assetId}
                        </span>
                        <span className="text-right text-gray-500 dark:text-gray-400">
                          {formatFileSize(p.originalSize)}
                        </span>
                        <span className="text-right text-gray-800 dark:text-gray-200">
                          {formatFileSize(p.compressedSize)}
                        </span>
                        <span className="text-right text-green-600 dark:text-green-400 font-medium">
                          {calcSavings(p.originalSize, p.compressedSize)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewAssetId(
                              previewAssetId === p.assetId ? null : p.assetId
                            )
                          }
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                          title="Preview compressed file"
                        >
                          <Eye className="w-3.5 h-3.5 text-blue-500" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Media preview */}
              {previewingItem && previewingAsset && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden mt-4">
                  <div className="bg-gray-50 dark:bg-gray-900/50 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center justify-between">
                    <span>Preview: {previewingAsset.fileName}</span>
                    <button
                      type="button"
                      onClick={() => setPreviewAssetId(null)}
                      className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="bg-black flex items-center justify-center max-h-64 overflow-hidden">
                    {previewingAsset.mimeType.startsWith("image/") && (
                      <img
                        src={`${API_URL}${previewingItem.previewUrl}`}
                        alt={`Compressed preview of ${previewingAsset.fileName}`}
                        className="max-w-full max-h-64 object-contain"
                      />
                    )}
                    {previewingAsset.mimeType.startsWith("video/") && (
                      <video
                        controls
                        className="max-w-full max-h-64 object-contain"
                        preload="metadata"
                      >
                        <source
                          src={`${API_URL}${previewingItem.previewUrl}`}
                          type="video/mp4"
                        />
                        <track kind="captions" />
                        Your browser does not support the video tag.
                      </video>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* REPLACING PHASE */}
          {phase === "replacing" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Replacing files with compressed versions…
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Preserving original timestamps
              </p>
            </div>
          )}

          {/* DONE PHASE */}
          {phase === "done" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Check className="w-7 h-7 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                Files replaced successfully!
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Saved {totalSavings}% ({formatFileSize(totalOriginalSize - totalCompressedSize)})
              </p>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        {(phase === "configure" || phase === "preview") && (
          <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2 bg-gray-50 dark:bg-gray-900/50">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClose}
              className="border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Cancel
            </Button>

            {phase === "configure" && (
              <Button
                size="sm"
                onClick={handlePreview}
                className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white"
              >
                <Eye className="w-4 h-4 mr-1.5" />
                Preview Compression
              </Button>
            )}

            {phase === "preview" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPreviews([]);
                    setPreviewAssetId(null);
                    setPhase("configure");
                  }}
                  className="border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Adjust Settings
                </Button>
                <Button
                  size="sm"
                  onClick={handleConfirm}
                  className="bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-white"
                >
                  <Check className="w-4 h-4 mr-1.5" />
                  Confirm &amp; Replace
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
