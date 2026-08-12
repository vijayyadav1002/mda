import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

interface ChangeMyPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPassword: string;
  setCurrentPassword: (value: string) => void;
  newPassword: string;
  setNewPassword: (value: string) => void;
  confirmPassword: string;
  setConfirmPassword: (value: string) => void;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

export function ChangeMyPasswordDialog({
  open, onOpenChange,
  currentPassword, setCurrentPassword,
  newPassword, setNewPassword,
  confirmPassword, setConfirmPassword,
  error, onSubmit, onCancel,
}: ChangeMyPasswordDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-manrope text-foreground">Change My Password</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 mt-2">
          {[
            { id: "cur-pwd-u", label: "Current Password", value: currentPassword, set: setCurrentPassword },
            { id: "new-pwd-u", label: "New Password", value: newPassword, set: setNewPassword },
            { id: "con-pwd-u", label: "Confirm New Password", value: confirmPassword, set: setConfirmPassword },
          ].map((f) => (
            <div key={f.id} className="space-y-1.5">
              <label htmlFor={f.id} className="label-meta">{f.label}</label>
              <Input id={f.id} type="password" value={f.value} onChange={(e) => f.set(e.target.value)} required minLength={6}
                className="bg-muted border-border/20 text-foreground placeholder:text-muted-foreground" />
            </div>
          ))}
          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onCancel}
              className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity">
              Update Password
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
