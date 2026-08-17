import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import type { UserData } from "~/hooks/useUsers";

interface EditUserRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedUser: UserData | null;
  error: string;
  onChangeRole: (userId: string, newRole: string) => void;
}

export function EditUserRoleDialog({ open, onOpenChange, selectedUser, error, onChangeRole }: EditUserRoleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-manrope text-foreground">Edit Role — {selectedUser?.username}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <label htmlFor="edit-role" className="label-meta">Access Level</label>
            <select
              id="edit-role"
              value={selectedUser?.role || "readonly"}
              onChange={(e) => selectedUser && onChangeRole(selectedUser.id, e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-hidden focus:border-brand-primary/80"
            >
              <option value="readonly">Read Only</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
