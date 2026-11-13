import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The streamed search: one `player.py search --stream` run whose stdout is
// one JSON line per lookup. Each part has to settle the moment its line
// arrives, even when a line is split across stdout chunks.

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

let child: FakeChild;
let lastArgs: string[] = [];

vi.mock('node:child_process', () => {
  const spawn = vi.fn((_cmd: string, args: string[]) => {
    lastArgs = args;
    child = new FakeChild();
    return child;
  });
  return { spawn, default: { spawn } };
});

const raw = (videoId: string, title = videoId) => ({ videoId, title, artist: 'Band', durationSec: 200, artworkUrl: null });
const line = (o: unknown) => Buffer.from(`${JSON.stringify(o)}\n`);
const tick = () => new Promise((r) => setTimeout(r, 0));

async function start(query: string) {
  const { searchTrackParts } = await import('./youtube');
  const parts = searchTrackParts(query);
  // The run starts once its lane has a slot (a microtask or two).
  await tick();
  return parts;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('searchTrackParts', () => {
  it('runs the helper in stream mode with the query after --', async () => {
    await start('stream args');
    expect(lastArgs.slice(1)).toEqual(['search', '--stream', '--limit', '30', '--', 'stream args']);
    child.emit('close', 0);
  });

  it('settles songs as soon as their line arrives, before the run ends', async () => {
    const parts = await start('songs first');
    let songs: unknown = null;
    void parts.songs.then((t) => { songs = t; });
    child.stdout.emit('data', line({ part: 'songs', tracks: [raw('aaaaaaaaaaa', 'Song')] }));
    await tick();
    expect((songs as { title: string }[]).map((t) => t.title)).toEqual(['Song']);
    child.emit('close', 0);
  });

  it('reads a line split over two stdout chunks', async () => {
    const parts = await start('split line');
    const text = line({ part: 'artists', artists: [{ id: 'UC1', name: 'Demetori', artworkUrl: null }] }).toString();
    child.stdout.emit('data', Buffer.from(text.slice(0, 10)));
    child.stdout.emit('data', Buffer.from(text.slice(10)));
    await expect(parts.artists).resolves.toEqual([{ id: 'UC1', name: 'Demetori', artworkUrl: null }]);
    child.emit('close', 0);
  });

  it('normalizes and de-duplicates tracks like the one-shot search', async () => {
    const parts = await start('normalize');
    child.stdout.emit('data', line({ part: 'videos', tracks: [raw('bbbbbbbbbbb'), raw('bbbbbbbbbbb')] }));
    const videos = await parts.videos;
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ id: 'youtube:bbbbbbbbbbb', source: 'youtube', streamUrl: '/api/youtube/stream/bbbbbbbbbbb' });
    child.emit('close', 0);
  });

  it('an empty videos line waits for the yt-dlp fallback', async () => {
    const parts = await start('fallback');
    child.stdout.emit('data', line({ part: 'videos', tracks: [] }));
    child.stdout.emit('data', line({ part: 'songs', tracks: [] }));
    child.stdout.emit('data', line({ part: 'fallback', tracks: [raw('ccccccccccc', 'Found by yt-dlp')] }));
    child.emit('close', 0);
    expect((await parts.videos).map((t) => t.title)).toEqual(['Found by yt-dlp']);
  });

  it('parts that never got a line are empty once the run ends', async () => {
    const parts = await start('missing lines');
    child.stdout.emit('data', line({ part: 'songs', tracks: [raw('aaaaaaaaaaa')] }));
    child.emit('close', 0);
    await expect(parts.artists).resolves.toEqual([]);
    await expect(parts.videos).resolves.toEqual([]);
  });

  it('a failed run rejects what is still waiting and keeps what arrived', async () => {
    const parts = await start('failing run');
    child.stdout.emit('data', line({ part: 'artists', artists: [] }));
    child.stderr.emit('data', Buffer.from('ERROR: search is unavailable right now, try again shortly\n'));
    child.emit('close', 1);
    await expect(parts.artists).resolves.toEqual([]);
    await expect(parts.songs).rejects.toMatchObject({ status: 502 });
    await expect(parts.videos).rejects.toMatchObject({ status: 502 });
  });

  it('caches a finished answer: the same query does not run the helper again', async () => {
    const { spawn } = await import('node:child_process');
    const parts = await start('cached parts');
    child.stdout.emit('data', line({ part: 'songs', tracks: [raw('aaaaaaaaaaa', 'Kept')] }));
    child.stdout.emit('data', line({ part: 'artists', artists: [{ id: 'UC1', name: 'A', artworkUrl: null }] }));
    child.emit('close', 0);
    await parts.songs;
    await tick();
    const again = await start('cached parts');
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
    expect((await again.songs).map((t) => t.title)).toEqual(['Kept']);
    expect(await again.artists).toEqual([{ id: 'UC1', name: 'A', artworkUrl: null }]);
  });

  it('never caches an answer with no tracks', async () => {
    const { spawn } = await import('node:child_process');
    await start('nothing found');
    child.stdout.emit('data', line({ part: 'songs', tracks: [] }));
    child.emit('close', 0);
    await tick();
    await start('nothing found');
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(2);
    child.emit('close', 0);
  });

  it('a line that is not JSON fails the run', async () => {
    const parts = await start('garbage');
    child.stdout.emit('data', Buffer.from('Traceback (most recent call last)\n'));
    child.emit('close', 0);
    await expect(parts.songs).rejects.toMatchObject({ status: 502 });
  });
});
