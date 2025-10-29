import { Download, File } from "lucide-react";
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
  if (!asset) return null;

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
      <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-hidden p-0 flex flex-col">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle>{asset.fileName}</DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {/* Media Preview */}
          {asset.mimeType.startsWith('image/') && (
            <div className="flex items-center justify-center w-full">
              <img 
                src={`${apiUrl}${asset.thumbnailUrl}`}
                alt={asset.fileName}
                className="max-w-full max-h-[calc(95vh-300px)] object-contain"
              />
            </div>
          )}
          
          {asset.mimeType.startsWith('video/') && (
            <div className="flex items-center justify-center w-full bg-black rounded-lg">
              <video 
                controls
                className="max-w-full max-h-[calc(95vh-300px)] object-contain"
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
            <div className="flex items-center justify-center h-64 bg-gray-100">
              <div className="text-center">
                <File className="h-16 w-16 mx-auto text-gray-400" />
                <p className="mt-2 text-sm text-gray-500">Preview not available</p>
              </div>
            </div>
          )}          {/* File Details */}
          <div className="space-y-2 pt-4 border-t">
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
          <div className="flex justify-end gap-2 pt-4 border-t">
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
