import {
  Folder,
  Menu,
  X,
  CalendarDays,
  Trash2,
  ListTodo,
  Users,
  ScrollText,
  RotateCcw,
  ImagePlus,
  Upload,
  Sun,
  Moon,
  Key,
  HardDrive,
  ChevronDown,
  LogOut,
} from "lucide-react";
import { formatBytes } from "~/lib/format";
import type { CacheSettingsData, CacheStats } from "~/lib/types";
import { SidebarNavItem } from "~/components/SidebarNavItem";
import { CachePanelBody } from "~/components/CachePanelBody";

interface MobileNavProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  user: { username: string; role: string } | null;
  queueBadgeCount: number;
  isRefreshing: boolean;
  isGeneratingThumbnails: boolean;
  canGenerateThumbnails: boolean;
  darkMode: boolean;
  rootSize: number | null;
  cacheStats: CacheStats | null;
  cacheSettings: CacheSettingsData | null;
  showCachePanel: boolean;
  onNavigateHome: () => void;
  onNavigateTimeline: () => void;
  onNavigateTrash: () => void;
  onOpenQueue: () => void;
  onNavigateUsers: () => void;
  onNavigateAudit: () => void;
  onRefreshLibrary: () => void;
  onGenerateThumbnails: () => void;
  onUpload: () => void;
  onToggleDarkMode: () => void;
  onChangePassword: () => void;
  onToggleCachePanel: () => void;
  onClearCache: (type: "thumbnails" | "previews" | "hls" | "transcoded" | "all") => void;
  onSaveCacheSettings: (input: Partial<CacheSettingsData>) => Promise<void>;
  onLogout: () => void;
}

export function MobileNav({
  open,
  onToggle,
  onClose,
  user,
  queueBadgeCount,
  isRefreshing,
  isGeneratingThumbnails,
  canGenerateThumbnails,
  darkMode,
  rootSize,
  cacheStats,
  cacheSettings,
  showCachePanel,
  onNavigateHome,
  onNavigateTimeline,
  onNavigateTrash,
  onOpenQueue,
  onNavigateUsers,
  onNavigateAudit,
  onRefreshLibrary,
  onGenerateThumbnails,
  onUpload,
  onToggleDarkMode,
  onChangePassword,
  onToggleCachePanel,
  onClearCache,
  onSaveCacheSettings,
  onLogout,
}: MobileNavProps) {
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between px-4 py-4 bg-card/80 backdrop-blur-xs sticky top-0 z-20">
        <button type="button" onClick={onNavigateHome} className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl gradient-brand flex items-center justify-center">
            <Folder className="w-4 h-4 text-[#060e20]" />
          </div>
          <span className="font-manrope font-bold text-sm text-foreground">The Curator</span>
        </button>
        <button type="button" onClick={onToggle} className="p-2 rounded-xl bg-muted text-muted-foreground">
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <div className="relative w-64 bg-card h-full flex flex-col p-4 space-y-1 shadow-ambient">
            <SidebarNavItem icon={Folder} label="Collections" active onClick={act(onNavigateHome)} />
            <SidebarNavItem icon={CalendarDays} label="Timeline" onClick={act(onNavigateTimeline)} />
            {(user?.role === "admin" || user?.role === "editor") && (
              <SidebarNavItem icon={Trash2} label="Trash" onClick={act(onNavigateTrash)} />
            )}
            {(user?.role === "admin" || user?.role === "editor") && (
              <SidebarNavItem
                icon={ListTodo}
                label="Queue"
                onClick={act(onOpenQueue)}
                badge={queueBadgeCount || undefined}
              />
            )}
            {user?.role === "admin" && (
              <SidebarNavItem icon={Users} label="Users" onClick={act(onNavigateUsers)} />
            )}
            {user?.role === "admin" && (
              <SidebarNavItem icon={ScrollText} label="Audit" onClick={act(onNavigateAudit)} />
            )}
            <div className="pt-4 space-y-2">
              <button
                type="button"
                onClick={act(onRefreshLibrary)}
                disabled={isRefreshing}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-all disabled:opacity-50"
              >
                <RotateCcw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
                {isRefreshing ? "Refreshing…" : "Refresh Library"}
              </button>
              {(user?.role === "admin" || user?.role === "editor") && (
                <>
                  <button
                    type="button"
                    onClick={act(onGenerateThumbnails)}
                    disabled={isGeneratingThumbnails || !canGenerateThumbnails}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-all disabled:opacity-40"
                  >
                    <ImagePlus className="w-4 h-4" />
                    {isGeneratingThumbnails ? "Queuing…" : "Generate Thumbnails"}
                  </button>
                  <button
                    type="button"
                    onClick={act(onUpload)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity"
                  >
                    <Upload className="w-4 h-4" />
                    Upload Media
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={act(onToggleDarkMode)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-all"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                {darkMode ? "Light Mode" : "Dark Mode"}
              </button>
              <button
                type="button"
                onClick={act(onChangePassword)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-all"
              >
                <Key className="w-4 h-4" /> Change Password
              </button>
              {rootSize != null && rootSize > 0 && (
                <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-border/20 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 shrink-0" />
                    Media Total
                  </span>
                  <span className="font-mono">{formatBytes(rootSize)}</span>
                </div>
              )}
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
                      onClear={(type) => onClearCache(type)}
                      onSaveSettings={onSaveCacheSettings}
                    />
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={act(onLogout)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-all"
              >
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
