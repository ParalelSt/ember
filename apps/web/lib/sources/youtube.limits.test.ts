// @vitest-environment node
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// No length/size cap by default (removed 2026-09-26; the host is friends
// only): player.py's "too long" refusal still becomes a 413 the stream route
// will not retry or stream live, and a live stream URL is always refused
// before anyone fetches it, since it has no end to reach. The env vars still
// opt a host back into a cap if it wants one.

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

let next: (child: FakeChild) => void = () => {};
vi.mock('node:child_process', () => {
  const spawn = vi.fn(() => {
    const child = new FakeChild();
    setTimeout(() => next(child), 0);
    return child;
  });
  return { spawn, default: { spawn } };
});
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

vi.stubEnv('MUSIC_DIR', fs.mkdtempSync(path.join(os.tmpdir(), 'ember-limits-')));
vi.stubEnv('EMBER_MAX_TRACK_MINUTES', '');
vi.stubEnv('EMBER_MAX_DOWNLOAD_MB', '');

const { ensureDownloaded, resolveStreamUrl, isTooLargeError, isUnavailableError } = await import('./youtube');

function fail(line: string) {
  next = (child) => {
    child.stderr.emit('data', Buffer.from(`Traceback...\n${line}\n`));
    child.emit('close', 1);
  };
}
function answer(json: unknown) {
  next = (child) => {
    child.stdout.emit('data', Buffer.from(JSON.stringify(json)));
    child.emit('close', 0);
  };
}

describe('the media cap in lib/sources/youtube', () => {
  it("player.py's too-long refusal is a 413 marked tooLarge, not a 502 or an unavailable song", async () => {
    fail('ERROR: too long: 60 min is over the 20 min limit');
    const e = await ensureDownloaded('limitlong01').catch((x: unknown) => x);
    expect(isTooLargeError(e)).toBe(true);
    expect((e as { status: number }).status).toBe(413);
    expect(isUnavailableError(e)).toBe(false);
    expect((e as Error).message).toBe('too long: 60 min is over the 20 min limit');
  });

  it('any other helper failure is untouched', async () => {
    fail('ERROR: unable to download video data: HTTP Error 403: Forbidden');
    const e = await ensureDownloaded('limitother1').catch((x: unknown) => x);
    expect(isTooLargeError(e)).toBe(false);
    expect((e as { status: number }).status).toBe(502);
  });

  it('an hour-long video resolves fine with no cap set', async () => {
    answer({ url: 'https://rr1.googlevideo.com/x', ext: 'm4a', durationSec: 3600 });
    expect((await resolveStreamUrl('limitlive01')).url).toBe('https://rr1.googlevideo.com/x');
  });

  it('a live stream is refused (it never ends, cap or no cap)', async () => {
    answer({ url: 'https://rr1.googlevideo.com/x', ext: 'm4a', durationSec: null, isLive: true });
    expect(isTooLargeError(await resolveStreamUrl('limitlive02').catch((x: unknown) => x))).toBe(true);
  });

  it('a normal song resolves', async () => {
    answer({ url: 'https://rr1.googlevideo.com/x', ext: 'm4a', durationSec: 240, filesize: 4_000_000 });
    expect((await resolveStreamUrl('limitlive03')).url).toBe('https://rr1.googlevideo.com/x');
  });

  it('an hour-long video is refused once EMBER_MAX_TRACK_MINUTES opts in', async () => {
    vi.stubEnv('EMBER_MAX_TRACK_MINUTES', '20');
    answer({ url: 'https://rr1.googlevideo.com/x', ext: 'm4a', durationSec: 3600 });
    const e = await resolveStreamUrl('limitlive04').catch((x: unknown) => x);
    expect(isTooLargeError(e)).toBe(true);
  });
});
