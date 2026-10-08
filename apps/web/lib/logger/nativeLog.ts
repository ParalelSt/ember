import { z } from 'zod';
import { scrubText } from './sanitize';
import type { LogLevel, NativeSurface, ServerLogEntry } from './types';

/** The phone app's own player log (apps/mobile/android/.../PlaybackLog.kt).
 *
 *  Android Auto and the AAOS car run only the app's player service, with no
 *  page open, so nothing they hit ever reached the web logger or a bug
 *  report. The service sends its events in batches to POST /api/native-log;
 *  they are stored in the same daily server log as everything else
 *  (lib/logger/server.ts) under category 'native', with the surface they
 *  happened on, and read back by the admin's "Car and Android Auto" page. */

export const NATIVE_CATEGORY = 'native';
export const NATIVE_ROUTE = 'native-log';
export const SURFACES = ['phone', 'android-auto', 'aaos'] as const satisfies readonly NativeSurface[];

export const NATIVE_LOG_LIMITS = {
  /** The whole request body. A full batch of 25 is ~10 KB. */
  maxBodyBytes: 64 * 1024,
  maxEvents: 50,
  maxMessage: 500,
  /** One event's `data`, serialized. */
  maxDataBytes: 2048,
  /** Batches per member per minute (a phone sends one every 30 s at most,
   *  plus one per error). */
  rate: { windowMs: 60_000, max: 12 },
} as const;

/** A device clock this far off is not trusted for the entry's time (the
 *  car emulator jumped a month on 2026-10-07); the server's time is used and
 *  the device's kept in data. */
const CLOCK_SKEW_MS = 48 * 60 * 60 * 1000;

const EventSchema = z.object({
  ts: z.number().int().nonnegative(),
  level: z.enum(['info', 'warn', 'error']),
  event: z.string().regex(/^[a-z][a-z0-9._-]{0,39}$/),
  message: z.string().max(NATIVE_LOG_LIMITS.maxMessage),
  surface: z.enum(SURFACES),
  data: z
    .record(z.string(), z.unknown())
    .optional()
    .refine((d) => d === undefined || JSON.stringify(d).length <= NATIVE_LOG_LIMITS.maxDataBytes, 'data too large'),
});

export const NativeLogBodySchema = z.object({
  session: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  device: z
    .object({
      model: z.string().max(80).optional(),
      sdk: z.number().int().min(1).max(1000).optional(),
      app: z.string().max(40).optional(),
    })
    .strict()
    .optional(),
  dropped: z.number().int().min(0).max(1_000_000).optional(),
  events: z.array(EventSchema).min(1).max(NATIVE_LOG_LIMITS.maxEvents),
});

export type NativeLogBody = z.infer<typeof NativeLogBodySchema>;

const URL_RE = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'<>]+/g;
const SECRET_KEY_RE = /cookie|token|authorization|password|secret|pb_auth|signature|sig$|session|email/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || '[url]';
  } catch {
    return '[url]';
  }
}

/** A URL becomes its host (a stream URL can carry a signed token), then the
 *  shared secret patterns (pb_auth, bearer, query values, long tokens). The
 *  app already does this; the server does not rely on it. */
export function redactNativeText(s: string): string {
  return scrubText(s.replace(URL_RE, (m) => hostOf(m))).slice(0, NATIVE_LOG_LIMITS.maxMessage);
}

function redactValue(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return redactNativeText(v);
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
  if (depth >= 3) return undefined;
  if (Array.isArray(v)) return v.slice(0, 10).map((x) => redactValue(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) continue;
      const r = redactValue(x, depth + 1);
      if (r !== undefined) out[k.slice(0, 40)] = r;
    }
    return out;
  }
  return undefined;
}

export function redactNativeData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  return redactValue(data, 0) as Record<string, unknown>;
}

/** One stored entry per event, plus one noting events the device dropped
 *  when its buffer was full. */
