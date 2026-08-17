import type { MediaAsset } from "~/lib/types";

interface ImagePreviewProps {
  readonly asset: MediaAsset;
  readonly imageUrl: string;
  readonly apiUrl: string;
  readonly isFullscreen: boolean;
  readonly onToggleFullscreen: () => void;
  readonly onImageLoad: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}

export function ImagePreview({
  asset,
  imageUrl,
  apiUrl,
  isFullscreen,
  onToggleFullscreen,
  onImageLoad,
}: Readonly<ImagePreviewProps>) {
  if (isFullscreen) {
    return (
      <button type="button" onClick={onToggleFullscreen} className="focus:outline-hidden">
        <img
          src={imageUrl}
          alt={asset.fileName}
          className="max-w-full max-h-[calc(100vh-120px)] object-contain"
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggleFullscreen}
      className="w-full h-full focus:outline-hidden cursor-zoom-in"
      title="View fullscreen"
    >
      <img
        src={imageUrl}
        alt={asset.fileName}
        className="w-full h-full object-contain max-h-[40vh] md:max-h-[90vh]"
        onLoad={onImageLoad}
        onError={(e) => {
          if (asset.thumbnailUrl) e.currentTarget.src = `${apiUrl}${asset.thumbnailUrl}`;
        }}
      />
    </button>
  );
}
