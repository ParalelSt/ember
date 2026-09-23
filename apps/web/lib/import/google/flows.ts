import 'server-only';
import { randomBytes } from 'node:crypto';
import {
  GoogleError,
  pollToken,
  readLikes,
  requestDeviceCode,
  revokeTokens,
  YOUTUBE_READONLY_SCOPE,
  type GoogleConfig,
} from '@/lib/import/google/client';
import { parseYtmusicLiked, GOOGLE_MESSAGES, type GoogleFailure } from '@/lib/import/sources/ytmusicLiked';
import { needsMusicCheck } from '@/lib/import/musicCheck';
import type { ParsedSource } from '@/lib/import/sources/types';
import type { TransferPreview } from '@/app/api/import/upload/route';

/** Every Google sign-in in flight on this server, in memory and nowhere else.
 *
 *  A flow is one person's one sign-in: the device code Google handed out,
 *  then (for the minute it takes to read the likes) their access and refresh
 *  tokens, then the list of songs read. The tokens are revoked and dropped
 *  the moment the likes are read, and on cancel, on any error, and at the
 *  15-minute limit. None of it is ever written to PocketBase, to disk, to a
 *  log or into a response: the routes only ever see a flow's state, its
 *  user code and its preview.
 *
 *  Google is polled from here, at the interval it asks for, so the dialog
 *  only has to ask this server how things stand. Kept on globalThis because
 *  Next bundles each route separately: a plain module variable would give
 *  the start route and the status route a map each. */

export type FlowState = 'waiting' | 'reading' | 'ready' | 'denied' | 'expired' | 'error';

/** The whole life of a sign-in, from the code to the last chance to press
 *  Start. Google's own codes last 30 minutes; nobody needs that long. */
export const FLOW_TTL_MS = 15 * 60_000;
/** How long a finished sign-in still answers with how it ended, so the
 *  dialog's next poll reads "denied" rather than "gone". */
export const ENDED_GRACE_MS = 2 * 60_000;
/** More flows than this at once is not a group of friends. */
export const MAX_FLOWS = 200;
/** Google's minimum is 5 seconds; a fake may ask for less. */
const MIN_INTERVAL_MS = 1_000;
/** Consecutive hiccups while polling before giving up. */
const MAX_TRANSIENT = 5;

/** `count` is every like Google returned, songs or not. */
export interface GooglePreview extends TransferPreview {
  /** Likes YouTube Music still has to say are songs, during the transfer.
   *  The rest come from Topic channels, which are songs for sure. */
  toCheck: number;
}

interface Flow {
  id: string;
  userId: string;
  cfg: GoogleConfig;
  state: FlowState;
  message: string | null;
  deviceCode: string | null;
  tokens: { accessToken: string; refreshToken: string | null } | null;
  intervalMs: number;
  transient: number;
  parsed: ParsedSource | null;
  poll: ReturnType<typeof setTimeout> | null;
  deadline: ReturnType<typeof setTimeout> | null;
  abort: AbortController;
}

const KEY = Symbol.for('ember.googleLikeFlows');
type Store = Map<string, Flow>;
const flows = (): Store => {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  return (g[KEY] ??= new Map());
};

/** What a flow id looks like, checked before any lookup. */
export const FLOW_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

const SAMPLE_SIZE = 5;

export class FlowError extends Error {
  constructor(readonly reason: GoogleFailure, readonly status: number) {
    super(GOOGLE_MESSAGES[reason]);
    this.name = 'FlowError';
  }
}

function timer(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const t = setTimeout(fn, ms);
  (t as { unref?: () => void }).unref?.();
  return t;
}

const alive = (flow: Flow) => flows().get(flow.id) === flow;

/** Everything secret out of the flow, and the grant revoked at Google. Safe
 *  to call twice. */
