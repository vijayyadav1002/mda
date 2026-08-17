import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import type { UserData } from "~/hooks/useUsers";

interface ResetPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedUser: UserData | null;
  newPassword: string;
  setNewPassword: (value: string) => void;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

export function ResetPasswordDialog({ open, onOpenChange, selectedUser, newPassword, setNewPassword, error, onSubmit, onCancel }: ResetPasswordDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-manrope text-foreground">Reset Password — {selectedUser?.username}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <label htmlFor="new-pwd-reset" className="label-meta">New Passphrase</label>
            <Input id="new-pwd-reset" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required
              placeholder="Enter new password" className="bg-muted border-border/20 text-foreground placeholder:text-muted-foreground" />
          </div>
          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onCancel}
              className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity">
              Reset Password
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
