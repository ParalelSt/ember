'use client';

import { Button } from '@/components/ui/button';
import { DownloadIcon } from '@/components/icons';
import { EmptyState } from '@/components/page/EmptyState';
import { SectionHeader } from '@/components/page/SectionHeader';
import { StorageBar } from '@/components/settings/StorageBar';
import { AutoCacheSettings } from '@/components/settings/AutoCacheSettings';
import {
  ClearDownloadsDialog,
  DOWNLOADS_BROWSER_TEXT,
  DOWNLOADS_NATIVE_TEXT,
  pinProgressText,
  useDownloadsSettings,
} from '@/components/settings/useDownloadsSettings';

/** Settings > Downloads on a phone (desktop draws the same as rows, see
 *  components/settings/desktop/DownloadsSection). */
export default function DownloadsSettingsPage() {
  const { pins, totalBytes, cacheBytes, native, count, retry, pendingClear, setPendingClear } = useDownloadsSettings();

  return (
    <section className="space-y-6">
      <header>
        <SectionHeader title="Downloads" />
        <p className="text-meta">
          {native ? DOWNLOADS_NATIVE_TEXT : DOWNLOADS_BROWSER_TEXT}
        </p>
      </header>

      <StorageBar downloadsBytes={totalBytes} cacheBytes={cacheBytes} canEstimate={!native} />

      {native && pins.length > 0 && (
        <ul className="space-y-2" data-testid="offline-pins">
          {pins.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 rounded-md bg-card px-4 py-3">
              <div>
                <div className="text-sm font-semibold">{p.name}</div>
                <div className="text-xs text-muted-foreground tabular-nums">{pinProgressText(p)}</div>
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

      {count === 0 && (
        <EmptyState
          icon={<DownloadIcon />}
          title="No downloads yet"
          action={{ label: 'Go to Library', href: '/library' }}
        >
          Open a playlist and tap Download for offline to keep it on this device.
        </EmptyState>
      )}

      <Button
        variant="outline"
        onClick={() => setPendingClear(true)}
        disabled={count === 0}
        className="text-destructive hover:text-destructive"
      >
        Clear all downloads
      </Button>

      <div className="flex flex-col gap-block">
        <SectionHeader title="Automatic caching" />
        <AutoCacheSettings />
      </div>

      <ClearDownloadsDialog open={pendingClear} onOpenChange={setPendingClear} />
    </section>
  );
}
