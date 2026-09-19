/** Text tabs (the ASCII kind people paste from Ultimate Guitar and forums)
 *  to alphaTex, the format generated tabs already use, so AlphaTab draws
 *  them and the tab page syncs them like any other tab.
 *  docs/tab-sources.md section 2.
 *
 *  Pure: no DOM, no Node. The paste dialog runs it for the live preview and
 *  POST /api/tabs/text runs the same code, so the saved tab is the preview.
 *
 *  Timing. Most text tabs carry no rhythm, so the tabber's spacing is the
 *  timing, the way people read them: a bar is 16 slots of a 16th (32 when a
 *  bar has more than 16 note columns) and a note's slot is where its column
 *  sits inside the bar. A UG style rhythm line (W H Q E S T under or over a
 *  block) gives real durations instead. Always 4/4. */

// ── public shapes ─────────────────────────────────────────────────────────

export interface TabTextOptions {
  title?: string;
  artist?: string;
  /** Beats per minute chosen by the listener (typed, tapped or fitted to
   *  the song length). Wins over a Tempo line in the text. */
  tempo?: number | null;
  /** Tuning override, scientific pitch, highest string first, the same
   *  order as the tab's lines: "E4 B3 G3 D3 A2 D2". */
  tuning?: string | null;
}

export interface SkippedLine {
  /** 1-based line number in the pasted text. */
  line: number;
  text: string;
  reason: string;
}

export interface TabTextReport {
  strings: number;
  /** Scientific pitch, highest string first (alphaTex order). */
  tuning: string[];
  /** MIDI numbers, highest string first (AlphaTab's staff.tuning order). */
  tuningMidi: number[];
  /** "Standard", "Drop D", "Custom (C G C F A D)". */
  tuningName: string;
  instrument: 'guitar' | 'bass';
  /** Bars as played: repeats are written out. */
  bars: number;
  notes: number;
  tempo: number;
  tempoSource: 'given' | 'text' | 'default';
  /** The tempo a Tempo line in the text gave, if any. */
  textTempo: number | null;
  capo: number;
  /** Bars timed by a rhythm line, the rest by spacing. */
  rhythmBars: number;
  skipped: SkippedLine[];
  warnings: string[];
  /** Marks between the frets the parser does not know. */
  ignoredMarks: number;
}

export type TabTextResult =
  | { ok: true; alphaTex: string; report: TabTextReport }
  | { ok: false; error: string; report: TabTextReport };

/** The route refuses anything bigger: a long tab is a few KB. */
export const MAX_TAB_TEXT_BYTES = 256 * 1024;
export const DEFAULT_TEMPO = 120;
export const MIN_TEMPO = 20;
export const MAX_TEMPO = 400;

// ── tuning ────────────────────────────────────────────────────────────────

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Standard tuning per string count, highest string first. */
const STANDARD: Record<number, number[]> = {
  4: [43, 38, 33, 28],
  5: [43, 38, 33, 28, 23],
  6: [64, 59, 55, 50, 45, 40],
  7: [64, 59, 55, 50, 45, 40, 35],
  8: [64, 59, 55, 50, 45, 40, 35, 30],
};

/** Named tunings, highest string first. */
const NAMED: { name: string; midi: number[] }[] = [
  { name: 'Standard', midi: STANDARD[6] },
  { name: 'Drop D', midi: [64, 59, 55, 50, 45, 38] },
  { name: 'Eb standard', midi: [63, 58, 54, 49, 44, 39] },
  { name: 'D standard', midi: [62, 57, 53, 48, 43, 38] },
  { name: 'Drop C#', midi: [63, 58, 54, 49, 44, 37] },
  { name: 'Drop C', midi: [62, 57, 53, 48, 43, 36] },
  { name: 'Open G', midi: [62, 59, 55, 50, 43, 38] },
  { name: 'Open D', midi: [62, 57, 54, 50, 45, 38] },
  { name: 'Open E', midi: [64, 59, 56, 52, 47, 40] },
  { name: 'DADGAD', midi: [62, 57, 55, 50, 45, 38] },
  { name: 'Standard', midi: STANDARD[7] },
  { name: 'Drop A', midi: [64, 59, 55, 50, 45, 40, 33] },
  { name: 'Standard', midi: STANDARD[8] },
  { name: 'Standard', midi: STANDARD[4] },
  { name: 'Drop D', midi: [43, 38, 33, 26] },
  { name: 'Standard', midi: STANDARD[5] },
];

