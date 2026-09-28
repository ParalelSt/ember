'use client';

import { toast } from 'sonner';
import { logger } from '@/lib/logger/client';
import type { BackendKind } from '@/lib/autoCache/select';
import { detectShell } from '@/lib/playback/detectShell';
import { nativePlatform } from '@/lib/playback/nativePlatform';
import type { AudioBackend } from '@/lib/playback/types';
import { requestCast, stopCast } from '@/lib/cast/controller';
import { useCastStore } from '@/stores/useCastStore';
import { EMPTY_OUTPUTS, useOutputStore } from '@/stores/useOutputStore';
import { androidCastPlugin, androidOutputsPlugin, createAndroidOutputs, watchAndroidCastDevices } from './android';
import { createDesktopOutputs } from './desktop';
import { createIosOutputs, iosRoutePlugin } from './ios';
import type { OutputProvider, OutputSnapshot } from './types';
import { createWebOutputs, webOutputsSupported } from './web';

/** The Devices button's brain, one per page: picks this platform's output
 *  provider (lib/outputs/*), keeps useOutputStore current, and runs what a
 *  row in the picker asks for. The player tells it which engine plays
 *  (initOutputs), at start and again when the desktop engine falls back to
 *  web audio. Casting stays with lib/cast/controller; this only lists the
 *  Android app's cast devices and starts or stops casting from the picker. */

export interface OutputEnv {
  kind: BackendKind;
  /** The page's own engine, even while a cast engine stands in for it. */
  localBackend: () => AudioBackend | null;
}

let provider: OutputProvider | null = null;
let unwatch: (() => void) | null = null;
let unwatchCast: (() => void) | null = null;
let startedKind: BackendKind | null = null;

const coarsePointer = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);

/** This page's provider, or null when it cannot pick an output. */
export function providerFor(env: OutputEnv): OutputProvider | null {
  switch (env.kind) {
    case 'android': {
      const p = androidOutputsPlugin();
      return p ? createAndroidOutputs(p) : null;
    }
    case 'capacitor': {
      if (nativePlatform() !== 'ios') return null;
      const p = iosRoutePlugin();
      return p ? createIosOutputs(p) : null;
    }
    case 'tauri-native':
      return createDesktopOutputs();
    case 'web':
      // A computer's browser only: a phone browser has one output it can
      // name (the phone), and the desktop app's web view (after a fallback
      // from its engine) has no setSinkId at all.
      if (detectShell() !== 'web' || coarsePointer() || !webOutputsSupported()) return null;
      return createWebOutputs({
        mediaDevices: navigator.mediaDevices,
        storage: (() => {
          try {
            return window.localStorage;
          } catch {
            return null;
          }
        })(),
        backend: env.localBackend,
        onLost: (name) => toast(`${name} is not connected. Playing on the system default.`),
      });
    default:
      return null;
  }
}

function apply(s: OutputSnapshot | null): void {
  const set = useOutputStore.getState().set;
  if (!s) {
    set({ platform: null, ...EMPTY_OUTPUTS });
    return;
  }
  set({ platform: provider?.platform ?? null, ...s });
}

/** Called by the player once its engine exists, and again if it changes
 *  kind. Safe to call more than once with the same kind. */
export function initOutputs(env: OutputEnv): void {
  if (typeof window === 'undefined' || env.kind === startedKind) return;
  _resetOutputs();
  startedKind = env.kind;
  provider = providerFor(env);
  if (provider) {
    const mine = provider;
    unwatch = mine.watch((s) => {
      if (provider === mine) apply(s);
    });
    void mine.snapshot().then((s) => {
      if (provider === mine) apply(s);
    }, () => {});
  }
  if (env.kind === 'android' && androidCastPlugin()) {
    unwatchCast = watchAndroidCastDevices((d) => useOutputStore.getState().set({ castDevices: d }));
  }
}

/** Fresh state for the picker that is opening. */
export async function refreshOutputs(): Promise<void> {
  const p = provider;
  if (!p) return;
  const s = await p.snapshot().catch(() => null);
  if (provider === p) apply(s);
}

async function run(what: string, fn: () => Promise<OutputSnapshot | null | void>): Promise<void> {
  const p = provider;
  useOutputStore.getState().set({ busy: true });
  try {
    const s = await fn();
    if (s && provider === p) apply(s);
  } catch (e) {
    const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
    // Closing a picker or a permission prompt is not a failure.
    if (!/cancel|abort|NotAllowed|dismiss/i.test(msg)) {
      logger.error('outputs', `could not ${what}`, { platform: p?.platform ?? null }, e instanceof Error ? e : new Error(msg));
      toast.error(what === 'switch output' ? 'Could not switch to that device.' : 'Could not open the device list.');
    }
  } finally {
    useOutputStore.getState().set({ busy: false });
  }
}

/** A speaker or headset row. While casting, the music comes back first. */
export async function chooseOutput(id: string): Promise<void> {
  const p = provider;
  if (!p) return;
  if (useCastStore.getState().connection !== 'idle' && p.platform !== 'ios') await stopCast();
  await run('switch output', () => p.select(id));
}

/** The system's own picker (Android's Output Switcher, iOS's route picker,
 *  the browser's speaker prompt or permission). */
export async function openSystemPicker(): Promise<void> {
  const p = provider;
  if (!p?.openSystemPicker) return;
  await run('open the system picker', () => p.openSystemPicker!());
}

/** A cast device the Android app listed. */
export async function chooseCastDevice(id: string): Promise<void> {
  const p = androidCastPlugin();
  if (!p) {
    await requestCast();
    return;
  }
  const already = useOutputStore.getState().castDevices?.find((d) => d.id === id);
  if (already?.selected && useCastStore.getState().connection === 'connected') {
    // Its own controls (volume, stop), as the Cast button does.
    await requestCast();
    return;
  }
  try {
    await p.selectCastDevice({ id });
  } catch (e) {
    logger.error('outputs', 'could not cast to that device', undefined, e instanceof Error ? e : new Error(String(e)));
    toast.error('Could not connect to that device.');
  }
}

export { requestCast as openCastPicker, stopCast as stopCasting };

/** Tests, and a change of engine. */
export function _resetOutputs(): void {
  unwatch?.();
  unwatchCast?.();
  unwatch = null;
  unwatchCast = null;
  provider = null;
  startedKind = null;
  useOutputStore.getState().set({ platform: null, ...EMPTY_OUTPUTS, castDevices: null, busy: false });
}
