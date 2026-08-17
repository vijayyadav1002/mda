import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";

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

export interface AuditLog {
  id: string;
  userId: string;
  user: { id: string; username: string; role: string } | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: string | null;
  createdAt: string;
}

interface UseAuditLogsParams {
  /**
   * Setter for the page-level error banner. Owned by the caller (rather than
   * this hook) because the same banner/state is also written to by the
   * page's own current-user/init fetch, so both flows must share one setter
   * to preserve the original single-error-state behavior.
   */
  setError: Dispatch<SetStateAction<string>>;
  /**
   * Invoked whenever filters are applied or reset, so the caller can clear
   * its own expanded-details UI state alongside the new result set, without
   * this hook needing to know about that unrelated piece of UI state.
   */
  onFiltersApplied: () => void;
}

/**
 * Owns audit-log fetching, pagination, and the filter draft/applied state for
 * the audit page.
 */
export function useAuditLogs({ setError, onFiltersApplied }: UseAuditLogsParams) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const [filterAction, setFilterAction] = useState("");
  const [filterResourceType, setFilterResourceType] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  const [appliedFilters, setAppliedFilters] = useState<{
    action: string; resourceType: string; userId: string; startDate: string; endDate: string;
  }>({ action: "", resourceType: "", userId: "", startDate: "", endDate: "" });

  useEffect(() => {
    fetchLogs();
  }, [page, appliedFilters]);

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
    onFiltersApplied();
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
    onFiltersApplied();
    setAppliedFilters({ action: "", resourceType: "", userId: "", startDate: "", endDate: "" });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    logs, total, page, setPage, loading,
    filterAction, setFilterAction,
    filterResourceType, setFilterResourceType,
    filterUserId, setFilterUserId,
    filterStartDate, setFilterStartDate,
    filterEndDate, setFilterEndDate,
    applyFilters, resetFilters,
    totalPages,
    fetchLogs,
  };
}
