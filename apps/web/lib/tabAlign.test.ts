// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';

const errorSpy = vi.fn();
const warnSpy = vi.fn();
vi.mock('@/lib/logger/server', () => ({
  serverLogger: { error: (...args: unknown[]) => errorSpy(...args), warn: (...args: unknown[]) => warnSpy(...args) },
}));

/** Lining a tab up (lib/tabAlign.ts): the job around align.py. The script
 *  itself is tested on real audio in tests/test_align.py; here it stands in
 *  as a shell script, so this checks what Ember does around it: the plan it
 *  hands over, the recording it finds, the row it writes, one job per tab,
 *  and a failure kept for the page. MUSIC_DIR and ALIGN_SCRIPT are read
 *  when the module loads. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-align-test-'));
process.env.MUSIC_DIR = dir;
const SCRIPT = path.join(dir, 'fake-align.sh');
const CALLS = path.join(dir, 'calls.txt');
process.env.ALIGN_SCRIPT = SCRIPT;

const TIMING = { offset_ms: 1350, bpm: 97.4, confidence: 0.82, bars: [{ bar: 0, ms: 1350 }, { bar: 1, ms: 3800 }] };

function writeScript(body: string) {
  fs.writeFileSync(SCRIPT, `#!/bin/sh\necho "$1 $2 $3" >> ${JSON.stringify(CALLS)}\n${body}\n`, { mode: 0o755 });
}

const TEX = `\\title "Copper Tide"
\\tempo 100
\\track ("Guitar" "Gtr")
\\staff {tabs}
\\tuning (E4 B3 G3 D3 A2 E2)
\\ts (4 4) 3.6.4 5.6.4 7.6.4 5.6.4 |
3.6.4 5.6.4 7.6.4 5.6.4 |
`;

const { alignmentStatus, alignTab, alreadyTried, audioForTrack, autoAlignQueue, MAX_AUTO_ALIGN, resetAlignment } =
  await import('./tabAlign');
const { FETCHED_DIR } = await import('./tabs');
const { resetOptionalDepsWarning } = await import('./tabOptionalDeps');

let store: FakePb;
function row(extra: Record<string, unknown> = {}) {
  fs.mkdirSync(FETCHED_DIR, { recursive: true });
  fs.writeFileSync(path.join(FETCHED_DIR, 'tab1.alphatex'), TEX);
  return {
    id: 'tab1',
    kind: 'fetched',
    file: 'tab1.alphatex',
    track_key: 'upload:up1',
    source_site: 'songsterr',
    ...extra,
  } as never;
}

beforeEach(() => {
  resetAlignment();
  resetOptionalDepsWarning();
  errorSpy.mockClear();
  warnSpy.mockClear();
  fs.rmSync(CALLS, { force: true });
  writeScript(`printf '%s' '${JSON.stringify(TIMING)}' > "$3"`);
  store = fakePocketBase({
    tabs: [row()],
    uploads: [{ id: 'up1', filename: 'song.m4a' }],
  });
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'uploads', 'song.m4a'), 'audio');
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const calls = () => (fs.existsSync(CALLS) ? fs.readFileSync(CALLS, 'utf8').trim().split('\n') : []);

describe('lining a tab up', () => {
  it('hands align.py the recording and the tab as AlphaTab plays it, then stores the timing', async () => {
    const tab = store.rows.get('tabs')![0];
    const timing = await alignTab(store.pb, tab);
    expect(timing).toEqual({ offsetMs: 1350, bpm: 97.4, confidence: 0.82, bars: TIMING.bars });
    expect(calls()).toHaveLength(1);
    const [audio, plan] = calls()[0].split(' ');
    expect(audio).toBe(path.join(dir, 'uploads', 'song.m4a'));
    // The plan is a temp file, gone with the job; its contents were the
    // tab's bars and notes on the tab's own clock (100 bpm, 4/4).
    expect(fs.existsSync(plan)).toBe(false);
    expect(store.rows.get('tabs')![0].timing).toEqual(TIMING);
    // Marked as tried, so the automatic pass leaves it alone from now on.
    expect(String(store.rows.get('tabs')![0].aligned_at)).toMatch(/^\d{4}-/);
    expect(alignmentStatus(store.rows.get('tabs')![0])).toEqual({
      status: 'ready',
      timing: { offsetMs: 1350, bpm: 97.4, confidence: 0.82, bars: TIMING.bars },
    });
  });

  it('runs one job per tab: two callers share it', async () => {
    const tab = store.rows.get('tabs')![0];
    const [a, b] = await Promise.all([alignTab(store.pb, tab), alignTab(store.pb, tab)]);
    expect(a).toEqual(b);
    expect(calls()).toHaveLength(1);
  });

  it('keeps the reason a job failed, for the page, and writes nothing', async () => {
    writeScript('echo "could not decode the audio: broken" >&2\nexit 1');
    const tab = store.rows.get('tabs')![0];
    expect(await alignTab(store.pb, tab)).toBeNull();
    expect(store.rows.get('tabs')![0].timing).toBeUndefined();
    expect(alignmentStatus(store.rows.get('tabs')![0])).toEqual({
      status: 'failed',
      error: 'could not decode the audio: broken',
    });
    // A failure counts as a try: the automatic pass never listens twice.
    expect(String(store.rows.get('tabs')![0].aligned_at)).toMatch(/^\d{4}-/);
    expect(alreadyTried(store.rows.get('tabs')![0])).toBe(true);
  });

  it('numpy missing on the host logs one warn, not an error per tab, and the tab still fails cleanly', async () => {
    writeScript("echo \"ModuleNotFoundError: No module named 'numpy'\" >&2\nexit 1");
    const tab = store.rows.get('tabs')![0];
    expect(await alignTab(store.pb, tab)).toBeNull();
    expect(alignmentStatus(store.rows.get('tabs')![0])).toEqual({
      status: 'failed',
      error: "ModuleNotFoundError: No module named 'numpy'",
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('tabs', 'tab alignment is off: numpy/librosa not installed, see SETUP.md');
  });

  it('lines up the tabs Ember fetched, Songsterr first, once each, four at most', () => {
    const rows = [
      { id: 'gen', kind: 'generated' },
      { id: 'paste', kind: 'pasted' },
      { id: 'ug1', kind: 'fetched', source_site: 'ug' },
      { id: 'ss', kind: 'fetched', source_site: 'songsterr' },
      { id: 'file', kind: 'file' },
      { id: 'ug2', kind: 'fetched', source_site: 'ug' },
      { id: 'ug3', kind: 'fetched', source_site: 'ug' },
      { id: 'ug4', kind: 'fetched', source_site: 'ug' },
    ] as never[];
    // Never a tab of this server's own: those are lined up only when
    // someone asks, from the Source sheet.
    expect(autoAlignQueue(rows).map((r) => r.id)).toEqual(['ss', 'ug1', 'ug2', 'ug3']);
    expect(MAX_AUTO_ALIGN).toBe(4);

    // A tab that has been through align.py is left alone, whether it came
    // back with a timing or with nothing.
    const tried = [
      { id: 'done', kind: 'fetched', source_site: 'ug', timing: { offset_ms: 0, confidence: 0.9, bpm: 100, bars: [] } },
      { id: 'failed', kind: 'fetched', source_site: 'ug', aligned_at: '2026-09-20T00:00:00Z' },
      { id: 'fresh', kind: 'fetched', source_site: 'ug' },
    ] as never[];
    expect(tried.map(alreadyTried)).toEqual([true, true, false]);
    expect(autoAlignQueue(tried).map((r) => r.id)).toEqual(['fresh']);
  });

  it('says so when Ember has no recording, and when the tab has no file', async () => {
    const noSong = { ...(row() as unknown as Record<string, unknown>), id: 'tab2', track_key: 'upload:nope' };
    expect(await alignTab(store.pb, noSong as never)).toBeNull();
    expect(alignmentStatus(noSong as never)).toEqual({ status: 'failed', error: 'Ember has no recording for that song yet' });
    expect(calls()).toHaveLength(0);

    const noFile = { ...(row() as unknown as Record<string, unknown>), id: 'tab3', file: '../escape.alphatex' };
    expect(await alignTab(store.pb, noFile as never)).toBeNull();
    expect(alignmentStatus(noFile as never)).toEqual({ status: 'failed', error: 'that tab has no file to read' });
  });

  it('refuses a tab with too few notes to hear', async () => {
    fs.writeFileSync(path.join(FETCHED_DIR, 'tiny.alphatex'), '\\tempo 100\n\\tuning (E4 B3 G3 D3 A2 E2)\n3.6.1 |\n');
    const tiny = { ...(row() as unknown as Record<string, unknown>), id: 'tab4', file: 'tiny.alphatex' };
    expect(await alignTab(store.pb, tiny as never)).toBeNull();
    expect(alignmentStatus(tiny as never)).toEqual({ status: 'failed', error: 'that tab has too few notes to line up' });
  });

  it('a tab nobody has asked about is "none"', () => {
    expect(alignmentStatus({ id: 'tabX' } as never)).toEqual({ status: 'none' });
    expect(alignmentStatus({ id: 'tabY', timing: { offset_ms: 0, confidence: 0.1, bpm: 90, bars: [] } } as never)).toEqual({
      status: 'ready',
      timing: { offsetMs: 0, bpm: 90, confidence: 0.1, bars: [] },
    });
  });

  it('finds an upload, and refuses a track id that is neither', async () => {
    expect(await audioForTrack('upload:up1', store.pb)).toBe(path.join(dir, 'uploads', 'song.m4a'));
    expect(await audioForTrack('upload:gone', store.pb)).toBeNull();
    expect(await audioForTrack('spotify:x', store.pb)).toBeNull();
  });
});
