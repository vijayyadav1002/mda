import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Folder } from "lucide-react";

interface AvailableFolder {
  readonly name: string;
  readonly path: string;
}

interface MoveAsset {
  readonly fileName: string;
  readonly filePath: string;
}

interface MoveDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly moveTargetFolderPath: string;
  readonly setMoveTargetFolderPath: (value: string) => void;
  readonly allAvailableFolders: AvailableFolder[];
  readonly rootPath: string | null;
  readonly selectionMode: boolean;
  readonly selectedAsset: MoveAsset | null;
  readonly selectedAssetCount: number;
  readonly selectedFolderPaths: Set<string>;
  readonly isMoving: boolean;
  readonly handleMoveAsset: () => void | Promise<void>;
  readonly handleBulkMove: () => void | Promise<void>;
}

export function MoveDialog({
  isOpen,
  onOpenChange,
  moveTargetFolderPath,
  setMoveTargetFolderPath,
  allAvailableFolders,
  rootPath,
  selectionMode,
  selectedAsset,
  selectedAssetCount,
  selectedFolderPaths,
  isMoving,
  handleMoveAsset,
  handleBulkMove,
}: MoveDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { onOpenChange(false); setMoveTargetFolderPath(''); } }}>
      <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-manrope font-bold text-foreground">
            {selectionMode ? 'Move Items' : 'Move File'}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">
          {selectionMode
            ? <>Move <strong className="text-foreground font-medium">{selectedAssetCount + selectedFolderPaths.size} selected items</strong> to a new location</>
            : <>Select destination for <strong className="text-foreground font-medium">{selectedAsset?.fileName}</strong></>
          }
        </p>
        <div className="max-h-60 overflow-y-auto space-y-1 border border-border/20 rounded-xl p-2 mt-1">
          {allAvailableFolders.map((folder) => {
            const relPath = rootPath && folder.path !== rootPath
              ? folder.path.replace(rootPath, '') || '/'
              : '/';
            const isPickerSelected = moveTargetFolderPath === folder.path;
            const isCurrent = !selectionMode && selectedAsset
              ? selectedAsset.filePath.substring(0, selectedAsset.filePath.lastIndexOf('/')) === folder.path
              : false;
            const isInvalidDest = selectionMode && (
              selectedFolderPaths.has(folder.path) ||
              [...selectedFolderPaths].some(fp => folder.path.startsWith(fp + '/'))
            );
            const isDisabled = isCurrent || isInvalidDest;
            return (
              <button
                key={folder.path}
                type="button"
                disabled={isDisabled}
                onClick={() => setMoveTargetFolderPath(folder.path)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all text-left ${
                  isPickerSelected
                    ? 'bg-brand-primary/20 text-brand-primary'
                    : isDisabled
                      ? 'opacity-40 cursor-not-allowed text-foreground'
                      : 'hover:bg-accent text-foreground'
                }`}
              >
                <Folder className="w-4 h-4 shrink-0" />
                <span className="font-mono text-xs truncate">{relPath}</span>
                {isCurrent && <span className="ml-auto text-xs text-muted-foreground">current</span>}
                {isInvalidDest && <span className="ml-auto text-xs text-muted-foreground">selected</span>}
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
            onClick={() => { onOpenChange(false); setMoveTargetFolderPath(''); }}
            className="flex-1 py-2.5 rounded-xl border border-border/30 text-sm text-foreground hover:bg-accent transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!moveTargetFolderPath || isMoving}
            onClick={() => void (selectionMode ? handleBulkMove() : handleMoveAsset())}
            className="flex-1 py-2.5 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm disabled:opacity-50 transition-all"
          >
            {isMoving ? 'Moving…' : 'Move Here'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
