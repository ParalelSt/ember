/** Songsterr's tab data to alphaTex. Pure: no
 *  fetching, no server, so the unit tests drive it with fixtures.
 *
 *  What a browser gets from Songsterr, checked live on 2026-09-19:
 *
 *   - the song page `/a/wsa/<slug>-tab-s<songId>` carries its state as
 *     plain JSON in `<script id="state" type="application/json">`:
 *     `meta.current` has `songId`, `revisionId`, `image` and `tracks[]`
 *     (each with `partId`, `name`, `instrument`, `instrumentId`, `tuning`
 *     high string first, `isGuitar`, `isBassGuitar`, `isDrums`,
 *     `isVocalTrack`, `isEmpty`, `views`);
 *   - each track's notes are a static file on Songsterr's CDN,
 *     `<cdn>/<songId>/<revisionId>/<image>/<partId>.json`, plain gzip JSON
 *     with no cookie, signature or expiry: `measures[].voices[].beats[]`,
 *     a beat's `duration` as a fraction of a whole note with `type` (the
 *     note value), `dots` and `tuplet`, and `notes[]` with `string` (0 is
 *     the top line), `fret`, `tie`, `dead`, `ghost` and effects; a measure's
 *     `signature` when it changes and `marker` for a section; the part's
 *     `tuning`, and `automations.tempo[]` with `measure`, `position` and
 *     `bpm` for the note value `type`.
 *
 *  One alphaTex file per song, one staff per chosen track (guitars, bass),
 *  so the tab page's instrument picker switches between them and every
 *  instrument shares one timeline (and one alignment). Repeats are written
 *  out, like pasted text tabs, so the tab's clock runs straight through
 *  like the recording does. Anything this does not know is left out and
 *  counted in the report, never an error. */

import { sameSong } from '@/lib/tabFetch/ug';

// ── the song page ─────────────────────────────────────────────────────────

export interface SongsterrTrack {
  partId: number;
  /** "Barry Stock | Ibanez Iceman | Lead Guitar". */
  name: string;
  /** "Distortion Guitar". */
  instrument: string;
  /** General MIDI program (1024 is drums). */
  instrumentId: number;
  /** MIDI note per string, top line (highest) first. */
  tuning: number[];
  isGuitar: boolean;
  isBass: boolean;
  isDrums: boolean;
  isVocal: boolean;
  isEmpty: boolean;
  views: number;
}

export interface SongsterrSongPage {
  songId: number;
  revisionId: number;
  /** The CDN path segment of this revision's files. */
  image: string;
  title: string;
  artist: string;
  tracks: SongsterrTrack[];
  /** The page says the tab is restricted or blocked: Ember leaves it. */
  restricted: boolean;
}

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** The page's `<script id="state">` JSON, or null. */
export function readSongsterrState(html: string): Record<string, unknown> | null {
  const m = /<script[^>]*\bid="state"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try {
    return obj(JSON.parse(m[1]));
  } catch {
    return null;
  }
}

/** A GM program is a guitar (24 to 31) or a bass (32 to 39). */
const isGuitarProgram = (p: number) => p >= 24 && p <= 31;
const isBassProgram = (p: number) => p >= 32 && p <= 39;

function toTrack(raw: unknown): SongsterrTrack | null {
  const t = obj(raw);
  if (!t || !Number.isInteger(t.partId)) return null;
  const instrumentId = num(t.instrumentId, -1);
  const tuning = Array.isArray(t.tuning) ? t.tuning.filter((n): n is number => Number.isInteger(n)).slice(0, 10) : [];
  const isDrums = t.isDrums === true || instrumentId === 1024;
  return {
    partId: t.partId as number,
    name: str(t.name).slice(0, 200),
    instrument: str(t.instrument).slice(0, 60),
    instrumentId,
    tuning,
    isGuitar: t.isGuitar === true || (t.isGuitar === undefined && isGuitarProgram(instrumentId)),
    isBass: t.isBassGuitar === true || (t.isBassGuitar === undefined && isBassProgram(instrumentId)),
    isDrums,
    isVocal: t.isVocalTrack === true,
    isEmpty: t.isEmpty === true,
    views: num(t.views),
  };
}

