import { useEffect, useState } from "react";
import { getApiUrl, getAuthToken } from "~/lib/api";

const TERMINAL_STATUSES = new Set(["done", "error"]);

export function useActiveQueueCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;
    const apiUrl = getApiUrl();

    let cancelled = false;
    let intervalId: number | null = null;

    const fetchCount = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/queue-state`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const { queue } = await res.json();
        if (cancelled) return;
        const active = Array.isArray(queue)
          ? queue.filter((j: { status?: string }) => !TERMINAL_STATUSES.has(j.status ?? "")).length
          : 0;
        setCount(active);
      } catch {
        // ignore — sidebar badge is non-critical
      }
    };

    fetchCount();
    intervalId = window.setInterval(fetchCount, 5000);

    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, []);

  return count;
}
