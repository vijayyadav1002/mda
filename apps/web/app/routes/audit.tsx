import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { createGraphQLClient, getAuthToken, clearAuthToken } from "~/lib/api";
import { useActiveQueueCount } from "~/lib/useActiveQueueCount";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import {
  ScrollText, Folder, ListTodo, Users,
  LogOut, User, Moon, Sun, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Trash2,
  ArrowLeft, CalendarDays,
} from "lucide-react";

const PAGE_SIZE = 50;

const AUDIT_LOGS_QUERY = `
  query AuditLogs($limit: Int, $offset: Int, $userId: ID, $action: String, $resourceType: String, $startDate: String, $endDate: String) {
    auditLogs(limit: $limit, offset: $offset, userId: $userId, action: $action, resourceType: $resourceType, startDate: $startDate, endDate: $endDate) {
      id
      userId
      user {
        id
        username
        role
      }
      action
      resourceType
      resourceId
      details
      createdAt
    }
  }
`;

const AUDIT_LOGS_COUNT_QUERY = `
  query AuditLogsCount($userId: ID, $action: String, $resourceType: String, $startDate: String, $endDate: String) {
    auditLogsCount(userId: $userId, action: $action, resourceType: $resourceType, startDate: $startDate, endDate: $endDate)
  }
`;

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

interface AuditLog {
  id: string;
  userId: string;
  user: { id: string; username: string; role: string } | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: string | null;
  createdAt: string;
}

interface UserOption {
  id: string;
  username: string;
  role: string;
}

const ALL_ACTIONS = [
  "LOGIN", "CREATE_FIRST_ADMIN", "CREATE_USER", "UPDATE_USER_ROLE",
  "RESET_PASSWORD", "CHANGE_PASSWORD", "DELETE_USER",
  "MOVE_ASSET", "RENAME_ASSET", "DUPLICATE_ASSET", "DELETE_ASSET",
  "COMPRESS_ASSET", "PREVIEW_COMPRESS_ASSETS", "CONFIRM_COMPRESS_REPLACE",
  "CREATE_FOLDER", "DELETE_FOLDER", "RENAME_FOLDER", "MOVE_FOLDER", "DUPLICATE_FOLDER",
  "APPLY_TAGS", "REMOVE_TAG", "DELETE_TAG", "RENAME_TAG",
  "REFRESH_MEDIA_LIBRARY",
];

const ALL_RESOURCE_TYPES = ["user", "media_asset", "directory", "tag", "media_library"];

