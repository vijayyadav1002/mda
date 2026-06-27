import { X, Check, Loader2, Clock, AlertCircle, Eye, ChevronDown, ChevronRight, Ban } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { useState } from "react";

interface MediaAsset {
  id: string;
  fileName: string;
  fileSize: string;
  mimeType: string;
}

interface CompressPreviewResult {
  assetId: string;
  originalSize: string;
  compressedSize: string;
  previewUrl: string;
}

export interface CompressJob {
  id: string;
  assets: MediaAsset[];
  options: { resolution: string; quality: number };
  status: "pending" | "compressing" | "preview_ready" | "confirming" | "done" | "error" | "cancelled";
  progress: Record<string, { percent: number; etaSeconds: number | null }>;
  currentFileId: string | null;
  previews: CompressPreviewResult[];
  fileStatuses: Record<string, "pending" | "confirming" | "confirmed" | "discarded" | "error">;
  addedAt: number;
  errorMessage?: string;
}

interface CompressQueuePanelProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly jobs: CompressJob[];
  readonly onConfirm: (jobId: string) => void;
  readonly onDismiss: (jobId: string) => void;
  readonly onCancel: (jobId: string) => void;
  readonly onClearCompleted: () => void;
  readonly onConfirmFile: (jobId: string, assetId: string) => void;
  readonly onDiscardFile: (jobId: string, assetId: string) => void;
  readonly apiUrl: string;
}