async function forget(flow: Flow): Promise<void> {
  flow.deviceCode = null;
  if (flow.poll) clearTimeout(flow.poll);
  flow.poll = null;
  flow.abort.abort();
  const tokens = flow.tokens;
  flow.tokens = null;
  if (tokens) await revokeTokens(flow.cfg, tokens);
}

/** The flow's end: forget its secrets, say how it ended, and leave it long
 *  enough for the dialog to read that. */
function end(flow: Flow, state: Exclude<FlowState, 'waiting' | 'reading' | 'ready'>, message: string): Promise<void> {
  flow.state = state;
  flow.message = message;
  flow.parsed = null;
  if (flow.deadline) clearTimeout(flow.deadline);
  flow.deadline = timer(() => drop(flow), ENDED_GRACE_MS);
  return forget(flow);
}

function drop(flow: Flow): void {
  if (flow.deadline) clearTimeout(flow.deadline);
  flow.deadline = null;
  if (alive(flow)) flows().delete(flow.id);
  void forget(flow);
}

function schedulePoll(flow: Flow): void {
  flow.poll = timer(() => void poll(flow), flow.intervalMs);
}

async function poll(flow: Flow): Promise<void> {
  flow.poll = null;
  if (!alive(flow) || flow.state !== 'waiting' || !flow.deviceCode) return;
  const r = await pollToken(flow.cfg, flow.deviceCode, flow.abort.signal);
  if (!alive(flow) || flow.state !== 'waiting') {
    // Cancelled while Google was answering: a token that arrived anyway is
    // revoked at once.
    if (r.kind === 'token') await revokeTokens(flow.cfg, r);
    return;
  }
  switch (r.kind) {
    case 'pending':
      flow.transient = 0;
      return schedulePoll(flow);
    case 'slow_down':
      flow.intervalMs += 5_000;
      return schedulePoll(flow);
    case 'transient':
      if (++flow.transient >= MAX_TRANSIENT) return end(flow, 'error', GOOGLE_MESSAGES.unreachable);
      return schedulePoll(flow);
    case 'fail':
      return end(flow, r.reason === 'denied' ? 'denied' : r.reason === 'expired' ? 'expired' : 'error', GOOGLE_MESSAGES[r.reason]);
    case 'token':
      flow.deviceCode = null;
      flow.tokens = { accessToken: r.accessToken, refreshToken: r.refreshToken };
      // Google's granular consent lets a person untick the one scope Ember
      // asked for; then there is nothing to read.
      if (r.scope && !r.scope.split(/\s+/).includes(YOUTUBE_READONLY_SCOPE)) {
        return end(flow, 'denied', GOOGLE_MESSAGES.noScope);
      }
      flow.state = 'reading';
      return read(flow);
  }
}

async function read(flow: Flow): Promise<void> {
  const tokens = flow.tokens;
  if (!tokens) return;
  let result: Awaited<ReturnType<typeof readLikes>>;
  try {
    result = await readLikes(flow.cfg, tokens.accessToken, { signal: flow.abort.signal });
  } catch (e) {
    if (alive(flow) && flow.state === 'reading') {
      return end(flow, 'error', GOOGLE_MESSAGES[e instanceof GoogleError ? e.reason : 'readFailed']);
    }
    return forget(flow);
  }
  // Read: the sign-in has done its one job, so it goes now, before anything
  // else happens.
  flow.tokens = null;
  await revokeTokens(flow.cfg, tokens);
  if (!alive(flow) || flow.state !== 'reading') return;
  if (!result.songs.length) return end(flow, 'error', GOOGLE_MESSAGES.noLikes);
  flow.parsed = parseYtmusicLiked(result.songs, { truncated: result.truncated });
  flow.state = 'ready';
  // A fresh quarter of an hour to look at the preview and press Start.
  if (flow.deadline) clearTimeout(flow.deadline);
  flow.deadline = timer(() => drop(flow), FLOW_TTL_MS);
}

