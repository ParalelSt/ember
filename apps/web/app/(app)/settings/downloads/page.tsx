'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { clearAllDownloads, downloadPlaylist, pinList } from '@/lib/offline';
import { refFromPinId } from '@/lib/collections';
import { nativeRetry, useNativeOfflinePresent } from '@/lib/offlineNative';
import { QK } from '@/hooks/useLibrary';
import { formatBytes, formatCount } from '@/lib/format';
import type { PinStatus } from '@/lib/offlineNative';
import type { Track } from '@/types/track';
import { SectionHeader } from '@/components/page/SectionHeader';

/** What the user can do about a pin that failed for good. The native side
 *  records the reason of the FIRST failure per pin (see OfflineDownloadService). */
const FAILED_REASON_TEXT: Record<string, string> = {
  auth: 'Sign in again',
  storage: 'Not enough storage',
  http: 'Download error',
};

export default function DownloadsSettingsPage() {
  const downloaded = useOfflineStore((s) => s.downloaded);
  const pins = useOfflineStore((s) => s.pins);
  const totalBytes = useOfflineStore((s) => s.totalBytes);
  const [pendingClear, setPendingClear] = useState(false);
  const qc = useQueryClient();
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

  return (
    <section className="space-y-6">
      <header>
        <SectionHeader title="Downloads" />
        <p className="text-meta">
          Playlists pinned for offline playback are stored on this device.
        </p>
      </header>

      <div className="rounded-md bg-card px-4 py-3">
        <div className="text-2xl font-bold tabular-nums">{formatBytes(totalBytes)}</div>
        <div className="text-meta">
          Across {formatCount(count, 'pin')}
        </div>
      </div>

      {native && pins.length > 0 && (
        <ul className="space-y-2" data-testid="offline-pins">
          {pins.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 rounded-md bg-card px-4 py-3">
              <div>
                <div className="text-sm font-semibold">{p.name}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {p.done}/{p.total} downloaded{p.failed > 0 ? `, ${p.failed} failed` : ''}
                  {p.failed > 0 && p.failedReason && FAILED_REASON_TEXT[p.failedReason]
                    ? ` (${FAILED_REASON_TEXT[p.failedReason]})`
                    : ''}
                </div>
              </div>
              {p.failed > 0 && (
                <Button variant="outline" size="sm" onClick={() => retry(p)}>
                  Retry
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="outline"
        onClick={() => setPendingClear(true)}
        disabled={count === 0}
        className="text-destructive hover:text-destructive"
      >
        Clear all downloads
      </Button>

      <ConfirmDialog
        open={pendingClear}
        onOpenChange={setPendingClear}
        title="Clear all downloads?"
        description="This removes every offline-pinned playlist from this device. The originals on the server are untouched."
        confirmLabel="Clear downloads"
        variant="destructive"
        onConfirm={async () => {
          try {
            await clearAllDownloads();
            toast.success('Downloads cleared');
            setPendingClear(false);
          } catch (e) {
            toast.error(`Couldn't clear: ${(e as Error).message}`);
            throw e;
          }
        }}
      />
    </section>
  );
}
