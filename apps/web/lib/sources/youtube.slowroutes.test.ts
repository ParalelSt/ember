// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Slow routes: identical asks must share one upstream call, and a repeat
// must not reach the upstream at all, with the answer unchanged.

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}
const spawned: { args: string[]; child: FakeChild }[] = [];
vi.mock('node:child_process', () => {
  const spawn = vi.fn((_bin: string, args: string[]) => {
    const child = new FakeChild();
    spawned.push({ args: args.slice(1), child });
    return child;
  });
  return { spawn, default: { spawn } };
});
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

let lrclibCalls = 0;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (!String(input).startsWith('https://lrclib.net/')) throw new Error('unexpected fetch');
  lrclibCalls += 1;
  await new Promise((r) => setTimeout(r, 5));
  if (String(input).includes('Gate')) return new Response('[]');
  return new Response(JSON.stringify([{ id: 1, duration: 200, plainLyrics: 'words', syncedLyrics: '[00:01.00]words' }]));
}) as typeof fetch;

const { searchTracks, searchTrackParts, getRecommended, getLyrics } = await import('./youtube');

const raw = (videoId: string) => ({ videoId, title: `T ${videoId}`, artist: 'Band', durationSec: 200, artworkUrl: null });
/** Fire and forget; the afterEach may end it with an error. */
const bg = (p: Promise<unknown>) => void p.catch(() => {});
const tick = () => new Promise((r) => setTimeout(r, 0));
const finish = (i: number, out: unknown) => {
  spawned[i].child.stdout.emit('data', JSON.stringify(out));
  spawned[i].child.emit('close', 0);
};
const finishLines = (i: number, lines: unknown[]) => {
  for (const l of lines) spawned[i].child.stdout.emit('data', `${JSON.stringify(l)}\n`);
  spawned[i].child.emit('close', 0);
};

/** Unfinished helpers hold lane slots: end whatever a test left running. */
afterEach(async () => {
  for (const { child } of spawned) child.emit('close', 1);
  await tick();
});

beforeEach(() => {
  spawned.length = 0;
  lrclibCalls = 0;
});

describe('searchTracks', () => {
  it('runs one helper for concurrent identical searches and gives all the same list', async () => {
    const a = searchTracks('dedupe one');
    const b = searchTracks('dedupe one');
    await tick();
    expect(spawned).toHaveLength(1);
    finish(0, [raw('aaaaaaaaaaa'), raw('bbbbbbbbbbb')]);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.map((t) => t.id)).toEqual(['youtube:aaaaaaaaaaa', 'youtube:bbbbbbbbbbb']);
    expect(rb).toEqual(ra);
  });

  it('answers a repeat, even with other capitals or spacing, without the helper', async () => {
    const first = searchTracks('Daft  Punk');
    await tick();
    finish(0, [raw('ccccccccccc')]);
    const tracks = await first;
    const again = await searchTracks('  daft punk ');
    expect(spawned).toHaveLength(1);
    expect(again).toEqual(tracks);
  });

  it('does not keep an empty answer or a failure', async () => {
    const a = searchTracks('empty one');
    await tick();
    finish(0, []);
    expect(await a).toEqual([]);
    const b = searchTracks('empty one');
    await tick();
    expect(spawned).toHaveLength(2);
    spawned[1].child.emit('close', 1);
    await expect(b).rejects.toBeTruthy();
    bg(searchTracks('empty one'));
    await tick();
    expect(spawned).toHaveLength(3);
  });
});