/** The song page to what Ember needs, or null when it is not a tab page. */
export function parseSongsterrPage(html: string): SongsterrSongPage | null {
  const state = readSongsterrState(html);
  const cur = obj(obj(state?.meta)?.current);
  if (!cur) return null;
  const songId = cur.songId;
  const revisionId = cur.revisionId;
  const image = str(cur.image);
  if (!Number.isInteger(songId) || !Number.isInteger(revisionId) || !/^[A-Za-z0-9_-]{1,80}$/.test(image)) return null;
  const tracks = (Array.isArray(cur.tracks) ? cur.tracks : []).map(toTrack).filter((t): t is SongsterrTrack => !!t);
  return {
    songId: songId as number,
    revisionId: revisionId as number,
    image,
    title: str(cur.title).slice(0, 200),
    artist: str(cur.artist).slice(0, 200),
    tracks,
    restricted: cur.isRestricted === true || cur.isBlocked === true || (typeof cur.restriction === 'string' && cur.restriction !== ''),
  };
}

// ── the search ────────────────────────────────────────────────────────────

export interface SongsterrHit {
  songId: number;
  title: string;
  artist: string;
}

/** `/api/songs?pattern=` JSON to hits, junk left out. Null when it is not
 *  Songsterr's answer at all (a block page, an error page). */
export function parseSongsterrSearch(raw: unknown): SongsterrHit[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SongsterrHit[] = [];
  for (const r of raw) {
    const o = obj(r);
    if (!o || !Number.isInteger(o.songId) || !str(o.title) || o.isJunk === true) continue;
    out.push({ songId: o.songId as number, title: str(o.title).slice(0, 200), artist: str(o.artist).slice(0, 200) });
  }
  return out;
}

/** The hits that are this song (lib/tabFetch/ug.ts sameSong: the same
 *  title words, a shared artist word), a plain title before a bracketed
 *  variant ("(Acoustic)", "(Standard Tuning)"), then Songsterr's order. */
export function chooseSongsterrSongs(hits: SongsterrHit[], song: { title: string; artist: string }): SongsterrHit[] {
  const bracketed = (h: SongsterrHit) => Number(/[([]/.test(h.title));
  return hits
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => sameSong({ songName: h.title, artistName: h.artist }, song.title, song.artist))
    .sort((a, b) => bracketed(a.h) - bracketed(b.h) || a.i - b.i)
    .map(({ h }) => h);
}

/** Parts Ember fetches per song, at most: the guitars and the bass. Each is
 *  one request to Songsterr's CDN. */
export const MAX_PARTS = 4;

/** The tracks worth drawing: guitars (most played first), then the bass,
 *  at most `max`. Vocals, drums, keys and empty tracks are left out. */
export function chooseSongsterrTracks(tracks: SongsterrTrack[], max = MAX_PARTS): SongsterrTrack[] {
  const usable = tracks.filter((t) => !t.isEmpty && !t.isVocal && !t.isDrums && t.tuning.length >= 4);
  const guitars = usable.filter((t) => t.isGuitar && !t.isBass).sort((a, b) => b.views - a.views);
  const bass = usable.filter((t) => t.isBass).sort((a, b) => b.views - a.views)[0];
  if (!bass) return guitars.slice(0, max);
  return [...guitars.slice(0, Math.max(0, max - 1)), bass];
}

/** A part file's URL on the CDN. */
export function partUrl(cdnBase: string, page: Pick<SongsterrSongPage, 'songId' | 'revisionId' | 'image'>, partId: number): string {
  return `${cdnBase.replace(/\/+$/, '')}/${page.songId}/${page.revisionId}/${page.image}/${partId}.json`;
}

/** Songsterr's own URL for a song (the slug is cosmetic: it resolves on
 *  the trailing -s<id>). */
export function songsterrPageUrl(base: string, song: { songId: number; artist: string; title: string }): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'song';
  return `${base.replace(/\/+$/, '')}/a/wsa/${slug(song.artist)}-${slug(song.title)}-tab-s${song.songId}`;
}