function actionBadgeClass(action: string): string {
  if (["LOGIN","CREATE_FIRST_ADMIN","CREATE_USER","UPDATE_USER_ROLE","RESET_PASSWORD","CHANGE_PASSWORD","DELETE_USER"].includes(action)) {
    return "bg-blue-500/15 text-blue-400";
  }
  if (["MOVE_ASSET","RENAME_ASSET","DUPLICATE_ASSET","DELETE_ASSET","COMPRESS_ASSET","PREVIEW_COMPRESS_ASSETS","CONFIRM_COMPRESS_REPLACE"].includes(action)) {
    return "bg-emerald-500/15 text-emerald-400";
  }
  if (["CREATE_FOLDER","DELETE_FOLDER","RENAME_FOLDER","MOVE_FOLDER","DUPLICATE_FOLDER"].includes(action)) {
    return "bg-amber-500/15 text-amber-400";
  }
  if (["APPLY_TAGS","REMOVE_TAG","DELETE_TAG","RENAME_TAG"].includes(action)) {
    return "bg-purple-500/15 text-purple-400";
  }
  return "bg-muted text-muted-foreground";
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

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserOption | null>(null);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const [filterAction, setFilterAction] = useState("");
  const [filterResourceType, setFilterResourceType] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  const [appliedFilters, setAppliedFilters] = useState<{
    action: string; resourceType: string; userId: string; startDate: string; endDate: string;
  }>({ action: "", resourceType: "", userId: "", startDate: "", endDate: "" });

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

  useEffect(() => {
    fetchLogs();
  }, [page, appliedFilters]);

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

  const buildVars = (p: number) => ({
    limit: PAGE_SIZE,
    offset: p * PAGE_SIZE,
    userId: appliedFilters.userId || undefined,
    action: appliedFilters.action || undefined,
    resourceType: appliedFilters.resourceType || undefined,
    startDate: appliedFilters.startDate || undefined,
    endDate: appliedFilters.endDate || undefined,
  });

  const fetchLogs = async () => {
    setLoading(true);
    setError("");
    try {
      const token = getAuthToken();
      if (!token) return;
      const client = createGraphQLClient(token);
      const filterVars = {
        userId: appliedFilters.userId || undefined,
        action: appliedFilters.action || undefined,
        resourceType: appliedFilters.resourceType || undefined,
        startDate: appliedFilters.startDate || undefined,
        endDate: appliedFilters.endDate || undefined,
      };
      const [logsData, countData]: [any, any] = await Promise.all([
        client.request(AUDIT_LOGS_QUERY, buildVars(page)),
        client.request(AUDIT_LOGS_COUNT_QUERY, filterVars),
      ]);
      setLogs(logsData.auditLogs);
      setTotal(countData.auditLogsCount);
    } catch {
      setError("Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    setPage(0);
    setExpandedDetails(new Set());
    setAppliedFilters({
      action: filterAction,
      resourceType: filterResourceType,
      userId: filterUserId,
      startDate: filterStartDate,
      endDate: filterEndDate,
    });
  };

  const resetFilters = () => {
    setFilterAction("");
    setFilterResourceType("");
    setFilterUserId("");
    setFilterStartDate("");
    setFilterEndDate("");
    setPage(0);
    setExpandedDetails(new Set());
    setAppliedFilters({ action: "", resourceType: "", userId: "", startDate: "", endDate: "" });
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
      setPage(0);
      setExpandedDetails(new Set());
      fetchLogs();
    } catch (err: any) {
      setClearResult(err.message || "Failed to clear logs");
    } finally {
      setClearing(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });

  const formatDetails = (raw: string) => {
    try { return JSON.stringify(JSON.parse(raw), null, 2); }
    catch { return raw; }
  };

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
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
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
          <div className="bg-card rounded-2xl p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Action filter */}
              <div className="space-y-1">
                <label className="label-meta">Action</label>
                <select
                  value={filterAction}
                  onChange={e => setFilterAction(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-none focus:border-brand-primary/80"
                >
                  <option value="">All actions</option>
                  {ALL_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              {/* Resource type filter */}
              <div className="space-y-1">
                <label className="label-meta">Resource Type</label>
                <select
                  value={filterResourceType}
                  onChange={e => setFilterResourceType(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-none focus:border-brand-primary/80"
                >
                  <option value="">All types</option>
                  {ALL_RESOURCE_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* User filter */}
              <div className="space-y-1">
                <label className="label-meta">User</label>
                <select
                  value={filterUserId}
                  onChange={e => setFilterUserId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-none focus:border-brand-primary/80"
                >
                  <option value="">All users</option>
                  {userOptions.map(u => (
                    <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
                  ))}
                </select>
              </div>

              {/* Date from */}
              <div className="space-y-1">
                <label className="label-meta">From</label>
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={e => setFilterStartDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-none focus:border-brand-primary/80"
                />
              </div>

              {/* Date to */}
              <div className="space-y-1">
                <label className="label-meta">To</label>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={e => setFilterEndDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-none focus:border-brand-primary/80"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={applyFilters}
                className="px-5 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity"
              >
                Apply Filters
              </button>
              <button
                type="button"
                onClick={resetFilters}
                className="px-5 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              >
                Reset
              </button>
            </div>
          </div>
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
                  className="px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-none focus:border-destructive/60"
                />
              </div>
              <div className="space-y-1">
                <label className="label-meta">To</label>
                <input
                  type="date"
                  value={clearEndDate}
                  onChange={e => { setClearEndDate(e.target.value); setClearResult(""); }}
                  className="px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-none focus:border-destructive/60"
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

          <div className="bg-card rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="hidden lg:grid lg:grid-cols-[180px_140px_180px_120px_80px_1fr] px-6 py-3 border-b border-border/10">
              {["Timestamp", "User", "Action", "Resource Type", "Res. ID", "Details"].map(h => (
                <p key={h} className="label-meta">{h}</p>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
                Loading…
              </div>
            ) : logs.length === 0 ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
                No audit logs found.
              </div>
            ) : (
              <div className="divide-y divide-border/10">
                {logs.map(log => (
                  <div key={log.id} className="flex flex-col lg:grid lg:grid-cols-[180px_140px_180px_120px_80px_1fr] px-4 lg:px-6 py-4 gap-2 lg:gap-0 lg:items-start hover:bg-accent/20 transition-colors">
                    {/* Timestamp */}
                    <p className="text-xs text-muted-foreground lg:pt-0.5 flex-shrink-0">
                      {formatDate(log.createdAt)}
                    </p>

                    {/* User */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <User className="w-3 h-3 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate">
                          {log.user?.username ?? <span className="text-muted-foreground italic">deleted</span>}
                        </p>
                        {log.user && (
                          <p className="text-[10px] text-muted-foreground capitalize">{log.user.role}</p>
                        )}
                      </div>
                    </div>

                    {/* Action badge */}
                    <div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold font-mono ${actionBadgeClass(log.action)}`}>
                        {log.action}
                      </span>
                    </div>

                    {/* Resource type */}
                    <p className="text-xs text-muted-foreground lg:pt-0.5">{log.resourceType}</p>

                    {/* Resource ID */}
                    <p className="text-xs text-muted-foreground lg:pt-0.5">{log.resourceId ?? "—"}</p>

                    {/* Details */}
                    <div>
                      {log.details ? (
                        <div>
                          <button
                            type="button"
                            onClick={() => toggleDetails(log.id)}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {expandedDetails.has(log.id) ? (
                              <><ChevronUp className="w-3 h-3" /> Hide</>
                            ) : (
                              <><ChevronDown className="w-3 h-3" /> Show</>
                            )}
                          </button>
                          {expandedDetails.has(log.id) && (
                            <pre className="mt-2 text-[11px] text-foreground bg-muted rounded-xl px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all">
                              {formatDetails(log.details)}
                            </pre>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">—</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {!loading && total > 0 && (
            <div className="flex items-center justify-between mt-4 px-1">
              <p className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages} <span className="text-muted-foreground/60">({total} total)</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
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
