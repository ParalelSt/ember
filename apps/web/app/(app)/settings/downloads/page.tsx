'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { clearAllDownloads, downloadPlaylist, pinLiked, LIKED_PIN } from '@/lib/offline';
import { useNativeOfflinePresent } from '@/lib/offlineNative';
import { QK } from '@/hooks/useLibrary';
import type { PinStatus } from '@/lib/offlineNative';
import type { Track } from '@/types/track';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function DownloadsSettingsPage() {
  const downloaded = useOfflineStore((s) => s.downloaded);
  const pins = useOfflineStore((s) => s.pins);
  const totalBytes = useOfflineStore((s) => s.totalBytes);
  const [pendingClear, setPendingClear] = useState(false);
  const qc = useQueryClient();
  const native = useNativeOfflinePresent();
  const count = native ? pins.length : downloaded.length;

  // Retries with whatever track list is already cached from browsing that
  // playlist/Liked this session — the native side clears `failed` on pin and
  // only re-fetches what's missing.
  const retry = async (pin: PinStatus) => {
    const tracks = pin.id === LIKED_PIN
      ? qc.getQueryData<Track[]>(QK.likes)
      : qc.getQueryData<{ tracks: Track[] }>(QK.playlist(pin.id))?.tracks;
    if (!tracks || tracks.length === 0) {
      toast.error('Open that playlist once while online, then retry.');
      return;
    }
    try {
      if (pin.id === LIKED_PIN) await pinLiked(tracks);
      else await downloadPlaylist({ id: pin.id, name: pin.name, created_at: '', artwork_url: null }, tracks);
    } catch (e) {
      toast.error(`Couldn't retry: ${(e as Error).message}`);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-xl font-bold tracking-tight">Downloads</h2>
        <p className="text-sm text-muted-foreground">
          Playlists pinned for offline playback are stored on this device.
        </p>
      </header>

      <div className="rounded-md bg-card px-4 py-3">
        <div className="text-2xl font-bold tabular-nums">{formatBytes(totalBytes)}</div>
        <div className="text-sm text-muted-foreground">
          Across {count} {count === 1 ? 'pin' : 'pins'}
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
