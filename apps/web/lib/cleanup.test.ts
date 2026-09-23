// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fakePocketBase } from '@/test-utils/fakePocketBase';

/** lib/cleanup.ts: the stale-track sweep (existing) plus the orphan cache
 *  file sweep (bughunt S06). MUSIC_DIR is read when the module loads, so
 *  every test gets its own fresh temp dir and a fresh import — never the
 *  real music cache. isDownloading is mocked so a test can simulate a
 *  download in progress without spawning anything. */

const downloading = vi.hoisted(() => ({ ids: new Set<string>() }));
vi.mock('@/lib/sources/youtube', () => ({
  isDownloading: (videoId: string) => downloading.ids.has(videoId),
}));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: () => {}, warn: () => {} } }));

async function freshCleanup(musicDir: string) {
  vi.resetModules();
  process.env.MUSIC_DIR = musicDir;
  downloading.ids.clear();
  return import('./cleanup');
}

function tmpMusicDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ember-cleanup-test-'));
}

function writeCacheFile(dir: string, name: string, { ageDays = 0 }: { ageDays?: number } = {}): void {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'fake audio bytes');
  if (ageDays > 0) {
    const old = new Date(Date.now() - ageDays * 86_400_000);
    fs.utimesSync(file, old, old);
  }
}

const VIDEO_A = 'aaaaaaaaaaa'; // 11 chars, like a real videoId
const VIDEO_B = 'bbbbbbbbbbb';
const VIDEO_C = 'ccccccccccc';

describe('orphan cache file sweep (bughunt S06)', () => {
  it('deletes an old cache file whose track row is gone', async () => {
    const dir = tmpMusicDir();
    writeCacheFile(dir, `${VIDEO_A}.m4a`, { ageDays: 40 });
    const { runCleanup, ORPHAN_CACHE_AFTER_DAYS } = await freshCleanup(dir);
    expect(ORPHAN_CACHE_AFTER_DAYS).toBe(30);
    const { pb } = fakePocketBase({ tracks: [] });

    const report = await runCleanup(pb);

    expect(report.orphanScanned).toBe(1);
    expect(report.orphanDeletedFiles).toBe(1);
    expect(report.orphanFreedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(dir, `${VIDEO_A}.m4a`))).toBe(false);
  });

  it('keeps a file whose track row still exists', async () => {
    const dir = tmpMusicDir();
    writeCacheFile(dir, `${VIDEO_A}.m4a`, { ageDays: 40 });
    const { runCleanup } = await freshCleanup(dir);
    // Liked, so the main stale-track sweep leaves the row (and its file)
    // alone too: this test is only about the orphan sweep seeing the row.
    const { pb } = fakePocketBase({
      tracks: [{ id: 't1', external_id: `youtube:${VIDEO_A}` }],
      likes: [{ track: 't1' }],
    });

    const report = await runCleanup(pb);

    expect(report.orphanScanned).toBe(0);
    expect(report.orphanDeletedFiles).toBe(0);
    expect(fs.existsSync(path.join(dir, `${VIDEO_A}.m4a`))).toBe(true);
  });

  it('keeps an orphan file that has not aged past the retention window yet', async () => {
    const dir = tmpMusicDir();
    writeCacheFile(dir, `${VIDEO_A}.m4a`, { ageDays: 2 });
    const { runCleanup } = await freshCleanup(dir);
    const { pb } = fakePocketBase({ tracks: [] });

    const report = await runCleanup(pb);

    // Still counted as a candidate the sweep saw, just not old enough to touch.
    expect(report.orphanScanned).toBe(1);
    expect(report.orphanDeletedFiles).toBe(0);
    expect(fs.existsSync(path.join(dir, `${VIDEO_A}.m4a`))).toBe(true);
  });

  it('never touches a videoId that is currently downloading, even if old and unmatched', async () => {
    const dir = tmpMusicDir();
    writeCacheFile(dir, `${VIDEO_A}.m4a`, { ageDays: 40 });
    const { runCleanup } = await freshCleanup(dir);
    downloading.ids.add(VIDEO_A);
    const { pb } = fakePocketBase({ tracks: [] });

    const report = await runCleanup(pb);

    expect(report.orphanDeletedFiles).toBe(0);
    expect(fs.existsSync(path.join(dir, `${VIDEO_A}.m4a`))).toBe(true);
  });

  it('never touches a mid-download .part/.ytdl file, even old and unmatched', async () => {
    const dir = tmpMusicDir();
    writeCacheFile(dir, `${VIDEO_A}.m4a.part`, { ageDays: 40 });
    writeCacheFile(dir, `${VIDEO_B}.webm.ytdl`, { ageDays: 40 });
    const { runCleanup } = await freshCleanup(dir);
    const { pb } = fakePocketBase({ tracks: [] });

    const report = await runCleanup(pb);

    expect(report.orphanScanned).toBe(0);
    expect(report.orphanDeletedFiles).toBe(0);
    expect(fs.existsSync(path.join(dir, `${VIDEO_A}.m4a.part`))).toBe(true);
    expect(fs.existsSync(path.join(dir, `${VIDEO_B}.webm.ytdl`))).toBe(true);
  });

  it('never touches a file that is not a plain cached-audio filename (e.g. an upload)', async () => {
    const dir = tmpMusicDir();
    writeCacheFile(dir, 'not-a-video-id.mp3', { ageDays: 40 });
    writeCacheFile(dir, `${VIDEO_A}.txt`, { ageDays: 40 });
    const { runCleanup } = await freshCleanup(dir);
    const { pb } = fakePocketBase({ tracks: [] });

    const report = await runCleanup(pb);

    expect(report.orphanDeletedFiles).toBe(0);
    expect(fs.existsSync(path.join(dir, 'not-a-video-id.mp3'))).toBe(true);
    expect(fs.existsSync(path.join(dir, `${VIDEO_A}.txt`))).toBe(true);
  });

  it('dry run reports what it would delete without deleting it', async () => {
    const dir = tmpMusicDir();
    writeCacheFile(dir, `${VIDEO_A}.m4a`, { ageDays: 40 });
    const { runCleanup } = await freshCleanup(dir);
    const { pb } = fakePocketBase({ tracks: [] });

    const report = await runCleanup(pb, { dryRun: true });

    expect(report.orphanDeletedFiles).toBe(1);
    expect(fs.existsSync(path.join(dir, `${VIDEO_A}.m4a`))).toBe(true);
  });

  it('handles a mix: gone row deleted, live row kept, in-flight kept, too-young kept', async () => {
    const dir = tmpMusicDir();
    writeCacheFile(dir, `${VIDEO_A}.m4a`, { ageDays: 40 }); // orphan, old enough
    writeCacheFile(dir, `${VIDEO_B}.mp3`, { ageDays: 40 }); // still has a row
    writeCacheFile(dir, `${VIDEO_C}.opus`, { ageDays: 40 }); // downloading right now
    const { runCleanup } = await freshCleanup(dir);
    downloading.ids.add(VIDEO_C);
    const { pb } = fakePocketBase({
      tracks: [{ id: 't1', external_id: `youtube:${VIDEO_B}` }],
      likes: [{ track: 't1' }],
    });

    const report = await runCleanup(pb);

    expect(report.orphanScanned).toBe(1);
    expect(report.orphanDeletedFiles).toBe(1);
    expect(fs.existsSync(path.join(dir, `${VIDEO_A}.m4a`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${VIDEO_B}.mp3`))).toBe(true);
    expect(fs.existsSync(path.join(dir, `${VIDEO_C}.opus`))).toBe(true);
  });
});
