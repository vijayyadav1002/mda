import {
  CalendarDays,
  ChevronDown,
  Folder,
  HardDrive,
  Key,
  ListTodo,
  LogOut,
  RotateCcw,
  ScrollText,
  Trash2,
  Upload,
  User,
  Users,
} from "lucide-react";
import { CachePanelBody } from "~/components/CachePanelBody";
import { SidebarNavItem } from "~/components/SidebarNavItem";
import { formatBytes } from "~/lib/format";
import type { CacheSettingsData, CacheStats } from "~/lib/types";

interface SidebarProps {
  readonly user: { username: string; role: string } | null;
  readonly rootSize: number | null;
  readonly onNavigateHome: () => void;
  readonly onNavigateTimeline: () => void;
  readonly onNavigateTrash: () => void;
  readonly onNavigateUsers: () => void;
  readonly onNavigateAudit: () => void;
  readonly onOpenQueuePanel: () => void;
  readonly queueBadgeCount?: number;
  readonly cacheStats: CacheStats | null;
  readonly cacheSettings: CacheSettingsData | null;
  readonly showCachePanel: boolean;
  readonly onToggleCachePanel: () => void;
  readonly onClearCache: (type: "thumbnails" | "previews" | "hls" | "transcoded" | "all") => void;
  readonly onSaveCacheSettings: (input: Partial<CacheSettingsData>) => Promise<void>;
  readonly isRefreshing: boolean;
  readonly onRefreshLibrary: () => void;
  readonly onUpload: () => void;
  readonly onChangePassword: () => void;
  readonly onLogout: () => void;
}

export function Sidebar({
  user,
  rootSize,
  onNavigateHome,
  onNavigateTimeline,
  onNavigateTrash,
  onNavigateUsers,
  onNavigateAudit,
  onOpenQueuePanel,
  queueBadgeCount,
  cacheStats,
  cacheSettings,
  showCachePanel,
  onToggleCachePanel,
  onClearCache,
  onSaveCacheSettings,
  isRefreshing,
  onRefreshLibrary,
  onUpload,
  onChangePassword,
  onLogout,
}: SidebarProps) {
  const canManageMedia = user?.role === "admin" || user?.role === "editor";

  return (
    <aside className="hidden md:flex flex-col fixed left-0 top-0 h-screen w-64 bg-card z-30 shrink-0">
      {/* Brand */}
      <div className="px-5 py-6">
        <button
          type="button"
          onClick={onNavigateHome}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <div className="w-9 h-9 rounded-xl gradient-brand flex items-center justify-center shadow-ambient shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#060e20" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
          </div>
          <div className="text-left">
            <p className="font-manrope font-bold text-sm text-foreground leading-none">The Curator</p>
            <p className="label-meta mt-0.5">Media Archive</p>
          </div>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-0.5">
        <SidebarNavItem icon={Folder} label="Collections" active onClick={onNavigateHome} />
        <SidebarNavItem icon={CalendarDays} label="Timeline" onClick={onNavigateTimeline} />
        {canManageMedia && <SidebarNavItem icon={Trash2} label="Trash" onClick={onNavigateTrash} />}
        {canManageMedia && (
          <SidebarNavItem icon={ListTodo} label="Queue" onClick={onOpenQueuePanel} badge={queueBadgeCount} />
        )}
        {user?.role === "admin" && <SidebarNavItem icon={Users} label="Users" onClick={onNavigateUsers} />}
        {user?.role === "admin" && <SidebarNavItem icon={ScrollText} label="Audit" onClick={onNavigateAudit} />}
      </nav>

      {/* Bottom */}
      <div className="px-3 pb-6 space-y-3">
        {rootSize != null && rootSize > 0 && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-border/20 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 shrink-0" />
              Media Total
            </span>
            <span className="font-mono">{formatBytes(rootSize)}</span>
          </div>
        )}
        {/* Cache stats (admin only) */}
        {user?.role === "admin" && cacheStats && (
          <div className="rounded-xl border border-border/20 overflow-hidden">
            <button
              type="button"
              onClick={onToggleCachePanel}
              className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
            >
              <span className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 shrink-0" />
                Cache
              </span>
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-xs truncate">{formatBytes(cacheStats.totalBytes)}</span>
                <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${showCachePanel ? "rotate-180" : ""}`} />
              </span>
            </button>
            {showCachePanel && (
              <CachePanelBody
                cacheStats={cacheStats}
                cacheSettings={cacheSettings}
                onClear={onClearCache}
                onSaveSettings={onSaveCacheSettings}
              />
            )}
          </div>
        )}

        {/* Refresh button */}
        <button
          type="button"
          onClick={onRefreshLibrary}
          disabled={isRefreshing}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border/40 text-muted-foreground text-sm hover:text-foreground hover:bg-accent transition-all duration-200 disabled:opacity-50"
        >
          <RotateCcw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "Refreshing…" : "Refresh Library"}
        </button>

        {/* Upload */}
        {canManageMedia && (
          <button
            type="button"
            onClick={onUpload}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity duration-200"
          >
            <Upload className="w-4 h-4" />
            Upload Media
          </button>
        )}

        {/* User row */}
        {user && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-accent/50 transition-colors group">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{user.username}</p>
              <p className="label-meta capitalize">{user.role}</p>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={onChangePassword}
                className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Change Password"
              >
                <Key className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onLogout}
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
  );
}
