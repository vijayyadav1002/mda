import { ImageIcon } from "lucide-react";
import type { Bucket } from "~/hooks/useTimelineSections";

export function CoverMosaic({
  covers,
  fallbackLabel,
  apiUrl,
}: {
  covers: Bucket["coverAssets"];
  fallbackLabel: string;
  apiUrl: string;
}) {
  const withThumbs = covers.filter((c) => c.thumbnailUrl);

  // No usable cover images (thumbnails not generated yet, or still loading):
  // render a decorative "photo stack" card so the tile never looks broken.
  if (withThumbs.length === 0) {
    return (
      <div className="relative w-full aspect-square rounded-xl overflow-hidden border border-border/20 bg-gradient-to-br from-brand-primary/20 via-muted/50 to-transparent">
        {/* Stacked-photos motif */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-1/2 aspect-square">
            <div className="absolute inset-0 rounded-lg bg-card/70 border border-border/40 rotate-[-8deg]" />
            <div className="absolute inset-0 rounded-lg bg-card/80 border border-border/40 rotate-[5deg]" />
            <div className="absolute inset-0 rounded-lg bg-card border border-border/50 flex items-center justify-center">
              <ImageIcon className="w-1/3 h-1/3 text-muted-foreground/40" />
            </div>
          </div>
        </div>
        <span className="absolute bottom-2 right-3 font-manrope font-bold text-2xl text-foreground/15 select-none">
          {fallbackLabel}
        </span>
      </div>
    );
  }

  const cells = withThumbs.length >= 4 ? withThumbs.slice(0, 4) : withThumbs.slice(0, 1);
  return (
    <div className={`grid ${cells.length === 4 ? "grid-cols-2" : "grid-cols-1"} gap-0.5 w-full aspect-square overflow-hidden rounded-xl bg-muted/40`}>
      {cells.map((c) => (
        <div key={c.id} className="relative overflow-hidden">
          <img
            src={`${apiUrl}${c.thumbnailUrl}`}
            alt={c.fileName}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        </div>
      ))}
    </div>
  );
}
