// @vitest-environment node
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// ensureDownloaded against the global download gate: cold downloads hold a
// slot, joiners never do, and a prefetch refuses to start a cold download
// while anything runs. The yt-dlp helper is a fake child we finish by hand.

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

const running: Array<{ id: string; child: FakeChild }> = [];

vi.mock('node:child_process', () => {
  const spawn = vi.fn((_cmd: string, args: string[]) => {
    const child = new FakeChild();
    running.push({ id: args[args.length - 1], child });
    return child;
  });
  return { spawn, default: { spawn } };
});

vi.stubEnv('MUSIC_DIR', fs.mkdtempSync(path.join(os.tmpdir(), 'ember-gate-')));
vi.stubEnv('MAX_CONCURRENT_DOWNLOADS', '2');

const { ensureDownloaded, isDownloading } = await import('./youtube');
const { downloadGate, isBusyError } = await import('@/lib/downloadGate');

const flush = () => new Promise((r) => setTimeout(r, 0));

function finish(id: string) {
  const i = running.findIndex((r) => r.id === id);
  const [{ child }] = running.splice(i, 1);
  child.stdout.emit('data', Buffer.from(JSON.stringify({ filePath: `/music/${id}.m4a` })));
  child.emit('close', 0);
}

describe('ensureDownloaded and the download gate', () => {
  it('runs two cold downloads, queues the third, and a joiner takes no slot', async () => {
    const a = ensureDownloaded('gateaaaaaa1');
    const b = ensureDownloaded('gatebbbbbb1');
    const c = ensureDownloaded('gatecccccc1');
    const joinA = ensureDownloaded('gateaaaaaa1');
    await flush();
    expect(running.map((r) => r.id)).toEqual(['gateaaaaaa1', 'gatebbbbbb1']);
    expect(downloadGate.inFlightCount()).toBe(2);
    expect(downloadGate.waitingCount()).toBe(1);
    // Waiting for a slot still counts as downloading, so the route never
    // serves a half-written file for it.
    expect(isDownloading('gatecccccc1')).toBe(true);

    finish('gateaaaaaa1');
    expect(await a).toBe('/music/gateaaaaaa1.m4a');
    expect(await joinA).toBe('/music/gateaaaaaa1.m4a');
    await flush();
    expect(running.map((r) => r.id)).toEqual(['gatebbbbbb1', 'gatecccccc1']);

    finish('gatebbbbbb1');
    finish('gatecccccc1');
    await Promise.all([b, c]);
    expect(downloadGate.inFlightCount()).toBe(0);
  });

  it('a prefetch refuses a cold download while one runs, but may join it', async () => {
    const play = ensureDownloaded('gatedddddd1');
    await flush();
    const refused = await ensureDownloaded('gateeeeeee1', { prefetch: true }).catch((e) => e);
    expect(isBusyError(refused)).toBe(true);
    expect((refused as { retryAfter: number }).retryAfter).toBe(30);
    expect(running.map((r) => r.id)).toEqual(['gatedddddd1']);

    const joined = ensureDownloaded('gatedddddd1', { prefetch: true });
    finish('gatedddddd1');
    expect(await joined).toBe('/music/gatedddddd1.m4a');
    await play;
  });

  it('a prefetch on an idle host starts the download and frees the slot after', async () => {
    const p = ensureDownloaded('gateffffff1', { prefetch: true });
    await flush();
    expect(downloadGate.inFlightCount()).toBe(1);
    finish('gateffffff1');
    await p;
    expect(downloadGate.inFlightCount()).toBe(0);
  });

  it('a failed download frees its slot too', async () => {
    const p = ensureDownloaded('gategggggg1');
    await flush();
    const [{ child }] = running.splice(0, 1);
    child.stderr.emit('data', Buffer.from('ERROR: HTTP Error 403: Forbidden'));
    child.emit('close', 1);
    await expect(p).rejects.toThrow();
    expect(downloadGate.inFlightCount()).toBe(0);
  });
});
