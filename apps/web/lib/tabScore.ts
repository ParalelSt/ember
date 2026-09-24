/** What the tab page reads out of a loaded AlphaTab score, and the colours
 *  it draws with. No React; the score is passed in as plain data. */

export type TabsStaff = 'tab' | 'score-tab';
export type TabsScroll = 'vertical' | 'horizontal';

/** One instrument of the score, as the track picker and header show it. */
export interface ScoreTrackInfo {
  index: number;
  /** Short name for the picker pill: 'Guitar', 'Bass'. */
  name: string;
  /** 'Distortion guitar', 'Bass'. */
  instrument: string;
  /** 'Drop D', 'Standard'; empty when AlphaTab has no name for it. */
  tuning: string;
  /** Strings low to high: 'D A D G B E'. */
  strings: string;
  /** This instrument has a tablature staff to draw. False for a file that
   *  only carries standard notation (a MusicXML export without string and
   *  fret numbers, a drum part): see `staveProfileOf`. */
  tab: boolean;
}

export interface ScoreInfo {
  tempo: number | null;
  /** The first bar's time signature; null when the file does not say
   *  (AlphaTab then plays it as 4/4). */
  signature: { numerator: number; denominator: number } | null;
  /** 'D minor'; null for C major, which is also what an unmarked file
   *  reads as, so it says nothing. */
  key: string | null;
  tracks: ScoreTrackInfo[];
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi: number): string {
  return NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12];
}

/** AlphaTab lists tuning top string first (high to low); players read it
 *  low to high. */
export function stringsText(tuning: number[]): string {
  return [...tuning].reverse().map(noteName).join(' ');
}

/** 'Guitar Dropped D Tuning' -> 'Drop D', 'Guitar Standard Tuning' ->
 *  'Standard'. */
export function shortTuningName(name: string): string {
  return name
    .replace(/^(guitar|bass|ukulele|banjo|mandolin)\s+/i, '')
    .replace(/\s+tuning$/i, '')
    .replace(/^dropped\b/i, 'Drop')
    .trim();
}

const MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];

/** AlphaTab's key signature (sharps positive, flats negative) and type
 *  (0 major, 1 minor) as a name. Null for C major (see ScoreInfo.key). */
export function keyName(fifths: number, type: number): string | null {
  const i = Math.round(fifths) + 7;
  if (i < 0 || i >= MAJOR.length) return null;
  if (type === 1) return `${MINOR[i]} minor`;
  if (i === 7) return null;
  return `${MAJOR[i]} major`;
}

