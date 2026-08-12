import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Upload, FileImage, X } from "lucide-react";
import { formatBytes } from "~/lib/format";

interface DirectoryOption {
  readonly path: string;
  readonly displayName: string;
}

interface UploadDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly uploadFiles: File[];
  readonly setUploadFiles: React.Dispatch<React.SetStateAction<File[]>>;
  readonly uploadTargetPath: string;
  readonly setUploadTargetPath: (value: string) => void;
  readonly uploadProgress: Record<string, number>;
  readonly setUploadProgress: (value: Record<string, number>) => void;
  readonly isUploading: boolean;
  readonly fileInputRef: React.RefObject<HTMLInputElement | null>;
  readonly handleUpload: () => void;
  readonly allDirectories: DirectoryOption[];
}

export function UploadDialog({
  isOpen,
  onOpenChange,
  uploadFiles,
  setUploadFiles,
  uploadTargetPath,
  setUploadTargetPath,
  uploadProgress,
  setUploadProgress,
  isUploading,
  fileInputRef,
  handleUpload,
  allDirectories,
}: UploadDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!isUploading) { onOpenChange(open); if (!open) { setUploadFiles([]); setUploadProgress({}); } } }}>
      <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-manrope text-foreground">Upload Media</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {/* Folder selector */}
          <div className="space-y-1.5">
            <label className="label-meta">Upload to Folder</label>
            <select
              value={uploadTargetPath}
              onChange={(e) => setUploadTargetPath(e.target.value)}
              className="w-full bg-muted border border-border/20 rounded-xl px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-brand-primary/30"
            >
              {allDirectories.map((dir) => (
                <option key={dir.path} value={dir.path}>{dir.displayName}</option>
              ))}
            </select>
          </div>

          {/* Drop zone */}
          <div>
            <label className="label-meta mb-1.5 block">Files</label>
            <div
              role="button"
              tabIndex={0}
              className="border-2 border-dashed border-border/30 rounded-xl p-8 text-center cursor-pointer hover:border-brand-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); setUploadFiles(Array.from(e.dataTransfer.files)); }}
            >
              <Upload className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {uploadFiles.length > 0
                  ? `${uploadFiles.length} file(s) selected`
                  : 'Drag & drop or click to select files'}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">Any file type · Max 1 GB per file</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
              />
            </div>
          </div>

          {/* File list with progress */}
          {uploadFiles.length > 0 && (
            <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
              {uploadFiles.map((file) => (
                <div key={file.name} className="flex items-center gap-3 bg-muted rounded-xl px-3 py-2">
                  <FileImage className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">{file.name}</p>
                    {isUploading && (
                      <div className="mt-1.5 h-1 bg-muted-foreground/20 rounded-full overflow-hidden">
                        <div
                          className="h-full gradient-brand rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress[file.name] ?? 0}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
                  {!isUploading && (
                    <button
                      type="button"
                      onClick={() => setUploadFiles((prev) => prev.filter((f) => f.name !== file.name))}
                      className="p-1 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={() => { onOpenChange(false); setUploadFiles([]); setUploadProgress({}); }}
              disabled={isUploading}
              className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploadFiles.length === 0 || isUploading}
              className="px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isUploading ? 'Uploading…' : `Upload${uploadFiles.length > 0 ? ` (${uploadFiles.length})` : ''}`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
