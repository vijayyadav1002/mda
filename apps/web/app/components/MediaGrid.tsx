import { CheckSquare, Copy, Download, Folder, Pencil, Square, Tag as TagIcon, Trash2, X, Zap } from "lucide-react";
import { formatBytes, formatDate } from "~/lib/format";
import { getFileCategory, getFileCategoryLabel } from "~/lib/file-type";
import type { DirectoryNode, MediaAsset } from "~/lib/types";
import { FileTypeIcon } from "~/components/FileTypeIcon";

interface MediaGridProps {
  nodes: DirectoryNode[];
  apiUrl: string;
  selectionMode: boolean;
  canManage: boolean;
  selectedFolderPaths: Set<string>;
  selectedAssetIds: Set<string>;
  activeTagFilter: string | null;
  isLoading: boolean;
  showAssetPath: boolean;
  rootPath: string | null;
  registerLazyThumbnailCard: (assetId: string) => (element: HTMLDivElement | null) => void;
  onFolderClick: (node: DirectoryNode) => void;
  onRenameFolder: (node: { path: string; name: string }) => void;
  onDuplicateFolder: (node: { path: string; name: string }) => void;
  onDeleteFolder: (path: string, name: string) => void;
  onAssetClick: (asset: MediaAsset) => void;
  onDeleteAsset: (id: string, fileName: string) => void;
  onApplyTagFilter: (tagName: string) => void;
  onRemoveTag: (assetId: string, tagName: string) => void;
}

