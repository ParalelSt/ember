'use client';

import { logger } from '@/lib/logger/client';
import { subscribeNativeLogEvents, type NativeLogEvent } from '@/lib/offlineNative';

/** Subscribed once per page: the native side buffers until someone listens, so
 *  a second subscription would only split the stream. */
let subscribed = false;

/** Turn one native event into a client-log entry. Errors become errors so they
 *  reach triage; warn becomes a warn-level breadcrumb and info a plain one;
 *  both keep their native level in `data` too, the same shape the console
 *  breadcrumbs use. */
export function recordNativeLog(event: NativeLogEvent): void {
  const category = `native:${event.category || 'unknown'}`;
  // The native timestamp is kept beside the payload rather than replacing the
  // entry's own ts: the two clocks are the same device's, but the entry time is
  // when the WEB side heard about it, and the gap is the buffering delay, which
  // is worth seeing.
  // Native payload first, mapping fields last: `data.level`/`data.nativeTs`
  // must win over any same-named keys the native side happened to send,
  // or a native `warn` event's own `level: 'warn'` field would get
  // clobbered back to whatever the payload carried.
  const data: Record<string, unknown> = isRecord(event.data) ? { ...event.data } : {};
  if (!isRecord(event.data) && event.data !== undefined) data.value = event.data;
  data.level = event.level;
  data.nativeTs = event.ts;
  if (event.level === 'error') logger.error(category, event.message, data);
  else if (event.level === 'warn') logger.warn(category, event.message, data);
  else logger.breadcrumb(category, event.message, data);
}

/** Start forwarding native diagnostics into the client logger. No-op off
 *  Android (no plugin) and on repeat calls. Returns whether it is now
 *  listening. */
export function subscribeNativeLog(): boolean {
  if (subscribed) return true;
  // Subscribing is what drains the plugin's buffer, so this must happen even
  // when nothing has failed yet.
  subscribed = subscribeNativeLogEvents(recordNativeLog);
  return subscribed;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
