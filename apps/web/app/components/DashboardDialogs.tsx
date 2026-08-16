import type { ComponentProps } from "react";
import { MediaAssetViewer } from "~/components/MediaAssetViewer";
import { CompressDialog } from "~/components/CompressDialog";
import { CompressQueuePanel } from "~/components/CompressQueuePanel";
import { TagDialog } from "~/components/TagDialog";
import { RemoveTagsDialog } from "~/components/RemoveTagsDialog";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { ChangePasswordDialog } from "~/components/ChangePasswordDialog";
import { LogoutConfirmDialog } from "~/components/LogoutConfirmDialog";
import { NewFileDialog } from "~/components/NewFileDialog";
import { NewFolderDialog } from "~/components/NewFolderDialog";
import { UploadDialog } from "~/components/UploadDialog";
import { MoveDialog } from "~/components/MoveDialog";
import { DuplicateDialog } from "~/components/DuplicateDialog";
import { RenameFolderDialog } from "~/components/RenameFolderDialog";

/**
 * Wires up every dialog/panel rendered at the bottom of the dashboard route.
 * Each key groups the exact props the underlying component expects, so the
 * prop shape here stays in sync with each dialog's own props automatically.
 */
interface DashboardDialogsProps {
  readonly viewer: ComponentProps<typeof MediaAssetViewer>;
  readonly compress: ComponentProps<typeof CompressDialog>;
  readonly tag: ComponentProps<typeof TagDialog>;
  readonly removeTags: ComponentProps<typeof RemoveTagsDialog>;
  readonly queue: ComponentProps<typeof CompressQueuePanel>;
  readonly duplicate: ComponentProps<typeof DuplicateDialog>;
  readonly move: ComponentProps<typeof MoveDialog>;
  readonly renameFolder: ComponentProps<typeof RenameFolderDialog>;
  readonly changePassword: ComponentProps<typeof ChangePasswordDialog>;
  readonly newFile: ComponentProps<typeof NewFileDialog>;
  readonly newFolder: ComponentProps<typeof NewFolderDialog>;
  readonly upload: ComponentProps<typeof UploadDialog>;
  readonly confirm: ComponentProps<typeof ConfirmDialog>;
  readonly logoutConfirm: ComponentProps<typeof LogoutConfirmDialog>;
}

export function DashboardDialogs({
  viewer,
  compress,
  tag,
  removeTags,
  queue,
  duplicate,
  move,
  renameFolder,
  changePassword,
  newFile,
  newFolder,
  upload,
  confirm,
  logoutConfirm,
}: DashboardDialogsProps) {
  return (
    <>
      <MediaAssetViewer {...viewer} />

      <CompressDialog {...compress} />

      <TagDialog {...tag} />

      <RemoveTagsDialog {...removeTags} />

      <CompressQueuePanel {...queue} />

      {/* Duplicate Asset */}
      <DuplicateDialog {...duplicate} />

      {/* Move Asset */}
      <MoveDialog {...move} />

      {/* Rename Folder */}
      <RenameFolderDialog {...renameFolder} />

      {/* Change Password */}
      <ChangePasswordDialog {...changePassword} />

      {/* New File Dialog */}
      <NewFileDialog {...newFile} />

      {/* New Folder Dialog */}
      <NewFolderDialog {...newFolder} />

      {/* Upload Dialog */}
      <UploadDialog {...upload} />

      <ConfirmDialog {...confirm} />

      {/* Logout Confirmation */}
      <LogoutConfirmDialog {...logoutConfirm} />
    </>
  );
}
