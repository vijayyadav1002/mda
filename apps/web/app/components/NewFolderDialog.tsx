import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

interface CurrentFolder {
  readonly name: string;
}

interface NewFolderDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly newFolderName: string;
  readonly setNewFolderName: (value: string) => void;
  readonly isCreatingFolder: boolean;
  readonly currentFolder: CurrentFolder | null;
  readonly onSubmit: (e: React.FormEvent) => void;
}

export function NewFolderDialog({
  isOpen,
  onOpenChange,
  newFolderName,
  setNewFolderName,
  isCreatingFolder,
  currentFolder,
  onSubmit,
}: NewFolderDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { onOpenChange(open); if (!open) setNewFolderName(''); }}>
      <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-manrope text-foreground">New Folder</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <label className="label-meta">Folder Name</label>
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. Vacation 2024"
              required
              autoFocus
              className="bg-muted border-border/20 text-foreground placeholder:text-muted-foreground"
            />
            {currentFolder && (
              <p className="text-xs text-muted-foreground">
                Will be created inside: <span className="text-foreground font-medium">{currentFolder.name}</span>
              </p>
            )}
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={() => { onOpenChange(false); setNewFolderName(''); }}
              className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreatingFolder || !newFolderName.trim()}
              className="px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isCreatingFolder ? 'Creating…' : 'Create Folder'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
