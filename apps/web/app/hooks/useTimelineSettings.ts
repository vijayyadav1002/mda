import { useEffect, useRef, useState } from "react";
import { createGraphQLClient, getAuthToken } from "~/lib/api";

const TIMELINE_SETTINGS_QUERY = `
  query TimelineSettings { timelineSettings { dateSource } }
`;

const UPDATE_TIMELINE_DATE_SOURCE_MUTATION = `
  mutation UpdateTimelineDateSource($dateSource: String!) {
    updateTimelineDateSource(dateSource: $dateSource) { dateSource }
  }
`;

interface UseTimelineSettingsParams {
  /** Re-fetches the timeline from scratch after a date-source change is saved. */
  reloadTimeline: () => void;
  /** Shared toast opener used to report save success/failure. */
  showToast: (message: string, queueLink?: boolean) => void;
}

/**
 * Owns the admin-only timeline settings dropdown: its open/closed state, the
 * current `dateSource` (loaded on open) and its save-in-flight flag, the
 * outside-click-closes-menu behavior, and the `handleChangeDateSource`
 * mutation that persists a new date source and triggers a background reload.
 */
export function useTimelineSettings({ reloadTimeline, showToast }: UseTimelineSettingsParams) {
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [dateSource, setDateSource] = useState<string>("folder");
  const [dateSourceSaving, setDateSourceSaving] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  // Load current date source when the settings menu is first opened
  useEffect(() => {
    if (!showSettingsMenu) return;
    const token = getAuthToken();
    if (!token) return;
    createGraphQLClient(token)
      .request<{ timelineSettings: { dateSource: string } }>(TIMELINE_SETTINGS_QUERY)
      .then((data) => setDateSource(data.timelineSettings.dateSource))
      .catch(() => {});
  }, [showSettingsMenu]);

  // Close the settings menu on outside click
  useEffect(() => {
    if (!showSettingsMenu) return;
    const handler = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSettingsMenu]);

  const handleChangeDateSource = async (value: string) => {
    if (value === dateSource || dateSourceSaving) return;
    const token = getAuthToken();
    if (!token) return;
    setDateSourceSaving(true);
    try {
      const data = await createGraphQLClient(token).request<{ updateTimelineDateSource: { dateSource: string } }>(
        UPDATE_TIMELINE_DATE_SOURCE_MUTATION,
        { dateSource: value }
      );
      setDateSource(data.updateTimelineDateSource.dateSource);
      setShowSettingsMenu(false);
      showToast("Date source updated — re-dating library in the background…");
      // Give the backend a moment to recompute, then reload. Large libraries
      // may keep reshuffling for a while; scrolling refetches as needed.
      window.setTimeout(reloadTimeline, 4000);
    } catch (err: any) {
      showToast(`Failed to update date source: ${err?.response?.errors?.[0]?.message ?? err.message}`);
    } finally {
      setDateSourceSaving(false);
    }
  };

  return {
    showSettingsMenu,
    setShowSettingsMenu,
    dateSource,
    dateSourceSaving,
    settingsMenuRef,
    handleChangeDateSource,
  };
}
