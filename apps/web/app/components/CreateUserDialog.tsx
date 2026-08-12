import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

interface CreateUserFormData {
  username: string;
  password: string;
  role: string;
}

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formData: CreateUserFormData;
  setFormData: (data: CreateUserFormData) => void;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

export function CreateUserDialog({ open, onOpenChange, formData, setFormData, error, onSubmit, onCancel }: CreateUserDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-manrope text-foreground">Add New Curator</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <label htmlFor="create-username" className="label-meta">Username</label>
            <Input
              id="create-username"
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              required
              placeholder="Enter username"
              className="bg-muted border-border/20 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="create-password" className="label-meta">Passphrase</label>
            <Input
              id="create-password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
              placeholder="Enter password"
              className="bg-muted border-border/20 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="create-role" className="label-meta">Access Level</label>
            <select
              id="create-role"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-hidden focus:border-brand-primary/80"
            >
              <option value="readonly">Read Only — View media only</option>
              <option value="editor">Editor — View, edit, delete media</option>
              <option value="admin">Admin — Full access</option>
            </select>
          </div>
          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onCancel}
              className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity">
              Create Curator
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
