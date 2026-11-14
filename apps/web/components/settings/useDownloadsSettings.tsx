'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { clearAllDownloads, downloadPlaylist, pinList } from '@/lib/offline';
import { refFromPinId } from '@/lib/collections';
import { nativeRetry, useNativeOfflinePresent } from '@/lib/offlineNative';
import { QK } from '@/hooks/useLibrary';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import type { PinStatus } from '@/lib/offlineNative';
import type { Track } from '@/types/track';

/* Settings > Downloads, shared by the phone page (app/(app)/settings/
 * downloads) and the desktop rows section (components/settings/desktop):
 * the same stores, retry and clear. */

/** What the user can do about a pin that failed for good. The native side
 *  records the reason of the FIRST failure per pin (see OfflineDownloadService). */
const FAILED_REASON_TEXT: Record<string, string> = {
  auth: 'Sign in again',
  storage: 'Not enough storage',
  http: 'Download error',
};

/** "3/10 downloaded, 2 failed (Not enough storage)". */
export function pinProgressText(p: PinStatus): string {
  const failed = p.failed > 0 ? `, ${p.failed} failed` : '';
  const reason = p.failed > 0 && p.failedReason && FAILED_REASON_TEXT[p.failedReason] ? ` (${FAILED_REASON_TEXT[p.failedReason]})` : '';
  return `${p.done}/${p.total} downloaded${failed}${reason}`;
}

export const DOWNLOADS_NATIVE_TEXT = 'Playlists pinned for offline playback are stored on this device.';
export const DOWNLOADS_BROWSER_TEXT =
  'Plays offline while Ember stays open in this tab. A reload or a fully offline launch needs the internet back first.';

export function useDownloadsSettings() {
  const downloaded = useOfflineStore((s) => s.downloaded);
  const pins = useOfflineStore((s) => s.pins);
  const totalBytes = useOfflineStore((s) => s.totalBytes);
  const [pendingClear, setPendingClear] = useState(false);
  const qc = useQueryClient();
  const cacheBytes = useAutoCacheStore((s) => s.stats.bytes);
  const native = useNativeOfflinePresent();
  const count = native ? pins.length : downloaded.length;

  // Native: the plugin re-queues the pin's failed tracks itself from its own
  // index, no track list from JS needed. Browser storage has no such call, so
  // it still needs a track list already cached from browsing that
  // playlist/Liked this session.
  const retry = async (pin: PinStatus) => {
    if (native) {
      try {
        useOfflineStore.getState().setNativeStatus(await nativeRetry(pin.id));
      } catch (e) {
        toast.error(`Couldn't retry: ${(e as Error).message}`);
      }
      return;
    }
    const ref = refFromPinId(pin.id);
    const tracks =
      ref.kind === 'liked' ? qc.getQueryData<Track[]>(QK.likes)
      : ref.kind === 'recent' ? qc.getQueryData<Track[]>(QK.history)
      : ref.kind === 'uploads' ? qc.getQueryData<Track[]>(QK.uploads)
      : qc.getQueryData<{ tracks: Track[] }>(QK.playlist(ref.id))?.tracks;
    if (!tracks || tracks.length === 0) {
      toast.error('Open that collection once while online, then retry.');
      return;
    }
    try {
      if (ref.kind === 'playlist') await downloadPlaylist({ id: ref.id, name: pin.name, created_at: '', artwork_url: null }, tracks);
      else await pinList(pin.id, pin.name, tracks);
    } catch (e) {
      toast.error(`Couldn't retry: ${(e as Error).message}`);
    }
  };

  return { pins, totalBytes, cacheBytes, native, count, retry, pendingClear, setPendingClear };
}

/** "Clear all downloads?", asked before every offline pin is removed. */
export function ClearDownloadsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Clear all downloads?"
      description="This removes every offline-pinned playlist from this device. The originals on the server are untouched."
      confirmLabel="Clear downloads"
      variant="destructive"
      onConfirm={async () => {
        try {
          await clearAllDownloads();
          toast.success('Downloads cleared');
          onOpenChange(false);
        } catch (e) {
          toast.error(`Couldn't clear: ${(e as Error).message}`);
          throw e;
        }
      }}
    />
  );
}
