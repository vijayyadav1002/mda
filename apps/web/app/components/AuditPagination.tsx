import type { Dispatch, SetStateAction } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface AuditPaginationProps {
  page: number;
  totalPages: number;
  total: number;
  loading: boolean;
  setPage: Dispatch<SetStateAction<number>>;
}

export function AuditPagination({ page, totalPages, total, loading, setPage }: AuditPaginationProps) {
  if (loading || total === 0) return null;

  return (
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
  );
}
