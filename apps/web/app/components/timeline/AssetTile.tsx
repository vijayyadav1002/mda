import { memo } from "react";
import { CheckSquare, ImageIcon, Play, Square, Zap } from "lucide-react";
import { formatBytes, formatDuration } from "~/lib/format";
import type { TimelineAsset } from "~/hooks/useTimelineSections";

export const AssetTile = memo(function AssetTile({
  asset,
  apiUrl,
  onActivate,
  onThumbError,
  selectionMode = false,
  isSelected = false,
}: Readonly<{
  asset: TimelineAsset;
  apiUrl: string;
  onActivate: (asset: TimelineAsset) => void;
  onThumbError: (assetId: string) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
}>) {
  const isVideo = asset.mimeType.startsWith("video/");
  return (
    <button
      type="button"
      data-asset-id={asset.id}
      onClick={() => onActivate(asset)}
      className={`relative w-full aspect-square overflow-hidden bg-muted/40 rounded-[3px] focus:outline-hidden focus:ring-2 focus:ring-brand-primary group/tile ${
        isSelected ? "ring-2 ring-brand-primary" : ""
      }`}
      title={asset.fileName}
    >
      {selectionMode && (
        <span className="absolute top-1 left-1 z-10">
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-brand-primary drop-shadow-sm bg-black/40 rounded-sm" />
          ) : (
            <Square className="w-4 h-4 text-white/80 drop-shadow-sm" />
          )}
        </span>
      )}
      {isSelected && <span className="absolute inset-0 bg-brand-primary/20 z-[5] pointer-events-none" />}
      {asset.thumbnailUrl ? (
        <img
          src={`${apiUrl}${asset.thumbnailUrl}`}
          alt={asset.fileName}
          loading="lazy"
          draggable={false}
          className="w-full h-full object-cover transition-transform duration-300 group-hover/tile:scale-105"
          onError={() => onThumbError(asset.id)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ImageIcon className="w-5 h-5 text-muted-foreground/40" />
        </div>
      )}
      {isVideo && (
        <span
          className="absolute bottom-1 right-1 flex items-center gap-0.5 px-1 py-0.5 rounded-sm bg-black/60 text-white text-[10px] font-mono leading-none"
          title={asset.transcodedUrl ? "Transcoded — plays instantly" : undefined}
        >
          {asset.transcodedUrl && <Zap className="w-2.5 h-2.5 fill-emerald-400 text-emerald-400" />}
          <Play className="w-2.5 h-2.5 fill-current" />
          {asset.duration ? formatDuration(asset.duration) : ""}
        </span>
      )}
      <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded-sm bg-black/60 text-white text-[10px] font-mono leading-none">
        {formatBytes(asset.fileSize)}
      </span>
    </button>
  );
});
