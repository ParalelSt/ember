import {
  COMMAND_TTL_MS,
  DROP_MS,
  MAX_DEVICES_PER_USER,
  MAX_PENDING_COMMANDS,
  SWEEP_MS,
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
  /** The tab that beats for this device (BeatBody.instance). */
  instance: string | null;
  /** Said goodbye (its page went away): stale at once. */
  gone: boolean;
}

interface UserRemote {
  rev: number;
  devices: Map<string, Entry>;
  /** deviceId to when it last asked for the state. */
  watchers: Map<string, number>;
  /** deviceId to the release of its held beat (one at most per device). */
  holds: Map<string, () => void>;
}

/** What pickActive needs of a device. */
export interface ActiveCandidate {
  deviceId: string;
  lastBeat: number;
  gone?: boolean;
  snapshot: (Pick<Snapshot, 'isPlaying' | 'changedAt'> & { trackId?: string | null }) | null;
}

const fresh = (d: { lastBeat: number; gone?: boolean }, now: number) => !d.gone && now - d.lastBeat <= STALE_MS;

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
    // A device with nothing loaded (an open, idle app) is never the one
    // the music is on.
    if (!d.snapshot || d.snapshot.trackId === null || !fresh(d, now) || now - d.snapshot.changedAt > TAKEOVER_WINDOW_MS) continue;
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
  /** Null when another tab of the same device is its player (a conflict). */
  beat(userId: string, body: BeatBody, now: number): BeatAnswer | null;
  /** The answer a device's beat gets now, without a beat (after a hold). */
  answer(userId: string, deviceId: string, now: number): BeatAnswer;
  /** Waits until a command comes in for the device, another device starts
   *  watching, a newer beat of the same device arrives, `signal` aborts, or
   *  `ms` pass. */
  hold(userId: string, deviceId: string, ms: number, signal?: AbortSignal): Promise<void>;
  /** `controlling`: the device that asks controls another one, so nothing
   *  plays on it (its last beat may still say so). */
  state(userId: string, deviceId: string, rev: number | null, now: number, controlling?: string | null): StateAnswer;
  command(userId: string, target: string, from: string | null, command: CommandBody, now: number): CommandResult;
  clear(): void;
  /** Accounts held in memory, for tests of the sweep. */
  _users(): number;
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
      u = { rev: 1, devices: new Map(), watchers: new Map(), holds: new Map() };
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

  /** Now and then, every account: old devices pruned, idle accounts dropped
   *  (nothing listed, nobody watching, nothing held). */
  let lastSweep = 0;
  const sweep = (now: number) => {
    if (now - lastSweep < SWEEP_MS) return;
    lastSweep = now;
    for (const [id, u] of users) {
      prune(u, now);
      if (u.devices.size === 0 && u.watchers.size === 0 && u.holds.size === 0) users.delete(id);
    }
  };

  /** Answers the device's held beat, if one waits. */
  const wake = (u: UserRemote, deviceId: string) => u.holds.get(deviceId)?.();

  const answerFor = (u: UserRemote, d: Entry, now: number): BeatAnswer => {
    let watchers = 0;
    for (const [id, at] of u.watchers) if (id !== d.deviceId && now - at <= WATCH_FRESH_MS) watchers++;
    const answer: BeatAnswer = {
      now,
      commands: d.pending.filter((c) => c.expiresAt > now),
      watchers,
      active: pickActive(candidates(u), now),
    };
    const { yieldTo } = decideTakeover(candidates(u), d.deviceId, now);
    if (yieldTo) answer.yield = { by: u.devices.get(yieldTo)!.label };
    return answer;
  };

  const push = (d: Entry, cmd: RemoteCommand) => {
    // One setQueue at a time: a newer one replaces one not run yet.
    if (cmd.type === 'setQueue') d.pending = d.pending.filter((c) => c.type !== 'setQueue');
    d.pending.push(cmd);
    if (d.pending.length > MAX_PENDING_COMMANDS) d.pending.splice(0, d.pending.length - MAX_PENDING_COMMANDS);
  };

  return {
    beat(userId, body, now) {
      sweep(now);
      const u = userOf(userId);
      prune(u, now);
      let d = u.devices.get(body.deviceId);
      // One player per device: another tab of it is refused while the one
      // that beats is alive (it says goodbye when it goes, or goes stale).
      if (d && body.instance && d.instance && d.instance !== body.instance && fresh(d, now)) return null;
      if (!d) {
        if (u.devices.size >= MAX_DEVICES_PER_USER) {
          let oldest: Entry | null = null;
          for (const e of u.devices.values()) if (!oldest || e.lastBeat < oldest.lastBeat) oldest = e;
          if (oldest) {
            wake(u, oldest.deviceId);
            u.devices.delete(oldest.deviceId);
          }
        }
        d = {
          deviceId: body.deviceId, label: body.label, platform: body.platform, shell: body.shell,
          browser: body.browser ?? null, lastBeat: now, snapshot: null, pending: [], stale: false,
          instance: null, gone: false,
        };
        u.devices.set(body.deviceId, d);
        u.rev++;
      }
      d.instance = body.bye ? null : body.instance ?? d.instance;
      d.gone = !!body.bye;
      const browser = body.browser ?? null;
      if (d.label !== body.label || d.platform !== body.platform || d.shell !== body.shell || d.browser !== browser) {
        d.label = body.label;
        d.platform = body.platform;
        d.shell = body.shell;
        d.browser = browser;
        u.rev++;
      }
      if (d.stale !== d.gone) {
        d.stale = d.gone;
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

      // A newer beat answers the one still held.
      wake(u, d.deviceId);
      if (d.gone) return answerFor(u, d, now);
      const { pause } = decideTakeover(candidates(u), d.deviceId, now);
      for (const id of pause) {
        const other = u.devices.get(id)!;
        if (other.pending.some((c) => c.type === 'pause' && c.issuedBy === null)) continue;
        push(other, {
          id: newId(), type: 'pause', args: { reason: 'took-over', by: d.label },
          issuedBy: null, issuedAt: now, expiresAt: now + COMMAND_TTL_MS,
        });
        wake(u, id);
      }
      const out = answerFor(u, d, now);
      if (want) out.want = want;
      return out;
    },

    answer(userId, deviceId, now) {
      sweep(now);
      const u = userOf(userId);
      prune(u, now);
      const d = u.devices.get(deviceId);
      if (!d) return { now, commands: [], watchers: 0, active: pickActive(candidates(u), now), want: 'full' };
      return answerFor(u, d, now);
    },

    hold(userId, deviceId, ms, signal) {
      const u = userOf(userId);
      wake(u, deviceId);
      return new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const release = () => {
          if (timer) clearTimeout(timer);
          timer = null;
          signal?.removeEventListener('abort', release);
          if (u.holds.get(deviceId) === release) u.holds.delete(deviceId);
          resolve();
        };
        if (signal?.aborted) {
          resolve();
          return;
        }
        u.holds.set(deviceId, release);
        timer = setTimeout(release, ms);
        signal?.addEventListener('abort', release);
      });
    },

    state(userId, deviceId, rev, now, controlling = null) {
      sweep(now);
      const u = userOf(userId);
      const seen = u.watchers.get(deviceId);
      u.watchers.set(deviceId, now);
      prune(u, now);
      // A new watcher: every held beat of the account hears it now, so the
      // player starts beating at the watched pace at once.
      if (seen === undefined || now - seen > WATCH_FRESH_MS) {
        for (const id of [...u.holds.keys()]) if (id !== deviceId) wake(u, id);
      }
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
      sweep(now);
      const u = userOf(userId);
      prune(u, now);
      const d = u.devices.get(target);
      if (!d || d.stale) {
        return { ok: false, status: 409, error: `${d?.label ?? 'That device'} is not reachable` };
      }
      const id = newId();
      push(d, { ...command, id, issuedBy: from, issuedAt: now, expiresAt: now + COMMAND_TTL_MS } as RemoteCommand);
      wake(u, target);
      return { ok: true, id };
    },

    clear() {
      for (const u of users.values()) for (const id of [...u.holds.keys()]) wake(u, id);
      users.clear();
      lastSweep = 0;
    },

    _users: () => users.size,
  };
}

const KEY = Symbol.for('ember.remote.store');

/** The process-wide store, on globalThis so every route bundle shares it. */
export function remoteStore(): RemoteStore {
  const g = globalThis as { [KEY]?: RemoteStore };
  g[KEY] ??= createRemoteStore();
  return g[KEY];
}
