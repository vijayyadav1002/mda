import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

interface CurrentFolder {
  readonly name: string;
}

interface NewFileDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly newFileName: string;
  readonly setNewFileName: (value: string) => void;
  readonly newFileType: "md" | "txt";
  readonly setNewFileType: (value: "md" | "txt") => void;
  readonly isCreatingFile: boolean;
  readonly currentFolder: CurrentFolder | null;
  readonly onSubmit: (e: React.FormEvent) => void;
}

export function NewFileDialog({
  isOpen,
  onOpenChange,
  newFileName,
  setNewFileName,
  newFileType,
  setNewFileType,
  isCreatingFile,
  currentFolder,
  onSubmit,
}: NewFileDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { onOpenChange(open); if (!open) setNewFileName(''); }}>
      <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-manrope text-foreground">New File</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <label className="label-meta">File Name</label>
            <div className="flex items-center gap-2">
              <Input
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder="e.g. notes"
                required
                autoFocus
                className="bg-muted border-border/20 text-foreground placeholder:text-muted-foreground"
              />
              {!/\.(txt|md|markdown)$/i.test(newFileName.trim()) && (
                <div className="flex items-center gap-1 shrink-0">
                  {(["md", "txt"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setNewFileType(type)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                        newFileType === type
                          ? "bg-brand-primary text-[#060e20] font-semibold"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      .{type}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {currentFolder && (
              <p className="text-xs text-muted-foreground">
                Will be created inside: <span className="text-foreground font-medium">{currentFolder.name}</span>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Opens in the editor right away. Markdown files render as a formatted preview after saving.
            </p>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={() => { onOpenChange(false); setNewFileName(''); }}
              className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreatingFile || !newFileName.trim()}
              className="px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isCreatingFile ? 'Creating…' : 'Create File'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