describe('searchTrackParts', () => {
  it('shares one streamed run between concurrent identical searches', async () => {
    const a = searchTrackParts('parts share');
    const b = searchTrackParts('Parts  Share');
    await tick();
    expect(spawned).toHaveLength(1);
    finishLines(0, [
      { part: 'songs', tracks: [raw('ddddddddddd')] },
      { part: 'videos', tracks: [raw('eeeeeeeeeee')] },
      { part: 'artists', artists: [] },
    ]);
    expect((await a.songs).map((t) => t.id)).toEqual(['youtube:ddddddddddd']);
    expect(await b.songs).toEqual(await a.songs);
    expect((await b.videos).map((t) => t.id)).toEqual(['youtube:eeeeeeeeeee']);
  });

  it('answers a repeat after the run from the cache, no helper', async () => {
    const a = searchTrackParts('parts repeat');
    await tick();
    finishLines(0, [{ part: 'songs', tracks: [raw('fffffffffff')] }, { part: 'videos', tracks: [] }, { part: 'artists', artists: [] }]);
    await a.songs;
    await tick();
    const again = searchTrackParts('parts repeat');
    expect(spawned).toHaveLength(1);
    expect((await again.songs).map((t) => t.id)).toEqual(['youtube:fffffffffff']);
  });
});

describe('getRecommended', () => {
  it('runs one helper for concurrent asks of the same seed, then answers from memory', async () => {
    const a = getRecommended({ seed: 'SEEDaaaaaaa', country: 'ZZ' });
    const b = getRecommended({ seed: 'SEEDaaaaaaa', country: 'ZZ' });
    await tick();
    expect(spawned).toHaveLength(1);
    expect(spawned[0].args).toEqual(['recommended', '--country', 'ZZ', '--limit', '30', '--seed=SEEDaaaaaaa']);
    finish(0, [raw('ggggggggggg'), raw('ggggggggggg'), raw('hhhhhhhhhhh')]);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.map((t) => t.id)).toEqual(['youtube:ggggggggggg', 'youtube:hhhhhhhhhhh']);
    expect(rb).toEqual(ra);
    expect(await getRecommended({ seed: 'SEEDaaaaaaa', country: 'ZZ' })).toEqual(ra);
    expect(spawned).toHaveLength(1);
  });

  it('keeps seeds, countries and sizes apart', async () => {
    bg(getRecommended({ seed: 'SEEDbbbbbbb', country: 'ZZ' }));
    bg(getRecommended({ seed: 'SEEDccccccc', country: 'ZZ' }));
    bg(getRecommended({ seed: 'SEEDbbbbbbb', country: 'US' }));
    bg(getRecommended({ seed: 'SEEDbbbbbbb', country: 'ZZ', limit: 10 }));
    await tick();
    expect(spawned).toHaveLength(4);
  });

  it('does not keep a failure', async () => {
    const a = getRecommended({ seed: 'SEEDddddddd' });
    await tick();
    spawned[0].child.emit('close', 1);
    await expect(a).rejects.toBeTruthy();
    bg(getRecommended({ seed: 'SEEDddddddd' }));
    await tick();
    expect(spawned).toHaveLength(2);
  });
});

describe('getLyrics', () => {
  it('asks LRCLib once for concurrent identical asks and answers a repeat from memory', async () => {
    const [a, b] = await Promise.all([getLyrics('Same Song', 'Same Band', 200), getLyrics('Same Song', 'Same Band', 200)]);
    expect(lrclibCalls).toBe(1);
    expect(b).toEqual(a);
    expect(a.source).toBe('lrclib');
    expect(a.synced?.[0].text).toBe('words');
    await getLyrics('same song', 'SAME BAND', 200);
    expect(lrclibCalls).toBe(1);
  });

  it('lets a waiter run its own lookup when the shared one was refused', async () => {
    const first = getLyrics('Gate Song', 'Gate Band', 200, {
      beforeHelper: () => {
        throw new Error('limited');
      },
    });
    const second = getLyrics('Gate Song', 'Gate Band', 200);
    const firstResult = first.then(() => 'ok', () => 'refused');
    await tick();
    await tick();
    await tick();
    expect(await firstResult).toBe('refused');
    // The waiter was not handed the refusal: it asked the helper itself.
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    expect(spawned[0].args.slice(0, 2)).toEqual(['lyrics', '--']);
    finish(0, { lyrics: 'genius words', source: 'genius', url: 'https://g.test/x' });
    expect((await second).lyrics).toBe('genius words');
  });
});
