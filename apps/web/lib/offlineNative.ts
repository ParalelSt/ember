'use client';

import { useSyncExternalStore } from 'react';
import type { Track } from '@/types/track';

export interface PinStatus {
  id: string;
  name: string;
  total: number;
  done: number;
  failed: number;
  downloading: boolean;
  /** Track ids currently pinned: lets `isStale` compare against the live
   *  playlist exactly instead of just counting. */
  trackIds: string[];
  /** Why this pin's first permanent failure happened, so the UI can say what
   *  to do about it: 'auth', 'storage' or 'http'. Null when nothing failed,
   *  absent on older native builds. */
  failedReason?: string | null;
}
export interface NativeStatus {
  pins: PinStatus[];
  trackFiles: Record<string, string>;
  totalBytes: number;
  progress?: { id: string; done: number; total: number; title: string };
}

/** One native diagnostic (see android NativeLog.kt), forwarded into the client
 *  logger so Kotlin-side failures reach the bug report. */
export interface NativeLogEvent {
  level: 'error' | 'warn' | 'info';
  /** 'offline' | 'player' | 'service'; the web side prefixes it with 'native:'. */
  category: string;
  message: string;
  data?: unknown;
  /** Milliseconds since epoch, from the device clock. */
  ts?: number;
}

interface EmberOfflinePlugin {
  addListener(event: 'offline', cb: (s: NativeStatus) => void): unknown;
  addListener(event: 'nativeLog', cb: (e: NativeLogEvent) => void): unknown;
  status(): Promise<NativeStatus>;
  pin(o: { id: string; name: string; tracks: Track[] }): Promise<NativeStatus>;
  unpin(o: { id: string }): Promise<NativeStatus>;
  cancel(o: { id: string }): Promise<NativeStatus>;
  clearAll(): Promise<NativeStatus>;
}
type Cap = { Plugins?: { EmberOffline?: EmberOfflinePlugin }; convertFileSrc?: (p: string) => string };
const cap = (): Cap | null => (typeof window === 'undefined' ? null : ((window as unknown as { Capacitor?: Cap }).Capacitor ?? null));
const plugin = (): EmberOfflinePlugin | null => cap()?.Plugins?.EmberOffline ?? null;

export const nativeOfflinePresent = (): boolean => plugin() !== null;
export const nativeStatus = () => plugin()!.status();
export const nativePin = (id: string, name: string, tracks: Track[]) => plugin()!.pin({ id, name, tracks });
export const nativeUnpin = (id: string) => plugin()!.unpin({ id });
export const nativeCancel = (id: string) => plugin()!.cancel({ id });
export const nativeClearAll = () => plugin()!.clearAll();
export function subscribeNative(cb: (s: NativeStatus) => void): void { plugin()?.addListener('offline', cb); }
/** Native diagnostics. Subscribing is also what drains the events the plugin
 *  buffered before this page existed, so call it once, early. */
export function subscribeNativeLogEvents(cb: (e: NativeLogEvent) => void): boolean {
  const p = plugin();
  if (!p) return false;
  p.addListener('nativeLog', cb);
  return true;
}

/** `window.Capacitor` never exists during SSR, so `nativeOfflinePresent()`
 *  called straight in JSX renders false on the server and (on Android) true
 *  on the client: a hydration mismatch. `useSyncExternalStore`'s dedicated
 *  server-snapshot argument is the React-approved way to read a value that
 *  legitimately differs between server and client: it renders the server
 *  value first and only then re-reads a client snapshot. Nothing here can
 *  actually change after mount (the plugin doesn't come or go at runtime),
 *  so the subscribe function never has anything to report. */
const noopSubscribe = () => () => {};
const serverSnapshot = () => false;

export function useNativeOfflinePresent(): boolean {
  return useSyncExternalStore(noopSubscribe, nativeOfflinePresent, serverSnapshot);
}

/** Whether the offline-download UI should render at all: the native plugin
 *  (Android), or plain browser storage (OPFS) elsewhere: everywhere
 *  except a browser with no Storage API, so this changes nothing on the web. */
export function useOfflineDownloadAllowed(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => nativeOfflinePresent() || (typeof navigator !== 'undefined' && 'storage' in navigator),
    serverSnapshot,
  );
}

/** The URL the <audio> element can play a downloaded file from, or null.
 *  Capacitor serves app files under a special path on the app's own origin. */
export function localSrcFor(track: Track, trackFiles: Record<string, string>): string | null {
  const path = trackFiles[track.id];
  const convert = cap()?.convertFileSrc;
  return path && convert ? convert(path) : null;
}