/** "Barry Stock | Ibanez Iceman | Lead Guitar" -> "Lead Guitar": the part
 *  of Songsterr's track name that says what it plays, else the last part,
 *  else the instrument. */
export function trackLabel(t: Pick<SongsterrTrack, 'name' | 'instrument' | 'isBass'>): string {
  const parts = t.name
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);
  const role = [...parts].reverse().find((p) => /guitar|bass|lead|rhythm|solo|harmon|acoustic|riff|clean|overdub/i.test(p));
  const label = role ?? parts[parts.length - 1] ?? (t.instrument || (t.isBass ? 'Bass' : 'Guitar'));
  return label.slice(0, 60);
}

// ── the part JSON ─────────────────────────────────────────────────────────

export interface SongsterrNote {
  string?: number;
  fret?: number;
  rest?: boolean;
  tie?: boolean;
  dead?: boolean;
  ghost?: boolean;
  [effect: string]: unknown;
}

export interface SongsterrBeat {
  duration?: [number, number];
  type?: number;
  dots?: number;
  tuplet?: number;
  rest?: boolean;
  notes?: SongsterrNote[];
  [effect: string]: unknown;
}

export interface SongsterrMeasure {
  voices?: { beats?: SongsterrBeat[]; rest?: boolean }[];
  signature?: [number, number];
  marker?: { text?: string };
  rest?: boolean;
  repeatStart?: boolean;
  repeatClose?: boolean;
  repeat?: number;
  alternateEnding?: number[] | number;
  anacrusis?: boolean;
  [key: string]: unknown;
}

export interface SongsterrTempo {
  measure: number;
  position?: number;
  bpm: number;
  /** The note value the bpm counts (4: quarter notes). */
  type?: number;
}

export interface SongsterrPart {
  name?: string;
  instrument?: string;
  instrumentId?: number;
  tuning?: number[];
  strings?: number;
  capo?: number;
  partId?: number;
  measures: SongsterrMeasure[];
  automations?: { tempo?: SongsterrTempo[] };
  anacrusis?: boolean;
}

/** A part file as fetched, or null when it has no measures. */
export function readSongsterrPart(raw: unknown): SongsterrPart | null {
  const p = obj(raw);
  if (!p || !Array.isArray(p.measures) || p.measures.length === 0) return null;
  return p as unknown as SongsterrPart;
}

// ── conversion ────────────────────────────────────────────────────────────

export interface SongsterrTrackReport {
  name: string;
  label: string;
  strings: number;
  /** "D A F C G C" low to high. */
  tuning: string;
  notes: number;
}

export interface SongsterrReport {
  tracks: SongsterrTrackReport[];
  /** Bars as played (repeats written out). */
  bars: number;
  /** Bars as Songsterr lists them. */
  measures: number;
  tempo: number;
  tempoChanges: number;
  signatureChanges: number;
  anacrusis: boolean;
  repeatsWrittenOut: number;
  tuplets: number;
  dotted: number;
  /** Beats whose `duration` disagreed with their note value (written from
   *  `duration`). */
  durationFixes: number;
  /** Effects Ember does not draw, by name, with how often they occurred. */
  ignored: Record<string, number>;
  /** Voices past the second, left out. */
  droppedVoices: number;
}

export type SongsterrResult =
  | { ok: true; alphaTex: string; report: SongsterrReport }
  | { ok: false; error: string };

