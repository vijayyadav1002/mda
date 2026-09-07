import type { MediaAsset } from "~/lib/types";

export type FileCategory = "image" | "video" | "pdf" | "word" | "excel" | "text" | "markdown" | "other";

/** Soft cap aligned with backend MAX_TEXT_CONTENT_BYTES (~2 MB). */
export const MAX_TEXT_CONTENT_BYTES = 2 * 1024 * 1024;

const TEXT_LIKE_EXTENSIONS = new Set([
  "txt",
  "json",
  "xml",
  "csv",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "yaml",
  "yml",
  "html",
  "htm",
  "css",
]);

const TEXT_LIKE_APPLICATION_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/yaml",
]);

export function getFileCategory(asset: MediaAsset): FileCategory {
  const ext = asset.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (asset.mimeType.startsWith("image/")) return "image";
  if (asset.mimeType.startsWith("video/")) return "video";
  if (asset.mimeType === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "docx") return "word";
  if (ext === "xlsx") return "excel";
  if (ext === "md" || ext === "markdown" || asset.mimeType === "text/markdown") return "markdown";
  if (
    asset.mimeType.startsWith("text/") ||
    TEXT_LIKE_EXTENSIONS.has(ext) ||
    TEXT_LIKE_APPLICATION_MIMES.has(asset.mimeType)
  ) {
    return "text";
  }
  return "other";
}

/** True for text-like assets that may show Copy / text preview (not binary). */
export function isTextLikeAsset(asset: MediaAsset): boolean {
  const category = getFileCategory(asset);
  return category === "text" || category === "markdown";
}

export function getFileCategoryLabel(category: FileCategory) {
  const labels: Record<FileCategory, string> = {
    image: "Image",
    video: "Video",
    pdf: "PDF",
    word: "Word",
    excel: "Excel",
    text: "Text",
    markdown: "Markdown",
    other: "File",
  };
  return labels[category];
}

export function canCompressAsset(asset: MediaAsset) {
  const category = getFileCategory(asset);
  return category === "image" || category === "video" || category === "pdf";
}

export function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toUpperCase() ?? "FILE";
}

export function formatFileSize(bytes: string) {
  const size = parseInt(bytes);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}
