'use client';

import { Button } from '@/components/ui/button';
import { RefreshIcon } from '@/components/icons';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { checkForAppUpdate, installAppUpdate, openInstallSettings, updateLine } from '@/lib/appUpdate';

/** Settings' "App updates" card, next to the version stamp: the app's own
 *  version, where the updater is, and Check for updates (or Install, or the
 *  "Install unknown apps" switch, when that is what the update waits for).
 *  Only in the Android app with the updater; nothing elsewhere. */
export function AppUpdateCard() {
  const { available, state } = useAppUpdate();
  if (!available) return null;

  const busy = state.status === 'checking' || state.status === 'downloading' || state.status === 'installing';
  const ready = state.status === 'ready';
  const needsSettings = ready && state.waiting === 'permission';
  const canInstallNow = ready && !needsSettings && state.waiting !== 'car';

  return (
    <div data-testid="app-update-card" className="mt-section max-w-2xl rounded-2xl bg-card p-stack shadow-soft">
      <div className="font-semibold">App updates</div>
      <p className="mt-inset text-sm text-muted-foreground">
        {state.current ? `Ember for Android ${state.current}. ` : null}
        <span data-testid="app-update-line">{updateLine(state)}</span>
      </p>
      <div className="mt-block flex flex-wrap gap-cluster">
        {needsSettings ? (
          <Button variant="ember" onClick={() => void openInstallSettings()}>
            Allow installs
          </Button>
        ) : canInstallNow ? (
          <Button variant="ember" onClick={() => void installAppUpdate()}>
            Install update
          </Button>
        ) : (
          <Button variant="ember" disabled={busy} onClick={() => void checkForAppUpdate()}>
            <RefreshIcon className={busy ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            Check for updates
          </Button>
        )}
      </div>
    </div>
  );
}
