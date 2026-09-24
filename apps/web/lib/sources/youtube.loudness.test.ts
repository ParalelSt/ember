// @vitest-environment node
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Loudness measurement on the server: `player.py loudness <id>` runs once per
// downloaded song, in the background, one at a time, and its gain is read
// back from the sidecar. The helper is a fake child we finish by hand.

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

const spawned: Array<{ args: string[]; child: FakeChild }> = [];

vi.mock('node:child_process', () => {
  const spawn = vi.fn((_cmd: string, args: string[]) => {
    const child = new FakeChild();
    spawned.push({ args: args.slice(1), child });
    return child;
  });
  return { spawn, default: { spawn } };
});

const MUSIC = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-loudness-'));
vi.stubEnv('MUSIC_DIR', MUSIC);

const { ensureDownloaded, measureLoudness, readTrackGain, loudnessSidecarPath } = await import('./youtube');

const flush = () => new Promise((r) => setTimeout(r, 0));
const audio = (id: string) => fs.writeFileSync(path.join(MUSIC, `${id}.m4a`), 'AUDIO');
const sidecar = (id: string, body: string) => fs.writeFileSync(loudnessSidecarPath(id), body);

function finish(cmd: string, id: string, out: unknown, code = 0) {
  const i = spawned.findIndex((s) => s.args[0] === cmd && s.args[s.args.length - 1] === id);
  expect(i).toBeGreaterThanOrEqual(0);
  const [{ child }] = spawned.splice(i, 1);
  if (code === 0) child.stdout.emit('data', Buffer.from(JSON.stringify(out)));
  else child.stderr.emit('data', Buffer.from('ERROR: loudness: ffmpeg failed\n'));
  child.emit('close', code);
}

const loudnessRuns = () => spawned.filter((s) => s.args[0] === 'loudness');

beforeEach(() => {
  spawned.length = 0;
});

describe('readTrackGain', () => {
  it('reads a stored gain', () => {
    sidecar('readgain001', JSON.stringify({ lufs: -8, gainDb: -6 }));
    expect(readTrackGain('readgain001')).toBe(-6);
  });

  it('is null for no sidecar, a corrupt one, a non-number, or a bad id', () => {
    expect(readTrackGain('readgain002')).toBeNull();
    sidecar('readgain003', '{nope');
    expect(readTrackGain('readgain003')).toBeNull();
    sidecar('readgain004', JSON.stringify({ gainDb: 'loud' }));
    expect(readTrackGain('readgain004')).toBeNull();
    expect(readTrackGain('../../etc/x')).toBeNull();
  });
});

describe('measureLoudness', () => {
  it('measures a downloaded song once, sharing the run between callers', async () => {
    audio('measure0001');
    const a = measureLoudness('measure0001');
    const b = measureLoudness('measure0001');
    await flush();
    expect(loudnessRuns().map((s) => s.args)).toEqual([['loudness', '--', 'measure0001']]);
    finish('loudness', 'measure0001', { gainDb: -4.5 });
    expect(await a).toBe(-4.5);
    expect(await b).toBe(-4.5);
  });

  it('answers from the sidecar without spawning', async () => {
    audio('measure0002');
    sidecar('measure0002', JSON.stringify({ gainDb: 2 }));
    expect(await measureLoudness('measure0002')).toBe(2);
    expect(loudnessRuns()).toHaveLength(0);
  });

  it('does nothing for a song that is not on disk', async () => {
    expect(await measureLoudness('notondisk01')).toBeNull();
    expect(loudnessRuns()).toHaveLength(0);
  });

  it('runs one measurement at a time', async () => {
    audio('serialaaaa1');
    audio('serialbbbb1');
    const a = measureLoudness('serialaaaa1');
    const b = measureLoudness('serialbbbb1');
    await flush();
    expect(loudnessRuns().map((s) => s.args[2])).toEqual(['serialaaaa1']);
    finish('loudness', 'serialaaaa1', { gainDb: -1 });
    await a;
    await flush();
    expect(loudnessRuns().map((s) => s.args[2])).toEqual(['serialbbbb1']);
    finish('loudness', 'serialbbbb1', { gainDb: 1 });
    expect(await b).toBe(1);
  });

  it('a failure resolves null and is not retried right away', async () => {
    audio('failing0001');
    const first = measureLoudness('failing0001');
    await flush();
    finish('loudness', 'failing0001', null, 1);
    expect(await first).toBeNull();
    expect(await measureLoudness('failing0001')).toBeNull();
    await flush();
    expect(loudnessRuns()).toHaveLength(0);
  });
});

describe('ensureDownloaded', () => {
  it('measures a fresh download in the background, after the file is served', async () => {
    const dl = ensureDownloaded('freshdl0001');
    await flush();
    expect(loudnessRuns()).toHaveLength(0);
    audio('freshdl0001');
    finish('download', 'freshdl0001', { filePath: path.join(MUSIC, 'freshdl0001.m4a') });
    expect(await dl).toBe(path.join(MUSIC, 'freshdl0001.m4a'));
    await flush();
    await flush();
    expect(loudnessRuns().map((s) => s.args)).toEqual([['loudness', '--', 'freshdl0001']]);
    finish('loudness', 'freshdl0001', { gainDb: -3 });
  });
});