function fmt(bytes: string | number): string {
  const n = typeof bytes === "string" ? parseInt(bytes) : bytes;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function savings(orig: string, comp: string): string {
  const o = parseInt(orig);
  const c = parseInt(comp);
  if (o === 0) return "0%";
  return `${(((o - c) / o) * 100).toFixed(1)}%`;
}

function eta(s: number | null): string {
  if (s == null) return "calculating…";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const STATUS: Record<CompressJob["status"], { label: string; color: string; bg: string; spin?: boolean }> = {
  pending:       { label: "Pending",        color: "text-muted-foreground", bg: "bg-muted" },
  compressing:   { label: "Compressing",    color: "text-brand-primary",    bg: "bg-brand-primary/10", spin: true },
  preview_ready: { label: "Review Needed",  color: "text-amber-400",        bg: "bg-amber-400/10" },
  confirming:    { label: "Applying",       color: "text-brand-primary",    bg: "bg-brand-primary/10", spin: true },
  done:          { label: "Done",           color: "text-emerald-400",      bg: "bg-emerald-400/10" },
  error:         { label: "Error",          color: "text-destructive",      bg: "bg-destructive/10" },
  cancelled:     { label: "Cancelled",      color: "text-muted-foreground", bg: "bg-muted" },
};

function StatusIcon({ status }: { status: CompressJob["status"] }) {
  const cfg = STATUS[status];
  const cls = `w-4 h-4 ${cfg.color} ${cfg.spin ? "animate-spin" : ""}`;
  if (status === "done") return <Check className={cls} />;
  if (status === "error") return <AlertCircle className={cls} />;
  if (status === "cancelled") return <Ban className={cls} />;
  if (status === "preview_ready") return <Eye className={cls} />;
  if (status === "pending") return <Clock className={cls} />;
  return <Loader2 className={cls} />;
}

export function CompressQueuePanel({
  isOpen, onClose, jobs, onConfirm, onDismiss, onCancel, onClearCompleted,
  onConfirmFile, onDiscardFile, apiUrl,
}: CompressQueuePanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);

  const activeCount = jobs.filter(j => !["done", "error", "cancelled"].includes(j.status)).length;
  const hasCompleted = jobs.some(j => j.status === "done" || j.status === "error" || j.status === "cancelled");

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="w-[95vw] max-w-xl max-h-[85vh] overflow-hidden p-0 flex flex-col bg-card border-border/10 shadow-ambient rounded-2xl">
        <DialogHeader className="px-6 py-4 bg-muted/40 flex-shrink-0 border-b border-border/10">
          <DialogTitle className="font-manrope text-foreground flex items-center justify-between">
            <span>Compression Queue</span>
            {activeCount > 0 && (
              <span className="text-xs font-normal text-brand-primary bg-brand-primary/10 px-2.5 py-1 rounded-full">
                {activeCount} active
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto divide-y divide-border/10">
          {jobs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Check className="w-10 h-10 opacity-20" />
              <p className="text-sm">No jobs in queue.</p>
              <p className="text-xs opacity-70">Select files and use Compress to queue jobs.</p>
            </div>
          )}

          {jobs.map(job => {
            const cfg = STATUS[job.status];
            const isExpanded = expandedId === job.id;
            const currentAsset = job.currentFileId ? job.assets.find(a => a.id === job.currentFileId) : null;
            const currentProgress = job.currentFileId ? job.progress[job.currentFileId] : null;
            const totalOrig = job.previews.reduce((s, p) => s + parseInt(p.originalSize), 0);
            const totalComp = job.previews.reduce((s, p) => s + parseInt(p.compressedSize), 0);

            return (
              <div key={job.id}>
                {/* Row */}
                <button
                  type="button"
                  onClick={() => { setExpandedId(isExpanded ? null : job.id); setPreviewAssetId(null); }}
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-accent/30 transition-colors text-left"
                >
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                    <StatusIcon status={job.status} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {job.assets.length === 1 ? job.assets[0].fileName : `${job.assets.length} files`}
                    </p>
                    <p className={`text-xs mt-0.5 ${cfg.color}`}>
                      {cfg.label}
                      {job.status === "compressing" && currentAsset && ` · ${currentAsset.fileName}`}
                      {(job.status === "done" || job.status === "preview_ready") && job.previews.length > 0 && (
                        <span className="text-emerald-400"> · {savings(totalOrig.toString(), totalComp.toString())} saved</span>
                      )}
                    </p>
                  </div>
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                </button>

                {/* Detail */}
                {isExpanded && (
                  <div className="px-5 pb-5 space-y-4 border-t border-border/5 bg-muted/10">

                    {/* PENDING */}
                    {job.status === "pending" && (
                      <div className="pt-3 flex items-center justify-between gap-3">
                        <p className="text-xs text-muted-foreground">
                          Waiting · {job.assets.length} file{job.assets.length !== 1 ? "s" : ""}
                          {" · "}Quality {job.options.quality}%
                          {job.options.resolution !== "original" ? ` · ${job.options.resolution}` : ""}
                        </p>
                        <button
                          type="button"
                          onClick={() => onCancel(job.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-destructive hover:bg-destructive/10 transition-all flex-shrink-0"
                          title="Cancel job"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                      </div>
                    )}

                    {/* COMPRESSING */}
                    {job.status === "compressing" && (
                      <div className="pt-3 space-y-3">
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => onCancel(job.id)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-destructive hover:bg-destructive/10 transition-all"
                            title="Cancel job"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Cancel
                          </button>
                        </div>
                        {job.assets.map(asset => {
                          const p = job.progress[asset.id];
                          const isCurrent = asset.id === job.currentFileId;
                          return (
                            <div key={asset.id} className={!isCurrent && !p ? "opacity-40" : ""}>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-foreground truncate flex-1 mr-2">{asset.fileName}</span>
                                <span className="text-muted-foreground flex-shrink-0">
                                  {p ? `${p.percent}%` : "waiting…"}
                                </span>
                              </div>
                              <div className="h-1 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full gradient-brand rounded-full transition-all duration-300"
                                  style={{ width: `${p?.percent ?? 0}%` }}
                                />
                              </div>
                              {isCurrent && p?.etaSeconds != null && (
                                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />{eta(p.etaSeconds)} remaining
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* PREVIEW READY */}
                    {(job.status === "preview_ready" || job.status === "confirming") && (
                      <div className="pt-3 space-y-3">
                        <div className="bg-emerald-400/10 rounded-xl px-4 py-3">
                          <p className="text-sm font-medium text-emerald-400">Preview ready — review before applying</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {fmt(totalOrig)} → {fmt(totalComp)}
                            {" · "}
                            <span className="text-emerald-400 font-semibold">
                              {savings(totalOrig.toString(), totalComp.toString())} saved
                            </span>
                          </p>
                        </div>

                        {/* Results table */}
                        <div className="bg-muted rounded-xl overflow-hidden">
                          <div className="grid grid-cols-[1fr_68px_68px_52px_28px_96px] gap-1 px-3 py-2">
                            {["File", "Before", "After", "Saved", "", ""].map((h, i) => (
                              <span key={i} className={`label-meta ${h && h !== "File" ? "text-right" : ""}`}>{h}</span>
                            ))}
                          </div>
                          <div className="max-h-44 overflow-auto divide-y divide-border/10">
                            {job.previews.map(p => {
                              const asset = job.assets.find(a => a.id === p.assetId);
                              const fileStatus = job.fileStatuses?.[p.assetId] ?? "pending";
                              const isPending = fileStatus === "pending";
                              const isConfirming = fileStatus === "confirming";
                              const isConfirmed = fileStatus === "confirmed";
                              const isDiscarded = fileStatus === "discarded";
                              return (
                                <div
                                  key={p.assetId}
                                  className={`grid grid-cols-[1fr_68px_68px_52px_28px_96px] gap-1 px-3 py-2 items-center text-xs transition-opacity ${
                                    isConfirmed ? "opacity-50" : isDiscarded ? "opacity-30" : ""
                                  }`}
                                >
                                  <span className={`truncate text-foreground ${isDiscarded ? "line-through text-muted-foreground" : ""}`}>
                                    {asset?.fileName ?? p.assetId}
                                  </span>
                                  <span className="text-right text-muted-foreground">{fmt(p.originalSize)}</span>
                                  <span className="text-right text-foreground">{fmt(p.compressedSize)}</span>
                                  <span className="text-right text-emerald-400 font-medium">{savings(p.originalSize, p.compressedSize)}</span>
                                  <button
                                    type="button"
                                    onClick={() => setPreviewAssetId(previewAssetId === p.assetId ? null : p.assetId)}
                                    disabled={isDiscarded}
                                    className="p-1 hover:bg-accent rounded-lg transition-colors flex justify-center disabled:opacity-30"
                                    title="Preview"
                                  >
                                    <Eye className="w-3 h-3 text-brand-primary" />
                                  </button>
                                  <div className="flex justify-end gap-1">
                                    {isConfirmed && (
                                      <span className="text-emerald-400 text-[10px] flex items-center gap-0.5">
                                        <Check className="w-3 h-3" /> Kept
                                      </span>
                                    )}
                                    {isDiscarded && (
                                      <span className="text-muted-foreground text-[10px]">Skipped</span>
                                    )}
                                    {(isPending || isConfirming) && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => onConfirmFile(job.id, p.assetId)}
                                          disabled={isConfirming || job.status === "confirming"}
                                          className="px-1.5 py-0.5 text-[10px] rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 disabled:opacity-40 transition-colors"
                                          title="Keep this file"
                                        >
                                          {isConfirming ? "…" : "Keep"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => onDiscardFile(job.id, p.assetId)}
                                          disabled={isConfirming || job.status === "confirming"}
                                          className="px-1.5 py-0.5 text-[10px] rounded-lg bg-muted hover:bg-accent text-muted-foreground disabled:opacity-40 transition-colors"
                                          title="Skip this file"
                                        >
                                          Skip
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Inline media preview */}
                        {previewAssetId && (() => {
                          const p = job.previews.find(pp => pp.assetId === previewAssetId);
                          const asset = job.assets.find(a => a.id === previewAssetId);
                          if (!p || !asset) return null;
                          return (
                            <div className="bg-[#060e20] rounded-xl overflow-hidden">
                              <div className="px-3 py-2 flex justify-between items-center">
                                <span className="label-meta text-white/60 truncate text-xs">{asset.fileName}</span>
                                <button type="button" onClick={() => setPreviewAssetId(null)} className="p-1 text-white/40 hover:text-white/80 transition-colors">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                              {asset.mimeType.startsWith("image/") && (
                                <img
                                  src={`${apiUrl}${p.previewUrl}`}
                                  alt="Compressed preview"
                                  className="max-w-full max-h-56 object-contain mx-auto block"
                                />
                              )}
                              {asset.mimeType.startsWith("video/") && (
                                <video controls className="max-w-full max-h-56 object-contain mx-auto block" preload="metadata">
                                  <source src={`${apiUrl}${p.previewUrl}`} type="video/mp4" />
                                  <track kind="captions" />
                                </video>
                              )}
                              {asset.mimeType === "application/pdf" && (
                                <iframe
                                  src={`${apiUrl}${p.previewUrl}`}
                                  title={`${asset.fileName} compressed preview`}
                                  className="w-full h-56 border-0 bg-white"
                                />
                              )}
                            </div>
                          );
                        })()}

                        {(() => {
                          const pendingCount = job.previews.filter(
                            p => (job.fileStatuses?.[p.assetId] ?? "pending") === "pending"
                          ).length;
                          const allPending = pendingCount === job.previews.length;
                          const hasPending = pendingCount > 0;
                          return (
                            <div className="flex gap-2 justify-end">
                              <button
                                type="button"
                                onClick={() => onDismiss(job.id)}
                                disabled={job.status === "confirming" || !hasPending}
                                className="px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all disabled:opacity-40"
                              >
                                {allPending ? "Discard All" : `Skip Remaining (${pendingCount})`}
                              </button>
                              <button
                                type="button"
                                onClick={() => onConfirm(job.id)}
                                disabled={job.status === "confirming" || !hasPending}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-manrope font-bold text-sm transition-colors disabled:opacity-50"
                              >
                                {job.status === "confirming"
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <Check className="w-3.5 h-3.5" />}
                                {allPending ? "Keep All" : `Keep Remaining (${pendingCount})`}
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* DONE */}
                    {job.status === "done" && job.previews.length > 0 && (
                      <div className="pt-3 flex items-center justify-between">
                        <p className="text-xs text-emerald-400">
                          Saved {savings(totalOrig.toString(), totalComp.toString())}
                          {" "}({fmt(totalOrig - totalComp)})
                        </p>
                        <button type="button" onClick={() => onDismiss(job.id)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                          Dismiss
                        </button>
                      </div>
                    )}

                    {/* ERROR */}
                    {job.status === "error" && (
                      <div className="pt-3 flex items-center justify-between gap-3">
                        <p className="text-xs text-destructive truncate">{job.errorMessage ?? "Unknown error"}</p>
                        <button type="button" onClick={() => onDismiss(job.id)} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                          Dismiss
                        </button>
                      </div>
                    )}

                    {/* CANCELLED */}
                    {job.status === "cancelled" && (
                      <div className="pt-3 flex items-center justify-between gap-3">
                        <p className="text-xs text-muted-foreground">Job cancelled.</p>
                        <button type="button" onClick={() => onDismiss(job.id)} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {hasCompleted && (
          <div className="px-5 py-3 bg-muted/40 flex justify-end border-t border-border/10">
            <button
              type="button"
              onClick={onClearCompleted}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear completed
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
