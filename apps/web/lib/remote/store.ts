import {
  COMMAND_TTL_MS,
  DROP_MS,
  MAX_PENDING_COMMANDS,
  STALE_MS,
  TAKEOVER_WINDOW_MS,
  WATCH_FRESH_MS,
  type BeatAnswer,
  type BeatBody,
  type CommandBody,
  type LightDevice,
  type RemoteCommand,
  type RemoteDevice,
  type Snapshot,
  type StateAnswer,
} from './types';

/** Who plays where, per account, in server memory (one Next process, like
 *  lib/pranks/presence). No collection and no write per beat: it refills
 *  within one beat of a restart. Keyed by the session's user id only. */

interface Entry {
  deviceId: string;
  label: string;
  platform: RemoteDevice['platform'];
  shell: RemoteDevice['shell'];
  browser: RemoteDevice['browser'];
  lastBeat: number;
  snapshot: Snapshot | null;
  pending: RemoteCommand[];
  /** Whether it was stale at the last prune (a flip bumps the rev). */
  stale: boolean;
}

interface UserRemote {
  rev: number;
  devices: Map<string, Entry>;
  /** deviceId to when it last asked for the state. */
  watchers: Map<string, number>;
}

/** What pickActive needs of a device. */
export interface ActiveCandidate {
  deviceId: string;
  lastBeat: number;
  snapshot: Pick<Snapshot, 'isPlaying' | 'changedAt'> | null;
}

const fresh = (d: { lastBeat: number }, now: number) => now - d.lastBeat <= STALE_MS;

/** The device the music is on: among fresh devices, the playing one whose
 *  play state changed last; with none playing, the paused one that changed
 *  last, if that was inside the takeover window. Else none. */
export function pickActive(devices: ActiveCandidate[], now: number): string | null {
  let best: ActiveCandidate | null = null;
  for (const d of devices) {
    if (!d.snapshot?.isPlaying || !fresh(d, now)) continue;
    if (!best || d.snapshot.changedAt > best.snapshot!.changedAt) best = d;
  }
  if (best) return best.deviceId;
  for (const d of devices) {
    if (!d.snapshot || !fresh(d, now) || now - d.snapshot.changedAt > TAKEOVER_WINDOW_MS) continue;
    if (!best || d.snapshot.changedAt > best.snapshot!.changedAt) best = d;
  }
  return best?.deviceId ?? null;
}

/** One device at a time: when [me] plays, every other fresh device that
 *  also plays and started before it is told to stop. `yieldTo`: a device
 *  that started after me, so I am the one to stop. */
export function decideTakeover(
  devices: ActiveCandidate[],
  me: string,
  now: number,
): { pause: string[]; yieldTo: string | null } {
  const mine = devices.find((d) => d.deviceId === me);
  if (!mine?.snapshot?.isPlaying) return { pause: [], yieldTo: null };
  const pause: string[] = [];
  let yieldTo: ActiveCandidate | null = null;
  for (const d of devices) {
    if (d.deviceId === me || !d.snapshot?.isPlaying || !fresh(d, now)) continue;
    if (d.snapshot.changedAt <= mine.snapshot.changedAt) pause.push(d.deviceId);
    else if (!yieldTo || d.snapshot.changedAt > yieldTo.snapshot!.changedAt) yieldTo = d;
  }
  return { pause, yieldTo: yieldTo?.deviceId ?? null };
}

export type CommandResult =
  | { ok: true; id: string }
  | { ok: false; status: 409; error: string };

export interface RemoteStore {
  beat(userId: string, body: BeatBody, now: number): BeatAnswer;
  /** `controlling`: the device that asks controls another one, so nothing
   *  plays on it (its last beat may still say so). */
  state(userId: string, deviceId: string, rev: number | null, now: number, controlling?: string | null): StateAnswer;
  command(userId: string, target: string, from: string | null, command: CommandBody, now: number): CommandResult;
  clear(): void;
}

