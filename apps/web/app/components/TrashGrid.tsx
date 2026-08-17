import { CheckSquare, Clock, File, FileText, Folder, Play, Square } from "lucide-react";
import type { TrashItem } from "~/hooks/useTrashItems";

const formatSize = (bytes: string | null): string => {
  if (!bytes) return "";
  const n = parseInt(bytes);
  if (!Number.isFinite(n)) return "";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const daysLeft = (expiresAt: string): number =>
  Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

const dayLabel = (key: string): string => {
  const today = new Date();
  const toKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (key === toKey(today)) return "Deleted today";
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (key === toKey(yesterday)) return "Deleted yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return `Deleted ${new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
};

function TileIcon({ item }: Readonly<{ item: TrashItem }>) {
  if (item.itemType === "folder") return <Folder className="w-8 h-8 text-muted-foreground/40" />;
  if (item.mimeType?.startsWith("video/")) return <Play className="w-8 h-8 text-muted-foreground/40" />;
  if (item.mimeType?.startsWith("image/")) return <File className="w-8 h-8 text-muted-foreground/40" />;
  return <FileText className="w-8 h-8 text-muted-foreground/40" />;
}

interface TrashGridProps {
  sections: [string, TrashItem[]][];
  selectedIds: Set<string>;
  apiUrl: string;
  onToggleItem: (id: string) => void;
  onToggleSection: (sectionItems: TrashItem[]) => void;
}

export function TrashGrid({ sections, selectedIds, apiUrl, onToggleItem, onToggleSection }: TrashGridProps) {
  return (
    <>
      {sections.map(([dayKey, sectionItems]) => {
        const allSelected = sectionItems.every((i) => selectedIds.has(i.id));
        return (
          <section key={dayKey}>
            <div className="flex items-baseline gap-2 pt-4 pb-2">
              <h2 className="font-manrope font-bold text-base md:text-lg">{dayLabel(dayKey)}</h2>
              <span className="text-xs text-muted-foreground font-mono">{sectionItems.length}</span>
              <button
                type="button"
                onClick={() => onToggleSection(sectionItems)}
                className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium text-brand-primary hover:bg-accent transition-colors"
              >
                {allSelected ? (
                  <><Square className="w-3 h-3" /> Unselect all</>
                ) : (
                  <><CheckSquare className="w-3 h-3" /> Select all</>
                )}
              </button>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
              {sectionItems.map((item) => {
                const isSelected = selectedIds.has(item.id);
                const left = daysLeft(item.expiresAt);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onToggleItem(item.id)}
                    className={`relative text-left rounded-xl overflow-hidden bg-card border transition-all focus:outline-hidden ${
                      isSelected ? "border-brand-primary ring-2 ring-brand-primary" : "border-border/20 hover:border-border/50"
                    }`}
                    title={item.originalPath}
                  >
                    <span className="absolute top-1.5 left-1.5 z-10">
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-brand-primary drop-shadow-sm bg-black/40 rounded-sm" />
                      ) : (
                        <Square className="w-4 h-4 text-white/80 drop-shadow-sm" />
                      )}
                    </span>
                    {isSelected && <span className="absolute inset-0 bg-brand-primary/15 z-[5] pointer-events-none" />}

                    <div className="aspect-square bg-muted/40 flex items-center justify-center overflow-hidden">
                      {item.thumbnailUrl ? (
                        <img
                          src={`${apiUrl}${item.thumbnailUrl}`}
                          alt={item.fileName}
                          loading="lazy"
                          className="w-full h-full object-cover"
                          onError={(e) => { e.currentTarget.style.display = "none"; }}
                        />
                      ) : (
                        <TileIcon item={item} />
                      )}
                    </div>

                    <div className="p-2">
                      <p className="text-xs font-medium text-foreground truncate">{item.fileName}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5 shrink-0" />
                        {left} day{left !== 1 ? "s" : ""} left{item.fileSize ? ` · ${formatSize(item.fileSize)}` : ""}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
