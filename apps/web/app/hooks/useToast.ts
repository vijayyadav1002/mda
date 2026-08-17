import { useCallback, useEffect, useState } from "react";

/**
 * Shared toast notification state used to surface transient status
 * messages (tag apply/remove, queue actions, date-source updates, etc).
 * Owns the toast content/visibility and the `showToast` opener with its
 * auto-dismiss timer; rendering the actual toast UI stays in the caller,
 * which wires `toast`/`setToast` to its markup.
 */
export function useToast() {
  const [toast, setToast] = useState<{ message: string; queueLink?: boolean } | null>(null);

  const showToast = useCallback((message: string, queueLink = false) => {
    setToast({ message, queueLink });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return { toast, setToast, showToast };
}
