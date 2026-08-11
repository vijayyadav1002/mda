import { File, FileImage, FileText, Table2 } from "lucide-react";
import { getFileCategory } from "~/lib/file-type";
import type { MediaAsset } from "~/lib/types";

interface FileTypeIconProps {
  asset: MediaAsset;
  className: string;
}

export function FileTypeIcon({ asset, className }: FileTypeIconProps) {
  const category = getFileCategory(asset);
  if (category === "excel") return <Table2 className={className} />;
  if (category === "word" || category === "text" || category === "markdown" || category === "pdf") {
    return <FileText className={className} />;
  }
  if (category === "image" || category === "video") return <FileImage className={className} />;
  return <File className={className} />;
}
