import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { createGraphQLClient, getAuthToken, clearAuthToken } from "~/lib/api";
import { useActiveQueueCount } from "~/lib/useActiveQueueCount";
import { useAuditLogs } from "~/hooks/useAuditLogs";
import { SidebarNavItem } from "~/components/SidebarNavItem";
import { AuditFilterBar } from "~/components/AuditFilterBar";
import { AuditLogTable } from "~/components/AuditLogTable";
import { AuditPagination } from "~/components/AuditPagination";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import {
  ScrollText, Folder, ListTodo, Users,
  LogOut, User, Moon, Sun, Trash2,
  ArrowLeft, CalendarDays,
} from "lucide-react";

const CLEAR_AUDIT_LOGS_MUTATION = `
  mutation ClearAuditLogs($startDate: String!, $endDate: String!) {
    clearAuditLogs(startDate: $startDate, endDate: $endDate)
  }
`;

const ME_AND_USERS_QUERY = `
  query MeAndUsers {
    me { id username role }
    users { id username role }
  }
`;

interface UserOption {
  id: string;
  username: string;
  role: string;
}

export default function AuditPage() {
  const [currentUser, setCurrentUser] = useState<UserOption | null>(null);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const auditLogs = useAuditLogs({
    setError,
    onFiltersApplied: () => setExpandedDetails(new Set()),
  });

  const [clearStartDate, setClearStartDate] = useState("");
  const [clearEndDate, setClearEndDate] = useState("");
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [clearResult, setClearResult] = useState("");
  const [clearing, setClearing] = useState(false);

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
    initPage();
  }, []);

  const initPage = async () => {
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      const data: any = await client.request(ME_AND_USERS_QUERY);
      if (data.me.role !== "admin") { navigate("/dashboard"); return; }
      setCurrentUser(data.me);
      setUserOptions(data.users);
    } catch {
      setError("Failed to initialize page");
    }
  };

  const toggleDetails = (id: string) => {
    setExpandedDetails(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLogout = () => {
    clearAuthToken();
    navigate("/login");
  };

  const handleClearLogs = async () => {
    setClearing(true);
    setClearResult("");
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      const data: any = await client.request(CLEAR_AUDIT_LOGS_MUTATION, {
        startDate: clearStartDate,
        endDate: clearEndDate,
      });
      const count: number = data.clearAuditLogs;
      setClearResult(`Deleted ${count} log ${count === 1 ? "entry" : "entries"}.`);
      setShowClearDialog(false);
      auditLogs.setPage(0);
      setExpandedDetails(new Set());
      auditLogs.fetchLogs();
    } catch (err: any) {
      setClearResult(err.message || "Failed to clear logs");
    } finally {
      setClearing(false);
    }
  };

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
          <SidebarNavItem icon={Users} label="Users" onClick={() => navigate("/users")} />
          <SidebarNavItem icon={ScrollText} label="Audit" active />
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

          {currentUser && (
            <div className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-accent/50 transition-colors group">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{currentUser.username}</p>
                <p className="label-meta capitalize">{currentUser.role}</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground transition-all"
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 md:ml-64 min-h-screen">
        {/* Mobile top bar (the sidebar is desktop-only) */}
        <div className="md:hidden sticky top-0 z-20 flex items-center gap-3 px-6 py-3 bg-background/80 backdrop-blur-md border-b border-border/20">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Collections
          </button>
          <div className="w-px h-5 bg-border/40" />
          <span className="font-manrope font-bold text-sm flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-brand-primary" /> Audit Log
          </span>
        </div>

        {/* Hero */}
        <div className="px-6 md:px-10 pt-8 pb-6">
          <h1 className="font-manrope text-3xl md:text-4xl font-bold text-foreground tracking-tight">
            Audit Log
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Complete history of actions performed within the archive.
          </p>
        </div>

        {/* Filter bar */}
        <div className="px-6 md:px-10 pb-6">
          <AuditFilterBar
            filterAction={auditLogs.filterAction}
            setFilterAction={auditLogs.setFilterAction}
            filterResourceType={auditLogs.filterResourceType}
            setFilterResourceType={auditLogs.setFilterResourceType}
            filterUserId={auditLogs.filterUserId}
            setFilterUserId={auditLogs.setFilterUserId}
            filterStartDate={auditLogs.filterStartDate}
            setFilterStartDate={auditLogs.setFilterStartDate}
            filterEndDate={auditLogs.filterEndDate}
            setFilterEndDate={auditLogs.setFilterEndDate}
            userOptions={userOptions}
            onApply={auditLogs.applyFilters}
            onReset={auditLogs.resetFilters}
          />
        </div>

        {/* Clear Logs panel */}
        <div className="px-6 md:px-10 pb-6">
          <div className="bg-card rounded-2xl p-5 border border-destructive/20">
            <p className="font-manrope font-semibold text-sm text-destructive mb-3">Clear Logs by Date Range</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="label-meta">From</label>
                <input
                  type="date"
                  value={clearStartDate}
                  onChange={e => { setClearStartDate(e.target.value); setClearResult(""); }}
                  className="px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-hidden focus:border-destructive/60"
                />
              </div>
              <div className="space-y-1">
                <label className="label-meta">To</label>
                <input
                  type="date"
                  value={clearEndDate}
                  onChange={e => { setClearEndDate(e.target.value); setClearResult(""); }}
                  className="px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-hidden focus:border-destructive/60"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowClearDialog(true)}
                disabled={!clearStartDate || !clearEndDate}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" /> Clear Logs
              </button>
            </div>
            {clearResult && (
              <p className="mt-3 text-sm text-muted-foreground">{clearResult}</p>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="px-6 md:px-10 pb-10">
          {error && (
            <div className="mb-4 px-4 py-3 bg-destructive/10 text-destructive text-sm rounded-xl">
              {error}
            </div>
          )}

          <AuditLogTable
            logs={auditLogs.logs}
            loading={auditLogs.loading}
            expandedDetails={expandedDetails}
            onToggleDetails={toggleDetails}
          />

          <AuditPagination
            page={auditLogs.page}
            totalPages={auditLogs.totalPages}
            total={auditLogs.total}
            loading={auditLogs.loading}
            setPage={auditLogs.setPage}
          />
        </div>
      </div>

      {/* Confirm clear dialog */}
      <Dialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <DialogContent className="bg-card border-border/20 shadow-ambient rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-manrope text-foreground">Clear Audit Logs</DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <p className="text-sm text-muted-foreground">
              Delete all audit logs from <span className="font-medium text-foreground">{clearStartDate}</span> to <span className="font-medium text-foreground">{clearEndDate}</span>?
              <br />
              <span className="text-destructive font-medium">This cannot be undone.</span>
            </p>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowClearDialog(false)}
                className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearLogs}
                disabled={clearing}
                className="px-4 py-2 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50"
              >
                {clearing ? "Deleting…" : "Delete Logs"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