export function toNativeEntries(
  body: NativeLogBody,
  ctx: { userId: string; reqId: string; now?: number },
): ServerLogEntry[] {
  const now = ctx.now ?? Date.now();
  const device = body.device
    ? {
        ...(body.device.model ? { model: redactNativeText(body.device.model) } : {}),
        ...(body.device.sdk ? { sdk: body.device.sdk } : {}),
        ...(body.device.app ? { app: redactNativeText(body.device.app) } : {}),
      }
    : {};
  const base = {
    category: NATIVE_CATEGORY,
    sessionId: `native:${body.session}`,
    side: 'server' as const,
    reqId: ctx.reqId,
    route: NATIVE_ROUTE,
    userId: ctx.userId,
  };
  const out: ServerLogEntry[] = body.events.map((e) => ({
    ...base,
    ts: Math.abs(now - e.ts) <= CLOCK_SKEW_MS ? e.ts : now,
    kind: e.level === 'info' ? 'breadcrumb' : 'error',
    level: e.level,
    message: redactNativeText(e.message),
    surface: e.surface,
    data: { event: e.event, deviceTs: e.ts, device, ...redactNativeData(e.data) },
  }));
  if (body.dropped && body.dropped > 0) {
    const last = body.events[body.events.length - 1];
    out.push({
      ...base,
      ts: now,
      kind: 'breadcrumb',
      level: 'info',
      message: `${body.dropped} event(s) dropped on the device (its log buffer was full)`,
      surface: last.surface,
      data: { event: 'log.dropped', device, dropped: body.dropped },
    });
  }
  return out;
}

// ── Admin view ──────────────────────────────────────────────────────────

export interface NativeEvent {
  ts: number;
  level: LogLevel;
  event: string;
  message: string;
  surface: NativeSurface;
  session: string;
  data: Record<string, unknown>;
}

export interface NativeDevice {
  /** userId + model + Android version: one phone or car. */
  key: string;
  userId: string;
  model: string;
  sdk: number | null;
  app: string;
  surfaces: NativeSurface[];
  lastSeen: number;
  counts: { error: number; warn: number; info: number };
  /** The app's last runs that ended badly (ANR, crash, killed), newest first. */
  exits: NativeEvent[];
  /** Newest first, capped. */
  events: NativeEvent[];
}

const MAX_EVENTS_PER_DEVICE = 300;

function isSurface(s: unknown): s is NativeSurface {
  return typeof s === 'string' && (SURFACES as readonly string[]).includes(s);
}

/** The native entries in [entries], per device, the most recently heard
 *  device first and each device's events newest first. [surface] keeps only
 *  events from that surface (and devices with any). */
export function groupNativeLog(entries: ServerLogEntry[], opts: { surface?: NativeSurface } = {}): NativeDevice[] {
  const devices = new Map<string, NativeDevice>();
  for (const e of entries) {
    if (e.category !== NATIVE_CATEGORY || !e.userId) continue;
    const surface: NativeSurface = isSurface(e.surface) ? e.surface : 'phone';
    if (opts.surface && surface !== opts.surface) continue;
    const data = (e.data && typeof e.data === 'object' ? e.data : {}) as Record<string, unknown>;
    const device = (data.device && typeof data.device === 'object' ? data.device : {}) as Record<string, unknown>;
    const model = typeof device.model === 'string' && device.model ? device.model : 'Unknown device';
    const sdk = typeof device.sdk === 'number' ? device.sdk : null;
    const key = `${e.userId}|${model}|${sdk ?? ''}`;
    let d = devices.get(key);
    if (!d) {
      d = { key, userId: e.userId, model, sdk, app: '', surfaces: [], lastSeen: 0, counts: { error: 0, warn: 0, info: 0 }, exits: [], events: [] };
      devices.set(key, d);
    }
    const { event, device: _device, ...rest } = data;
    void _device;
    const ev: NativeEvent = {
      ts: e.ts,
      level: e.level,
      event: typeof event === 'string' ? event : 'event',
      message: e.message,
      surface,
      session: e.sessionId.replace(/^native:/, ''),
      data: rest,
    };
    d.events.push(ev);
    d.counts[e.level] = (d.counts[e.level] ?? 0) + 1;
    if (!d.surfaces.includes(surface)) d.surfaces.push(surface);
    if (e.ts >= d.lastSeen) {
      d.lastSeen = e.ts;
      if (typeof device.app === 'string' && device.app) d.app = device.app;
    }
    if (ev.event === 'exit' && ev.level !== 'info') d.exits.push(ev);
  }
  const out = [...devices.values()];
  for (const d of out) {
    d.events.sort((a, b) => b.ts - a.ts);
    d.events = d.events.slice(0, MAX_EVENTS_PER_DEVICE);
    d.exits.sort((a, b) => b.ts - a.ts);
  }
  return out.sort((a, b) => b.lastSeen - a.lastSeen);
}