/** 'C#' / 'Db' / 'e' -> pitch class, or null. */
function pitchClass(name: string): number | null {
  const m = /^([A-Ga-g])([#b♯♭]?)$/.exec(name.trim());
  if (!m) return null;
  const base = PC[m[1].toUpperCase()];
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return (base + acc + 12) % 12;
}

/** The octave nearest to where that string sits in standard tuning: a
 *  bottom D on six strings is D2 (Drop D), a seventh B is B1. */
function nearest(pc: number, reference: number): number {
  let best = pc;
  for (let midi = pc; midi < 128; midi += 12) {
    if (Math.abs(midi - reference) < Math.abs(best - reference)) best = midi;
  }
  return best;
}

function midiName(midi: number, flats: boolean): string {
  return `${(flats ? FLAT_NAMES : SHARP_NAMES)[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** "E4" / "Eb2" / "C#3" -> MIDI, or null. */
function parsePitch(name: string): number | null {
  const m = /^([A-Ga-g][#b♯♭]?)(-?\d)$/.exec(name.trim());
  if (!m) return null;
  const pc = pitchClass(m[1]);
  return pc === null ? null : pc + (Number(m[2]) + 1) * 12;
}

export function tuningName(midi: number[]): string {
  const hit = NAMED.find((t) => t.midi.length === midi.length && t.midi.every((n, i) => n === midi[i]));
  if (hit) return hit.name;
  return `Custom (${[...midi].reverse().map((n) => SHARP_NAMES[n % 12]).join(' ')})`;
}

/** Tuning from the lines' labels, top line first. Null when any label is
 *  missing or unreadable. */
function tuningFromLabels(labels: (string | null)[]): number[] | null {
  const standard = STANDARD[labels.length];
  if (!standard) return null;
  const out: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    const pc = labels[i] ? pitchClass(labels[i]!) : null;
    if (pc === null) return null;
    out.push(nearest(pc, standard[i]));
  }
  return out;
}

/** A "Tuning: D A D G B E" line (low to high, as people write it) or a
 *  named one ("Tuning: Drop D"), for a block without labels. */
function tuningFromLine(text: string, strings: number): number[] | null {
  const rest = text.replace(/^\s*tuning\s*[:=-]?\s*/i, '').trim();
  const named = rest.toLowerCase().replace(/\s+/g, ' ');
  const byName: Record<string, string> = {
    standard: 'Standard',
    'e standard': 'Standard',
    'drop d': 'Drop D',
    'half step down': 'Eb standard',
    'eb standard': 'Eb standard',
    'd standard': 'D standard',
    'drop c': 'Drop C',
    'open g': 'Open G',
    'open d': 'Open D',
    dadgad: 'DADGAD',
  };
  for (const [k, v] of Object.entries(byName)) {
    if (named.startsWith(k)) {
      const t = NAMED.find((n) => n.name === v && n.midi.length === strings);
      if (t) return t.midi;
    }
  }
  const notes = rest.split(/[\s,]+/).filter(Boolean);
  if (notes.length !== strings) return null;
  const pcs = notes.map((n) => pitchClass(n));
  if (pcs.some((p) => p === null)) return null;
  const standard = STANDARD[strings];
  if (!standard) return null;
  // Written low to high; the tab's lines run high to low.
  return (pcs as number[]).reverse().map((pc, i) => nearest(pc, standard[i]));
}

// ── line classification ───────────────────────────────────────────────────

interface StringLine {
  index: number;
  raw: string;
  label: string | null;
  /** From the first bar line (or first dash) on. */
  body: string;
  /** Column of body[0] in the raw line. */
  offset: number;
  /** "x4" written after the last bar line: play the block that often. */
  repeat: number | null;
  /** ":|x3" at the end of the line: the repeated part plays 3 times. */
  closeCount: number | null;
}

type Line =
  | { kind: 'blank' }
  | { kind: 'string'; s: StringLine }
  | { kind: 'rhythm'; raw: string }
  | { kind: 'pm'; raw: string }
  | { kind: 'repeat'; times: number }
  | { kind: 'tempo'; bpm: number }
  | { kind: 'capo'; fret: number }
  | { kind: 'tuning'; raw: string }
  | { kind: 'section'; name: string }
  | { kind: 'text'; reason: string };

const REPEAT_TAIL = /^\s*\(?\s*(?:[x×*]\s*(\d{1,2})|(\d{1,2})\s*[x×])\s*\)?\s*$/i;
const REPEAT_LINE = /^\s*(?:\(\s*)?(?:(?:repeat|play)\s*)?(?:[x×]\s*(\d{1,2})|(\d{1,2})\s*(?:[x×]|times))\s*\)?\s*$/i;
const CHORD = /^[A-G][#b]?(?:m|maj|min|dim|aug|sus|add|M)?\d{0,2}(?:sus\d|add\d{1,2}|b5|#5|b9|#9)*(?:\/[A-G][#b]?)?$/;
/** Letters that can appear between frets: techniques and dead notes. */
const TAB_LETTERS = /[hpbrstvxgHPBRSTVXG]/;

function stringLine(raw: string, index: number): StringLine | null {
  const m = /^(\s*)([A-Ga-g][#b♯♭]?)?(\s*)(.*)$/.exec(raw);
  if (!m) return null;
  const label = m[2] ?? null;
  let body = m[4];
  const offset = m[1].length + (label?.length ?? 0) + m[3].length;
  // "b|" is the B string, but "bend" or "e.g." is not a label.
  if (label && body && !/^[|:\-\[\]]/.test(body)) {
    if (/^[0-9]/.test(body)) return null;
    // A label glued to text: not a tab line.
    if (/^[A-Za-z]/.test(body)) return null;
  }
  if (!label && !/^[|\-]/.test(body)) return null;

  // "x4" after the last bar line: the whole block again, or after ":|" the
  // repeated part.
  let repeat: number | null = null;
  let closeCount: number | null = null;
  const lastBar = body.lastIndexOf('|');
  if (lastBar >= 0) {
    const tail = body.slice(lastBar + 1);
    const rm = REPEAT_TAIL.exec(tail);
    if (rm) {
      const n = Number(rm[1] ?? rm[2]);
      if (/:\s*\|+$/.test(body.slice(0, lastBar + 1))) closeCount = n;
      else repeat = n;
      body = body.slice(0, lastBar + 1);
    } else if (/[A-Za-z]{2,}/.test(tail) || /\s{2,}\S/.test(tail)) {
      // A comment after the tab ("let ring"): not part of it.
      body = body.slice(0, lastBar + 1);
    }
  }
  body = body.replace(/\s+$/, '');

  const dashes = (body.match(/-/g) ?? []).length;
  if (dashes < 3) return null;
  const nonSpace = body.replace(/\s/g, '');
  if (dashes / nonSpace.length < 0.25) return null;
  // Too many letters that are not techniques: lyrics or prose with dashes.
  const foreign = (nonSpace.match(/[A-Za-z]/g) ?? []).filter((c) => !TAB_LETTERS.test(c)).length;
  if (foreign > 2) return null;
  // A rule line of dashes on its own (no label, no bars, no frets).
  if (!label && !/[|0-9]/.test(body)) return null;
  return { index, raw, label, body, offset, repeat, closeCount };
}

function classify(raw: string, index: number): Line {
  const t = raw.trim();
  if (!t) return { kind: 'blank' };
  const s = stringLine(raw, index);
  if (s) return { kind: 'string', s };

  if (/^(?:P\.?\s?M\.?|palm\s*mute)[\s\-._|~]*(?:(?:P\.?\s?M\.?)[\s\-._|~]*)*$/i.test(t) && /-|\./.test(t.slice(2))) {
    return { kind: 'pm', raw };
  }
  const tokens = t.replace(/\|/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length >= 2 && tokens.every((k) => /^(?:[WHQEST]\.?)+$/.test(k) || k === '+' || k === '.')) {
    return { kind: 'rhythm', raw };
  }
  const rep = REPEAT_LINE.exec(t);
  if (rep) return { kind: 'repeat', times: Number(rep[1] ?? rep[2]) };

  const tempo = /(?:\btempo\b|\bbpm\b)\s*[:=]?\s*(?:♩\s*=\s*)?(\d{2,3})\b|\b(\d{2,3})\s*bpm\b|♩\s*=\s*(\d{2,3})\b/i.exec(t);
  if (tempo) {
    const bpm = Number(tempo[1] ?? tempo[2] ?? tempo[3]);
    if (bpm >= MIN_TEMPO && bpm <= MAX_TEMPO) return { kind: 'tempo', bpm };
  }
  const capo = /\bcapo\b[^\d\n]{0,14}(\d{1,2})/i.exec(t);
  if (capo && Number(capo[1]) <= 24) return { kind: 'capo', fret: Number(capo[1]) };
  if (/^no capo\b/i.test(t)) return { kind: 'capo', fret: 0 };
  if (/^tuning\b/i.test(t)) return { kind: 'tuning', raw: t };

  const section = /^\[([^\]]{1,40})\]$/.exec(t);
  if (section) return { kind: 'section', name: section[1].trim() };

  const words = t.split(/\s+/);
  if (words.every((w) => CHORD.test(w) || /^[|\-x\d()]+$/.test(w)) && words.some((w) => CHORD.test(w))) {
    return { kind: 'text', reason: 'chord names' };
  }
  return { kind: 'text', reason: 'lyrics or text' };
}

// ── notes inside a bar ────────────────────────────────────────────────────

interface Note {
  string: number;
  fret: number;
  col: number;
  /** Columns the fret digits take. */
  width: number;
  effects: string[];
  tap: boolean;
}

/** One string's slice of a bar: frets and the marks between them. */
function readSegment(seg: string, stringNo: number, startCol: number, marks: { ignored: number }): Note[] {
  const notes: Note[] = [];
  let i = 0;
  let pendingTap = false;
  let pendingSlideIn: string | null = null;
  let ghost = false;
  let harmonic = false;
  // "(5)", "<12>", "t12", "/7": the note sits where its mark starts.
  let markCol: number | null = null;
  const last = () => notes[notes.length - 1];
  const add = (fx: string) => {
    const n = last();
    if (n && !n.effects.includes(fx)) n.effects.push(fx);
  };
  while (i < seg.length) {
    const c = seg[i];
    if (/[0-9]/.test(c)) {
      let digits = c;
      // Two digits make one fret (12), but not "00" or "35": frets stop at 24.
      if (c !== '0' && /[0-9]/.test(seg[i + 1] ?? '') && Number(c + seg[i + 1]) <= 24) digits = c + seg[i + 1];
      const note: Note = {
        string: stringNo,
        fret: Number(digits),
        col: startCol + (markCol ?? i),
        width: digits.length + (markCol === null ? 0 : i - markCol),
        effects: [],
        tap: pendingTap,
      };
      if (pendingSlideIn) note.effects.push(pendingSlideIn);
      if (ghost) note.effects.push('g');
      if (harmonic) note.effects.push('nh');
      pendingTap = false;
      pendingSlideIn = null;
      markCol = null;
      notes.push(note);
      i += digits.length;
      // Bends consume their target (and a release) instead of making notes.
      if (seg[i] === 'b' || seg[i] === 'B') {
        i++;
        let target = '';
        if (seg[i] === '(') i++;
        while (/[0-9]/.test(seg[i] ?? '') && target.length < 2) target += seg[i++];
        if (seg[i] === ')') i++;
        const q = target ? Math.max(1, Math.min(12, (Number(target) - note.fret) * 2)) : 4;
        let release = false;
        if (seg[i] === 'r' || seg[i] === 'R') {
          release = true;
          i++;
          if (seg[i] === '(') i++;
          while (/[0-9]/.test(seg[i] ?? '')) i++;
          if (seg[i] === ')') i++;
        }
        note.effects.push(release ? `b (0 ${q} 0)` : `b (0 ${q})`);
      }
      continue;
    }
    switch (c) {
      case 'h':
      case 'H':
      case 'p':
      case 'P':
        if (last() && last()!.col + last()!.width === startCol + i) add('h');
        else marks.ignored++;
        break;
      case '/':
      case '\\':
      case 's':
      case 'S': {
        const n = last();
        if (n && n.col + n.width === startCol + i) add('sl');
        else if (c === '/' || c === '\\') {
          pendingSlideIn = c === '/' ? 'sib' : 'sia';
          markCol ??= i;
        }
        else marks.ignored++;
        break;
      }
      case '~':
      case 'v':
      case 'V':
        if (last()) add('v');
        else marks.ignored++;
        while (seg[i + 1] === '~') i++;
        break;
      case 't':
      case 'T': {
        const n = last();
        if (/[0-9]/.test(seg[i + 1] ?? '')) {
          pendingTap = true;
          markCol ??= i;
        }
        else if (n && n.col + n.width === startCol + i) n.tap = true;
        else marks.ignored++;
        break;
      }
      case 'x':
      case 'X':
        notes.push({ string: stringNo, fret: 0, col: startCol + i, width: 1, effects: ['x'], tap: false });
        break;
      case '(':
        ghost = true;
        markCol ??= i;
        break;
      case ')':
        ghost = false;
        break;
      case '<':
      case '[':
        harmonic = true;
        markCol ??= i;
        break;
      case '>':
      case ']':
        harmonic = false;
        break;
      case 'r':
      case 'R':
        marks.ignored++;
        break;
      case '-':
      case ' ':
      case '|':
      case '=':
        break;
      default:
        marks.ignored++;
    }
    i++;
  }
  return notes;
}

interface Beat {
  col: number;
  end: number;
  notes: Note[];
}

/** Notes that share a column are one beat. A two-digit fret written one
 *  column off from the rest of its chord still overlaps it, so it joins. */
function toBeats(notes: Note[]): Beat[] {
  const beats: Beat[] = [];
  for (const n of [...notes].sort((a, b) => a.col - b.col || a.string - b.string)) {
    const end = n.col + n.width - 1;
    const hit = beats.find((b) => n.col <= b.end && end >= b.col && !b.notes.some((m) => m.string === n.string));
    if (hit) {
      hit.notes.push(n);
      hit.end = Math.max(hit.end, end);
      hit.col = Math.min(hit.col, n.col);
    } else beats.push({ col: n.col, end, notes: [n] });
  }
  return beats.sort((a, b) => a.col - b.col);
}

// ── durations ─────────────────────────────────────────────────────────────

/** A whole bar of 4/4 is 64 ticks: a 16th is 4, a 32nd 2. */
const BAR_TICKS = 64;
const DURATIONS: [number, string, boolean][] = [
  [64, '1', false],
  [48, '2', true],
  [32, '2', false],
  [24, '4', true],
  [16, '4', false],
  [12, '8', true],
  [8, '8', false],
  [6, '16', true],
  [4, '16', false],
  [3, '32', true],
  [2, '32', false],
  [1, '64', false],
];

/** Split a length into written durations, longest first. */
function split(ticks: number): [string, boolean][] {
  const out: [string, boolean][] = [];
  let left = ticks;
  while (left > 0) {
    const d = DURATIONS.find(([t]) => t <= left)!;
    out.push([d[1], d[2]]);
    left -= d[0];
  }
  return out;
}

const RHYTHM_TICKS: Record<string, number> = { W: 64, H: 32, Q: 16, E: 8, S: 4, T: 2 };

// ── blocks and bars ───────────────────────────────────────────────────────

interface ParsedBar {
  tokens: string[];
  notes: number;
  section: string | null;
  startRepeat: boolean;
  endRepeat: number;
  rhythm: boolean;
}

function noteToken(n: Note): string {
  const fx = n.effects.length ? `{${n.effects.join(' ')}}` : '';
  return `${n.fret}.${n.string}${fx}`;
}

function beatToken(notes: Note[] | null, dur: string, dotted: boolean, extra: string[] = []): string {
  const fx = [...(dotted ? ['d'] : []), ...extra];
  const beatFx = fx.length ? `{${fx.join(' ')}}` : '';
  if (!notes) return `r.${dur}${beatFx}`;
  const body = notes.length === 1 ? noteToken(notes[0]) : `(${notes.map(noteToken).join(' ')})`;
  return `${body}.${dur}${beatFx}`;
}

/** A beat of notes lasting `ticks`, then rests for what its written value
 *  cannot cover. */
function writeBeat(out: string[], notes: Note[] | null, ticks: number) {
  const parts = split(ticks);
  const tap = notes?.some((n) => n.tap) ? ['tt'] : [];
  parts.forEach(([dur, dotted], i) => out.push(i === 0 ? beatToken(notes, dur, dotted, tap) : beatToken(null, dur, dotted)));
}

/** Timing from column spacing: the bar's width is its length. */
function spacingTokens(beats: Beat[], width: number, lead: number, warnings: Set<string>): string[] {
  if (beats.length === 0) return ['r.1'];
  let slots = 16;
  if (beats.length > 16) slots = 32;
  if (beats.length > 32) {
    slots = 64;
    warnings.add('A bar has more than 32 notes, so some are squeezed onto a 64th grid.');
  }
  // The tabber's usual gap between notes: round the bar to a whole number
  // of those, so trailing dashes a little short or long of a full beat do
  // not stretch or squeeze everything else.
  const gaps = new Map<number, number>();
  for (let i = 1; i < beats.length; i++) {
    const g = beats[i].col - beats[i - 1].col;
    gaps.set(g, (gaps.get(g) ?? 0) + 1);
  }
  const pitch = [...gaps.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
  const grid =
    pitch >= 2 ? Math.max(pitch, Math.round((width - lead) / pitch) * pitch) : Math.max(1, width - lead);
  const want = beats.map((b) => Math.max(0, Math.min(slots - 1, Math.round(((b.col - lead) / grid) * slots))));
  // Keep the order: a note further along the line plays later.
  for (let i = 1; i < want.length; i++) want[i] = Math.max(want[i], want[i - 1] + 1);
  for (let i = want.length - 1; i >= 0; i--) {
    const cap = i === want.length - 1 ? slots - 1 : want[i + 1] - 1;
    want[i] = Math.min(want[i], cap);
  }
  const unit = BAR_TICKS / slots;
  const out: string[] = [];
  if (want[0] > 0) for (const [d, dot] of split(want[0] * unit)) out.push(beatToken(null, d, dot));
  beats.forEach((b, i) => {
    const next = i + 1 < beats.length ? want[i + 1] : slots;
    writeBeat(out, b.notes, (next - want[i]) * unit);
  });
  return out;
}

/** Timing from a rhythm line: letters under (or over) each beat. Null when
 *  a beat has no letter, so the bar falls back to spacing. */
function rhythmTokens(beats: Beat[], letters: Map<number, { ticks: number }>, warnings: Set<string>): string[] | null {
  if (beats.length === 0) return null;
  const durs: number[] = [];
  for (const b of beats) {
    let found: number | null = null;
    for (let c = b.col - 1; c <= b.end + 1 && found === null; c++) {
      const l = letters.get(c);
      if (l) found = l.ticks;
    }
    if (found === null) return null;
    durs.push(found);
  }
  const out: string[] = [];
  let total = 0;
  beats.forEach((b, i) => {
    writeBeat(out, b.notes, durs[i]);
    total += durs[i];
  });
  if (total < BAR_TICKS) for (const [d, dot] of split(BAR_TICKS - total)) out.push(beatToken(null, d, dot));
  if (total > BAR_TICKS) warnings.add('A bar’s rhythm adds up to more than 4 beats.');
  return out;
}

/** Rhythm letters by body column. */
function readRhythm(raw: string, offset: number): Map<number, { ticks: number }> {
  const map = new Map<number, { ticks: number }>();
  for (let i = 0; i < raw.length; i++) {
    const t = RHYTHM_TICKS[raw[i]];
    if (!t) continue;
    map.set(i - offset, { ticks: raw[i + 1] === '.' ? t * 1.5 : t });
  }
  return map;
}

/** Palm-mute ranges from a "PM----" line, in body columns. */
function readPalmMute(raw: string, offset: number): [number, number][] {
  const out: [number, number][] = [];
  const re = /P\.?\s?M\.?[\-._~|]*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.push([m.index - offset, m.index + m[0].length - 1 - offset]);
  return out;
}

/** Bar line runs in a body ("|", "||"), as [start, end] columns. */
function barRuns(body: string): [number, number][] {
  const runs: [number, number][] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '|') continue;
    let j = i;
    while (body[j + 1] === '|') j++;
    runs.push([i, j]);
    i = j;
  }
  return runs;
}

interface Block {
  lines: StringLine[];
  rhythm: string | null;
  pm: string | null;
  repeat: number;
  section: string | null;
}

/** Split a block's bodies into bars. Every line splits at its own bar
 *  lines when they agree on how many there are (a line one dash longer
 *  than the rest stays in step), else all at the lines of the one that
 *  has the most common count. */
function splitBars(lines: StringLine[], noBarLines: boolean): { segs: { text: string; start: number }[][]; interior: boolean } {
  const runs = lines.map((l) => barRuns(l.body));
  const counts = runs.map((r) => r.length);
  const tally = new Map<number, number>();
  for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1);
  const mode = [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const agree = counts.every((c) => c === mode);
  const refRuns = runs[counts.indexOf(mode)];

  const segsFor = (body: string, r: [number, number][]) => {
    const out: { text: string; start: number }[] = [];
    let from = 0;
    for (const [s, e] of r) {
      out.push({ text: body.slice(from, s), start: from });
      from = e + 1;
    }
    out.push({ text: body.slice(from), start: from });
    return out;
  };

  let segs = lines.map((l, i) => segsFor(l.body, agree ? runs[i] : refRuns));
  // Drop what sits before the first and after the last bar line when empty.
  const empty = (k: number) => segs.every((s) => !s[k] || !s[k].text.replace(/[\s:]/g, ''));
  while (segs[0].length > 1 && empty(0)) segs = segs.map((s) => s.slice(1));
  while (segs[0].length > 1 && empty(segs[0].length - 1)) segs = segs.map((s) => s.slice(0, -1));
  const interior = segs[0].length > 1;

  if (!interior && noBarLines) {
    // No bar lines anywhere: a bar every 16 columns.
    const width = Math.max(...segs.map((s) => s[0].start + s[0].text.length));
    const start = segs[0][0].start;
    if (width - start > 24) {
      const chunked = lines.map((l) => {
        const out: { text: string; start: number }[] = [];
        for (let c = start; c < width; c += 16) out.push({ text: l.body.slice(c, c + 16).padEnd(16, '-'), start: c });
        return out;
      });
      // The last chunk is often just the tail of the dashes.
      while (chunked[0].length > 1 && chunked.every((c) => !/[0-9xX]/.test(c[c.length - 1].text))) {
        for (const c of chunked) c.pop();
      }
      return { segs: chunked, interior: false };
    }
  }
  return { segs, interior };
}

// ── the parser ────────────────────────────────────────────────────────────

function escapeTex(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
}

function emptyReport(): TabTextReport {
  return {
    strings: 0,
    tuning: [],
    tuningMidi: [],
    tuningName: '',
    instrument: 'guitar',
    bars: 0,
    notes: 0,
    tempo: DEFAULT_TEMPO,
    tempoSource: 'default',
    textTempo: null,
    capo: 0,
    rhythmBars: 0,
    skipped: [],
    warnings: [],
    ignoredMarks: 0,
  };
}

export function parseTabText(text: string, opts: TabTextOptions = {}): TabTextResult {
  const report = emptyReport();
  const warnings = new Set<string>();
  const marks = { ignored: 0 };
  const rawLines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const lines = rawLines.map((l, i) => classify(l, i));
  const used = new Set<number>();

  let textTempo: number | null = null;
  let capo = 0;
  let tuningLine: string | null = null;
  let pendingSection: string | null = null;
  const blocks: Block[] = [];
  const skip = (i: number, reason: string) =>
    report.skipped.push({ line: i + 1, text: rawLines[i].trim().slice(0, 120), reason });

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.kind === 'tempo') {
      if (textTempo === null) textTempo = l.bpm;
      used.add(i);
    } else if (l.kind === 'capo') {
      capo = l.fret;
      used.add(i);
    } else if (l.kind === 'tuning') {
      tuningLine = l.raw;
      used.add(i);
    } else if (l.kind === 'section') {
      pendingSection = l.name;
      used.add(i);
    }
    if (l.kind !== 'string') continue;

    const group: StringLine[] = [];
    let j = i;
    while (j < lines.length) {
      const g = lines[j];
      if (g.kind !== 'string') break;
      group.push(g.s);
      j++;
    }
    // Two blocks written back to back: the top label comes round again.
    const parts: StringLine[][] = [];
    let cur: StringLine[] = [];
    for (const sl of group) {
      if (cur.length >= 4 && sl.label && cur[0].label && sl.label === cur[0].label) {
        parts.push(cur);
        cur = [];
      }
      cur.push(sl);
    }
    parts.push(cur);

    const made: Block[] = [];
    for (const part of parts) {
      if (part.length < 4 || part.length > 8) {
        for (const sl of part) skip(sl.index, part.length < 4 ? 'not a full block of strings' : 'too many strings in one block');
        continue;
      }
      for (const sl of part) used.add(sl.index);
      made.push({
        lines: part,
        rhythm: null,
        pm: null,
        repeat: part.reduce((r, sl) => Math.max(r, sl.repeat ?? 1), 1),
        section: made.length === 0 ? pendingSection : null,
      });
    }
    if (made.length) {
      pendingSection = null;
      blocks.push(...made);
      // Rhythm and palm-mute lines right above or below belong to the block,
      // and so does an "x4" on its own line after it.
      const claim = (k: number, target: Block, below: boolean) => {
        const n = lines[k];
        if (!n || used.has(k)) return false;
        if (n.kind === 'rhythm' && !target.rhythm) target.rhythm = n.raw;
        else if (n.kind === 'pm' && !target.pm) target.pm = n.raw;
        else if (n.kind === 'repeat' && below) target.repeat = Math.max(target.repeat, n.times);
        else return false;
        used.add(k);
        return true;
      };
      if (claim(i - 1, made[0], false)) claim(i - 2, made[0], false);
      const last = made[made.length - 1];
      if (claim(j, last, true)) claim(j + 1, last, true);
    }
    i = j - 1;
  }

  // What was not used, and why.
  lines.forEach((l, i) => {
    if (used.has(i)) return;
    if (l.kind === 'text') skip(i, l.reason);
    else if (l.kind === 'rhythm' || l.kind === 'pm' || l.kind === 'repeat') skip(i, 'not next to a tab block');
  });

  report.textTempo = textTempo;
  report.capo = capo;
  if (opts.tempo && opts.tempo >= MIN_TEMPO && opts.tempo <= MAX_TEMPO) {
    report.tempo = Math.round(opts.tempo);
    report.tempoSource = 'given';
  } else if (textTempo) {
    report.tempo = textTempo;
    report.tempoSource = 'text';
  } else {
    warnings.add('No tempo in the text, so it plays at 120 bpm until you set one.');
  }

  if (blocks.length === 0) {
    report.skipped.sort((a, b) => a.line - b.line);
    report.warnings = [...warnings];
    return { ok: false, error: 'No tab lines found: paste the lines that look like e|--3--|.', report };
  }

  // One track: the first block's string count. Guitar and bass in one paste
  // is a later stage.
  const strings = blocks[0].lines.length;
  const kept = blocks.filter((b) => b.lines.length === strings);
  if (kept.length < blocks.length) {
    warnings.add(`Blocks with a different number of strings were left out (only the ${strings}-string part is used).`);
    for (const b of blocks) {
      if (b.lines.length !== strings) for (const sl of b.lines) skip(sl.index, `a ${b.lines.length}-string block`);
    }
  }
  report.skipped.sort((a, b) => a.line - b.line);

  // Tuning: the override, else the labels, else a Tuning line, else standard.
  let tuning: number[] | null = null;
  let flats = false;
  if (opts.tuning) {
    const parts = opts.tuning.trim().split(/[\s,]+/).map(parsePitch);
    if (parts.length === strings && parts.every((p) => p !== null)) {
      tuning = parts as number[];
      flats = /[A-G]b/.test(opts.tuning);
    } else warnings.add('The tuning given does not fit the tab, so it was read from the text.');
  }
  if (!tuning) {
    const labels = kept[0].lines.map((l) => l.label);
    tuning = tuningFromLabels(labels);
    flats = labels.some((l) => !!l && /^[A-Ga-g](b|♭)$/.test(l));
    if (!tuning) {
      tuning = (tuningLine ? tuningFromLine(tuningLine, strings) : null) ?? STANDARD[strings];
      if (!tuningLine || !tuningFromLine(tuningLine, strings)) {
        warnings.add(
          labels.some(Boolean)
            ? 'Some string names could not be read, so standard tuning is assumed.'
            : 'No string names, so standard tuning is assumed.',
        );
      }
    }
  }

  const noBarLines = kept.every((b) => !splitBars(b.lines, false).interior);
  if (noBarLines && kept.some((b) => Math.max(...b.lines.map((l) => l.body.length)) > 24)) {
    warnings.add('No bar lines, so a bar is every 16 columns.');
  }

  const bars: ParsedBar[] = [];
  for (const block of kept) {
    const lens = block.lines.map((l) => l.body.length);
    if (Math.max(...lens) - Math.min(...lens) >= 2) {
      warnings.add('Some lines are longer than others; notes were lined up bar by bar.');
    }
    const { segs } = splitBars(block.lines, noBarLines);
    const offset = block.lines[0].offset;
    const letters = block.rhythm ? readRhythm(block.rhythm, offset) : null;
    const pm = block.pm ? readPalmMute(block.pm, offset) : [];
    const closeCount = block.lines.reduce<number | null>((c, l) => c ?? l.closeCount, null);

    const barCount = Math.max(...segs.map((sg) => sg.length));
    const raw: { beats: Beat[]; notes: number; width: number; start: number; startRepeat: boolean; endRepeat: number }[] = [];
    for (let b = 0; b < barCount; b++) {
      let startRepeat = false;
      let endRepeat = 0;
      let width = 0;
      const notes: Note[] = [];
      let start = segs[0][b]?.start ?? 0;
      if (segs[0][b]?.text.startsWith(':')) start++;
      block.lines.forEach((_line, si) => {
        const seg = segs[si][b];
        if (!seg) return;
        let t = seg.text;
        let segStart = seg.start;
        if (/^:/.test(t)) startRepeat = true;
        if (/:\s*$/.test(t)) {
          endRepeat = Math.max(endRepeat, 2);
          // ":|x3" in the middle of a line leaves "x3" at the start of the
          // next bar.
          const next = segs[si][b + 1]?.text ?? '';
          const count = /^\s*(?:[x×](\d)|(\d)[x×])/.exec(next);
          if (count) endRepeat = Math.max(endRepeat, Number(count[1] ?? count[2]));
          if (b === barCount - 1 && closeCount) endRepeat = Math.max(endRepeat, closeCount);
        }
        const prev = segs[si][b - 1]?.text ?? '';
        // Repeat dots belong to the bar line, not the bar's time.
        if (t.startsWith(':')) {
          t = t.slice(1);
          segStart++;
        }
        t = t.replace(/:\s*$/, '');
        if (/:\s*$/.test(prev)) t = t.replace(/^(\s*)(?:[x×]\d|\d[x×])/, (_m, sp: string) => `${sp}---`);
        width = Math.max(width, t.length);
        for (const n of readSegment(t, si + 1, 0, marks)) {
          const abs = segStart + n.col;
          if (pm.some(([a, z]) => abs >= a && abs <= z) && !n.effects.includes('pm')) n.effects.push('pm');
          notes.push(n);
        }
      });
      raw.push({ beats: toBeats(notes), notes: notes.length, width, start, startRepeat, endRepeat });
    }
    // The block's usual lead-in: most bars start a dash or two in.
    const firsts = raw.filter((r) => r.beats.length).map((r) => r.beats[0].col);
    const lead = Math.min(2, firsts.length ? Math.min(...firsts) : 0);

    const blockBars: ParsedBar[] = raw.map((r, k) => {
      let tokens: string[] | null = null;
      if (letters && r.beats.length) {
        const local = new Map<number, { ticks: number }>();
        for (const [c, v] of letters) local.set(c - r.start, v);
        tokens = rhythmTokens(r.beats, local, warnings);
        if (!tokens) warnings.add('Some notes have no rhythm letter, so those bars are timed by spacing.');
      }
      const rhythm = !!tokens;
      tokens ??= spacingTokens(r.beats, r.width, lead, warnings);
      return {
        tokens,
        notes: r.notes,
        section: k === 0 ? block.section : null,
        startRepeat: r.startRepeat,
        endRepeat: r.endRepeat,
        rhythm,
      };
    });

    // |: ... :| repeats, then "x4" on the whole block, written out so the
    // tab's timeline runs straight through like the recording does.
    const played: ParsedBar[] = [];
    let from = 0;
    for (const bar of blockBars) {
      if (bar.startRepeat) from = played.length;
      played.push(bar);
      if (bar.endRepeat > 1) {
        const span = played.slice(from);
        for (let r = 1; r < bar.endRepeat; r++) played.push(...span.map((sp) => ({ ...sp, section: null })));
        from = played.length;
      }
    }
    const once = [...played];
    for (let r = 1; r < block.repeat; r++) played.push(...once.map((sp) => ({ ...sp, section: null })));
    bars.push(...played);
  }

  report.strings = strings;
  report.tuningMidi = tuning;
  report.tuning = tuning.map((n) => midiName(n, flats));
  report.tuningName = tuningName(tuning);
  report.instrument = strings <= 5 ? 'bass' : 'guitar';
  report.bars = bars.length;
  report.notes = bars.reduce((n, b) => n + b.notes, 0);
  report.rhythmBars = bars.filter((b) => b.rhythm).length;
  report.ignoredMarks = marks.ignored;
  if (marks.ignored) {
    warnings.add(
      `${marks.ignored} mark${marks.ignored === 1 ? '' : 's'} between the frets ${marks.ignored === 1 ? 'was' : 'were'} not understood and left out.`,
    );
  }
  report.warnings = [...warnings];

  if (report.notes === 0) {
    return { ok: false, error: 'That text has tab lines but no notes on them.', report };
  }

  const bass = report.instrument === 'bass';
  const head = [
    `\\title "${escapeTex(opts.title?.trim() || 'Untitled')}"`,
    ...(opts.artist?.trim() ? [`\\artist "${escapeTex(opts.artist.trim())}"`] : []),
    `\\tempo ${report.tempo}`,
    bass ? '\\track ("Bass" "Bass")' : '\\track ("Guitar" "Gtr")',
    `\\instrument ${bass ? 33 : 27}`,
    `\\tuning (${report.tuning.join(' ')})`,
    ...(capo > 0 ? [`\\capo ${capo}`] : []),
    '\\ts (4 4)',
  ];
  const body = bars.map((b) => `${b.section ? `\\section "${escapeTex(b.section)}" ` : ''}${b.tokens.join(' ')}`);
  return { ok: true, alphaTex: `${head.join('\n')}\n${body.join(' |\n')}\n`, report };
}

// ── helpers for the paste dialog ──────────────────────────────────────────

/** "6 strings, Drop D, 24 bars, 2 lines skipped". */
export function reportLine(r: TabTextReport): string {
  const parts = [`${r.strings} strings`, r.tuningName, `${r.bars} bar${r.bars === 1 ? '' : 's'}`, `${r.notes} notes`];
  if (r.skipped.length) parts.push(`${r.skipped.length} line${r.skipped.length === 1 ? '' : 's'} skipped`);
  return parts.join(', ');
}

/** The tempo that makes the tab last as long as the recording (4/4). */
export function fitTempo(bars: number, durationSec: number): number | null {
  if (!(bars > 0) || !(durationSec > 0)) return null;
  const bpm = Math.round((bars * 4 * 60) / durationSec);
  return Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, bpm));
}

/** Beats per minute from taps (milliseconds): the median gap, so one late
 *  tap does not throw it. Null under four taps. */
export function tapTempo(taps: number[]): number | null {
  if (taps.length < 4) return null;
  const gaps = taps
    .slice(1)
    .map((t, i) => t - taps[i])
    .filter((g) => g > 0)
    .sort((a, b) => a - b);
  if (!gaps.length) return null;
  const bpm = Math.round(60_000 / gaps[Math.floor(gaps.length / 2)]);
  return bpm >= MIN_TEMPO && bpm <= MAX_TEMPO ? bpm : null;
}
