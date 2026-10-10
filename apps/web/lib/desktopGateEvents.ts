'use client';

import { invoke } from '@tauri-apps/api/core';
import { detectShell } from '@/lib/playback/detectShell';

/** The desktop app's launch gate (apps/desktop/src-tauri/src/gate.rs) runs
 *  before any page exists and before anyone is signed in, so it keeps its
 *  update events ("update.gate.check", ".shown", ".cancel", ".install",
 *  ".failed", ".done") on disk. The page picks them up once per load
 *  (`update_gate_events`, which hands them over and forgets them) and sends
 *  them to /api/native-log as surface 'desktop', where the admin's native log
 *  shows them next to the phones'. A batch the server refuses (signed out,
 *  offline) waits in localStorage for the next load. Never throws. */

export interface GateEvent {
  ts: number;
  event: string;
  data?: Record<string, unknown> | null;
}

const PENDING_KEY = 'ember.desktopGateEvents';
const MAX_EVENTS = 50;
/** /api/native-log's cap on one event's data, serialized. */
const MAX_DATA = 2048;
const EVENT_NAME = /^[a-z][a-z0-9._-]{0,39}$/;
const TIMEOUT_MS = 2000;

let sentThisLoad = false;

function isEvent(v: unknown): v is GateEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.ts === 'number' && Number.isFinite(e.ts) && e.ts >= 0 && typeof e.event === 'string' && EVENT_NAME.test(e.event);
}

/** One /api/native-log batch for these events, or null when none is usable. */
export function toNativeLogBody(events: unknown[], session: string): Record<string, unknown> | null {
  const usable = events.filter(isEvent).slice(-MAX_EVENTS);
  if (usable.length === 0) return null;
  return {
    session,
    device: { model: 'Ember desktop' },
    events: usable.map((e) => {
      const data = e.data && typeof e.data === 'object' && !Array.isArray(e.data) ? e.data : undefined;
      return {
        ts: Math.floor(e.ts),
        level: e.event === 'update.gate.failed' ? 'warn' : 'info',
        event: e.event,
        message: e.event,
        surface: 'desktop',
        ...(data && JSON.stringify(data).length <= MAX_DATA ? { data } : {}),
      };
    }),
  };
}

function readPending(): unknown[] {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePending(events: unknown[]): void {
  try {
    if (events.length === 0) window.localStorage.removeItem(PENDING_KEY);
    else window.localStorage.setItem(PENDING_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // A full or blocked storage only loses telemetry.
  }
}

function sessionId(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
  return `desktop-${rand}`.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
}

async function takeFromShell(): Promise<unknown[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const got = await Promise.race([
      invoke<unknown>('update_gate_events'),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('update_gate_events timed out')), TIMEOUT_MS);
      }),
    ]);
    return Array.isArray(got) ? got : [];
  } catch {
    // An older shell without the command, or no bridge: nothing to send.
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Send what the gate kept. Returns how many events the server took. */
export async function forwardDesktopGateEvents(): Promise<number> {
  if (sentThisLoad || detectShell() !== 'tauri') return 0;
  sentThisLoad = true;
  const events = [...readPending(), ...(await takeFromShell())];
  const body = toNativeLogBody(events, sessionId());
  if (!body) {
    writePending([]);
    return 0;
  }
  try {
    const res = await fetch('/api/native-log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Signed out (401) or limited: keep them for the next load. A batch
      // the server calls malformed would never go through: drop it.
      writePending(res.status === 400 || res.status === 413 ? [] : events.filter(isEvent));
      return 0;
    }
    writePending([]);
    return (body.events as unknown[]).length;
  } catch {
    writePending(events.filter(isEvent));
    return 0;
  }
}

/** Tests only. */
export function _resetDesktopGateEvents(): void {
  sentThisLoad = false;
}
