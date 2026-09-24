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

let closeCode = 0;
let stderrLine = '';

vi.mock('node:child_process', () => {
  const spawn = vi.fn((_cmd: string, args: unknown[]) => {
    lastSpawnArgs = args;
    fakeChild = new FakeChild();
    queueMicrotask(() => {
      if (stderrLine) fakeChild.stderr.emit('data', Buffer.from(`${stderrLine}\n`));
      fakeChild.emit('close', closeCode);
    });
    return fakeChild;
  });
  return { spawn, default: { spawn } };
});

const errorSpy = vi.fn();
const warnSpy = vi.fn();
vi.mock('@/lib/logger/server', () => ({
  serverLogger: { error: (...args: unknown[]) => errorSpy(...args), warn: (...args: unknown[]) => warnSpy(...args) },
}));

describe('tab generation argv', () => {
  const tabDir = path.join(os.tmpdir(), `ember-tabgen-test-${Date.now()}`);

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    closeCode = 0;
    stderrLine = '';
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

describe('tab generation without basic_pitch installed', () => {
  const tabDir = path.join(os.tmpdir(), `ember-tabgen-basicpitch-test-${Date.now()}`);

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    closeCode = 1;
    stderrLine = "ModuleNotFoundError: No module named 'basic_pitch'";
    process.env.TRANSCRIBE_SCRIPT = path.join(tabDir, 'transcribe.py');
    process.env.PYTHON_BIN = '/usr/bin/env';
    process.env.MUSIC_DIR = tabDir;
  });

  afterEach(() => {
    delete process.env.TRANSCRIBE_SCRIPT;
    delete process.env.PYTHON_BIN;
    delete process.env.MUSIC_DIR;
  });

  it('logs one warn instead of an error, and generation still fails cleanly for the caller', async () => {
    const { startGeneration, generationStatus } = await import('./tabGenerate');
    await expect(startGeneration('youtube-abc', '/tmp/audio.m4a', 'Song')).rejects.toThrow(
      "ModuleNotFoundError: No module named 'basic_pitch'",
    );

    expect(generationStatus('youtube-abc')).toEqual({
      status: 'failed',
      error: "ModuleNotFoundError: No module named 'basic_pitch'",
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('tabs', 'tab alignment is off: numpy/basic_pitch not installed, see SETUP.md');
  });
});
