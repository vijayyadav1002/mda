import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

interface RenamingFolder {
  readonly path: string;
  readonly name: string;
}

interface RenameFolderDialogProps {
  readonly renamingFolder: RenamingFolder | null;
  readonly onClose: () => void;
  readonly renameFolderValue: string;
  readonly setRenameFolderValue: (value: string) => void;
  readonly isRenamingFolder: boolean;
  readonly onSubmit: (e: React.FormEvent) => void;
}

export function RenameFolderDialog({
  renamingFolder,
  onClose,
  renameFolderValue,
  setRenameFolderValue,
  isRenamingFolder,
  onSubmit,
}: RenameFolderDialogProps) {
  return (
    <Dialog open={!!renamingFolder} onOpenChange={(open) => { if (!open) { onClose(); setRenameFolderValue(''); } }}>
      <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-manrope font-bold text-foreground">Rename Folder</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 mt-1">
          <div className="space-y-1.5">
            <label className="label-meta">New name</label>
            <Input
              autoFocus
              value={renameFolderValue}
              onChange={(e) => setRenameFolderValue(e.target.value)}
              placeholder={renamingFolder?.name ?? ''}
              className="bg-muted border-border/20 text-foreground"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { onClose(); setRenameFolderValue(''); }}
              className="flex-1 py-2.5 rounded-xl border border-border/30 text-sm text-foreground hover:bg-accent transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!renameFolderValue.trim() || isRenamingFolder}
              className="flex-1 py-2.5 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm disabled:opacity-50 transition-all"
            >
              {isRenamingFolder ? 'Renaming…' : 'Rename'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
