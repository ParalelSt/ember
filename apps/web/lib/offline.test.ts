/** The browser-storage (OPFS) playlist download: the web and desktop path.
 *  Android goes through the native plugin and is covered by its own tests.
 *
 *  The faults this guards (bughunt P09): a download saved files the player
 *  never read, an uploaded song always failed because the download asked the
 *  YouTube route for it, and one bad track threw away every track saved so
 *  far. A small in-memory OPFS stands in for navigator.storage. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test-utils/fakeBackend';
import { useOfflineStore } from '@/stores/useOfflineStore';

vi.mock('@/lib/api', () => ({ apiUrl: (u: string) => u }));

import { downloadPlaylist, hydrateOfflineStore, removeDownload } from './offline';

type Node = FakeDir | FakeFile;
class FakeFile {
  kind = 'file' as const;
  data: Uint8Array = new Uint8Array();
  constructor(public name: string, public parent: FakeDir) {}
  async getFile() { return new File([this.data as BlobPart], this.name); }
  async createWritable() {
    const chunks: Uint8Array[] = [];
    return {
      write: async (c: Uint8Array | string) => { chunks.push(typeof c === 'string' ? new TextEncoder().encode(c) : c); },
      close: async () => {
        const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
        let at = 0;
        for (const c of chunks) { out.set(c, at); at += c.byteLength; }
        this.data = out;
      },
      abort: async () => {},
    };
  }
  async move(name: string) {
    this.parent.children.delete(this.name);
    this.name = name;
    this.parent.children.set(name, this);
  }
}
class FakeDir {
  kind = 'directory' as const;
  children = new Map<string, Node>();
  async getDirectoryHandle(name: string, o: { create?: boolean } = {}) {
    let d = this.children.get(name);
    if (!d && o.create) { d = new FakeDir(); this.children.set(name, d); }
    if (!(d instanceof FakeDir)) throw new DOMException('missing', 'NotFoundError');
    return d;
  }
  async getFileHandle(name: string, o: { create?: boolean } = {}) {
    let f = this.children.get(name);
    if (!f && o.create) { f = new FakeFile(name, this); this.children.set(name, f); }
    if (!(f instanceof FakeFile)) throw new DOMException('missing', 'NotFoundError');
    return f;
  }
  async removeEntry(name: string) {
    if (!this.children.delete(name)) throw new DOMException('missing', 'NotFoundError');
  }
  async *entries() { yield* this.children.entries(); }
}

let root: FakeDir;
const fetchMock = vi.fn();
let urlCount = 0;

const audio = (bytes = 4) => new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'audio/mp4' } });

const YT = makeTrack({ id: 'youtube:a1', sourceId: 'a1', title: 'Song A', streamUrl: '/api/youtube/stream/a1' });
const BAD = makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Song B', streamUrl: '/api/youtube/stream/b2' });
const UP = makeTrack({ id: 'upload:u1', source: 'upload', sourceId: 'u1', title: 'My Upload', streamUrl: '/api/uploads/u1/stream' });
const PL = { id: 'pl1', name: 'Mix', created_at: '', artwork_url: null };

beforeEach(() => {
  root = new FakeDir();
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { getDirectory: async () => root, persist: async () => true },
  });
  urlCount = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${++urlCount}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    url.includes('/b2') ? new Response('nope', { status: 500 }) : audio());
  vi.stubGlobal('fetch', fetchMock);
  useOfflineStore.setState({ downloaded: [], inFlight: {}, totalBytes: 0, trackFiles: {}, webFiles: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const manifestIds = async () => {
  const dir = await root.getDirectoryHandle('playlists').then((d) => d.getDirectoryHandle('pl1'));
  const f = await (await dir.getFileHandle('manifest.json')).getFile();
  return (JSON.parse(await f.text()) as { tracks: { id: string }[] }).tracks.map((t) => t.id);
};

describe('downloadPlaylist (browser storage)', () => {
  it('fetches an uploaded song from its own stream URL, not the YouTube route', async () => {
    await downloadPlaylist(PL, [UP]);

    expect(fetchMock.mock.calls.map((c) => c[0])).toContain('/api/uploads/u1/stream');
    expect(await manifestIds()).toEqual(['upload:u1']);
  });

  it('skips a track that fails and keeps the rest, reporting the count', async () => {
    const result = await downloadPlaylist(PL, [YT, BAD, UP]);

    expect(result).toEqual({ saved: 2, failed: 1 });
    expect(await manifestIds()).toEqual(['youtube:a1', 'upload:u1']);
    expect(useOfflineStore.getState().downloaded).toContain('pl1');
  });

  it('does not save a sign-in page as audio', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/b2') ? new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) : audio());

    const result = await downloadPlaylist(PL, [YT, BAD]);

    expect(result).toEqual({ saved: 1, failed: 1 });
  });

  it('still fails outright when nothing at all could be saved', async () => {
    await expect(downloadPlaylist(PL, [BAD])).rejects.toThrow();
    expect(useOfflineStore.getState().downloaded).not.toContain('pl1');
  });

  it('makes the saved files playable: each gets a local URL the player reads', async () => {
    await downloadPlaylist(PL, [YT, BAD, UP]);

    const web = useOfflineStore.getState().webFiles;
    expect(Object.keys(web).sort()).toEqual(['upload:u1', 'youtube:a1']);
    expect(web['youtube:a1']).toMatch(/^blob:/);
  });

  it('rebuilds those local URLs at boot from what is on disk', async () => {
    await downloadPlaylist(PL, [YT, UP]);
    useOfflineStore.setState({ webFiles: {} });

    await hydrateOfflineStore();

    expect(Object.keys(useOfflineStore.getState().webFiles).sort()).toEqual(['upload:u1', 'youtube:a1']);
  });

  it('forgets the local URLs of a removed download', async () => {
    await downloadPlaylist(PL, [YT]);

    await removeDownload('pl1');

    expect(useOfflineStore.getState().webFiles).toEqual({});
  });
});
