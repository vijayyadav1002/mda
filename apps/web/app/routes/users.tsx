import { useState, useEffect } from "react";
import { useNavigate } from "@remix-run/react";
import { createGraphQLClient, getAuthToken, clearAuthToken } from "~/lib/api";
import { useActiveQueueCount } from "~/lib/useActiveQueueCount";
import { Input } from "~/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { SearchBar } from "~/components/SearchBar";
import {
  UserPlus, Trash2, Edit, Key, ArrowLeft,
  Users, Folder, ListTodo, ScrollText,
  LogOut, User, Moon, Sun,
} from "lucide-react";

const USERS_QUERY = `
  query GetUsers {
    users {
      id
      username
      role
      createdAt
    }
    me {
      id
      username
      role
    }
  }
`;

const CREATE_USER_MUTATION = `
  mutation CreateUser($username: String!, $password: String!, $role: String!) {
    createUser(username: $username, password: $password, role: $role) {
      id
      username
      role
      createdAt
    }
  }
`;

const UPDATE_USER_ROLE_MUTATION = `
  mutation UpdateUserRole($id: ID!, $role: String!) {
    updateUserRole(id: $id, role: $role) {
      id
      username
      role
    }
  }
`;

const DELETE_USER_MUTATION = `
  mutation DeleteUser($id: ID!) {
    deleteUser(id: $id)
  }
`;

const RESET_PASSWORD_MUTATION = `
  mutation ResetPassword($userId: ID!, $newPassword: String!) {
    resetPassword(userId: $userId, newPassword: $newPassword)
  }
`;

const CHANGE_MY_PASSWORD_MUTATION = `
  mutation ChangeMyPassword($currentPassword: String!, $newPassword: String!) {
    changeMyPassword(currentPassword: $currentPassword, newPassword: $newPassword)
  }
`;

