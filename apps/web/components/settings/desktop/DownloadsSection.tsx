'use client';

import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { DownloadIcon } from '@/components/icons';
import { StorageBar } from '@/components/settings/StorageBar';
import {
  AUTO_CACHE_DESCRIPTION,
  AUTO_CACHE_UNAVAILABLE_TEXT,
  AUTO_CACHE_UPDATE_APP_TEXT,
  useAutoCacheControls,
} from '@/components/settings/AutoCacheSettings';
import {
  ClearDownloadsDialog,
  DOWNLOADS_BROWSER_TEXT,
  DOWNLOADS_NATIVE_TEXT,
  pinProgressText,
  useDownloadsSettings,
} from '@/components/settings/useDownloadsSettings';
import { formatBytes, formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SettingsGroup, SettingsRow, SettingsSwitchRow } from './rows';

/** The automatic cache as rows: its switch, then what it holds with Clear. */
function AutoCacheRows() {
  const { enabled, setEnabled, supported, needsAppUpdate, stats, clearing, onClear } = useAutoCacheControls();
  return (
    <SettingsGroup title="Automatic caching" testId="auto-cache-settings">
      <SettingsSwitchRow
        title="Cache upcoming songs"
        description={AUTO_CACHE_DESCRIPTION}
        checked={enabled}
        disabled={!supported}
        onCheckedChange={() => setEnabled(!enabled)}
      />
      {supported ? (
        <SettingsRow
          title="Cached songs"
          description={
            <span className="tabular-nums" data-testid="auto-cache-stats">
              Cached: {formatBytes(stats.bytes)}, {formatCount(stats.count, 'song')}
            </span>
          }
          control={
            <Button variant="outline" onClick={() => void onClear()} disabled={clearing || stats.count === 0}>
              Clear cached songs
            </Button>
          }
        />
      ) : (
        <SettingsRow
          title="Not available here"
          description={<span data-testid="auto-cache-unavailable">{needsAppUpdate ? AUTO_CACHE_UPDATE_APP_TEXT : AUTO_CACHE_UNAVAILABLE_TEXT}</span>}
        />
      )}
    </SettingsGroup>
  );
}

/** Desktop Settings > Downloads as rows: the same stores, retry and clear
 *  as the phone page (app/(app)/settings/downloads). */
export function DownloadsSection() {
  const { pins, totalBytes, cacheBytes, native, count, retry, pendingClear, setPendingClear } = useDownloadsSettings();
  return (
    <div className="flex flex-col gap-section">
      <SettingsGroup title="Storage" footer={native ? DOWNLOADS_NATIVE_TEXT : DOWNLOADS_BROWSER_TEXT}>
        <StorageBar bare downloadsBytes={totalBytes} cacheBytes={cacheBytes} canEstimate={!native} />
      </SettingsGroup>

      <SettingsGroup title="Downloads" testId="offline-pins">
        {native &&
          pins.map((p) => (
            <SettingsRow
              key={p.id}
              title={p.name}
              description={<span className="tabular-nums">{pinProgressText(p)}</span>}
              control={
                p.failed > 0 ? (
                  <Button variant="outline" onClick={() => void retry(p)}>
                    Retry
                  </Button>
                ) : undefined
              }
            />
          ))}
        {count === 0 && (
          <SettingsRow
            leading={
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                <DownloadIcon className="size-5" />
              </span>
            }
            title="No downloads yet"
            description="Open a playlist and tap Download for offline to keep it on this device."
            control={
              <Link href="/library" className={cn(buttonVariants({ variant: 'outline' }))}>
                Go to Library
              </Link>
            }
          />
        )}
        <SettingsRow
          title="Clear all downloads"
          description="Removes every offline-pinned playlist from this device."
          control={
            <Button
              variant="outline"
              onClick={() => setPendingClear(true)}
              disabled={count === 0}
              className="text-destructive hover:text-destructive"
            >
              Clear all downloads
            </Button>
          }
        />
      </SettingsGroup>

      <AutoCacheRows />

      <ClearDownloadsDialog open={pendingClear} onOpenChange={setPendingClear} />
    </div>
  );
}
