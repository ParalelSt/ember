import 'server-only';
import type { RecordModel } from 'pocketbase';
import {
  ForbiddenError,
  forbiddenResponse,
  UnauthorizedError,
  unauthorizedResponse,
} from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { logLine, scheduleLine } from './copy';
import { isExpired, parsePbDate, type RecentPrank } from './limits';
import type { PrankKind, PrankLogEntry, PrankSchedule, PrankStatus } from './types';

/** The catch block every prank route shares. */
export function prankErrorResponse(e: unknown): Response {
  if (e instanceof UnauthorizedError) return unauthorizedResponse();
  if (e instanceof ForbiddenError) return forbiddenResponse();
  return fromError(e);
}

/** A row's status as the admin should read it: pending past its window is
 *  expired, whether or not anything has written that back yet. */
export function effectiveStatus(row: RecordModel, now: number): PrankStatus {
  const status = row.status as PrankStatus;
  return isExpired(status, parsePbDate(row.expires_at), now) ? 'expired' : status;
}

export function toRecent(row: RecordModel, now: number): RecentPrank {
  return {
    kind: row.kind as PrankKind,
    status: effectiveStatus(row, now),
    created: parsePbDate(row.created),
    reason: String(row.reason ?? ''),
  };
}

const dateOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** One admin log line. `names` maps user ids to display names. */
export function toLogEntry(row: RecordModel, names: Map<string, string>, now: number): PrankLogEntry {
  const status = effectiveStatus(row, now);
  const targetName = names.get(String(row.target)) ?? 'someone';
  const issuerName = names.get(String(row.issued_by)) ?? 'An admin';
  const playedSec = typeof row.played_sec === 'number' && row.played_sec > 0 ? row.played_sec : null;
  const entry = {
    id: row.id,
    kind: row.kind as PrankKind,
    status,
    reason: String(row.reason ?? ''),
    engine: String(row.engine ?? ''),
    targetId: String(row.target),
    targetName,
    issuerName,
    created: String(row.created),
    deliveredAt: dateOrNull(row.delivered_at),
    doneAt: dateOrNull(row.done_at),
    playedSec,
    fromRepeat: typeof row.schedule === 'string' && row.schedule !== '',
  };
  return { ...entry, line: logLine(entry) };
}

/** One active repeat for the admin page. `names` maps user ids to display
 *  names, `sounds` sound ids to their library names. */
export function toSchedule(row: RecordModel, names: Map<string, string>, sounds: Map<string, string>): PrankSchedule {
  const targetName = names.get(String(row.target)) ?? 'someone';
  const soundName = sounds.get(String(row.sound)) ?? 'a sound';
  const intervalSec = Number(row.interval_sec) || 0;
  const params = (row.params ?? {}) as { mode?: unknown };
  return {
    id: row.id,
    targetId: String(row.target),
    targetName,
    soundName,
    intervalSec,
    mode: params.mode === 'duck' ? 'duck' : 'over',
    endsAt: String(row.ends_at ?? ''),
    nextFireAt: String(row.next_fire_at ?? ''),
    fired: Number(row.fired ?? 0),
    line: scheduleLine(soundName, targetName, intervalSec),
  };
}
