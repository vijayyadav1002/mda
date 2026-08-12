import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { useState } from "react";
import { CompressQueueItem } from "~/components/CompressQueueItem";

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
  kind?: "compress" | "transcode";
  assets: MediaAsset[];
  options?: { resolution: string; quality: number };
  status: "pending" | "compressing" | "transcoding" | "preview_ready" | "confirming" | "done" | "error" | "cancelled";
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
        <DialogHeader className="px-6 py-4 bg-muted/40 shrink-0 border-b border-border/10">
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

          {jobs.map(job => (
            <CompressQueueItem
              key={job.id}
              job={job}
              isExpanded={expandedId === job.id}
              onToggleExpand={() => { setExpandedId(expandedId === job.id ? null : job.id); setPreviewAssetId(null); }}
              previewAssetId={previewAssetId}
              onSetPreviewAssetId={setPreviewAssetId}
              apiUrl={apiUrl}
              onConfirm={onConfirm}
              onDismiss={onDismiss}
              onCancel={onCancel}
              onConfirmFile={onConfirmFile}
              onDiscardFile={onDiscardFile}
            />
          ))}
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
