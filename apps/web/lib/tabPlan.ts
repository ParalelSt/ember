import { tempoMap, tickToMs } from '@/lib/tabSync';

/** What align.py needs to know of a tab (docs/tabs-v3.md section 3): where
 *  each bar starts and where every note sounds, on the tab's own clock, as
 *  AlphaTab plays it. Built with the installed AlphaTab so the times are
 *  exactly the ones the tab page's cursor walks through (the same tick
 *  lookup and tempo map, lib/tabSync.ts tickToMs). */

export interface TabPlanBar {
  /** Master bar index, 0 = the first bar (a pickup, if there is one). */
  bar: number;
  /** Where the bar starts on the tab's clock. */
  ms: number;
  /** Time signature numerator and denominator. */
  sig: [number, number];
}

export interface TabPlanNote {
  /** When it sounds, on the tab's clock. */
  ms: number;
  /** How long it lasts (to the next beat of its voice). */
  dur: number;
  /** MIDI pitches struck; empty for a beat of dead notes only. */
  p: number[];
}

export interface TabPlan {
  version: 1;
  /** The tempo at the top, quarter notes per minute. */
  tempo: number;
  bars: TabPlanBar[];
  /** Every struck beat of every pitched track, sorted by time. Held notes
   *  (tie destinations) strike nothing and are left out. */
  notes: TabPlanNote[];
  endMs: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The plan of a score AlphaTab has read. `at` is the AlphaTab module. */
export function planFromScore(at: any, score: any): TabPlan {
  const settings = new at.Settings();
  const generator = new at.midi.MidiFileGenerator(score, settings, new at.midi.AlphaSynthMidiFileHandler(new at.midi.MidiFile()));
  generator.generate();
  const lookup = generator.tickLookup;
  const tempos = tempoMap(lookup.masterBars);
  const ms = (tick: number) => Math.round(tickToMs(tempos, tick) * 10) / 10;

  // Bars in playing order; a tab without repeats (every fetched tab: they
  // are written out) plays each master bar once, in order.
  const starts = new Map<number, number>();
  for (const mb of lookup.masterBars) {
    const index = mb.masterBar?.index;
    if (typeof index === 'number' && !starts.has(index)) starts.set(index, mb.start);
  }
  const bars: TabPlanBar[] = score.masterBars.map((mb: any, i: number) => ({
    bar: i,
    ms: ms(starts.get(i) ?? mb.start),
    sig: [mb.timeSignatureNumerator, mb.timeSignatureDenominator] as [number, number],
  }));

  const struck = new Map<number, { dur: number; p: Set<number> }>();
  for (const track of score.tracks) {
    if (track.isPercussion || track.staves?.some((s: any) => s.isPercussion)) continue;
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        const barStart = starts.get(bar.index) ?? bar.masterBar.start;
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            if (beat.isRest || beat.notes.length === 0) continue;
            const sounding = beat.notes.filter((n: any) => !n.isTieDestination);
            if (sounding.length === 0) continue;
            const start = ms(barStart + beat.playbackStart);
            const end = ms(barStart + beat.playbackStart + beat.playbackDuration);
            const at0 = struck.get(start) ?? { dur: 0, p: new Set<number>() };
            at0.dur = Math.max(at0.dur, Math.round((end - start) * 10) / 10);
            for (const n of sounding) if (!n.isDead && Number.isFinite(n.realValue)) at0.p.add(n.realValue);
            struck.set(start, at0);
          }
        }
      }
    }
  }
  const notes = [...struck.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ ms: t, dur: v.dur, p: [...v.p].sort((a, b) => a - b) }));
  const last = lookup.masterBars[lookup.masterBars.length - 1];
  return {
    version: 1,
    tempo: Number(score.tempo) || 120,
    bars,
    notes,
    endMs: last ? ms(last.end) : 0,
  };
}

/** Read alphaTex with the installed AlphaTab and plan it. Throws when
 *  AlphaTab cannot read it. */
export function planFromAlphaTex(at: any, tex: string): TabPlan {
  const importer = new at.importer.AlphaTexImporter();
  importer.initFromString(tex, new at.Settings());
  return planFromScore(at, importer.readScore());
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The same, loading AlphaTab on demand (the server has no use for it
 *  otherwise). */
export async function buildTabPlan(tex: string): Promise<TabPlan> {
  const at = await import('@coderline/alphatab');
  return planFromAlphaTex(at, tex);
}