interface UserData {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

function SidebarNavItem({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  onClick?: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 relative ${
        active
          ? "nav-active bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-auto w-5 h-5 gradient-brand rounded-full flex items-center justify-center text-[10px] font-bold text-[#060e20]">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

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

export default function UsersPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [currentUser, setCurrentUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false);
  const [showChangeMyPasswordDialog, setShowChangeMyPasswordDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [formData, setFormData] = useState({ username: "", password: "", role: "readonly" });
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("darkMode");
      return stored !== null ? stored === "true" : true;
    }
    return true;
  });
  const navigate = useNavigate();
  const activeQueueCount = useActiveQueueCount();

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("darkMode", darkMode.toString());
      if (darkMode) document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) { navigate("/login"); return; }
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      const data: any = await client.request(USERS_QUERY);
      setUsers(data.users);
      setCurrentUser(data.me);
      if (data.me.role !== "admin") navigate("/dashboard");
    } catch {
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(CREATE_USER_MUTATION, formData);
      setShowCreateDialog(false);
      setFormData({ username: "", password: "", role: "readonly" });
      loadUsers();
    } catch (err: any) {
      setError(err.message || "Failed to create user");
    }
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(UPDATE_USER_ROLE_MUTATION, { id: userId, role: newRole });
      setShowEditDialog(false);
      setSelectedUser(null);
      loadUsers();
    } catch (err: any) {
      setError(err.message || "Failed to update user role");
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Are you sure you want to delete this user?")) return;
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(DELETE_USER_MUTATION, { id: userId });
      loadUsers();
    } catch (err: any) {
      setError(err.message || "Failed to delete user");
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!selectedUser) return;
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(RESET_PASSWORD_MUTATION, { userId: selectedUser.id, newPassword });
      setShowResetPasswordDialog(false);
      setSelectedUser(null);
      setNewPassword("");
      alert("Password reset successfully");
    } catch (err: any) {
      setError(err.message || "Failed to reset password");
    }
  };

  const handleChangeMyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) { setError("New passwords do not match"); return; }
    if (newPassword.length < 6) { setError("Password must be at least 6 characters long"); return; }
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      await client.request(CHANGE_MY_PASSWORD_MUTATION, { currentPassword, newPassword });
      setShowChangeMyPasswordDialog(false);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setError("");
      alert("Password changed successfully");
    } catch (err: any) {
      setError(err.message || "Failed to change password");
    }
  };

  const handleLogout = () => {
    clearAuthToken();
    navigate("/login");
  };

  const handleSearch = (_term: string, _mediaType: string) => {
    navigate("/dashboard");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 rounded-2xl gradient-brand flex items-center justify-center animate-pulse">
          <Users className="w-5 h-5 text-[#060e20]" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* ── Sidebar ── */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 h-screen w-64 bg-card z-30 flex-shrink-0">
        <div className="px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl gradient-brand flex items-center justify-center shadow-ambient flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#060e20" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
            </div>
            <div>
              <p className="font-manrope font-bold text-sm text-foreground leading-none">The Curator</p>
              <p className="label-meta mt-0.5">Media Archive</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-0.5">
          <SidebarNavItem icon={Folder} label="Collections" onClick={() => navigate("/dashboard")} />
          <SidebarNavItem
            icon={ListTodo}
            label="Queue"
            onClick={() => navigate("/dashboard?queue=open")}
            badge={activeQueueCount || undefined}
          />
          <SidebarNavItem icon={Users} label="Users" active />
          <SidebarNavItem icon={ScrollText} label="Audit" onClick={() => navigate("/audit")} />
        </nav>

        <div className="px-3 pb-6 space-y-3">
          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border/40 text-muted-foreground text-sm hover:text-foreground hover:bg-accent transition-all duration-200"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            {darkMode ? "Light Mode" : "Dark Mode"}
          </button>
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity duration-200"
          >
            <UserPlus className="w-4 h-4" />
            Add User
          </button>

          {currentUser && (
            <div className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-accent/50 transition-colors group">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{currentUser.username}</p>
                <p className="label-meta capitalize">{currentUser.role}</p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => setShowChangeMyPasswordDialog(true)}
                  className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title="Change Password"
                >
                  <Key className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 md:ml-64 min-h-screen">
        {/* Toolbar */}
        <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-sm px-6 md:px-10 py-4 flex flex-col md:flex-row md:items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </button>
          <SearchBar
            onSearch={handleSearch}
            onClear={() => {}}
            className="w-full md:max-w-xl md:ml-auto"
          />
        </div>

        {/* Hero */}
        <div className="px-6 md:px-10 pt-6 pb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-manrope text-3xl md:text-4xl font-bold text-foreground tracking-tight">
                System Overview
              </h1>
              <p className="text-muted-foreground mt-1.5 text-sm">
                Manage curators and access permissions.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="label-meta text-emerald-400">Operational</span>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-8">
            {[
              { label: "Total Curators", value: users.length.toString(), sub: "Active accounts" },
              { label: "Administrators", value: users.filter((u) => u.role === "admin").length.toString(), sub: "Full access" },
              { label: "Read-Only", value: users.filter((u) => u.role === "readonly").length.toString(), sub: "View access" },
            ].map((stat) => (
              <div key={stat.label} className="bg-card rounded-2xl p-5">
                <p className="label-meta">{stat.label}</p>
                <p className="font-manrope text-3xl font-bold text-foreground mt-1">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{stat.sub}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Users table */}
        <div className="px-6 md:px-10 pb-10">
          <div className="flex items-center justify-between mb-4">
            <p className="font-manrope font-semibold text-foreground">Active Curators</p>
            <button
              type="button"
              onClick={() => setShowCreateDialog(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity md:hidden"
            >
              <UserPlus className="w-4 h-4" /> Add User
            </button>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 bg-destructive/10 text-destructive text-sm rounded-xl">
              {error}
            </div>
          )}

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
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
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
                        <button type="button" onClick={() => { setSelectedUser(user); setShowEditDialog(true); }}
                          className="p-2 rounded-xl text-muted-foreground hover:text-brand-primary hover:bg-brand-primary/10 transition-all" title="Edit role">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => { setSelectedUser(user); setShowResetPasswordDialog(true); }}
                          className="p-2 rounded-xl text-muted-foreground hover:text-brand-secondary hover:bg-brand-secondary/10 transition-all" title="Reset password">
                          <Key className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => handleDeleteUser(user.id)}
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
                        <button type="button" onClick={() => { setSelectedUser(user); setShowEditDialog(true); }}
                          className="p-2 rounded-xl text-muted-foreground hover:text-brand-primary hover:bg-brand-primary/10 transition-all" title="Edit role">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => { setSelectedUser(user); setShowResetPasswordDialog(true); }}
                          className="p-2 rounded-xl text-muted-foreground hover:text-brand-secondary hover:bg-brand-secondary/10 transition-all" title="Reset password">
                          <Key className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => handleDeleteUser(user.id)}
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
        </div>
      </div>

      {/* ── Dialogs ── */}

      {/* Create User */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-manrope text-foreground">Add New Curator</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateUser} className="space-y-4 mt-2">
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
                className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-none focus:border-brand-primary/80"
              >
                <option value="readonly">Read Only — View media only</option>
                <option value="editor">Editor — View, edit, delete media</option>
                <option value="admin">Admin — Full access</option>
              </select>
            </div>
            {error && <p className="text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2">{error}</p>}
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => { setShowCreateDialog(false); setFormData({ username: "", password: "", role: "readonly" }); setError(""); }}
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

      {/* Edit Role */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
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
                onChange={(e) => selectedUser && handleUpdateRole(selectedUser.id, e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-none focus:border-brand-primary/80"
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

      {/* Reset Password */}
      <Dialog open={showResetPasswordDialog} onOpenChange={setShowResetPasswordDialog}>
        <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-manrope text-foreground">Reset Password — {selectedUser?.username}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleResetPassword} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label htmlFor="new-pwd-reset" className="label-meta">New Passphrase</label>
              <Input id="new-pwd-reset" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required
                placeholder="Enter new password" className="bg-muted border-border/20 text-foreground placeholder:text-muted-foreground" />
            </div>
            {error && <p className="text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2">{error}</p>}
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => { setShowResetPasswordDialog(false); setSelectedUser(null); setNewPassword(""); setError(""); }}
                className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity">
                Reset Password
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Change My Password */}
      <Dialog open={showChangeMyPasswordDialog} onOpenChange={setShowChangeMyPasswordDialog}>
        <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-manrope text-foreground">Change My Password</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleChangeMyPassword} className="space-y-4 mt-2">
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
              <button type="button" onClick={() => { setShowChangeMyPasswordDialog(false); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setError(""); }}
                className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity">
                Update Password
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