export function MediaGrid({
  nodes,
  apiUrl,
  selectionMode,
  canManage,
  selectedFolderPaths,
  selectedAssetIds,
  activeTagFilter,
  isLoading,
  showAssetPath,
  rootPath,
  registerLazyThumbnailCard,
  onFolderClick,
  onRenameFolder,
  onDuplicateFolder,
  onDeleteFolder,
  onAssetClick,
  onDeleteAsset,
  onApplyTagFilter,
  onRemoveTag,
}: Readonly<MediaGridProps>) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
      {nodes.map((node) => {
        if (node.type === "directory") {
          return (
            <div key={node.path} className="group relative">
              <button
                type="button"
                onClick={() => onFolderClick(node)}
                className={`w-full rounded-2xl bg-card hover:bg-accent transition-all duration-300 p-6 flex flex-col items-center justify-center gap-4 min-h-[180px] text-center ${
                  selectedFolderPaths.has(node.path) ? "ring-2 ring-brand-primary ring-offset-2 ring-offset-background" : ""
                }`}
              >
                {selectionMode && (
                  <div className="absolute top-3 left-3 z-10">
                    {selectedFolderPaths.has(node.path) ? (
                      <CheckSquare className="w-5 h-5 text-brand-primary drop-shadow-sm" />
                    ) : (
                      <Square className="w-5 h-5 text-white drop-shadow-sm" />
                    )}
                  </div>
                )}
                <div className="w-16 h-16 rounded-2xl gradient-brand flex items-center justify-center shadow-ambient group-hover:scale-110 transition-transform duration-300">
                  <Folder className="w-8 h-8 text-[#060e20]" />
                </div>
                <div>
                  <p className="font-manrope font-semibold text-sm text-foreground truncate max-w-[120px]">{node.name}</p>
                  <p className="label-meta mt-1">{node.size != null && node.size > 0 ? formatBytes(node.size) : "Folder"}</p>
                </div>
              </button>
              {!selectionMode && canManage && (
                <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRenameFolder({ path: node.path, name: node.name }); }}
                    className="w-8 h-8 bg-background/80 backdrop-blur-xs rounded-xl flex items-center justify-center hover:bg-accent transition-all duration-200"
                    title="Rename folder"
                  >
                    <Pencil className="w-3.5 h-3.5 text-foreground" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDuplicateFolder({ path: node.path, name: node.name }); }}
                    className="w-8 h-8 bg-background/80 backdrop-blur-xs rounded-xl flex items-center justify-center hover:bg-accent transition-all duration-200"
                    title="Duplicate folder"
                  >
                    <Copy className="w-3.5 h-3.5 text-foreground" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteFolder(node.path, node.name); }}
                    className="w-8 h-8 bg-background/80 backdrop-blur-xs rounded-xl flex items-center justify-center hover:bg-destructive/20 transition-all duration-200"
                    title="Delete folder"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </button>
                </div>
              )}
            </div>
          );
        } else if (node.mediaAsset) {
          const asset = node.mediaAsset;
          const isSelected = selectedAssetIds.has(asset.id);
          return (
            <div
              key={asset.id}
              onClick={() => onAssetClick(asset)}
              className={`group cursor-pointer rounded-2xl overflow-hidden bg-card transition-all duration-300 relative ${
                isSelected ? "ring-2 ring-brand-primary ring-offset-2 ring-offset-background" : "hover:bg-accent"
              }`}
            >
              {selectionMode && (
                <div className="absolute top-3 left-3 z-10">
                  {isSelected ? (
                    <CheckSquare className="w-5 h-5 text-brand-primary drop-shadow-sm" />
                  ) : (
                    <Square className="w-5 h-5 text-white drop-shadow-sm" />
                  )}
                </div>
              )}

              {!selectionMode && canManage && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDeleteAsset(asset.id, asset.fileName); }}
                  className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 w-8 h-8 bg-background/80 backdrop-blur-xs rounded-xl flex items-center justify-center hover:bg-destructive/20 transition-all duration-200"
                >
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </button>
              )}

              {/* Thumbnail — 4:5 portrait */}
              {/* overflow-hidden is on the inner div so the download button isn't clipped */}
              <div
                className="aspect-[4/5] bg-muted relative"
                ref={asset.thumbnailUrl ? undefined : registerLazyThumbnailCard(asset.id)}
              >
                <div className="absolute inset-0 overflow-hidden">
                  {asset.thumbnailUrl ? (
                    <img
                      src={`${apiUrl}${asset.thumbnailUrl}`}
                      alt={asset.fileName}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FileTypeIcon asset={asset} className="w-12 h-12 text-muted-foreground/30" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-background/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </div>

                <div className="absolute top-3 left-3 z-10 flex items-center gap-1">
                  <div className="bg-background/70 backdrop-blur-xs px-2 py-0.5 rounded-lg">
                    <span className="label-meta">{getFileCategoryLabel(getFileCategory(asset))}</span>
                  </div>
                  {asset.mimeType.startsWith("video/") && asset.transcodedUrl && (
                    <div
                      className="bg-emerald-500/20 backdrop-blur-xs px-1.5 py-0.5 rounded-lg flex items-center gap-0.5"
                      title="Transcoded — plays instantly"
                    >
                      <Zap className="w-2.5 h-2.5 text-emerald-400 fill-emerald-400" />
                      <span className="text-[10px] font-medium text-emerald-400">Transcoded</span>
                    </div>
                  )}
                </div>

                {!selectionMode && (
                  <a
                    href={`${apiUrl}/download/${asset.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-3 right-3 z-10 opacity-0 group-hover:opacity-100 w-8 h-8 bg-background/80 backdrop-blur-xs rounded-xl flex items-center justify-center hover:bg-accent transition-all duration-200"
                    title={`Download ${asset.fileName}`}
                  >
                    <Download className="w-3.5 h-3.5 text-foreground" />
                  </a>
                )}
              </div>

              <div className="p-3">
                <p className="font-medium text-sm text-foreground truncate">{asset.fileName}</p>
                <p className="label-meta mt-1">
                  {formatBytes(asset.fileSize)} · {formatDate(asset.capturedAt ?? asset.createdAt)}
                </p>
                {showAssetPath && (
                  <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">
                    {(asset.filePath.substring(0, asset.filePath.lastIndexOf("/")).replace(rootPath ?? "", "") || "/").replace(/^\//, "") || "/"}
                  </p>
                )}
                {asset.tags && asset.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {asset.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className={`inline-flex items-center rounded-full pl-1.5 text-[10px] font-medium transition-colors ${
                          activeTagFilter === tag.name
                            ? "bg-brand-primary text-[#060e20]"
                            : "bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onApplyTagFilter(tag.name); }}
                          className="py-0.5 pr-1"
                          title={`Filter by #${tag.name}`}
                        >
                          #{tag.name}
                        </button>
                        {!selectionMode && canManage && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onRemoveTag(asset.id, tag.name); }}
                            className="px-1 py-0.5 rounded-r-full hover:bg-brand-primary/30 transition-colors"
                            title={`Remove #${tag.name} from this file`}
                            aria-label={`Remove ${tag.name}`}
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        )}
                        {(selectionMode || !canManage) && <span className="pr-1.5" />}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        }
        return null;
      })}

      {isLoading && (
        <div className="col-span-full flex flex-col items-center justify-center py-24 text-muted-foreground">
          <div className="w-10 h-10 rounded-2xl gradient-brand flex items-center justify-center mx-auto mb-4 animate-pulse">
            <Folder className="w-5 h-5 text-[#060e20]" />
          </div>
          <p className="text-sm">{activeTagFilter ? "Loading tagged files…" : "Loading folder…"}</p>
        </div>
      )}
      {activeTagFilter && !isLoading && nodes.length === 0 && (
        <div className="col-span-full flex flex-col items-center justify-center py-24 text-muted-foreground">
          <TagIcon className="w-16 h-16 opacity-20 mb-4" />
          <p className="font-manrope font-semibold text-foreground">No files with #{activeTagFilter}</p>
          <p className="text-sm mt-1">Apply this tag to media files to see them here.</p>
        </div>
      )}
      {!activeTagFilter && !isLoading && nodes.length === 0 && (
        <div className="col-span-full flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Folder className="w-16 h-16 opacity-20 mb-4" />
          <p className="font-manrope font-semibold text-foreground">This folder is empty</p>
          <p className="text-sm mt-1">No items found in this directory</p>
        </div>
      )}
    </div>
  );
}
