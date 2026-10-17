'use client';

import { useRef, useState, type TouchEvent } from 'react';
import { CloseIcon, DownloadIcon, RefreshIcon } from '@/components/icons';
import { ProgressRing } from '@/components/primitives/ProgressRing';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { installAppUpdate, openInstallSettings, updatePill } from '@/lib/appUpdate';

/** How far a sideways swipe has to go to put the card away, like a
 *  notification (px). */
export const SWIPE_DISMISS_PX = 80;

/** The Android app's update, as a rounded card floating under the top bar:
 *  a progress ring around the icon while it downloads, an Install button
 *  when it is ready, and a small "Allow / Later" card when Android needs the
 *  install permission. Shows only in the Android app, only while there is
 *  something to say. Swipe it sideways (or tap the X) to put it away until
 *  the state changes. Lives in the app shell, over every page. */
export function AppUpdatePill() {
  const { available, state } = useAppUpdate();
  // Put away for this state: a new state (the download finishing) shows again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [dx, setDx] = useState(0);
  const touch = useRef<{ x: number; y: number; swiping: boolean } | null>(null);
  if (!available) return null;
  const pill = updatePill(state);
  if (!pill) return null;
  const key = `${state.status}:${state.waiting}:${state.latest}`;
  if (dismissed === key) return null;

  const hide = () => {
    setDx(0);
    setDismissed(key);
  };
  const act = () => {
    if (pill.action === 'install') void installAppUpdate();
    else if (pill.action === 'settings') void openInstallSettings();
  };
  const downloading = state.status === 'downloading';
  const busy = downloading || state.status === 'installing';
  const permission = pill.action === 'settings';
  const installButton = pill.action === 'install';
  const detail = installButton && state.waiting === 'tap' ? 'Ember restarts when done' : pill.detail;

  const onTouchStart = (e: TouchEvent) => {
    if (!pill.dismissable) return;
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, swiping: false };
  };
  const onTouchMove = (e: TouchEvent) => {
    const start = touch.current;
    if (!start) return;
    const t = e.touches[0];
    const mx = t.clientX - start.x;
    if (!start.swiping && Math.abs(mx) > Math.abs(t.clientY - start.y)) start.swiping = true;
    if (start.swiping) setDx(mx);
  };
  const onTouchEnd = () => {
    const start = touch.current;
    touch.current = null;
    if (start?.swiping && Math.abs(dx) >= SWIPE_DISMISS_PX) hide();
    else setDx(0);
  };

  const close = pill.dismissable && (
    <button
      type="button"
      aria-label="Hide update notice"
      onClick={hide}
      className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
    >
      <CloseIcon className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <div
      className="fixed left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2"
      style={{ top: 'calc(var(--safe-top, 0px) + 4.25rem)' }}
    >
      <div
        data-testid="app-update-pill"
        data-status={state.status}
        data-kind={permission ? 'permission' : 'card'}
        role="status"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        className="touch-pan-y rounded-2xl border border-border bg-popover/95 p-row shadow-2xl backdrop-blur"
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          opacity: dx ? Math.max(0.3, 1 - Math.abs(dx) / 300) : undefined,
          transition: touch.current ? 'none' : 'transform 150ms, opacity 150ms',
        }}
      >
        {permission ? (
          <div data-testid="app-update-permission">
            <div className="flex items-center gap-row">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ember/15 text-ember">
                <DownloadIcon className="h-[1.125rem] w-[1.125rem]" />
              </span>
              <b className="min-w-0 flex-1 text-sm">Allow Ember to install updates</b>
              {close}
            </div>
            <p className="my-cluster text-xs leading-snug text-muted-foreground">
              {`Android asks once. Tap Allow, switch on "Allow from this source", then come back to install${state.latest ? ` ${state.latest}` : ''}.`}
            </p>
            <div className="flex justify-end gap-cluster">
              <button type="button" onClick={hide} className="h-8 rounded-full px-block text-xs font-bold text-muted-foreground">
                Later
              </button>
              <button type="button" onClick={act} className="h-8 rounded-full bg-ember px-block text-xs font-bold text-ember-foreground">
                Allow
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-row">
            <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-ember/15 text-ember">
              {downloading && (
                <span data-testid="app-update-ring" className="absolute inset-0 grid place-items-center">
                  <ProgressRing done={Math.round((state.progress ?? 0) * 100)} total={100} size={42} label="Download progress" />
                </span>
              )}
              {busy ? (
                <RefreshIcon className={`h-[1.125rem] w-[1.125rem] ${downloading ? '' : 'animate-spin'}`} />
              ) : (
                <DownloadIcon className="h-[1.125rem] w-[1.125rem]" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <b className="block truncate text-sm">{pill.title}</b>
              {detail && <small className="block truncate text-xs text-muted-foreground">{detail}</small>}
            </span>
            {installButton && (
              <button type="button" onClick={act} className="h-8 shrink-0 rounded-full bg-ember px-block text-xs font-bold text-ember-foreground">
                Install
              </button>
            )}
            {close}
          </div>
        )}
      </div>
    </div>
  );
}