/** General MIDI programs a tab usually carries, by name. */
const PROGRAMS: Record<number, string> = {
  24: 'Nylon guitar',
  25: 'Acoustic guitar',
  26: 'Jazz guitar',
  27: 'Clean guitar',
  28: 'Muted guitar',
  29: 'Overdriven guitar',
  30: 'Distortion guitar',
  31: 'Guitar harmonics',
  32: 'Acoustic bass',
  33: 'Bass',
  34: 'Picked bass',
  35: 'Fretless bass',
  36: 'Slap bass',
  37: 'Slap bass',
  38: 'Synth bass',
  39: 'Synth bass',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Read the header and picker data out of an AlphaTab `Score`. Defensive:
 *  every file format fills a different subset. */
export function scoreInfo(score: any): ScoreInfo {
  const first = score?.masterBars?.[0];
  const tempo = Number(score?.tempo) > 0 ? Math.round(Number(score.tempo)) : null;
  const key = first ? keyName(Number(first.keySignature ?? 0), Number(first.keySignatureType ?? 0)) : null;
  const tracks: ScoreTrackInfo[] = (score?.tracks ?? []).map((t: any, index: number) => {
    const staves: any[] = Array.isArray(t?.staves) ? t.staves : [];
    const staff = staves[0];
    const tuning: number[] = Array.isArray(staff?.tuning) ? staff.tuning : [];
    const name = String(t?.name || `Track ${index + 1}`).trim();
    const program = Number(t?.playbackInfo?.program);
    return {
      index,
      name,
      instrument: PROGRAMS[program] ?? name,
      tuning: staff?.tuningName ? shortTuningName(String(staff.tuningName)) : '',
      strings: tuning.length ? stringsText(tuning) : '',
      tab: staves.some((s) => s?.showTablature === true),
    };
  });
  const num = Number(first?.timeSignatureNumerator);
  const den = Number(first?.timeSignatureDenominator);
  const signature = num > 0 && den > 0 ? { numerator: Math.round(num), denominator: Math.round(den) } : null;
  return { tempo, signature, key, tracks };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The meta line under the title: artist, tempo, key, then the shown
 *  instrument with its tuning. Parts that are unknown are left out. */
export function metaLine(artist: string, info: ScoreInfo | null, track: number): string {
  const t = info?.tracks[track];
  const tuning = t ? [t.tuning, t.strings && `(${t.strings})`].filter(Boolean).join(' ') : '';
  return [
    artist,
    info?.tempo ? `${info.tempo} bpm` : '',
    info?.key ?? '',
    t ? [t.instrument, tuning].filter(Boolean).join(', ') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

// ── colours ───────────────────────────────────────────────────────────────

/** Score colours from Ember's tokens. AlphaTab parses rgb()/hex only and
 *  the tokens are oklch, so each is painted on a 1px canvas and read back.
 *  Without a canvas (unit tests) the fallbacks are the dark theme's values. */
const FALLBACK = { fg: [250, 250, 250], muted: [170, 172, 178] };

function tokenRgb(name: string, fallback: number[]): number[] {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!value || !ctx) return fallback;
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  } catch {
    return fallback;
  }
}

const rgba = ([r, g, b]: number[], a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`;

/** AlphaTab's `display.resources` in Ember's colours. */
export function scoreResources() {
  const fg = tokenRgb('--foreground', FALLBACK.fg);
  const muted = tokenRgb('--muted-foreground', FALLBACK.muted);
  return {
    mainGlyphColor: rgba(fg),
    secondaryGlyphColor: rgba(fg, 0.45),
    scoreInfoColor: rgba(fg),
    staffLineColor: rgba(muted, 0.45),
    barSeparatorColor: rgba(muted, 0.7),
    barNumberColor: rgba(muted, 0.9),
  };
}

/** Which instrument of the score to draw: the one asked for when the score
 *  has it, else the last one it does have (and 0 for a score with none).
 *
 *  The index can be stale: the picker is filled from the score on screen,
 *  so a switch to another tab can carry an index the new file does not
 *  reach. AlphaTab drops an index it cannot resolve and then draws *no*
 *  track at all, which throws inside its layout instead of showing
 *  anything, so the index is always clamped against the score in hand. */
export function trackIndexIn(trackCount: number, wanted: number): number {
  if (!Number.isInteger(wanted) || wanted < 0) return 0;
  return Math.max(0, Math.min(wanted, trackCount - 1));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The stave profile a score can actually be drawn with. "Tab" alone needs
 *  a tablature staff; a file that only carries standard notation (MusicXML
 *  exported without string and fret numbers, a drum part) has none, and
 *  AlphaTab's Tab profile then lays out an empty system and throws
 *  ("can't access property staves"). Such a score keeps its standard staff
 *  instead of drawing nothing. */
export function staveProfileOf(at: any, staff: TabsStaff, hasTab: boolean) {
  return staff === 'tab' && hasTab ? at.StaveProfile.Tab : at.StaveProfile.ScoreTab;
}

/** The settings every drawn tab shares (docs/tabs-rebuild.md section 4):
 *  tab staff with rhythm under the numbers, Tab or Tab + Score, Ember's
 *  colours, page or horizontal layout, and the score's own title block
 *  hidden because the page header shows it. `at` is the AlphaTab module.
 *  `hasTab` says whether the instrument being drawn has a tablature staff;
 *  unknown (no score yet) counts as yes. */
export function displaySettings(
  at: any,
  opts: { staff: TabsStaff; scroll: TabsScroll; scale: number; hasTab?: boolean },
) {
  const E = at.NotationElement;
  return {
    display: {
      // One row reads bigger, like Songsterr's scroll mode.
      scale: opts.scroll === 'horizontal' ? opts.scale * 1.25 : opts.scale,
      staveProfile: staveProfileOf(at, opts.staff, opts.hasTab ?? true),
      layoutMode: opts.scroll === 'horizontal' ? at.LayoutMode.Horizontal : at.LayoutMode.Page,
      resources: scoreResources(),
    },
    notation: {
      rhythmMode: at.TabRhythmMode.ShowWithBars,
      rhythmHeight: 22,
      elements: new Map([
        [E.ScoreTitle, false],
        [E.ScoreSubTitle, false],
        [E.ScoreArtist, false],
        [E.ScoreAlbum, false],
        [E.ScoreWords, false],
        [E.ScoreMusic, false],
        [E.ScoreWordsAndMusic, false],
        [E.ScoreCopyright, false],
        [E.GuitarTuning, false],
        [E.TrackNames, false],
        [E.EffectDynamics, false],
      ]),
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** AlphaTab's display scale for the page: smaller on phones (under 640px)
 *  so a bar still fits the width. */
export function scoreScale(phone: boolean): number {
  return phone ? 0.65 : 0.95;
}
