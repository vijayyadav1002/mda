import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { ChevronDown, ListTodo } from "lucide-react";

interface MediaAsset {
  id: string;
  fileName: string;
  fileSize: string;
}

interface CompressDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly selectedAssets: MediaAsset[];
  readonly onAddToQueue: (options: { resolution: string; quality: number }) => void;
}

const RESOLUTION_OPTIONS = [
  { value: "original",   label: "Original" },
  { value: "1920x1080", label: "1920 × 1080 (1080p)" },
  { value: "1280x720",  label: "1280 × 720 (720p)" },
  { value: "960x540",   label: "960 × 540 (540p)" },
  { value: "640x360",   label: "640 × 360 (360p)" },
];

function formatFileSize(bytes: string | number): string {
  const n = typeof bytes === "string" ? parseInt(bytes) : bytes;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function CompressDialog({ isOpen, onClose, selectedAssets, onAddToQueue }: CompressDialogProps) {
  const [resolution, setResolution] = useState("original");
  const [quality, setQuality] = useState(70);
  const [showResDropdown, setShowResDropdown] = useState(false);

  const totalSize = selectedAssets.reduce((sum, a) => sum + parseInt(a.fileSize), 0);

  const handleAdd = () => {
    onAddToQueue({ resolution, quality });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="w-[95vw] sm:w-auto max-w-md p-0 flex flex-col bg-card border-border/10 shadow-ambient rounded-2xl">
        <DialogHeader className="px-6 py-4 bg-muted/40">
          <DialogTitle className="font-manrope text-foreground">Compress Media</DialogTitle>
        </DialogHeader>

        <div className="p-5 space-y-5">
          {/* Summary */}
          <div className="bg-muted rounded-2xl p-4">
            <p className="text-sm font-medium text-foreground">
              {selectedAssets.length} file{selectedAssets.length !== 1 ? "s" : ""} selected
            </p>
            <p className="label-meta mt-1">Total: {formatFileSize(totalSize)}</p>
            <div className="mt-3 space-y-1 max-h-28 overflow-auto">
              {selectedAssets.map(a => (
                <div key={a.id} className="flex items-center justify-between text-xs">
                  <span className="text-foreground truncate flex-1 mr-3">{a.fileName}</span>
                  <span className="text-muted-foreground flex-shrink-0">{formatFileSize(a.fileSize)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div className="space-y-1.5">
            <label className="label-meta">Resolution</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowResDropdown(p => !p)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-sm text-foreground hover:border-brand-primary/60 transition-colors outline-none"
              >
                {RESOLUTION_OPTIONS.find(o => o.value === resolution)?.label}
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </button>
              {showResDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border/10 rounded-xl shadow-ambient z-50 py-1 overflow-hidden">
                  {RESOLUTION_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                        resolution === opt.value
                          ? "bg-accent text-brand-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                      onClick={() => { setResolution(opt.value); setShowResDropdown(false); }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quality */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="label-meta">Quality</label>
              <span className="label-meta text-brand-primary">{quality}%</span>
            </div>
            <input
              type="range" min={10} max={100} step={5} value={quality}
              onChange={e => setQuality(Number(e.target.value))}
              className="w-full accent-[hsl(var(--primary))]"
            />
            <div className="flex justify-between label-meta">
              <span>Smaller file</span>
              <span>Higher quality</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground bg-muted rounded-xl px-3 py-2.5">
            The job will run in the background. Check the Queue to review results and confirm replacement.
          </p>
        </div>

        <div className="px-5 py-4 bg-muted/40 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={selectedAssets.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <ListTodo className="w-4 h-4" />
            Add to Queue
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
