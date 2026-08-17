import ffmpeg from 'fluent-ffmpeg';

export function parseTimemarkToSeconds(timemark: string): number {
  // FFmpeg timemark format: "HH:MM:SS.ms"
  const parts = timemark.split(':');
  if (parts.length !== 3) return 0;
  const hours = Number.parseFloat(parts[0]) || 0;
  const minutes = Number.parseFloat(parts[1]) || 0;
  const seconds = Number.parseFloat(parts[2]) || 0;
  return hours * 3600 + minutes * 60 + seconds;
}

export async function probeDurationSeconds(videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err || !metadata?.format?.duration) {
        resolve(0);
        return;
      }
      resolve(Number(metadata.format.duration) || 0);
    });
  });
}
