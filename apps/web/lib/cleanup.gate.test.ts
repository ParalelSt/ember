// @vitest-environment node
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fakePocketBase } from '@/test-utils/fakePocketBase';

// The orphan sweep (bughunt S06) against the REAL download path: the global
// download gate and the auto cache's prefetch. A download waiting for a gate
// slot, one holding a slot, and a prefetch download must all read as
// "downloading", so the sweep never deletes a file yt-dlp has already renamed
// into place but is still post-processing. yt-dlp is a fake child finished by
// hand; MUSIC_DIR is a temp dir, never the real cache.

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
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: () => {}, warn: () => {}, info: () => {} } }));

const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-cleanup-gate-'));
vi.stubEnv('MUSIC_DIR', musicDir);
vi.stubEnv('MAX_CONCURRENT_DOWNLOADS', '2');

const { ensureDownloaded, isDownloading } = await import('@/lib/sources/youtube');
const { downloadGate } = await import('@/lib/downloadGate');
const { runCleanup } = await import('./cleanup');

const flush = () => new Promise((r) => setTimeout(r, 0));

function finish(id: string) {
  const i = running.findIndex((r) => r.id === id);
  const [{ child }] = running.splice(i, 1);
  child.stdout.emit('data', Buffer.from(JSON.stringify({ filePath: path.join(musicDir, `${id}.m4a`) })));
  child.emit('close', 0);
}

/** A finished-looking cache file, aged well past the orphan window. */
function oldFile(id: string): string {
  const file = path.join(musicDir, `${id}.m4a`);
  fs.writeFileSync(file, 'audio');
  const old = new Date(Date.now() - 90 * 86_400_000);
  fs.utimesSync(file, old, old);
  return file;
}

describe('orphan sweep vs the download gate and prefetch (bughunt S06)', () => {
  it('keeps files for downloads holding a slot or waiting for one', async () => {
    const a = ensureDownloaded('swpaaaaaaa1');
    const b = ensureDownloaded('swpbbbbbbb1');
    const c = ensureDownloaded('swpccccccc1'); // queued behind the gate
    await flush();
    expect(downloadGate.inFlightCount()).toBe(2);
    expect(downloadGate.waitingCount()).toBe(1);
    expect(isDownloading('swpccccccc1')).toBe(true);

    const files = ['swpaaaaaaa1', 'swpbbbbbbb1', 'swpccccccc1'].map(oldFile);
    const orphan = oldFile('swpzzzzzzz1'); // nothing downloading: a real orphan

    const report = await runCleanup(fakePocketBase({ tracks: [] }).pb);

    for (const f of files) expect(fs.existsSync(f)).toBe(true);
    expect(fs.existsSync(orphan)).toBe(false);
    expect(report.orphanDeletedFiles).toBe(1);

    finish('swpaaaaaaa1');
    await a;
    await flush();
    finish('swpbbbbbbb1');
    finish('swpccccccc1');
    await Promise.all([b, c]);
    expect(downloadGate.inFlightCount()).toBe(0);
    for (const f of files) fs.rmSync(f, { force: true });
  });

  it('keeps the file of a prefetch download while it runs', async () => {
    const p = ensureDownloaded('swpppppppp1', { prefetch: true });
    await flush();
    expect(downloadGate.inFlightCount()).toBe(1);
    expect(isDownloading('swpppppppp1')).toBe(true);
    const file = oldFile('swpppppppp1');

    const report = await runCleanup(fakePocketBase({ tracks: [] }).pb);

    expect(fs.existsSync(file)).toBe(true);
    expect(report.orphanDeletedFiles).toBe(0);

    finish('swpppppppp1');
    await p;
    expect(isDownloading('swpppppppp1')).toBe(false);
    expect(downloadGate.inFlightCount()).toBe(0);
    fs.rmSync(file, { force: true });
  });

  it('the stale-track pass also leaves a row and file alone while it downloads', async () => {
    const p = ensureDownloaded('swpsssssss1', { prefetch: true });
    await flush();
    const file = oldFile('swpsssssss1');
    // Never played, nothing references it: stale, were it not downloading.
    const fake = fakePocketBase({ tracks: [{ id: 't1', external_id: 'youtube:swpsssssss1' }] });

    const report = await runCleanup(fake.pb);

    expect(fs.existsSync(file)).toBe(true);
    expect(report.deletedRows).toBe(0);
    expect(report.deletedFiles).toBe(0);
    expect(fake.rows.get('tracks')?.length).toBe(1);

    finish('swpsssssss1');
    await p;
    const after = await runCleanup(fake.pb);
    expect(after.deletedRows).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
  });
});
