'use client';

import { useState } from 'react';
import { CloseIcon, DownloadIcon, RefreshIcon } from '@/components/icons';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { installAppUpdate, openInstallSettings, updatePill } from '@/lib/appUpdate';
import { cn } from '@/lib/utils';

/** The Android app's update, in one small line floating under the top bar:
 *  "Downloading update 0.4.19 · 42%", "Update 0.4.19 ready · Tap to
 *  install", "Allow Ember to install updates". Shows only in the Android
 *  app, only while there is something to say, and can be put away until the
 *  state changes. Lives in the app shell, over every page. */
export function AppUpdatePill() {
  const { available, state } = useAppUpdate();
  // Put away for this state: a new state (the download finishing) shows again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!available) return null;
  const pill = updatePill(state);
  if (!pill) return null;
  const key = `${state.status}:${state.waiting}:${state.latest}`;
  if (dismissed === key) return null;

  const act = () => {
    if (pill.action === 'install') void installAppUpdate();
    else if (pill.action === 'settings') void openInstallSettings();
  };
  const busy = state.status === 'downloading' || state.status === 'installing';

  return (
    <div
      data-testid="app-update-pill"
      data-status={state.status}
      role="status"
      className="fixed left-1/2 z-40 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-popover/95 py-1.5 pl-1.5 pr-2 shadow-2xl backdrop-blur"
      style={{ top: 'calc(var(--safe-top, 0px) + 4.25rem)' }}
    >
      <button
        type="button"
        onClick={act}
        disabled={!pill.action}
        className="flex min-w-0 items-center gap-2 rounded-full text-left disabled:cursor-default"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ember/15 text-ember">
          {busy ? <RefreshIcon className={cn('h-3.5 w-3.5', 'animate-spin')} /> : <DownloadIcon className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0">
          <b className="block truncate text-[13px]">{pill.title}</b>
          {pill.detail && <small className="block truncate text-[11.5px] text-muted-foreground">{pill.detail}</small>}
        </span>
      </button>
      {pill.dismissable && (
        <button
          type="button"
          aria-label="Hide update notice"
          onClick={() => setDismissed(key)}
          className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
