import { Edit, Key, Trash2, User } from "lucide-react";
import type { UserData } from "~/hooks/useUsers";

function getRoleBadge(role: string) {
  switch (role) {
    case "admin":
      return "bg-brand-secondary/20 text-brand-secondary";
    case "editor":
      return "bg-brand-primary/20 text-brand-primary";
    default:
      return "bg-muted text-muted-foreground";
  }
}

interface UserTableProps {
  users: UserData[];
  currentUser: UserData | null;
  onEditRole: (user: UserData) => void;
  onResetPassword: (user: UserData) => void;
  onDelete: (userId: string) => void;
}

export function UserTable({ users, currentUser, onEditRole, onResetPassword, onDelete }: UserTableProps) {
  return (
    <div className="bg-card rounded-2xl overflow-hidden">
      {/* Table header — hidden on mobile */}
      <div className="hidden sm:grid sm:grid-cols-[1fr_120px_140px_120px] px-6 py-3">
        {["Username", "Role", "Joined", "Actions"].map((h) => (
          <p key={h} className="label-meta">{h}</p>
        ))}
      </div>

      {/* Table rows */}
      <div className="divide-y divide-border/10">
        {users.map((user) => (
          <div
            key={user.id}
            className="flex flex-col sm:grid sm:grid-cols-[1fr_120px_140px_120px] px-4 sm:px-6 py-4 gap-2 sm:gap-0 sm:items-center hover:bg-accent/30 transition-colors"
          >
            {/* Username + role (mobile: stacked; desktop: separate cols) */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground truncate">{user.username}</p>
                  {currentUser?.id === user.id && (
                    <p className="text-xs text-brand-primary">You</p>
                  )}
                  {/* Role badge on mobile */}
                  <span className={`sm:hidden inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${getRoleBadge(user.role)}`}>
                    {user.role}
                  </span>
                </div>
                {/* Date on mobile */}
                <p className="sm:hidden text-xs text-muted-foreground mt-0.5">
                  {new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
              {/* Actions on mobile */}
              {currentUser?.id !== user.id && (
                <div className="flex items-center gap-1 sm:hidden">
                  <button type="button" onClick={() => onEditRole(user)}
                    className="p-2 rounded-xl text-muted-foreground hover:text-brand-primary hover:bg-brand-primary/10 transition-all" title="Edit role">
                    <Edit className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => onResetPassword(user)}
                    className="p-2 rounded-xl text-muted-foreground hover:text-brand-secondary hover:bg-brand-secondary/10 transition-all" title="Reset password">
                    <Key className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => onDelete(user.id)}
                    className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all" title="Delete user">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
            {/* Desktop-only columns */}
            <div className="hidden sm:block">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${getRoleBadge(user.role)}`}>
                {user.role}
              </span>
            </div>
            <p className="hidden sm:block text-sm text-muted-foreground">
              {new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>
            <div className="hidden sm:flex items-center gap-1 justify-end">
              {currentUser?.id !== user.id && (
                <>
                  <button type="button" onClick={() => onEditRole(user)}
                    className="p-2 rounded-xl text-muted-foreground hover:text-brand-primary hover:bg-brand-primary/10 transition-all" title="Edit role">
                    <Edit className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => onResetPassword(user)}
                    className="p-2 rounded-xl text-muted-foreground hover:text-brand-secondary hover:bg-brand-secondary/10 transition-all" title="Reset password">
                    <Key className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => onDelete(user.id)}
                    className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all" title="Delete user">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
