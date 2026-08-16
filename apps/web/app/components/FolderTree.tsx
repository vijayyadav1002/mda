import { CheckSquare, ChevronDown, ChevronRight, Copy, FileImage, Folder, Pencil, Square, Trash2 } from "lucide-react";
import { formatBytes } from "~/lib/format";
import type { DirectoryNode, MediaAsset } from "~/lib/types";

interface FolderTreeNodeProps {
  node: DirectoryNode;
  directoryCache: Record<string, DirectoryNode>;
  expandedFolders: Set<string>;
  selectedAssetIds: Set<string>;
  selectionMode: boolean;
  canManage: boolean;
  onToggleFolder: (path: string) => void;
  onAssetClick: (asset: MediaAsset) => void;
  onDeleteAsset: (assetId: string, fileName: string) => void;
  onRenameFolder: (folder: { path: string; name: string }) => void;
  onDuplicateFolder: (folder: { path: string; name: string }) => void;
  onDeleteFolder: (path: string, name: string) => void;
}

export function FolderTreeNode(props: FolderTreeNodeProps) {
  const {
    node,
    directoryCache,
    expandedFolders,
    selectedAssetIds,
    selectionMode,
    canManage,
    onToggleFolder,
    onAssetClick,
    onDeleteAsset,
    onRenameFolder,
    onDuplicateFolder,
    onDeleteFolder,
  } = props;

  if (node.type === "file") {
    const isSelected = node.mediaAsset ? selectedAssetIds.has(node.mediaAsset.id) : false;
    return (
      <div className="relative group">
        <button
          type="button"
          className={`w-full pl-6 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-accent rounded-xl transition-all duration-150 outline-hidden focus:ring-2 focus:ring-brand-primary/30 text-left ${
            isSelected ? "bg-accent" : ""
          }`}
          onClick={() => node.mediaAsset && onAssetClick(node.mediaAsset)}
        >
          {selectionMode && (
            <div className="shrink-0">
              {isSelected ? (
                <CheckSquare className="w-4 h-4 text-brand-primary" />
              ) : (
                <Square className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          )}
          <FileImage className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm truncate text-foreground flex-1">{node.name}</span>
          {!selectionMode && node.mediaAsset && canManage && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteAsset(node.mediaAsset!.id, node.mediaAsset!.fileName);
              }}
              className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-destructive/10 rounded-lg transition-all duration-150 mr-2"
            >
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </button>
          )}
        </button>
      </div>
    );
  }

  const cachedNode = directoryCache[node.path] || node;
  const children = cachedNode.children ?? null;
  const isExpanded = expandedFolders.has(node.path);

  return (
    <div className="pl-4">
      <div className="group relative flex items-center">
        <button
          type="button"
          className="flex-1 py-2.5 flex items-center gap-3 font-medium text-foreground hover:bg-accent rounded-xl transition-all duration-150 outline-hidden focus:ring-2 focus:ring-brand-primary/30 text-left px-2"
          onClick={() => onToggleFolder(node.path)}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <div className="w-8 h-8 gradient-brand rounded-lg flex items-center justify-center shrink-0">
            <Folder className="w-4 h-4 text-[#060e20]" />
          </div>
          <span className="text-sm">{node.name}</span>
          <span className="flex items-center gap-1.5 ml-auto mr-2 shrink-0">
            {node.size != null && node.size > 0 && (
              <span className="text-xs text-muted-foreground font-mono">{formatBytes(node.size)}</span>
            )}
            {Array.isArray(children) && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {children.length}
              </span>
            )}
          </span>
        </button>
        {canManage && (
          <>
            <button
              type="button"
              onClick={() => onRenameFolder({ path: node.path, name: node.name })}
              className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-accent rounded-lg transition-all duration-150 shrink-0"
              title="Rename folder"
            >
              <Pencil className="w-3.5 h-3.5 text-foreground" />
            </button>
            <button
              type="button"
              onClick={() => onDuplicateFolder({ path: node.path, name: node.name })}
              className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-accent rounded-lg transition-all duration-150 shrink-0"
              title="Duplicate folder"
            >
              <Copy className="w-3.5 h-3.5 text-foreground" />
            </button>
            <button
              type="button"
              onClick={() => onDeleteFolder(node.path, node.name)}
              className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-destructive/10 rounded-lg transition-all duration-150 mr-1 shrink-0"
              title="Delete folder"
            >
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </button>
          </>
        )}
      </div>
      {isExpanded && children === null && (
        <div className="pl-10 py-2 text-xs text-muted-foreground">Loading…</div>
      )}
      {isExpanded && Array.isArray(children) && children.length > 0 && (
        <div className="ml-4 mt-1">
          {children.map((child) => (
            <FolderTreeNode key={child.path} {...props} node={child} />
          ))}
        </div>
      )}
      {isExpanded && Array.isArray(children) && children.length === 0 && (
        <div className="pl-10 py-2 text-xs text-muted-foreground">Empty folder</div>
      )}
    </div>
  );
}