let seq = 0;
const newId = () => `${Date.now().toString(36)}${(seq++ % 1_000_000).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const sameLight = (s: Snapshot, b: { trackId: string | null; index: number; queueHash: string; isPlaying: boolean; volume: number; muted: boolean }) =>
  (s.track?.id ?? s.trackId) === b.trackId && s.index === b.index && s.queueHash === b.queueHash
  && s.isPlaying === b.isPlaying && s.volume === b.volume && s.muted === b.muted;

export function createRemoteStore(): RemoteStore {
  const users = new Map<string, UserRemote>();

  const userOf = (userId: string): UserRemote => {
    let u = users.get(userId);
    if (!u) {
      u = { rev: 1, devices: new Map(), watchers: new Map() };
      users.set(userId, u);
    }
    return u;
  };

  /** Drops old devices, watchers and expired commands; flips stale. */
  const prune = (u: UserRemote, now: number) => {
    for (const [id, d] of u.devices) {
      if (now - d.lastBeat > DROP_MS) {
        u.devices.delete(id);
        u.rev++;
        continue;
      }
      const stale = !fresh(d, now);
      if (stale !== d.stale) {
        d.stale = stale;
        u.rev++;
      }
      d.pending = d.pending.filter((c) => c.expiresAt > now);
    }
    for (const [id, at] of u.watchers) if (now - at > WATCH_FRESH_MS * 10) u.watchers.delete(id);
  };

  const candidates = (u: UserRemote): ActiveCandidate[] => [...u.devices.values()];

  const push = (d: Entry, cmd: RemoteCommand) => {
    // One setQueue at a time: a newer one replaces one not run yet.
    if (cmd.type === 'setQueue') d.pending = d.pending.filter((c) => c.type !== 'setQueue');
    d.pending.push(cmd);
    if (d.pending.length > MAX_PENDING_COMMANDS) d.pending.splice(0, d.pending.length - MAX_PENDING_COMMANDS);
  };

  return {
    beat(userId, body, now) {
      const u = userOf(userId);
      prune(u, now);
      let d = u.devices.get(body.deviceId);
      if (!d) {
        d = {
          deviceId: body.deviceId, label: body.label, platform: body.platform, shell: body.shell,
          browser: body.browser ?? null, lastBeat: now, snapshot: null, pending: [], stale: false,
        };
        u.devices.set(body.deviceId, d);
        u.rev++;
      }
      const browser = body.browser ?? null;
      if (d.label !== body.label || d.platform !== body.platform || d.shell !== body.shell || d.browser !== browser) {
        d.label = body.label;
        d.platform = body.platform;
        d.shell = body.shell;
        d.browser = browser;
        u.rev++;
      }
      if (d.stale) {
        d.stale = false;
        u.rev++;
      }
      d.lastBeat = now;
      if (body.acked.length) {
        const done = new Set(body.acked);
        d.pending = d.pending.filter((c) => !done.has(c.id));
      }

      const prev = d.snapshot;
      let want: 'full' | undefined;
      const state = body.full ?? body.light!;
      const changed = !prev || prev.isPlaying !== state.isPlaying || (prev.track?.id ?? prev.trackId) !== state.trackId;
      const changedAt = changed ? now : prev.changedAt;
      if (body.full) {
        d.snapshot = { ...body.full, at: now, changedAt };
        u.rev++;
      } else {
        const light = body.light!;
        if (!prev || prev.trackId !== light.trackId || prev.queueHash !== light.queueHash) want = 'full';
        if (!prev || !sameLight(prev, light)) u.rev++;
        d.snapshot = prev
          ? { ...prev, ...light, at: now, changedAt }
          : { ...light, track: null, upNext: [], queueLength: 0, loopMode: 'off', shuffle: false, context: null, at: now, changedAt };
      }
      // A "took over" pause from before this device last started playing
      // is old news: it started again since (the music moved back here).
      const startedAt = d.snapshot.isPlaying ? d.snapshot.changedAt : 0;
      d.pending = d.pending.filter((c) => !(c.type === 'pause' && c.issuedBy === null && c.issuedAt < startedAt));

      const { pause, yieldTo } = decideTakeover(candidates(u), d.deviceId, now);
      for (const id of pause) {
        const other = u.devices.get(id)!;
        if (other.pending.some((c) => c.type === 'pause' && c.issuedBy === null)) continue;
        push(other, {
          id: newId(), type: 'pause', args: { reason: 'took-over', by: d.label },
          issuedBy: null, issuedAt: now, expiresAt: now + COMMAND_TTL_MS,
        });
      }

      let watchers = 0;
      for (const [id, at] of u.watchers) if (id !== d.deviceId && now - at <= WATCH_FRESH_MS) watchers++;
      const answer: BeatAnswer = {
        now,
        commands: d.pending.filter((c) => c.expiresAt > now),
        watchers,
        active: pickActive(candidates(u), now),
      };
      if (want) answer.want = want;
      if (yieldTo) answer.yield = { by: u.devices.get(yieldTo)!.label };
      return answer;
    },

    state(userId, deviceId, rev, now, controlling = null) {
      const u = userOf(userId);
      u.watchers.set(deviceId, now);
      prune(u, now);
      const own = u.devices.get(deviceId);
      if (controlling && own?.snapshot?.isPlaying) {
        own.snapshot = { ...own.snapshot, isPlaying: false };
        u.rev++;
      }
      const active = pickActive(candidates(u), now);
      // A device is never listed to itself (a second tab on it included).
      const list = [...u.devices.values()].filter((d) => d.deviceId !== deviceId);
      if (rev !== null && rev === u.rev) {
        const devices: LightDevice[] = list.map((d) => ({
          deviceId: d.deviceId,
          position: d.snapshot?.position ?? 0,
          isPlaying: d.snapshot?.isPlaying ?? false,
          at: d.snapshot?.at ?? d.lastBeat,
        }));
        return { now, rev: u.rev, active, devices, light: true };
      }
      const devices: RemoteDevice[] = list.map((d) => ({
        deviceId: d.deviceId, label: d.label, platform: d.platform, shell: d.shell, browser: d.browser,
        lastBeat: d.lastBeat, stale: d.stale, snapshot: d.snapshot,
      }));
      return { now, rev: u.rev, active, devices };
    },

    command(userId, target, from, command, now) {
      const u = userOf(userId);
      prune(u, now);
      const d = u.devices.get(target);
      if (!d || d.stale) {
        return { ok: false, status: 409, error: `${d?.label ?? 'That device'} is not reachable` };
      }
      const id = newId();
      push(d, { ...command, id, issuedBy: from, issuedAt: now, expiresAt: now + COMMAND_TTL_MS } as RemoteCommand);
      return { ok: true, id };
    },

    clear() {
      users.clear();
    },
  };
}

const KEY = Symbol.for('ember.remote.store');

/** The process-wide store, on globalThis so every route bundle shares it. */
export function remoteStore(): RemoteStore {
  const g = globalThis as { [KEY]?: RemoteStore };
  g[KEY] ??= createRemoteStore();
  return g[KEY];
}
