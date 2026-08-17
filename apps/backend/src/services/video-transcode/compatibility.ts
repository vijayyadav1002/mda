import path from 'node:path';
import ffmpeg from 'fluent-ffmpeg';

// Web-compatible video codecs
const WEB_COMPATIBLE_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const WEB_COMPATIBLE_CONTAINERS = new Set(['.mp4', '.webm']);

interface VideoInfo {
  codec: string;
  container: string;
  needsTranscoding: boolean;
}

/**
 * Check if a video needs transcoding for web playback
 */
export async function checkVideoCompatibility(videoPath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const container = path.extname(videoPath).toLowerCase();
      const codec = videoStream?.codec_name || 'unknown';

      const needsTranscoding =
        !WEB_COMPATIBLE_CODECS.has(codec.toLowerCase()) ||
        !WEB_COMPATIBLE_CONTAINERS.has(container);

      resolve({
        codec,
        container,
        needsTranscoding
      });
    });
  });
}
