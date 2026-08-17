import { User, ChevronDown, ChevronUp } from "lucide-react";
import type { AuditLog } from "~/hooks/useAuditLogs";

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

interface AuditLogTableProps {
  logs: AuditLog[];
  loading: boolean;
  expandedDetails: Set<string>;
  onToggleDetails: (id: string) => void;
}

export function AuditLogTable({ logs, loading, expandedDetails, onToggleDetails }: AuditLogTableProps) {
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
              <p className="text-xs text-muted-foreground lg:pt-0.5 shrink-0">
                {formatDate(log.createdAt)}
              </p>

              {/* User */}
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0">
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
                      onClick={() => onToggleDetails(log.id)}
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
  );
}
