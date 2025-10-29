import { Download, File } from "lucide-react";
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

interface MediaAsset {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: string;
  thumbnailUrl: string;
  transcodedUrl?: string;
  createdAt: string;
}

interface MediaAssetViewerProps {
  readonly asset: MediaAsset | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly apiUrl: string;
}

export function MediaAssetViewer({
  asset,
  isOpen,
  onClose,
  apiUrl,
}: Readonly<MediaAssetViewerProps>) {
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  
  // Reset dimensions when dialog closes or asset changes
  useEffect(() => {
    if (!isOpen) {
      setImageDimensions({ width: 0, height: 0 });
    }
  }, [isOpen, asset?.id]);

  // Track when a video is opened
  useEffect(() => {
    if (isOpen && asset?.mimeType.startsWith('video/')) {
      setCurrentVideoId(asset.id);
    }
  }, [isOpen, asset]);

  // Cleanup transcoded video when dialog closes
  useEffect(() => {
    if (!isOpen && currentVideoId) {
      // Dialog was closed and we have a video ID to clean up
      console.log(`Cleaning up transcoded video for asset: ${currentVideoId}`);
      fetch(`${apiUrl}/video/${currentVideoId}/cleanup`, {
        method: 'DELETE',
      })
        .then((response) => {
          console.log('Cleanup response:', response.status);
          return response.json();
        })
        .then((data) => {
          console.log('Cleanup result:', data);
        })
        .catch((error) => {
          console.error('Error cleaning up transcoded video:', error);
        });
      
      // Clear the current video ID
      setCurrentVideoId(null);
    }
  }, [isOpen, currentVideoId, apiUrl]);

  if (!asset) return null;

  // Extract relative path from full path (everything after media-files/)
  const getRelativePath = (fullPath: string) => {
    const parts = fullPath.split('/media-files/');
    return parts.length > 1 ? parts[1] : fullPath;
  };

  const getOriginalImageUrl = () => {
    return `${apiUrl}/media/${getRelativePath(asset.filePath)}`;
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  };

  // Calculate dialog size based on image dimensions
  const getDialogSize = () => {
    if (!asset.mimeType.startsWith('image/') || imageDimensions.width === 0) {
      return 'max-w-4xl'; // Default size for videos and before image loads
    }

    const viewportWidth = globalThis.window === undefined ? 1920 : globalThis.window.innerWidth;
    const viewportHeight = globalThis.window === undefined ? 1080 : globalThis.window.innerHeight;
    
    // Calculate max width/height (90% of viewport)
    const maxWidth = viewportWidth * 0.9;
    const maxHeight = viewportHeight * 0.85; // Leave space for header and details

    // Add padding for dialog chrome (header, details, etc.)
    const chromeHeight = 300;
    const availableHeight = maxHeight - chromeHeight;

    const aspectRatio = imageDimensions.width / imageDimensions.height;
    
    let dialogWidth = Math.min(imageDimensions.width + 100, maxWidth);
    const requiredHeight = (dialogWidth - 100) / aspectRatio;

    if (requiredHeight > availableHeight) {
      dialogWidth = availableHeight * aspectRatio + 100;
    }

    // Return appropriate size class
    if (dialogWidth >= viewportWidth * 0.8) return 'max-w-[90vw]';
    if (dialogWidth >= 1200) return 'max-w-7xl';
    if (dialogWidth >= 1000) return 'max-w-6xl';
    if (dialogWidth >= 800) return 'max-w-5xl';
    return 'max-w-4xl';
  };

  const formatFileSize = (bytes: string) => {
    const size = Number.parseInt(bytes);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
    return `${(size / 1024 / 1024).toFixed(2)} MB`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${getDialogSize()} max-h-[90vh] overflow-hidden p-0 flex flex-col bg-white`}>
        <DialogHeader className="px-6 py-4 border-b bg-white">
          <DialogTitle>{asset.fileName}</DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-auto p-6 space-y-4 bg-white">
          {/* Media Preview */}
          {asset.mimeType.startsWith('image/') && (
            <div className="flex items-center justify-center w-full overflow-auto max-h-[60vh] bg-gray-50 rounded-lg">
              <img 
                src={getOriginalImageUrl()}
                alt={asset.fileName}
                className="w-auto h-auto max-w-none"
                onLoad={handleImageLoad}
                onError={(e) => {
                  console.error('Image load error:', e);
                  // Fallback to thumbnail if original fails
                  e.currentTarget.src = `${apiUrl}${asset.thumbnailUrl}`;
                }}
              />
            </div>
          )}
          
          {asset.mimeType.startsWith('video/') && (
            <div className="flex items-center justify-center w-full bg-black rounded-lg">
              <video 
                controls
                className="max-w-full max-h-[60vh] object-contain"
                preload="metadata"
                onError={(e) => {
                  console.error('Video error:', e);
                  console.error('Video src:', e.currentTarget.src);
                }}
                onLoadedMetadata={() => console.log('Video metadata loaded')}
              >
                <source 
                  src={`${apiUrl}/video/${asset.id}`}
                  type="video/mp4"
                />
                <track kind="captions" />
                Your browser does not support the video tag.
              </video>
            </div>
          )}
          
          {!asset.mimeType.startsWith('image/') && !asset.mimeType.startsWith('video/') && (
            <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
              <div className="text-center">
                <File className="h-16 w-16 mx-auto text-gray-400" />
                <p className="mt-2 text-sm text-gray-500">Preview not available</p>
              </div>
            </div>
          )}

          {/* File Details */}
          <div className="space-y-2 pt-4 border-t bg-white">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="font-medium">File Name:</span>
                <p className="text-gray-600 break-all">{asset.fileName}</p>
              </div>
              <div>
                <span className="font-medium">File Size:</span>
                <p className="text-gray-600">{formatFileSize(asset.fileSize)}</p>
              </div>
              <div>
                <span className="font-medium">Type:</span>
                <p className="text-gray-600">{asset.mimeType}</p>
              </div>
              <div>
                <span className="font-medium">Created:</span>
                <p className="text-gray-600">{formatDate(asset.createdAt)}</p>
              </div>
              <div className="col-span-2">
                <span className="font-medium">File Path:</span>
                <p className="text-gray-600 text-xs break-all font-mono bg-gray-50 p-2 rounded mt-1">
                  {asset.filePath}
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t bg-white">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button variant="default">
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
