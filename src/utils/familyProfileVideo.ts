export const MAX_PROFILE_VIDEO_BYTES = 8 * 1024 * 1024;
export const MAX_PROFILE_VIDEO_SECONDS = 10;

export async function validateProfileVideo(file: File): Promise<void> {
  if (!['video/mp4', 'video/webm'].includes(file.type)) throw new Error('Choose an MP4 or WebM video.');
  if (!file.size || file.size > MAX_PROFILE_VIDEO_BYTES) throw new Error('Choose a video of 8 MB or less.');

  const source = URL.createObjectURL(file);
  const video = document.createElement('video');
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Could not read this video. Try another clip.')), 8000);
      video.onloadedmetadata = () => {
        window.clearTimeout(timer);
        if (!video.videoWidth || !Number.isFinite(video.duration) || video.duration <= 0) {
          reject(new Error('Could not read this video. Try another clip.'));
        } else if (video.duration > MAX_PROFILE_VIDEO_SECONDS) {
          reject(new Error('Choose a video of 10 seconds or less.'));
        } else {
          resolve();
        }
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('Could not read this video. Try another clip.'));
      };
      video.preload = 'metadata';
      video.src = source;
    });
  } finally {
    video.onloadedmetadata = null;
    video.onerror = null;
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(source);
  }
}
