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

interface AuditFilterBarProps {
  filterAction: string;
  setFilterAction: (v: string) => void;
  filterResourceType: string;
  setFilterResourceType: (v: string) => void;
  filterUserId: string;
  setFilterUserId: (v: string) => void;
  filterStartDate: string;
  setFilterStartDate: (v: string) => void;
  filterEndDate: string;
  setFilterEndDate: (v: string) => void;
  userOptions: UserOption[];
  onApply: () => void;
  onReset: () => void;
}

export function AuditFilterBar({
  filterAction, setFilterAction,
  filterResourceType, setFilterResourceType,
  filterUserId, setFilterUserId,
  filterStartDate, setFilterStartDate,
  filterEndDate, setFilterEndDate,
  userOptions,
  onApply,
  onReset,
}: AuditFilterBarProps) {
  return (
    <div className="bg-card rounded-2xl p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Action filter */}
        <div className="space-y-1">
          <label className="label-meta">Action</label>
          <select
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-hidden focus:border-brand-primary/80"
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
            className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-hidden focus:border-brand-primary/80"
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
            className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-hidden focus:border-brand-primary/80"
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
            className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-hidden focus:border-brand-primary/80"
          />
        </div>

        {/* Date to */}
        <div className="space-y-1">
          <label className="label-meta">To</label>
          <input
            type="date"
            value={filterEndDate}
            onChange={e => setFilterEndDate(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/20 text-foreground text-sm outline-hidden focus:border-brand-primary/80"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onApply}
          className="px-5 py-2 rounded-xl gradient-brand text-[#060e20] font-manrope font-bold text-sm shadow-ambient hover:opacity-90 transition-opacity"
        >
          Apply Filters
        </button>
        <button
          type="button"
          onClick={onReset}
          className="px-5 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
