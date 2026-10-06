import { normaliseParams, parsePbDate, PRANK_KINDS } from './limits';
import type { PrankAction, PrankEngine, PrankKind, PrankRow } from './types';

export interface DecideContext {
  isPlaying: boolean;
  hasTrack: boolean;
  engine: PrankEngine;
  /** Another prank is running on this device right now. */
  busy: boolean;
  pluginHasOverlay: boolean;
  now: number;
}

/** What the receiver should do with one prank. Pure: the unit tests hammer it.
 *  Sounds only while music is actually playing (owner decision). A device
 *  that is not playing never answers for a sound, whatever its engine: the
 *  person may be listening on another one. */
export function decidePrank(row: PrankRow, ctx: DecideContext): PrankAction {
  const expires = parsePbDate(row.expiresAt);
  if (!Number.isFinite(expires) || expires < ctx.now) return { type: 'ignore' };
  if (row.kind === 'ping') return { type: 'ack-only' };

  if (!row.streamUrl) return { type: 'skip', reason: 'error:no-media' };
  if (!ctx.hasTrack || !ctx.isPlaying) return { type: 'wait' };

  if (ctx.engine === 'native-stub') return { type: 'skip', reason: 'engine-unsupported' };
  if (ctx.busy) return { type: 'skip', reason: 'busy' };
  if (ctx.engine === 'android' && !ctx.pluginHasOverlay) return { type: 'skip', reason: 'engine-unsupported' };
  return { type: 'sound', url: row.streamUrl, volume: row.params.volume, duck: row.params.mode === 'duck' };
}

/** A pranks record (realtime event or inbox query) as the receiver sees it.
 *  Null for anything that is not a well-formed pending prank. */
export function toPrankRow(record: Record<string, unknown>): PrankRow | null {
  const kind = record.kind as PrankKind;
  if (typeof record.id !== 'string' || !PRANK_KINDS.includes(kind)) return null;
  if (record.status !== undefined && record.status !== 'pending') return null;
  const raw = (record.params && typeof record.params === 'object' ? record.params : {}) as Record<string, unknown>;
  const url = typeof raw.streamUrl === 'string' && raw.streamUrl.startsWith('/') ? raw.streamUrl : null;
  return {
    id: record.id,
    kind,
    params: normaliseParams(kind, raw),
    streamUrl: kind === 'ping' ? null : url,
    expiresAt: String(record.expires_at ?? record.expiresAt ?? ''),
  };
}
