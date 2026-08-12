import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Folder, Copy } from "lucide-react";

interface AvailableFolder {
  readonly name: string;
  readonly path: string;
}

interface DuplicateAsset {
  readonly fileName: string;
  readonly filePath: string;
}

interface DuplicateSourceFolder {
  readonly path: string;
  readonly name: string;
}

interface DuplicateDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly duplicateTargetFolderPath: string;
  readonly setDuplicateTargetFolderPath: (value: string) => void;
  readonly duplicateSourceFolder: DuplicateSourceFolder | null;
  readonly setDuplicateSourceFolder: (folder: DuplicateSourceFolder | null) => void;
  readonly allAvailableFolders: AvailableFolder[];
  readonly rootPath: string | null;
  readonly selectedAsset: DuplicateAsset | null;
  readonly isDuplicating: boolean;
  readonly handleDuplicateAsset: () => void | Promise<void>;
}

export function DuplicateDialog({
  isOpen,
  onOpenChange,
  duplicateTargetFolderPath,
  setDuplicateTargetFolderPath,
  duplicateSourceFolder,
  setDuplicateSourceFolder,
  allAvailableFolders,
  rootPath,
  selectedAsset,
  isDuplicating,
  handleDuplicateAsset,
}: DuplicateDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { onOpenChange(false); setDuplicateTargetFolderPath(''); setDuplicateSourceFolder(null); } }}>
      <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-manrope font-bold text-foreground">
            {duplicateSourceFolder ? 'Duplicate Folder' : 'Duplicate File'}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">
          Choose where to place a copy of{' '}
          <strong className="text-foreground font-medium">
            {duplicateSourceFolder?.name ?? selectedAsset?.fileName}
          </strong>
        </p>
        <div className="max-h-60 overflow-y-auto space-y-1 border border-border/20 rounded-xl p-2 mt-1">
          {allAvailableFolders.map((folder) => {
            const relPath = rootPath && folder.path !== rootPath
              ? folder.path.replace(rootPath, '') || '/'
              : '/';
            const isPickerSelected = duplicateTargetFolderPath === folder.path;
            const currentFolderPath = selectedAsset?.filePath.substring(0, selectedAsset.filePath.lastIndexOf('/'));
            const sourceFolderPath = duplicateSourceFolder?.path;
            const isCurrent = duplicateSourceFolder
              ? sourceFolderPath?.substring(0, sourceFolderPath.lastIndexOf('/')) === folder.path
              : currentFolderPath === folder.path;
            const isInvalidDest = !!sourceFolderPath && (
              folder.path === sourceFolderPath || folder.path.startsWith(`${sourceFolderPath}/`)
            );
            return (
              <button
                key={folder.path}
                type="button"
                disabled={isInvalidDest}
                onClick={() => setDuplicateTargetFolderPath(folder.path)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all text-left ${
                  isPickerSelected
                    ? 'bg-brand-primary/20 text-brand-primary'
                    : isInvalidDest
                      ? 'opacity-40 cursor-not-allowed text-foreground'
                      : 'hover:bg-accent text-foreground'
                }`}
              >
                <Folder className="w-4 h-4 shrink-0" />
                <span className="font-mono text-xs truncate">{relPath}</span>
                {isCurrent && <span className="ml-auto text-xs text-muted-foreground">current</span>}
                {isInvalidDest && <span className="ml-auto text-xs text-muted-foreground">inside source</span>}
              </button>
            );
          })}
          {allAvailableFolders.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No folders available</p>
          )}
        </div>
        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onClick={() => { onOpenChange(false); setDuplicateTargetFolderPath(''); setDuplicateSourceFolder(null); }}
            className="flex-1 py-2.5 rounded-xl border border-border/30 text-sm text-foreground hover:bg-accent transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!duplicateTargetFolderPath || isDuplicating}
            onClick={() => void handleDuplicateAsset()}
            className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm disabled:opacity-50 transition-all"
          >
            <Copy className="w-4 h-4" />
            {isDuplicating ? 'Duplicating…' : 'Duplicate Here'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
