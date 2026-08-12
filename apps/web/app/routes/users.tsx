import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { clearAuthToken } from "~/lib/api";
import { useActiveQueueCount } from "~/lib/useActiveQueueCount";
import { useUsers } from "~/hooks/useUsers";
import { SidebarNavItem } from "~/components/SidebarNavItem";
import { UserTable } from "~/components/UserTable";
import { CreateUserDialog } from "~/components/CreateUserDialog";
import { EditUserRoleDialog } from "~/components/EditUserRoleDialog";
import { ResetPasswordDialog } from "~/components/ResetPasswordDialog";
import { ChangeMyPasswordDialog } from "~/components/ChangeMyPasswordDialog";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { SearchBar } from "~/components/SearchBar";
import {
  UserPlus, Trash2, Key, ArrowLeft,
  Users, Folder, ListTodo, ScrollText,
  LogOut, User, Moon, Sun, CalendarDays,
} from "lucide-react";

export default function UsersPage() {
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("darkMode");
      return stored !== null ? stored === "true" : true;
    }
    return true;
  });
  const navigate = useNavigate();
  const activeQueueCount = useActiveQueueCount();
  const u = useUsers(navigate);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("darkMode", darkMode.toString());
      if (darkMode) document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  const handleLogout = () => {
    clearAuthToken();
    navigate("/login");
  };

  const handleSearch = (_term: string, _mediaType: string) => {
    navigate("/dashboard");
  };

  if (u.loading) {
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
      <aside className="hidden md:flex flex-col fixed left-0 top-0 h-screen w-64 bg-card z-30 shrink-0">
        <div className="px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl gradient-brand flex items-center justify-center shadow-ambient shrink-0">
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
          <SidebarNavItem icon={CalendarDays} label="Timeline" onClick={() => navigate("/timeline")} />
          <SidebarNavItem icon={Trash2} label="Trash" onClick={() => navigate("/trash")} />
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
            onClick={() => u.setShowCreateDialog(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity duration-200"
          >
            <UserPlus className="w-4 h-4" />
            Add User
          </button>

          {u.currentUser && (
            <div className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-accent/50 transition-colors group">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{u.currentUser.username}</p>
                <p className="label-meta capitalize">{u.currentUser.role}</p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => u.setShowChangeMyPasswordDialog(true)}
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
        <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-xs px-6 md:px-10 py-4 flex flex-col md:flex-row md:items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
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
            <div className="flex items-center gap-2 shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="label-meta text-emerald-400">Operational</span>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-8">
            {[
              { label: "Total Curators", value: u.users.length.toString(), sub: "Active accounts" },
              { label: "Administrators", value: u.users.filter((usr) => usr.role === "admin").length.toString(), sub: "Full access" },
              { label: "Read-Only", value: u.users.filter((usr) => usr.role === "readonly").length.toString(), sub: "View access" },
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
              onClick={() => u.setShowCreateDialog(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity md:hidden"
            >
              <UserPlus className="w-4 h-4" /> Add User
            </button>
          </div>

          {u.error && (
            <div className="mb-4 px-4 py-3 bg-destructive/10 text-destructive text-sm rounded-xl">
              {u.error}
            </div>
          )}

          <UserTable
            users={u.users}
            currentUser={u.currentUser}
            onEditRole={(user) => { u.setSelectedUser(user); u.setShowEditDialog(true); }}
            onResetPassword={(user) => { u.setSelectedUser(user); u.setShowResetPasswordDialog(true); }}
            onDelete={u.handleDeleteUser}
          />
        </div>
      </div>

      {/* ── Dialogs ── */}

      <CreateUserDialog
        open={u.showCreateDialog}
        onOpenChange={u.setShowCreateDialog}
        formData={u.formData}
        setFormData={u.setFormData}
        error={u.error}
        onSubmit={u.handleCreateUser}
        onCancel={() => { u.setShowCreateDialog(false); u.setFormData({ username: "", password: "", role: "readonly" }); u.setError(""); }}
      />

      <EditUserRoleDialog
        open={u.showEditDialog}
        onOpenChange={u.setShowEditDialog}
        selectedUser={u.selectedUser}
        error={u.error}
        onChangeRole={u.handleUpdateRole}
      />

      <ResetPasswordDialog
        open={u.showResetPasswordDialog}
        onOpenChange={u.setShowResetPasswordDialog}
        selectedUser={u.selectedUser}
        newPassword={u.newPassword}
        setNewPassword={u.setNewPassword}
        error={u.error}
        onSubmit={u.handleResetPassword}
        onCancel={() => { u.setShowResetPasswordDialog(false); u.setSelectedUser(null); u.setNewPassword(""); u.setError(""); }}
      />

      <ChangeMyPasswordDialog
        open={u.showChangeMyPasswordDialog}
        onOpenChange={u.setShowChangeMyPasswordDialog}
        currentPassword={u.currentPassword}
        setCurrentPassword={u.setCurrentPassword}
        newPassword={u.newPassword}
        setNewPassword={u.setNewPassword}
        confirmPassword={u.confirmPassword}
        setConfirmPassword={u.setConfirmPassword}
        error={u.error}
        onSubmit={u.handleChangeMyPassword}
        onCancel={() => { u.setShowChangeMyPasswordDialog(false); u.setCurrentPassword(""); u.setNewPassword(""); u.setConfirmPassword(""); u.setError(""); }}
      />

      <ConfirmDialog
        open={u.deleteConfirm.open}
        onOpenChange={(open) => u.setDeleteConfirm((prev) => ({ ...prev, open }))}
        title="Delete User"
        description="Are you sure you want to delete this user?"
        warning="This cannot be undone."
        onConfirm={u.confirmDeleteUser}
      />
    </div>
  );
}
