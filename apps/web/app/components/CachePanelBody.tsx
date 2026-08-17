import { useState } from "react";
import { formatBytes } from "~/lib/format";
import type { CacheSettingsData, CacheStats } from "~/lib/types";

const CACHE_LIMIT_FIELDS: Array<{ key: keyof CacheSettingsData; label: string; unit: string }> = [
  { key: "thumbnailCacheMaxMb", label: "Thumbnails", unit: "MB" },
  { key: "previewCacheMaxMb", label: "Previews", unit: "MB" },
  { key: "hlsCacheMaxMb", label: "HLS", unit: "MB" },
  { key: "transcodedCacheMaxMb", label: "Transcoded", unit: "MB" },
  { key: "previewCacheMaxAgeDays", label: "Preview age", unit: "days" },
  { key: "hlsCacheMaxAgeHours", label: "HLS age", unit: "hrs" },
];

interface CachePanelBodyProps {
  readonly cacheStats: CacheStats;
  readonly cacheSettings: CacheSettingsData | null;
  readonly onClear: (type: "thumbnails" | "previews" | "hls" | "transcoded" | "all") => void;
  readonly onSaveSettings: (input: Partial<CacheSettingsData>) => Promise<void>;
}

export function CachePanelBody({ cacheStats, cacheSettings, onClear, onSaveSettings }: CachePanelBodyProps) {
  const [showLimits, setShowLimits] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openEditor = () => {
    if (!showLimits && cacheSettings) {
      setDraft(Object.fromEntries(CACHE_LIMIT_FIELDS.map(({ key }) => [key, String(cacheSettings[key])])));
      setSaveError(null);
    }
    setShowLimits((p) => !p);
  };

  const handleSave = async () => {
    const input: Partial<CacheSettingsData> = {};
    for (const { key } of CACHE_LIMIT_FIELDS) {
      const value = Number.parseInt(draft[key] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) {
        setSaveError("All values must be positive numbers");
        return;
      }
      input[key] = value;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSaveSettings(input);
      setShowLimits(false);
    } catch (err: any) {
      setSaveError(err?.response?.errors?.[0]?.message ?? err?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-3 pb-3 pt-2 space-y-2 border-t border-border/20">
      {(["thumbnails", "previews", "hls", "transcoded"] as const).map((key) => {
        const s = cacheStats[key];
        const usage = s.maxBytes > 0 ? Math.min(100, (s.bytes / s.maxBytes) * 100) : 0;
        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground truncate">{s.label}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-foreground">
                  {formatBytes(s.bytes)}
                  <span className="text-muted-foreground"> / {formatBytes(s.maxBytes)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onClear(key)}
                  className="text-destructive hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="h-1 rounded-full bg-muted/60 overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${usage > 90 ? "bg-destructive" : "gradient-brand"}`}
                style={{ width: `${Math.max(usage, 2)}%` }}
              />
            </div>
          </div>
        );
      })}

      {cacheSettings && (
        <button
          type="button"
          onClick={openEditor}
          className="w-full text-xs text-muted-foreground border border-border/40 rounded-lg py-1.5 hover:text-foreground hover:bg-accent transition-colors"
        >
          {showLimits ? "Hide limits" : "Configure limits"}
        </button>
      )}

      {showLimits && cacheSettings && (
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            {CACHE_LIMIT_FIELDS.map(({ key, label, unit }) => (
              <label key={key} className="text-[10px] text-muted-foreground space-y-0.5 block">
                <span className="block truncate">{label} ({unit})</span>
                <input
                  type="number"
                  min={1}
                  value={draft[key] ?? ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="w-full px-2 py-1 rounded-lg bg-background border border-border/40 text-xs font-mono text-foreground focus:outline-hidden focus:border-brand-primary"
                />
              </label>
            ))}
          </div>
          {saveError && <p className="text-[10px] text-destructive">{saveError}</p>}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="w-full text-xs font-semibold gradient-brand text-[#060e20] rounded-lg py-1.5 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Limits"}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => onClear("all")}
        className="w-full text-xs text-destructive border border-destructive/40 rounded-lg py-1.5 hover:bg-destructive/10 transition-colors"
      >
        Clear All
      </button>
    </div>
  );
}
