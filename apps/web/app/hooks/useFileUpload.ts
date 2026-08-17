import { useRef, useState } from "react";
import { getApiUrl, getAuthToken } from "~/lib/api";
import type { DirectoryNode } from "~/lib/types";

const API_URL = getApiUrl();

interface UseFileUploadParams {
  /** Currently open folder; used as the upload target when none is explicitly chosen. */
  currentPath: string | null;
  /** Library root; used as a fallback upload target and re-fetched alongside it. */
  rootPath: string | null;
  /** From `useDirectoryTree` — refreshes a path's cached `DirectoryNode` after upload completes. */
  loadDirectoryIntoCache: (directoryPath?: string | null) => Promise<DirectoryNode | null>;
}

/**
 * Owns the dashboard's upload-media feature: the upload dialog's open state,
 * the selected-files/target-folder/per-file-progress state, the hidden
 * file-input ref used by the drop zone's click-to-browse affordance, and the
 * `handleUpload` action that XHR-uploads each selected file with progress
 * tracking and refreshes the affected directory caches afterward.
 *
 * Takes the directory-tree cache accessors as parameters rather than
 * importing `useDirectoryTree` directly, since they're shared with other
 * dashboard features.
 */
export function useFileUpload({ currentPath, rootPath, loadDirectoryIntoCache }: UseFileUploadParams) {
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadTargetPath, setUploadTargetPath] = useState('');
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (uploadFiles.length === 0 || isUploading) return;
    setIsUploading(true);
    const token = getAuthToken();
    if (!token) { setIsUploading(false); return; }
    const target = uploadTargetPath || currentPath || rootPath || '';
    const newProgress: Record<string, number> = {};
    try {
      for (const file of uploadFiles) {
        newProgress[file.name] = 0;
        setUploadProgress({ ...newProgress });
        const formData = new FormData();
        formData.append('file', file);
        const url = `${API_URL}/api/upload?targetPath=${encodeURIComponent(target)}`;
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', url);
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              newProgress[file.name] = Math.round((e.loaded / e.total) * 100);
              setUploadProgress({ ...newProgress });
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              newProgress[file.name] = 100;
              setUploadProgress({ ...newProgress });
              resolve();
            } else {
              try {
                const err = JSON.parse(xhr.responseText);
                reject(new Error(err.error || xhr.statusText));
              } catch {
                reject(new Error(xhr.statusText));
              }
            }
          };
          xhr.onerror = () => reject(new Error('Network error'));
          xhr.send(formData);
        });
      }
      setShowUploadDialog(false);
      setUploadFiles([]);
      setUploadProgress({});
      if (target) await loadDirectoryIntoCache(target);
      if (rootPath && rootPath !== target) await loadDirectoryIntoCache(rootPath);
    } catch (err: any) {
      alert(`Upload failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsUploading(false);
    }
  };

  return {
    showUploadDialog,
    setShowUploadDialog,
    uploadFiles,
    setUploadFiles,
    uploadTargetPath,
    setUploadTargetPath,
    uploadProgress,
    setUploadProgress,
    isUploading,
    fileInputRef,
    handleUpload,
  };
}
