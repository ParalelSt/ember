'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { clearAllDownloads } from '@/lib/offline';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function DownloadsSettingsPage() {
  const downloaded = useOfflineStore((s) => s.downloaded);
  const totalBytes = useOfflineStore((s) => s.totalBytes);
  const [pendingClear, setPendingClear] = useState(false);

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
          Across {downloaded.length} {downloaded.length === 1 ? 'playlist' : 'playlists'}
        </div>
      </div>

      <Button
        variant="outline"
        onClick={() => setPendingClear(true)}
        disabled={downloaded.length === 0}
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
