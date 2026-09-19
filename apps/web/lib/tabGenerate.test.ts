import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Companion regression test to youtube.test.ts: tab generation also builds
// player-side (transcribe.py) argv from track data (the title), which can
// legitimately start with `-` and, without spaces, would otherwise be
// misread by argparse as another option.

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

let lastSpawnArgs: unknown[] | undefined;
let fakeChild: FakeChild;

vi.mock('node:child_process', () => {
  const spawn = vi.fn((_cmd: string, args: unknown[]) => {
    lastSpawnArgs = args;
    fakeChild = new FakeChild();
    queueMicrotask(() => {
      fakeChild.emit('close', 0);
    });
    return fakeChild;
  });
  return { spawn, default: { spawn } };
});

describe('tab generation argv', () => {
  const tabDir = path.join(os.tmpdir(), `ember-tabgen-test-${Date.now()}`);

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.TRANSCRIBE_SCRIPT = path.join(tabDir, 'transcribe.py');
    process.env.PYTHON_BIN = '/usr/bin/env';
    process.env.MUSIC_DIR = tabDir;
  });

  afterEach(() => {
    delete process.env.TRANSCRIBE_SCRIPT;
    delete process.env.PYTHON_BIN;
    delete process.env.MUSIC_DIR;
  });

  it('passes a hyphen-leading title as --title=<value>, never as a separate argv token', async () => {
    const { startGeneration } = await import('./tabGenerate');
    await startGeneration('youtube-abc', '/tmp/audio.m4a', '-Interlude').catch(() => {});

    expect(lastSpawnArgs).toBeDefined();
    const args = lastSpawnArgs as string[];
    expect(args).toContain('--title=-Interlude');
    expect(args).not.toContain('--title');
  });
});
