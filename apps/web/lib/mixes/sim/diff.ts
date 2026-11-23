import type { SimMember, SimMix, SimRun, SimTrack } from './types';

/** Two mix measurement runs compared (tests/measure-mixes/README.md): per
 *  member, the mixes that appeared or disappeared, and per mix the songs
 *  that moved out (and where to) or came in (and from where). Pure, and
 *  free of runtime imports so tests/measure-mixes/diff.mjs can load it
 *  with plain node. */

export const GAME_ANIME_KEY = 'game-anime';

export interface SongRef {
  songKey: string;
  title: string;
  artist: string;
}

export interface MixDiff {
  key: string;
  title: string;
  /** Song counts; null when the mix is not in that run. */
  before: number | null;
  after: number | null;
  /** Each with the other mixes of the member that hold it after, or none. */
  movedOut: (SongRef & { to: string[] })[];
  /** Each with the mixes that held it before, or none (a new find). */
  added: (SongRef & { from: string[] })[];
  /** Radio songs by an artist with no family, before and after. */
  untaggedBefore: number;
  untaggedAfter: number;
}

export interface MemberDiff {
  userId: string;
  appeared: string[];
  disappeared: string[];
  mixes: MixDiff[];
  /** After: songs with a title signal in a style mix other than Game & Anime. */
  flagged: (SongRef & { mix: string; signal: string })[];
  gameAnime: { before: number | null; after: number | null };
  unrecognised: SimMember['unrecognised'];
  notes: SimMember['notes'];
}

export interface RunDiff {
  a: string;
  b: string;
  members: MemberDiff[];
}

const ref = (t: SimTrack): SongRef => ({ songKey: t.songKey, title: t.title, artist: t.artist });
const isStyle = (key: string) => !['discover', 'on-repeat', 'throwback'].includes(key) && !key.startsWith('artist-');

function holders(member: SimMember | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of member?.mixes ?? []) {
    for (const t of m.tracks) {
      const list = out.get(t.songKey) ?? [];
      if (!list.includes(m.key)) list.push(m.key);
      out.set(t.songKey, list);
    }
  }
  return out;
}

const untaggedNew = (m: SimMix | undefined) => (m ? m.tracks.filter((t) => !t.own && t.untagged).length : 0);

export function diffMember(userId: string, a: SimMember | undefined, b: SimMember | undefined): MemberDiff {
  const before = new Map((a?.mixes ?? []).map((m) => [m.key, m]));
  const after = new Map((b?.mixes ?? []).map((m) => [m.key, m]));
  const heldBefore = holders(a);
  const heldAfter = holders(b);
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  const order = (k: string) => after.get(k)?.position ?? before.get(k)?.position ?? 99;
  keys.sort((x, y) => order(x) - order(y) || x.localeCompare(y));
  const mixes: MixDiff[] = keys.map((key) => {
    const x = before.get(key);
    const y = after.get(key);
    const inX = new Set((x?.tracks ?? []).map((t) => t.songKey));
    const inY = new Set((y?.tracks ?? []).map((t) => t.songKey));
    return {
      key,
      title: y?.title ?? x?.title ?? key,
      before: x ? x.tracks.length : null,
      after: y ? y.tracks.length : null,
      movedOut: x && y ? x.tracks.filter((t) => !inY.has(t.songKey)).map((t) => ({ ...ref(t), to: (heldAfter.get(t.songKey) ?? []).filter((k) => k !== key) })) : [],
      added: x && y ? y.tracks.filter((t) => !inX.has(t.songKey)).map((t) => ({ ...ref(t), from: (heldBefore.get(t.songKey) ?? []).filter((k) => k !== key) })) : [],
      untaggedBefore: untaggedNew(x),
      untaggedAfter: untaggedNew(y),
    };
  });
  const flagged: MemberDiff['flagged'] = [];
  for (const m of b?.mixes ?? []) {
    if (!isStyle(m.key) || m.key === GAME_ANIME_KEY) continue;
    for (const t of m.tracks) if (t.signal) flagged.push({ ...ref(t), mix: m.key, signal: t.signal });
  }
  return {
    userId,
    appeared: keys.filter((k) => !before.has(k) && after.has(k)),
    disappeared: keys.filter((k) => before.has(k) && !after.has(k)),
    mixes,
    flagged,
    gameAnime: { before: before.get(GAME_ANIME_KEY)?.tracks.length ?? null, after: after.get(GAME_ANIME_KEY)?.tracks.length ?? null },
    unrecognised: b?.unrecognised ?? [],
    notes: b?.notes ?? [],
  };
}

export function diffRuns(a: SimRun, b: SimRun): RunDiff {
  const ma = new Map(a.members.map((m) => [m.userId, m]));
  const mb = new Map(b.members.map((m) => [m.userId, m]));
  const users = [...new Set([...ma.keys(), ...mb.keys()])].sort();
  return { a: a.label, b: b.label, members: users.map((u) => diffMember(u, ma.get(u), mb.get(u))) };
}

const song = (s: SongRef) => `"${s.title}" by ${s.artist}`;
const count = (n: number | null) => (n === null ? '-' : String(n));

/** The diff as plain text, member by member, then totals. */
export function formatDiff(d: RunDiff): string {
  const lines: string[] = [`${d.a} -> ${d.b}`];
  let moved = 0;
  let added = 0;
  let flagged = 0;
  for (const m of d.members) {
    lines.push('', `== member ${m.userId}`);
    if (m.appeared.length) lines.push(`  appeared: ${m.appeared.join(', ')}`);
    if (m.disappeared.length) lines.push(`  disappeared: ${m.disappeared.join(', ')}`);
    lines.push(`  game-anime: ${m.gameAnime.after === null ? 'no mix' : `${m.gameAnime.after} songs`} (before: ${m.gameAnime.before === null ? 'no mix' : m.gameAnime.before})`);
    for (const x of m.mixes) {
      const same = x.movedOut.length === 0 && x.added.length === 0 && x.before === x.after;
      lines.push(`  ${x.key.padEnd(22)} ${count(x.before).padStart(3)} -> ${count(x.after).padStart(3)}  unknown-artist finds ${x.untaggedBefore} -> ${x.untaggedAfter}${same ? '  (same songs)' : ''}`);
      for (const s of x.movedOut) lines.push(`      out: ${song(s)} -> ${s.to.length ? s.to.join(', ') : 'nowhere'}`);
      for (const s of x.added) lines.push(`      in:  ${song(s)} <- ${s.from.length ? s.from.join(', ') : 'new'}`);
      moved += x.movedOut.length;
      added += x.added.length;
    }
    for (const f of m.flagged) lines.push(`  FLAGGED (${f.signal} signal in ${f.mix}): ${song(f)}`);
    flagged += m.flagged.length;
    for (const n of m.notes) lines.push(`  note: ${n.message}${n.detail ? ` ${JSON.stringify(n.detail)}` : ''}`);
    if (m.unrecognised.length) {
      lines.push(`  unrecognised own songs (${m.unrecognised.length}):`);
      for (const u of m.unrecognised) lines.push(`      "${u.title}" by ${u.artist}`);
    }
  }
  lines.push('', `TOTAL moved out ${moved}, came in ${added}, flagged ${flagged}`);
  return lines.join('\n');
}
