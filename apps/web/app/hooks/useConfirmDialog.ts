import { useCallback, useState } from "react";

/**
 * Shared confirm-dialog orchestration used to gate destructive actions
 * across the dashboard (tag delete, cache clear, asset delete, folder
 * delete, etc). Owns the dialog's open/content state and the `openConfirm`
 * opener; rendering the actual `<ConfirmDialog>` component stays in the
 * caller, which wires `confirmDialog`/`setConfirmDialog` to its props.
 */
export function useConfirmDialog() {
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    warning?: string;
    confirmLabel?: string;
    onConfirm: () => Promise<void>;
  }>({ open: false, title: "", description: "", onConfirm: async () => {} });
  const openConfirm = useCallback((opts: {
    title: string;
    description: string;
    warning?: string;
    confirmLabel?: string;
    onConfirm: () => Promise<void>;
  }) => {
    setConfirmDialog({ ...opts, open: true });
  }, []);

  return { confirmDialog, setConfirmDialog, openConfirm };
}
