// @vitest-environment node
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { diffRuns } from './diff';
import { loadExport } from './fileDeps';
import { runMeasure, storedRun } from './runner';

// The mix measurement harness on its own fixture (tests/measure-mixes/fixture:
// a 3-member export plus recorded radios, no SQLite, no network): it builds
// offline, replays the same mixes twice, and a run diffed with itself is
// empty.

const FIXTURE = path.resolve(__dirname, '../../../../../tests/measure-mixes/fixture');
const dir = mkdtempSync(path.join(tmpdir(), 'mix-sim-'));
cpSync(FIXTURE, dir, { recursive: true });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('mix measurement harness', () => {
  it('builds the fixture offline, the same way twice, and writes nothing', async () => {
    const files = readdirSync(dir).sort();
    const a = await runMeasure(loadExport(dir), { label: 'a' });
    const b = await runMeasure(loadExport(dir), { label: 'b' });
    expect(readdirSync(dir).sort()).toEqual(files);
    expect(a.members.map((m) => m.userId)).toEqual(['u-game', 'u-pop', 'u-rock']);
    for (const m of a.members) expect(m.radioMissing).toEqual([]);
    const rock = a.members.find((m) => m.userId === 'u-rock')!;
    expect(rock.mixes.some((m) => m.key === 'rock-metal' || m.key === 'rock')).toBe(true);
    const strip = (r: typeof a) => r.members.map((m) => m.mixes.map((x) => [x.key, x.tracks.map((t) => t.songKey)]));
    expect(strip(b)).toEqual(strip(a));
    const d = diffRuns(a, b);
    for (const m of d.members) {
      expect(m.appeared).toEqual([]);
      expect(m.disappeared).toEqual([]);
      expect(m.mixes.flatMap((x) => [...x.movedOut, ...x.added])).toEqual([]);
    }
  });

  it('reads the stored mixes without rebuilding', () => {
    expect(storedRun(loadExport(dir)).members).toEqual([]);
  });
});
