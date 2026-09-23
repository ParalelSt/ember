import { formatTime } from '@/lib/format';
import { PRANK_LIMITS, type CapReason } from './limits';
import type { Presence } from './presence';
import type { PrankKind, PrankStatus } from './types';

/** Every word the admin side shows about pranks: kinds, statuses, reasons,
 *  engines and the "playing now" line. One table, so the log never shows an
 *  id or a raw status. Admin-only: nothing here reaches the target. */

export function engineWords(engine: string): string {
  switch (engine) {
    case 'android': return 'on Android';
    case 'capacitor': return 'on Android (older app)';
    case 'tauri-native':
    case 'native-stub': return 'on desktop';
    case 'web': return 'in the browser';
    default: return '';
  }
}

export function agoWords(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

const song = (t: { title: string; artist: string }) =>
  t.artist ? `“${t.title}” by ${t.artist}` : `“${t.title}”`;
const join = (...parts: string[]) => parts.filter(Boolean).join(', ');

/** The admin's "what are they doing" line for one person. `fresh` is a
 *  heartbeat inside the stale window, `stale` their last one ever,
 *  `lastPlay` their newest play within 30 min (for people whose app has not
 *  reported since a restart). */
export function presenceLine(
  fresh: Presence | null,
  stale: Presence | null,
  lastPlay: { title: string; artist: string; playedAt: number } | null,
  now: number,
): string {
  if (fresh?.track) {
    const t = fresh.track;
    const where = engineWords(fresh.engine);
    if (fresh.isPlaying) {
      // The heartbeat is up to 20 s old: count on from it.
      const pos = fresh.position + (now - fresh.at) / 1000;
      const at = t.durationSec > 0 ? `${formatTime(Math.min(pos, t.durationSec))} of ${formatTime(t.durationSec)}` : '';
      const since = now - fresh.since >= 60_000 ? `since ${agoWords(now - fresh.since)}` : '';
      return join(`Playing ${song(t)}`, at, since, where);
    }
    return join(`Paused on ${song(t)}`, where);
  }
  if (lastPlay) return `Was playing ${song(lastPlay)}, ${agoWords(now - lastPlay.playedAt)}`;
  if (stale) return `Not listening (last seen ${agoWords(now - stale.at)})`;
  return 'Not listening';
}

const VERBS: Record<PrankKind, string> = {
  ping: 'pinged',
  sound: 'played a sound for',
  swap: 'swapped the song for',
};

const REASONS: Record<string, string> = {
  'not-playing': 'nothing was playing',
  paused: 'their music was paused',
  busy: 'another prank was running',
  'engine-unsupported': 'their app cannot do that yet',
};

export function reasonWords(reason: string): string {
  if (REASONS[reason]) return REASONS[reason];
  if (reason.startsWith('error:')) return `something went wrong (${reason.slice(6) || 'unknown'})`;
  return reason || 'no reason given';
}

export function statusWords(status: PrankStatus, reason: string, engine: string, playedSec: number | null): string {
  switch (status) {
    case 'pending': return 'waiting for their app';
    case 'delivered': return engineWords(engine) ? `delivered ${engineWords(engine)}` : 'delivered';
    case 'skipped': return `not played: ${reasonWords(reason)}`;
    case 'done': return playedSec ? `done after ${Math.round(playedSec)} s` : 'done';
    case 'expired': return 'not delivered: offline, paused, or app too old';
    case 'cancelled': return 'cancelled';
  }
}

/** "Aron pinged Marko: delivered on desktop". The time is shown beside it
 *  by the page, in the admin's own timezone. */
export function logLine(e: {
  issuerName: string;
  targetName: string;
  kind: PrankKind;
  status: PrankStatus;
  reason: string;
  engine: string;
  playedSec: number | null;
}): string {
  return `${e.issuerName} ${VERBS[e.kind]} ${e.targetName}: ${statusWords(e.status, e.reason, e.engine, e.playedSec)}`;
}

/** "every minute", "every 5 min", "every hour", "every 90 min". */
export function intervalWords(sec: number): string {
  const mins = Math.max(1, Math.round(sec / 60));
  if (mins === 1) return 'every minute';
  if (mins === 60) return 'every hour';
  if (mins === 120) return 'every 2 hours';
  return `every ${mins} min`;
}

/** The repeat's line, without the stop time (the page adds it in the
 *  admin's timezone). */
export function scheduleLine(soundName: string, targetName: string, intervalSec: number): string {
  return `“${soundName}” for ${targetName}, ${intervalWords(intervalSec)}`;
}

/** Why the create route said no, for the admin's toast. */
export function capWords(reason: CapReason, targetName: string, retryAfterSec: number): string {
  const wait = retryAfterSec >= 90 ? `${Math.ceil(retryAfterSec / 60)} min` : `${retryAfterSec} s`;
  switch (reason) {
    case 'admin-hourly':
      return `You have sent ${PRANK_LIMITS.perAdminPerHour} pranks this hour; try again in ${wait}`;
    case 'target-hourly':
      return `${targetName} has had ${PRANK_LIMITS.perTargetPerHour} pranks this hour; try again in ${wait}`;
    case 'sound-gap':
      return `Sounds need ${PRANK_LIMITS.soundGapSec} s between them; try again in ${wait}`;
    case 'swap-active':
      return `A swap is already running on ${targetName}; try again in ${wait}`;
  }
}

/** A display name, never an id: name, else the email's local part. */
export function personName(u: Record<string, unknown>): string {
  const name = typeof u.name === 'string' ? u.name.trim() : '';
  if (name) return name;
  const email = typeof u.email === 'string' ? u.email : '';
  return email.split('@')[0] || 'someone';
}
