'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshIcon } from '@/components/icons';
import { appUpdateWaitsForTap } from '@/lib/appUpdate';
import { checkForUpdates, requestUpdate } from '@/lib/update/apply';
import { isDesktopPlatform } from '@/lib/update/check';
import { loadDeviceInfo, type DeviceInfo } from '@/lib/versions/device';
import { platformName } from '@/lib/versions/label';
import { useUpdateStore, type UpdateState } from '@/stores/useUpdateStore';

/** Settings' one line about updates. */
export function updatesLine(s: Pick<UpdateState, 'status' | 'offer' | 'pending' | 'applying' | 'applyFailed'>): string {
  const v = s.offer ? ` ${s.offer.version}` : '';
  if (s.applying) return `Updating to Ember${v}`;
  if (s.status === 'checking') return 'Checking for updates…';
  if (s.offer && s.applyFailed && s.offer.via === 'android') return `Ember${v} is ready. Couldn't update, try again`;
  if (s.offer && (s.applyFailed || !s.offer.canApply)) return `Ember${v} is ready. Quit and reopen Ember to install it`;
  if (s.offer && s.pending) return `Ember${v} is ready. Updating after this song`;
  if (s.offer) return `Ember${v} is ready`;
  if (s.status === 'up-to-date') return 'Ember is up to date';
  if (s.status === 'failed') return "Couldn't check for updates";
  return 'Ember checks for updates by itself';
}

/** Where the card shows: the desktop app, and an Android app that waits for
 *  a tap to update (from 0.4.34; older ones keep AppUpdateCard). */
function cardPlatform(info: DeviceInfo): boolean {
  return isDesktopPlatform(info.platform) || (info.platform === 'android' && appUpdateWaitsForTap());
}

/** Settings' "Updates" card in the desktop and Android apps: the app's and
 *  the web build's versions, where updates are, a quiet Check for updates,
 *  and Update when there is one. The same update the reminder at the top
 *  offers (components/update/UpdateReminder), so a tap here also waits for
 *  the song playing to end. */
export function UpdatesCard() {
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const state = useUpdateStore();

  useEffect(() => {
    let live = true;
    void loadDeviceInfo().then((i) => {
      if (!live) return;
      setInfo(i);
      // Opening Settings before the first check has run: ask now.
      if (cardPlatform(i) && useUpdateStore.getState().checkedAt === 0) void checkForUpdates();
    });
    return () => {
      live = false;
    };
  }, []);

  if (!info || !cardPlatform(info)) return null;

  const busy = state.status === 'checking' || state.applying;
  const canUpdate =
    !!state.offer?.canApply && (!state.applyFailed || state.offer.via === 'android') && !state.pending && !state.applying;
  const versions = [
    info.shellVersion ? `${platformName(info.platform)} ${info.shellVersion}` : null,
    info.webVersion ? `web ${info.webVersion}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div data-testid="updates-card" className="mt-section max-w-2xl rounded-2xl bg-card p-stack shadow-soft">
      <div className="font-semibold">Updates</div>
      <p className="mt-inset text-sm text-muted-foreground">
        {versions ? `${versions}. ` : null}
        <span data-testid="updates-line">{updatesLine(state)}</span>
      </p>
      <div className="mt-block flex flex-wrap gap-cluster">
        {canUpdate && (
          <Button variant="ember" onClick={() => void requestUpdate()}>
            Update
          </Button>
        )}
        <Button variant="outline" disabled={busy} onClick={() => void checkForUpdates()}>
          <RefreshIcon className={busy ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          Check for updates
        </Button>
      </div>
    </div>
  );
}