export interface StartedFlow {
  flowId: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

/** A new sign-in for this person. Any sign-in they already had going is
 *  cancelled first: one at a time is all anyone needs. */
export async function beginFlow(userId: string, cfg: GoogleConfig): Promise<StartedFlow> {
  for (const f of [...flows().values()]) if (f.userId === userId) drop(f);
  if (flows().size >= MAX_FLOWS) throw new FlowError('busy', 503);
  let code;
  try {
    code = await requestDeviceCode(cfg);
  } catch (e) {
    const reason = e instanceof GoogleError ? e.reason : 'unreachable';
    throw new FlowError(reason, reason === 'busy' ? 429 : reason === 'setupWrong' ? 503 : 502);
  }
  const expiresIn = Math.min(code.expiresIn, FLOW_TTL_MS / 1000);
  const flow: Flow = {
    id: randomBytes(18).toString('base64url'),
    userId,
    cfg,
    state: 'waiting',
    message: null,
    deviceCode: code.deviceCode,
    tokens: null,
    intervalMs: Math.max(MIN_INTERVAL_MS, code.interval * 1000),
    transient: 0,
    parsed: null,
    poll: null,
    deadline: null,
    abort: new AbortController(),
  };
  flows().set(flow.id, flow);
  flow.deadline = timer(() => {
    if (flow.state === 'waiting' || flow.state === 'reading') void end(flow, 'expired', GOOGLE_MESSAGES.expired);
    else drop(flow);
  }, expiresIn * 1000);
  schedulePoll(flow);
  return {
    flowId: flow.id,
    userCode: code.userCode,
    verificationUrl: code.verificationUrl,
    expiresIn,
    interval: flow.intervalMs / 1000,
  };
}

function mine(userId: string, flowId: string): Flow | null {
  const flow = flows().get(flowId);
  return flow && flow.userId === userId ? flow : null;
}

export interface FlowStatus {
  state: FlowState;
  preview?: GooglePreview;
  message?: string;
}

/** How a sign-in stands, or null when there is no such sign-in for this
 *  person (never started, someone else's, or long over). */
export function flowStatus(userId: string, flowId: string): FlowStatus | null {
  const flow = mine(userId, flowId);
  if (!flow) return null;
  if (flow.state === 'ready' && flow.parsed) {
    const p = flow.parsed;
    return {
      state: 'ready',
      preview: {
        kind: p.kind,
        label: p.label,
        order: p.order,
        count: p.items.length,
        dropped: p.dropped,
        truncated: p.truncated,
        sample: p.items.slice(0, SAMPLE_SIZE).map((i) => ({ title: i.title, artist: i.artist })),
        toCheck: p.items.filter((i) => needsMusicCheck(i.candidates ?? [])).length,
      },
    };
  }
  return flow.message ? { state: flow.state, message: flow.message } : { state: flow.state };
}

/** The songs of a ready sign-in, taken once: the flow is gone afterwards. */
export function takeFlow(userId: string, flowId: string): ParsedSource | null {
  const flow = mine(userId, flowId);
  if (!flow || flow.state !== 'ready' || !flow.parsed) return null;
  const parsed = flow.parsed;
  drop(flow);
  return parsed;
}

/** Cancel: revoke whatever Google handed out and forget the flow. */
export async function cancelFlow(userId: string, flowId: string): Promise<boolean> {
  const flow = mine(userId, flowId);
  if (!flow) return false;
  flows().delete(flow.id);
  if (flow.deadline) clearTimeout(flow.deadline);
  flow.deadline = null;
  await forget(flow);
  return true;
}

/** For the tests: how many flows are held, and whether any still holds a
 *  secret. Never reveals one. */
export function _flowStats(): { flows: number; holdingSecrets: number } {
  const all = [...flows().values()];
  return { flows: all.length, holdingSecrets: all.filter((f) => f.tokens || f.deviceCode).length };
}

export function _resetFlows(): void {
  for (const f of [...flows().values()]) drop(f);
  flows().clear();
}
