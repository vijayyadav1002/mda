import { Pencil, Tag as TagIcon, Trash2, X } from "lucide-react";
import type { RefObject } from "react";
import type { TagSuggestion } from "~/hooks/useTagInput";

interface TagFilterMenuProps {
  tagSuggestions: TagSuggestion[];
  showTagFilterMenu: boolean;
  activeTagFilter: string | null;
  tagFilterMenuRef: RefObject<HTMLDivElement>;
  tagFilterTriggerRef: RefObject<HTMLButtonElement>;
  tagFilterMenuRight: number;
  userRole: string | undefined;
  onToggleMenu: () => void;
  onClearFilter: () => void;
  onApplyFilter: (tagName: string) => void;
  onRenameTag: (tagName: string) => void;
  onDeleteTag: (tagName: string) => void;
}

export function TagFilterMenu({
  tagSuggestions,
  showTagFilterMenu,
  activeTagFilter,
  tagFilterMenuRef,
  tagFilterTriggerRef,
  tagFilterMenuRight,
  userRole,
  onToggleMenu,
  onClearFilter,
  onApplyFilter,
  onRenameTag,
  onDeleteTag,
}: TagFilterMenuProps) {
  return (
    <div className="relative" ref={tagFilterMenuRef}>
      <button
        ref={tagFilterTriggerRef}
        type="button"
        onClick={onToggleMenu}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all ${
          activeTagFilter
            ? "text-brand-primary bg-brand-primary/10"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
        }`}
        title={activeTagFilter ? `Filtered by #${activeTagFilter}` : "Filter by tag"}
      >
        <TagIcon className="w-4 h-4" />
        <span className="hidden sm:inline">
          {activeTagFilter ? `#${activeTagFilter}` : "Tags"}
        </span>
        {activeTagFilter && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onClearFilter(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onClearFilter();
              }
            }}
            className="ml-1 hover:bg-brand-primary/20 rounded-full p-0.5 cursor-pointer"
            aria-label="Clear tag filter"
          >
            <X className="w-3 h-3" />
          </span>
        )}
      </button>
      {showTagFilterMenu && (
        <div
          className="absolute top-full mt-1 w-64 max-w-[calc(100vw-1rem)] bg-card border border-border/20 rounded-xl shadow-ambient z-50 py-1 max-h-80 overflow-y-auto"
          style={{ right: tagFilterMenuRight }}
        >
          {tagSuggestions.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              No tags yet. Select files and apply a tag to start.
            </p>
          ) : (
            tagSuggestions.map((tag) => {
              const canEdit = userRole === "admin" || userRole === "editor";
              return (
                <div
                  key={tag.id}
                  className={`group flex items-center px-2 transition-colors ${
                    activeTagFilter === tag.name ? "bg-accent" : "hover:bg-accent"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onApplyFilter(tag.name)}
                    className={`flex-1 flex items-center justify-between px-2 py-2 text-sm text-left ${
                      activeTagFilter === tag.name
                        ? "text-brand-primary font-medium"
                        : "text-muted-foreground group-hover:text-foreground"
                    }`}
                  >
                    <span>#{tag.name}</span>
                    <span className="text-xs">{tag.assetCount}</span>
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRenameTag(tag.name); }}
                      className="p-1.5 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-background transition-all"
                      title={`Rename #${tag.name}`}
                      aria-label={`Rename ${tag.name}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {userRole === "admin" && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDeleteTag(tag.name); }}
                      className="p-1.5 rounded-lg text-destructive opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all"
                      title={`Delete #${tag.name}`}
                      aria-label={`Delete ${tag.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