export interface SongsterrInputTrack {
  track: Pick<SongsterrTrack, 'name' | 'instrument' | 'instrumentId' | 'tuning' | 'isBass'>;
  part: SongsterrPart;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function midiName(n: number): string {
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

function escapeTex(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
}

/** Whole-note fractions as exact rationals: [numerator, denominator]. */
type Frac = [number, number];
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const frac = (n: number, d: number): Frac => {
  const g = gcd(n, d) || 1;
  return [n / g, d / g];
};
const add = (a: Frac, b: Frac): Frac => frac(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const sub = (a: Frac, b: Frac): Frac => frac(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const cmp = (a: Frac, b: Frac) => a[0] * b[1] - b[0] * a[1];

const VALUES = [1, 2, 4, 8, 16, 32, 64];
const TUPLETS: Record<number, number> = { 3: 2, 5: 4, 6: 4, 7: 4, 9: 8, 10: 8, 12: 8 };

/** The length of a note value with dots and a tuplet, as a whole-note
 *  fraction. */
function valueLength(type: number, dots: number, tuplet: number): Frac {
  let f: Frac = frac(1, type);
  if (dots === 1) f = frac(3, type * 2);
  if (dots === 2) f = frac(7, type * 4);
  const normal = TUPLETS[tuplet];
  if (normal) f = frac(f[0] * normal, f[1] * tuplet);
  return f;
}

interface Written {
  type: number;
  dots: number;
  tuplet: number;
}

/** A beat's alphaTex duration. Songsterr's `type`, `dots` and `tuplet`
 *  when they agree with its `duration`; otherwise a value found from the
 *  duration alone; null when nothing fits (the beat is then split). */
function writtenFor(beat: SongsterrBeat): { w: Written | null; length: Frac; fixed: boolean } {
  const d = Array.isArray(beat.duration) && beat.duration.length === 2 && beat.duration[0] > 0 && beat.duration[1] > 0
    ? frac(beat.duration[0], beat.duration[1])
    : null;
  const type = num(beat.type, 0);
  const dots = Math.min(2, Math.max(0, Math.round(num(beat.dots, 0))));
  const tuplet = num(beat.tuplet, 0);
  if (VALUES.includes(type)) {
    const w = { type, dots, tuplet: TUPLETS[tuplet] ? tuplet : 0 };
    const length = valueLength(w.type, w.dots, w.tuplet);
    if (!d || cmp(length, d) === 0) return { w, length, fixed: false };
  }
  if (!d) return { w: { type: 4, dots: 0, tuplet: 0 }, length: frac(1, 4), fixed: true };
  for (const t of [0, 3, 5, 6, 7, 9, 10, 12]) {
    for (const dt of [0, 1, 2]) {
      for (const v of VALUES) {
        if (cmp(valueLength(v, dt, t), d) === 0) return { w: { type: v, dots: dt, tuplet: t }, length: d, fixed: true };
      }
    }
  }
  return { w: null, length: d, fixed: true };
}

/** Rests that fill `length` exactly (largest values first, then a
 *  triplet 64th for anything odd, which does not occur in practice). */
function restsFor(length: Frac): string[] {
  const out: string[] = [];
  let left = length;
  for (let guard = 0; guard < 64 && left[0] > 0; guard++) {
    const v = VALUES.find((x) => cmp(frac(1, x), left) <= 0);
    if (v) {
      out.push(`r.${v}`);
      left = sub(left, frac(1, v));
      continue;
    }
    out.push('r.64{tu 3}');
    left = sub(left, valueLength(64, 0, 3));
    if (left[0] < 0) break;
  }
  return out;
}

const durationToken = (w: Written) => String(w.type);

/** Bend points to alphaTex's exact bend: (position value) pairs with
 *  position 0..60 and value in quarter tones (Songsterr's tone 25 is a
 *  quarter tone, 100 a whole tone). */
function bendProp(bend: unknown): string | null {
  const b = obj(bend);
  const points = Array.isArray(b?.points) ? (b.points as unknown[]).map(obj).filter((p): p is Record<string, unknown> => !!p) : [];
  if (points.length >= 2) {
    const pairs = points
      .slice(0, 12)
      .map((p) => `${Math.max(0, Math.min(60, Math.round(num(p.position))))} ${Math.max(-12, Math.min(12, Math.round(num(p.tone) / 25)))}`);
    return `be (${pairs.join(' ')})`;
  }
  const tone = num(b?.tone, 0);
  if (tone) return `b (0 ${Math.round(tone / 25)})`;
  return null;
}

const SLIDES: Record<string, string> = {
  shift: 'ss',
  legato: 'sl',
  intoFromBelow: 'sib',
  intoFromAbove: 'sia',
  outDownwards: 'sod',
  outUpwards: 'sou',
  below: 'sib',
  above: 'sia',
  downwards: 'sod',
  upwards: 'sou',
};

const HARMONICS: Record<string, string> = {
  natural: 'nh',
  artificial: 'ah',
  pinch: 'ph',
  tap: 'th',
  tapped: 'th',
  semi: 'sh',
  feedback: 'fh',
};

/** Note keys that are data, not effects. */
const NOTE_DATA = new Set(['string', 'fret', 'rest', 'tie']);
/** Beat keys that are data or layout, not effects. */
const BEAT_DATA = new Set([
  'duration',
  'type',
  'dots',
  'tuplet',
  'tupletStart',
  'tupletStop',
  'rest',
  'notes',
  'beamStart',
  'beamStop',
  'velocity',
  'text',
  'palmMute',
  'letRing',
  'upStroke',
  'downStroke',
]);

class Counter {
  readonly map: Record<string, number> = {};
  add(key: string) {
    this.map[key] = (this.map[key] ?? 0) + 1;
  }
}

/** One note's alphaTex, or null for a rest or a string off the staff. */
function noteTex(n: SongsterrNote, strings: number, beatFx: string[], ignored: Counter): string | null {
  if (n.rest) return null;
  const s = num(n.string, -1);
  if (!Number.isInteger(s) || s < 0 || s >= strings) return null;
  const line = s + 1;
  if (n.tie) return `-.${line}`;
  const fret = Math.max(0, Math.round(num(n.fret, 0)));
  const fx: string[] = [...beatFx];
  for (const [k, v] of Object.entries(n)) {
    if (NOTE_DATA.has(k) || v === false || v === null || v === undefined) continue;
    if (k === 'dead') fx.push('x');
    else if (k === 'ghost') fx.push('g');
    else if (k === 'hp' || k === 'hammerOn' || k === 'pullOff' || k === 'legato') fx.push('h');
    else if (k === 'slide' && typeof v === 'string' && SLIDES[v]) fx.push(SLIDES[v]);
    else if (k === 'bend' || k === 'whammy') {
      const p = k === 'bend' ? bendProp(v) : null;
      if (p) fx.push(p);
      else ignored.add(k);
    } else if (k === 'vibrato' || k === 'leftHandVibrato') fx.push(v === 'wide' ? 'vw' : 'v');
    else if (k === 'wideVibrato') fx.push('vw');
    else if (k === 'staccato') fx.push('st');
    else if (k === 'palmMute') fx.push('pm');
    else if (k === 'letRing') fx.push('lr');
    else if (k === 'accentuated' || k === 'accent') fx.push('ac');
    else if (k === 'heavyAccentuated') fx.push('hac');
    else if (k === 'harmonic' && typeof v === 'string' && HARMONICS[v]) fx.push(HARMONICS[v]);
    else if (k === 'tapping' || k === 'tap') fx.push('t');
    else ignored.add(k);
  }
  const uniq = [...new Set(fx)];
  return `${fret}.${line}${uniq.length ? `{${uniq.join(' ')}}` : ''}`;
}

/** A beat's alphaTex: its notes (or a rest), duration and beat effects. */
function beatTex(beat: SongsterrBeat, strings: number, extra: string[], ignored: Counter, report: SongsterrReport): { tex: string[]; length: Frac } {
  const { w, length, fixed } = writtenFor(beat);
  if (fixed) report.durationFixes++;
  const beatFx: string[] = [];
  if (beat.palmMute) beatFx.push('pm');
  if (beat.letRing) beatFx.push('lr');
  for (const [k, v] of Object.entries(beat)) {
    if (BEAT_DATA.has(k) || v === false || v === null || v === undefined) continue;
    ignored.add(k);
  }
  const notes = (beat.rest ? [] : (beat.notes ?? [])).map((n) => noteTex(n, strings, beatFx, ignored)).filter((t): t is string => !!t);
  if (!w) {
    // No single value fits: rests of the right total, the notes dropped.
    return { tex: restsFor(length), length };
  }
  const props: string[] = [...extra];
  if (w.dots === 1) {
    props.push('d');
    report.dotted++;
  }
  if (w.dots === 2) {
    props.push('dd');
    report.dotted++;
  }
  if (w.tuplet) {
    props.push(`tu ${w.tuplet}`);
    report.tuplets++;
  }
  if (beat.upStroke) props.push('su');
  if (beat.downStroke) props.push('sd');
  const text = obj(beat.text)?.text ?? (typeof beat.text === 'string' ? beat.text : '');
  if (typeof text === 'string' && text.trim()) props.push(`txt "${escapeTex(text.trim().slice(0, 80))}"`);
  const body = notes.length === 0 ? 'r' : notes.length === 1 ? notes[0] : `(${notes.join(' ')})`;
  const tex = `${body}.${durationToken(w)}${props.length ? `{${props.join(' ')}}` : ''}`;
  return { tex: [tex], length };
}

/** The bars in the order they are played: repeats and alternate endings
 *  written out. Guarded against a malformed loop. */
export function playOrder(measures: SongsterrMeasure[]): { order: number[]; repeats: number } {
  const order: number[] = [];
  let repeats = 0;
  let start = 0;
  let pass = 1;
  let i = 0;
  const limit = Math.max(2000, measures.length * 8);
  while (i < measures.length && order.length < limit) {
    const m = measures[i] ?? {};
    if (m.repeatStart && i !== start && pass === 1) start = i;
    const endings = Array.isArray(m.alternateEnding)
      ? m.alternateEnding.filter((n) => Number.isInteger(n))
      : Number.isInteger(m.alternateEnding)
        ? [m.alternateEnding as number]
        : [];
    const plays = endings.length === 0 || endings.includes(pass);
    if (plays) order.push(i);
    const count = Number.isInteger(m.repeat) && (m.repeat as number) >= 2 ? (m.repeat as number) : m.repeatClose ? 2 : 0;
    if (plays && count && pass < count) {
      pass++;
      repeats++;
      i = start;
      continue;
    }
    if (count && plays) {
      pass = 1;
      start = i + 1;
    }
    i++;
  }
  return { order, repeats };
}

/** The tempo in quarter notes per minute from an automation. */
function quarterBpm(t: SongsterrTempo): number {
  const type = num(t.type, 4) || 4;
  return num(t.bpm) * (4 / type);
}

function fmtBpm(bpm: number): string {
  const r = Math.round(bpm * 100) / 100;
  return String(Math.max(20, Math.min(400, r)));
}

/** "Rhythm Guitar" -> "Rhythm Gtr": the short name AlphaTab puts beside
 *  a staff. */
function shortLabel(label: string): string {
  return label.replace(/guitar/gi, 'Gtr').slice(0, 12);
}

/** Songsterr parts to one multi-track alphaTex document. */
export function songsterrToAlphaTex(input: SongsterrInputTrack[], meta: { title: string; artist: string }): SongsterrResult {
  const tracks = input.filter((t) => Array.isArray(t.part?.measures) && t.part.measures.length > 0);
  if (tracks.length === 0) return { ok: false, error: 'No Songsterr part with bars.' };

  const master = tracks[0].part;
  const measureCount = Math.max(...tracks.map((t) => t.part.measures.length));
  // Repeats, signatures and markers are the song's, the same in every part;
  // read them from whichever part has them.
  const structure: SongsterrMeasure[] = Array.from({ length: measureCount }, (_, i) => {
    const merged: SongsterrMeasure = {};
    for (const t of tracks) {
      const m = t.part.measures[i];
      if (!m) continue;
      for (const k of ['repeatStart', 'repeatClose', 'repeat', 'alternateEnding', 'signature', 'marker', 'anacrusis'] as const) {
        if (merged[k] === undefined && m[k] !== undefined) (merged as Record<string, unknown>)[k] = m[k];
      }
    }
    return merged;
  });
  const { order, repeats } = playOrder(structure);

  // The time signature in force at every Songsterr measure.
  const sigs: Frac[] = [];
  const sigText: string[] = [];
  let sig: [number, number] = [4, 4];
  for (let i = 0; i < measureCount; i++) {
    const s = structure[i].signature;
    if (Array.isArray(s) && Number.isInteger(s[0]) && Number.isInteger(s[1]) && s[0] > 0 && VALUES.includes(s[1])) sig = [s[0], s[1]];
    sigs.push(frac(sig[0], sig[1]));
    sigText.push(`${sig[0]} ${sig[1]}`);
  }

  // Tempo: the automations of the first part that has any.
  const autos = (tracks.find((t) => (t.part.automations?.tempo ?? []).length > 0)?.part.automations?.tempo ?? [])
    .filter((t) => Number.isInteger(t.measure) && num(t.bpm) > 0)
    .map((t) => ({ measure: t.measure, position: Math.max(0, Math.round(num(t.position))), bpm: quarterBpm(t) }))
    .sort((a, b) => a.measure - b.measure || a.position - b.position);
  const firstBpm = autos.find((a) => a.measure === 0 && a.position === 0)?.bpm ?? autos[0]?.bpm ?? 120;
  /** The tempo in force when a measure starts. */
  const tempoAtStart = (m: number) => {
    let bpm = firstBpm;
    for (const a of autos) {
      if (a.measure < m || (a.measure === m && a.position === 0)) bpm = a.bpm;
      else break;
    }
    return bpm;
  };

  const report: SongsterrReport = {
    tracks: [],
    bars: order.length,
    measures: measureCount,
    tempo: Math.round(firstBpm * 100) / 100,
    tempoChanges: 0,
    signatureChanges: 0,
    anacrusis: false,
    repeatsWrittenOut: repeats,
    tuplets: 0,
    dotted: 0,
    durationFixes: 0,
    ignored: {},
    droppedVoices: 0,
  };
  const ignored = new Counter();

  // A pickup: the first bar is marked so, or holds less than its signature.
  const firstLen = (() => {
    const m = master.measures[order[0] ?? 0];
    let len: Frac = [0, 1];
    for (const b of m?.voices?.[0]?.beats ?? []) len = add(len, writtenFor(b).length);
    return len;
  })();
  const anacrusis =
    order[0] === 0 &&
    (master.anacrusis === true || structure[0].anacrusis === true || (firstLen[0] > 0 && cmp(firstLen, sigs[0]) < 0));
  report.anacrusis = anacrusis;

  const head = [`\\title "${escapeTex(meta.title || 'Untitled')}"`];
  if (meta.artist) head.push(`\\artist "${escapeTex(meta.artist)}"`);
  head.push(`\\tempo ${fmtBpm(firstBpm)}`);

  const trackTexts: string[] = [];
  tracks.forEach(({ track, part }, ti) => {
    const tuning = (Array.isArray(part.tuning) && part.tuning.length >= 4 ? part.tuning : track.tuning).filter((n) => Number.isInteger(n));
    const strings = tuning.length;
    const label = trackLabel({ name: track.name || part.name || '', instrument: track.instrument || part.instrument || '', isBass: track.isBass });
    const program = Number.isInteger(part.instrumentId) ? (part.instrumentId as number) : track.instrumentId;
    const lines: string[] = [
      `\\track ("${escapeTex(label)}" "${escapeTex(shortLabel(label))}")`,
      '\\staff {tabs}',
      ...(program >= 0 && program < 128 ? [`\\instrument ${program}`] : []),
      `\\tuning (${tuning.map(midiName).join(' ')})`,
      ...(num(part.capo) > 0 ? [`\\capo ${Math.round(num(part.capo))}`] : []),
    ];
    const voiceCount = Math.min(2, Math.max(1, ...part.measures.map((m) => m.voices?.length ?? 1)));
    report.droppedVoices += part.measures.reduce((n, m) => n + Math.max(0, (m.voices?.length ?? 0) - 2), 0);
    let notes = 0;

    for (let v = 0; v < voiceCount; v++) {
      if (voiceCount > 1) lines.push('\\voice');
      const bars: string[] = [];
      let prevSig = '';
      let tempo = firstBpm;
      order.forEach((mi, k) => {
        const m = part.measures[mi];
        const barMeta: string[] = [];
        // The master bar's own data goes on the first track, first voice.
        const own = ti === 0 && v === 0;
        if (k === 0 && anacrusis && own) barMeta.push('\\ac');
        if (sigText[mi] !== prevSig) {
          if (own) {
            barMeta.push(`\\ts (${sigText[mi]})`);
            if (k > 0) report.signatureChanges++;
          }
          prevSig = sigText[mi];
        }
        const marker = str(structure[mi].marker?.text).trim();
        if (own && marker && (k === 0 || order[k - 1] !== mi)) barMeta.push(`\\section "${escapeTex(marker.slice(0, 60))}"`);
        const startBpm = tempoAtStart(mi);
        if (own && k > 0 && startBpm !== tempo) {
          barMeta.push(`\\tempo ${fmtBpm(startBpm)}`);
          report.tempoChanges++;
        }
        tempo = startBpm;
        // Tempo changes inside the bar, on the beat at their position.
        const inner = own ? autos.filter((a) => a.measure === mi && a.position > 0) : [];

        const voice = m?.voices?.[v];
        const beats = voice && !voice.rest ? (voice.beats ?? []) : [];
        const toks: string[] = [];
        let len: Frac = [0, 1];
        beats.forEach((b, bi) => {
          const extra: string[] = [];
          for (const a of inner) {
            if (a.position === bi) {
              extra.push(`tempo ${fmtBpm(a.bpm)}`);
              report.tempoChanges++;
              tempo = a.bpm;
            }
          }
          const r = beatTex(b, strings, extra, ignored, report);
          toks.push(...r.tex);
          len = add(len, r.length);
          if (!b.rest) notes += (b.notes ?? []).filter((n) => !n.rest && !n.tie && Number.isInteger(n.string)).length;
        });
        // A whole-bar rest, a missing bar or a second voice with nothing:
        // rests that fill the signature (the pickup bar keeps its length).
        const want = k === 0 && anacrusis ? (cmp(len, [0, 1]) > 0 ? len : firstLen) : sigs[mi];
        const allRest = beats.every((b) => b.rest || (b.notes ?? []).every((n) => n.rest));
        if (toks.length === 0 || (allRest && cmp(len, want) !== 0)) {
          toks.length = 0;
          toks.push(...restsFor(want[0] > 0 ? want : sigs[mi]));
        }
        bars.push(`${barMeta.length ? `${barMeta.join(' ')} ` : ''}${toks.join(' ')}`);
      });
      lines.push(bars.join(' |\n'));
    }
    report.tracks.push({
      name: (track.name || part.name || '').slice(0, 200),
      label,
      strings,
      tuning: [...tuning].reverse().map((n) => NOTE_NAMES[((n % 12) + 12) % 12]).join(' '),
      notes,
    });
    trackTexts.push(lines.join('\n'));
  });

  report.ignored = ignored.map;
  if (report.tracks.every((t) => t.notes === 0)) return { ok: false, error: 'The Songsterr parts have no notes.' };
  return { ok: true, alphaTex: `${head.join('\n')}\n${trackTexts.join('\n')}\n`, report };
}
