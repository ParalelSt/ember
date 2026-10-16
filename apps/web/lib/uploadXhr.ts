import { API_BASE } from '@/lib/api';
import { sessionExpired } from '@/lib/sessionExpired';
import { guessFromFilename } from '@/lib/uploadName';
import type { UploadProgress } from '@/lib/uploadQueue';
import type { Track } from '@/types/track';

/** A song's length, read in the browser: the server cannot count on ffprobe
 *  (same as the upload form). 0 when the browser cannot tell, or takes
 *  longer than `timeoutMs`, so a file the browser cannot decode never holds
 *  the queue. */
export function readAudioDuration(file: File, timeoutMs = 4000): Promise<number> {
  return new Promise((resolve) => {
    if (typeof Audio === 'undefined' || typeof URL.createObjectURL !== 'function') {
      resolve(0);
      return;
    }
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;
    const done = (v: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(v) && v > 0 ? v : 0);
    };
    const timer = setTimeout(() => done(0), timeoutMs);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => done(audio.duration), { once: true });
    audio.addEventListener('error', () => done(0), { once: true });
    audio.src = url;
  });
}

/** POST /api/uploads for one file with XMLHttpRequest, which (unlike
 *  fetch) reports how many bytes of the body have gone out. Title and artist
 *  come from the file name, like the upload form's pre-fill; they can be
 *  fixed afterwards with Edit details. The server's own error message (too
 *  large, not audio, the hourly limit) is what the promise rejects with. */
export async function uploadSongXhr(file: File, { onProgress, signal }: UploadProgress): Promise<Track> {
  const durationSec = await readAudioDuration(file);
  if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
  const guess = guessFromFilename(file.name);

  const fd = new FormData();
  fd.append('file', file);
  fd.append('title', guess.title);
  fd.append('artist', guess.artist);
  fd.append('durationSec', String(Math.round(durationSec)));

  return new Promise<Track>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/uploads`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      // `loaded` counts the multipart body, a little over the file itself.
      if (e.lengthComputable && e.total > 0) onProgress(Math.round((e.loaded / e.total) * file.size));
    };
    xhr.onload = () => {
      let body: { track?: Track; error?: string } | null = null;
      try {
        body = JSON.parse(xhr.responseText) as { track?: Track; error?: string };
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.track) {
        resolve(body.track);
        return;
      }
      if (xhr.status === 401) sessionExpired();
      reject(new Error(body?.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Connection lost'));
    xhr.ontimeout = () => reject(new Error('Connection timed out'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(fd);
  });
}
