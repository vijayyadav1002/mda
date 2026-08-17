import { LogOut } from "lucide-react";

interface LogoutConfirmDialogProps {
  readonly isOpen: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function LogoutConfirmDialog({ isOpen, onCancel, onConfirm }: LogoutConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
      <div className="bg-card rounded-2xl p-8 max-w-sm w-full mx-4 shadow-ambient border border-border/10 text-center">
        <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
          <LogOut className="w-5 h-5 text-muted-foreground" />
        </div>
        <h2 className="font-manrope text-xl font-bold text-foreground mb-2">Securely signing out?</h2>
        <p className="text-muted-foreground text-sm mb-6">
          Before you leave, ensure all your gallery edits are saved. You will need to sign in again to access your media library.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-border/30 text-sm text-foreground hover:bg-accent transition-all font-medium"
          >
            Return to Dashboard
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl gradient-brand text-[#060e20] text-sm font-manrope font-bold shadow-ambient hover:opacity-90 transition-opacity"
          >
            Confirm Logout
          </button>
        </div>
        <p className="label-meta mt-4">The Curated Gallery · Session Security</p>
      </div>
    </div>
  );
}
