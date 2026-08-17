import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

interface ChangePasswordDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly currentPassword: string;
  readonly setCurrentPassword: (value: string) => void;
  readonly newPassword: string;
  readonly setNewPassword: (value: string) => void;
  readonly confirmPassword: string;
  readonly setConfirmPassword: (value: string) => void;
  readonly passwordError: string;
  readonly setPasswordError: (value: string) => void;
  readonly onSubmit: (e: React.FormEvent) => void;
}

export function ChangePasswordDialog({
  isOpen,
  onOpenChange,
  currentPassword,
  setCurrentPassword,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  passwordError,
  setPasswordError,
  onSubmit,
}: ChangePasswordDialogProps) {
  const handleCancel = () => {
    onOpenChange(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-manrope text-foreground">Change Password</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 mt-2">
          {(
            [
              { id: "cur-pwd", label: "Current Password", value: currentPassword, onChange: setCurrentPassword },
              { id: "new-pwd", label: "New Password", value: newPassword, onChange: setNewPassword },
              { id: "con-pwd", label: "Confirm New Password", value: confirmPassword, onChange: setConfirmPassword },
            ] as const
          ).map((field) => (
            <div key={field.id} className="space-y-1.5">
              <label htmlFor={field.id} className="label-meta">{field.label}</label>
              <Input
                id={field.id}
                type="password"
                value={field.value}
                onChange={(e) => (field.onChange as any)(e.target.value)}
                required
                minLength={6}
                className="bg-muted border-border/20 text-foreground placeholder:text-muted-foreground"
              />
            </div>
          ))}
          {passwordError && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2">{passwordError}</p>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity"
            >
              Update Password
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
