import { Download, File, Maximize2, Minimize2, X } from "lucide-react";
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
  thumbnailUrl: string | null;
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Reset dimensions when dialog closes or asset changes
  useEffect(() => {
    if (!isOpen) {
      setImageDimensions({ width: 0, height: 0 });
      setIsFullscreen(false);
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

  const getOriginalImageUrl = () => {
    // Backend /image/:id handles both HEIC conversion and non-HEIC originals.
    return `${apiUrl}/image/${asset.id}`;
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

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleClose = () => {
    setIsFullscreen(false);
    onClose();
  };

  // Fullscreen overlay component
  if (isFullscreen && asset) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
        <div className="relative w-full h-full max-w-[100vw] max-h-[100vh] flex items-center justify-center p-4">
          {/* Close and minimize buttons */}
          <div className="absolute top-4 right-4 z-10 flex gap-2">
            <button
              onClick={toggleFullscreen}
              className="p-3 bg-black/50 hover:bg-black/70 text-white rounded-lg backdrop-blur-sm transition-all"
              title="Exit Fullscreen"
            >
              <Minimize2 className="w-5 h-5" />
            </button>
            <button
              onClick={handleClose}
              className="p-3 bg-black/50 hover:bg-black/70 text-white rounded-lg backdrop-blur-sm transition-all"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Fullscreen media content */}
          {asset.mimeType.startsWith('image/') && (
            <button
              onClick={toggleFullscreen}
              className="max-w-full max-h-full cursor-pointer focus:outline-none flex items-center justify-center"
              type="button"
              title="Click to exit fullscreen"
            >
              <img
                src={getOriginalImageUrl()}
                alt={asset.fileName}
                className="max-w-full max-h-[calc(100vh-120px)] object-contain"
              />
            </button>
          )}

          {asset.mimeType.startsWith('video/') && (
            <video
              controls
              autoPlay
              className="max-w-full max-h-[calc(100vh-120px)] object-contain"
              preload="metadata"
            >
              <source src={`${apiUrl}/video/${asset.id}`} type="video/mp4" />
              <track kind="captions" />
              Your browser does not support the video tag.
            </video>
          )}

          {/* File info overlay */}
          <div className="absolute bottom-4 left-4 right-4 max-w-4xl mx-auto bg-black/50 backdrop-blur-md text-white p-4 rounded-lg">
            <h3 className="font-semibold text-lg mb-2 truncate">{asset.fileName}</h3>
            <div className="flex gap-6 text-sm flex-wrap">
              <span>{formatFileSize(asset.fileSize)}</span>
              <span>{asset.mimeType}</span>
              {imageDimensions.width > 0 && (
                <span>{imageDimensions.width} × {imageDimensions.height}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`w-[95vw] sm:w-auto ${getDialogSize()} max-h-[90vh] overflow-hidden p-0 flex flex-col bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700`}>
        <DialogHeader className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <DialogTitle className="text-gray-900 dark:text-white truncate pr-6">{asset.fileName}</DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-auto p-3 sm:p-6 space-y-4 bg-white dark:bg-gray-800">
          {/* Media Preview */}
          {asset.mimeType.startsWith('image/') && (
            <div className="relative flex items-center justify-center w-full overflow-auto max-h-[52vh] sm:max-h-[60vh] bg-gray-50 dark:bg-gray-900 rounded-lg p-2 sm:p-4 group">
              <img 
                src={getOriginalImageUrl()}
                alt={asset.fileName}
                className="w-auto h-auto max-w-none rounded-lg shadow-lg"
                onLoad={handleImageLoad}
                onError={(e) => {
                  console.error('Image load error:', e);
                  // Fallback to thumbnail if original fails
                  if (asset.thumbnailUrl) {
                    e.currentTarget.src = `${apiUrl}${asset.thumbnailUrl}`;
                  }
                }}
              />
              <button
                onClick={toggleFullscreen}
                className="absolute top-4 right-4 p-2.5 bg-black/50 hover:bg-black/70 text-white rounded-lg backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all"
                title="View Fullscreen"
                type="button"
              >
                <Maximize2 className="w-5 h-5" />
              </button>
            </div>
          )}
          
          {asset.mimeType.startsWith('video/') && (
            <div className="relative flex items-center justify-center w-full bg-black dark:bg-gray-950 rounded-lg overflow-hidden shadow-lg group">
              <video 
                controls
                className="max-w-full max-h-[52vh] sm:max-h-[60vh] object-contain"
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
              <button
                onClick={toggleFullscreen}
                className="absolute top-4 right-4 p-2.5 bg-black/50 hover:bg-black/70 text-white rounded-lg backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all"
                title="View Fullscreen"
                type="button"
              >
                <Maximize2 className="w-5 h-5" />
              </button>
            </div>
          )}
          
          {!asset.mimeType.startsWith('image/') && !asset.mimeType.startsWith('video/') && (
            <div className="flex items-center justify-center h-64 bg-gray-100 dark:bg-gray-900 rounded-lg">
              <div className="text-center">
                <File className="h-16 w-16 mx-auto text-gray-400 dark:text-gray-500" />
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Preview not available</p>
              </div>
            </div>
          )}

          {/* File Details */}
          <div className="space-y-2 pt-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
              <div>
                <span className="font-semibold text-gray-900 dark:text-gray-100">File Name:</span>
                <p className="text-gray-600 dark:text-gray-300 break-all mt-1">{asset.fileName}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-900 dark:text-gray-100">File Size:</span>
                <p className="text-gray-600 dark:text-gray-300 mt-1">{formatFileSize(asset.fileSize)}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-900 dark:text-gray-100">Type:</span>
                <p className="text-gray-600 dark:text-gray-300 mt-1">{asset.mimeType}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-900 dark:text-gray-100">Created:</span>
                <p className="text-gray-600 dark:text-gray-300 mt-1">{formatDate(asset.createdAt)}</p>
              </div>
              <div className="sm:col-span-2">
                <span className="font-semibold text-gray-900 dark:text-gray-100">File Path:</span>
                <p className="text-gray-600 dark:text-gray-300 text-xs break-all font-mono bg-gray-50 dark:bg-gray-900 p-3 rounded-lg mt-1 border border-gray-200 dark:border-gray-700">
                  {asset.filePath}
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <Button 
              variant="outline" 
              onClick={onClose}
              className="w-full sm:w-auto border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Close
            </Button>
            <Button 
              variant="default"
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
