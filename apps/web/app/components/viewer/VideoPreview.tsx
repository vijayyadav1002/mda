export interface TranscodeProgress {
  percent: number;
  status: string;
  playlistReady?: boolean;
}

interface VideoPreviewProps {
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  readonly transcodeProgress: TranscodeProgress | null;
  readonly isFullscreen: boolean;
}

export function VideoPreview({ videoRef, transcodeProgress, isFullscreen }: Readonly<VideoPreviewProps>) {
  return (
    <div
      className={
        isFullscreen
          ? "relative flex items-center justify-center"
          : "relative w-full h-full flex items-center justify-center"
      }
    >
      <video
        ref={videoRef}
        controls
        autoPlay={isFullscreen}
        className={
          isFullscreen
            ? "max-w-full max-h-[calc(100vh-120px)] object-contain"
            : "w-full h-full object-contain max-h-[40vh] md:max-h-[90vh]"
        }
        preload="metadata"
      >
        <track kind="captions" />
      </video>
      {transcodeProgress && transcodeProgress.status !== "ready" && transcodeProgress.status !== "unknown" && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-xs text-white">
          <p className="font-manrope font-semibold mb-3">
            {transcodeProgress.status === "queued" ? "Preparing video…" : "Transcoding for playback"}
          </p>
          <div className="w-64 h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-400 transition-[width] duration-500"
              style={{ width: `${Math.max(2, Math.round(transcodeProgress.percent))}%` }}
            />
          </div>
          <p className="text-xs text-white/70 mt-2">
            {Math.round(transcodeProgress.percent)}% — playback will start automatically when ready
          </p>
        </div>
      )}
    </div>
  );
}
