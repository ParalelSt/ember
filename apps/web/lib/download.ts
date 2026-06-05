import JSZip from 'jszip';
import { toast } from 'sonner';
import type { Track } from '@/types/track';

/** True if the track has a server-backed stream we can attach a download
 *  header to. Jamendo's stream URL is a cross-origin CDN — no clean way to
 *  force a filename without a server proxy of its own. */
export function isDownloadable(track: Track): boolean {
  return track.source === 'youtube';
}

function streamDownloadUrl(track: Track): string {
  const qs = new URLSearchParams({
    download: '1',
    title: track.title,
    artist: track.artist,
  });
  return `/api/youtube/stream/${encodeURIComponent(track.sourceId)}?${qs.toString()}`;
}

/** Triggers the browser to save a single track via an anchor click. The
 *  server sets Content-Disposition so the file lands with a nice name. */
export function downloadSingleTrack(track: Track): void {
  if (!isDownloadable(track)) {
    toast.error("This track's source doesn't support download");
    return;
  }
  const a = document.createElement('a');
  a.href = streamDownloadUrl(track);
  // Leave the `download` attr off — the server's Content-Disposition picks
  // the filename, including the correct extension we can't know client-side.
  a.target = '_self';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function sanitize(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150);
}

function extractFilenameFromHeader(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/.exec(disposition);
  return match ? decodeURIComponent(match[1]) : fallback;
}

interface DownloadPlaylistOptions {
  name: string;
  tracks: Track[];
}

/** Fetches every downloadable track in the playlist sequentially, builds
 *  a ZIP client-side, and triggers a browser save. Updates a sonner toast
 *  with progress; non-downloadable / failing tracks are skipped with a
 *  per-track warning toast. */
export async function downloadPlaylistAsZip({ name, tracks }: DownloadPlaylistOptions): Promise<void> {
  const downloadable = tracks.filter(isDownloadable);
  if (downloadable.length === 0) {
    toast.error('Nothing to download — this playlist has no YouTube tracks');
    return;
  }

  const zip = new JSZip();
  const toastId = toast.loading(`Downloading 0 of ${downloadable.length}…`);
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < downloadable.length; i++) {
    const t = downloadable[i];
    toast.loading(`Downloading ${i + 1} of ${downloadable.length} — ${t.title}`, { id: toastId });
    try {
      const res = await fetch(streamDownloadUrl(t), { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const filename = extractFilenameFromHeader(
        res.headers.get('content-disposition'),
        `${sanitize(t.artist)} - ${sanitize(t.title)}.m4a`,
      );
      zip.file(filename, blob);
      succeeded++;
    } catch (e) {
      failed++;
      toast.error(`Skipped "${t.title}": ${(e as Error).message}`);
    }
  }

  if (succeeded === 0) {
    toast.error('Download failed — no tracks could be fetched', { id: toastId });
    return;
  }

  toast.loading(`Packaging ${succeeded} tracks…`, { id: toastId });
  const zipBlob = await zip.generateAsync({ type: 'blob' });

  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitize(name) || 'playlist'}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  toast.success(
    failed > 0
      ? `Downloaded ${succeeded} tracks (${failed} skipped)`
      : `Downloaded ${succeeded} tracks`,
    { id: toastId },
  );
}
