'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { DownloadButtonProps } from '@/components/library/DownloadButton';
import { pinIdFor, type CollectionRef } from '@/lib/collections';
import { cancelDownload, downloadPlaylist, isStale, pinList, playableFor, removeDownload } from '@/lib/offline';
import { nativeOfflinePresent, useNativeOfflinePresent, useOfflineDownloadAllowed } from '@/lib/offlineNative';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { useOnline } from '@/lib/useOnline';
import type { Track } from '@/types/track';

/** Offline pin state and actions for one collection, shaped as
 *  DownloadButtonProps (or null when offline downloads aren't available
 *  here). System lists (Liked, Recent, Uploads) can only be pinned through
 *  the native plugin; a playlist can also fall back to browser storage. */
export function useOfflinePin(ref: CollectionRef, name: string, tracks: Track[]): DownloadButtonProps | null {
  const isOnline = useOnline();
  // Read through useSyncExternalStore so the server render and the first
  // client paint agree (the button would otherwise flicker in on hydration).
  const nativePresent = useNativeOfflinePresent();
  const browserAllowed = useOfflineDownloadAllowed();
  const available = ref.kind === 'playlist' ? browserAllowed : nativePresent;
  const id = pinIdFor(ref);
  const downloaded = useOfflineStore((s) => s.downloaded.includes(id));
  const inFlight = useOfflineStore((s) => s.inFlight[id]);
  const [stale, setStale] = useState(false);

  // Compared against what a pin actually holds: `downloadPlaylist`/`pinList`
  // skip unavailable tracks, so comparing against every track id would
  // report a healthy pin as permanently stale.
  useEffect(() => {
    if (!downloaded || !isOnline || !tracks.length) return;
    let cancelled = false;
    isStale(id, playableFor(tracks).map((t) => t.id))
      .then((s) => { if (!cancelled) setStale(s); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [downloaded, isOnline, id, tracks]);

  const save = () =>
    ref.kind === 'playlist'
      ? downloadPlaylist({ id: ref.id, name, created_at: '', artwork_url: null }, tracks)
      : pinList(id, name, tracks);

  const onDownload = async () => {
    try {
      await save();
      const skipped = tracks.length - playableFor(tracks).length;
      const note = skipped > 0 ? `, ${skipped} unavailable skipped` : '';
      // Native pin() resolves as soon as the pin is recorded, before a
      // single byte lands, so promising "Downloaded" there is a lie.
      toast.success(`${nativeOfflinePresent() ? `Downloading "${name}"` : `Downloaded "${name}"`}${note}`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        toast.error(`Couldn't download "${name}", please try again.`);
      }
    }
  };

  const onUpdate = async () => {
    try {
      await save();
      setStale(false);
      toast.success(`Updated "${name}"`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        toast.error(`Couldn't download "${name}", please try again.`);
      }
    }
  };

  const onRemove = async () => {
    try {
      await removeDownload(id);
      toast.success(`Removed offline copy of "${name}"`);
    } catch {
      toast.error(`Couldn't remove that, please try again.`);
    }
  };

  if (!available) return null;

  return {
    state: inFlight ? 'downloading' : downloaded ? (stale ? 'stale' : 'downloaded') : 'idle',
    progress: inFlight ? { current: inFlight.current, total: inFlight.total } : undefined,
    disabled: tracks.length === 0,
    onDownload,
    onCancel: () => cancelDownload(id),
    onRemove,
    onUpdate,
  };
}
