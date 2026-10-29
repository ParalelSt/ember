// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { createNowPlaying, decodeMetadata, MAX_METAINT, NOW_TTL_MS, parseStreamTitle, readFirstMetadata } from './nowPlaying';
import type { openUpstream } from './streamProxy';

/** A metadata block as a station sends it: one length byte (times 16),
 *  then the text, padded with zeros. */
function block(text: string, encoding: BufferEncoding = 'utf8'): Buffer {
  const body = Buffer.from(text, encoding);
  const n = Math.ceil(body.length / 16);
  const out = Buffer.alloc(1 + n * 16);
  out[0] = n;
  body.copy(out, 1);
  return out;
}

async function* chunks(...parts: Buffer[]) {
  for (const p of parts) yield p;
}

describe('parseStreamTitle', () => {
  it('splits "Artist - Title"', () => {
    expect(parseStreamTitle("StreamTitle='Dino Merlin - Godinama';StreamUrl='';")).toEqual({ artist: 'Dino Merlin', title: 'Godinama' });
  });

  it('keeps an apostrophe inside a name, and only the first " - " splits', () => {
    expect(parseStreamTitle("StreamTitle='Guns N' Roses - Don't Cry - Live';")).toEqual({ artist: "Guns N' Roses", title: "Don't Cry - Live" });
  });

  it('takes a line with no artist part as the title', () => {
    expect(parseStreamTitle("StreamTitle='Jutarnji program';")).toEqual({ artist: null, title: 'Jutarnji program' });
    expect(parseStreamTitle("StreamTitle=' - Godinama';")).toEqual({ artist: null, title: '- Godinama' });
  });

  it('names no song for an empty title or none at all', () => {
    expect(parseStreamTitle("StreamTitle='';")).toBeNull();
    expect(parseStreamTitle("StreamTitle=' - ';")).toBeNull();
    expect(parseStreamTitle("StreamUrl='x';")).toBeNull();
    expect(parseStreamTitle('')).toBeNull();
  });

  it('tidies spaces and zero padding, and caps the length', () => {
    expect(parseStreamTitle("StreamTitle='  Oliver   Dragojević -  Cesarica ';\0\0\0")).toEqual({ artist: 'Oliver Dragojević', title: 'Cesarica' });
    expect(parseStreamTitle(`StreamTitle='${'a'.repeat(500)}';`)!.title).toHaveLength(200);
  });
});

describe('decodeMetadata', () => {
  it('reads UTF-8, and Latin-1 where the bytes are not UTF-8', () => {
    expect(decodeMetadata(Buffer.from('Đorđe Balašević', 'utf8'))).toBe('Đorđe Balašević');
    expect(decodeMetadata(Buffer.from('Café', 'latin1'))).toBe('Café');
  });
});

describe('readFirstMetadata', () => {
  it('skips the audio and reads the block, across chunk edges', async () => {
    const meta = block("StreamTitle='A - B';");
    const stream = Buffer.concat([Buffer.alloc(10, 7), meta, Buffer.alloc(10, 7)]);
    const parts = [stream.subarray(0, 4), stream.subarray(4, 11), stream.subarray(11, 14), stream.subarray(14)];
    const got = await readFirstMetadata(chunks(...parts), 10);
    expect(decodeMetadata(got!)).toMatch(/^StreamTitle='A - B';\0*$/);
  });

  it('gives null for an empty block or a stream that ends first', async () => {
    expect(await readFirstMetadata(chunks(Buffer.alloc(4), Buffer.from([0]), Buffer.alloc(4)), 4)).toBeNull();
    expect(await readFirstMetadata(chunks(Buffer.alloc(3)), 4)).toBeNull();
    expect(await readFirstMetadata(chunks(Buffer.alloc(4), Buffer.from([2]), Buffer.alloc(5)), 4)).toBeNull();
  });
});

describe('createNowPlaying', () => {
  type Open = typeof openUpstream;
  const URL = 'http://stream.example/live';

  /** A station stream: `metaint` bytes of audio, then the block, then audio
   *  that never ends (as a live stream does). */
  function station(title: string | null, metaint: number | string | null = 16, status = 200) {
    const closed = { value: false };
    const open = vi.fn<Open>(async (_url, opts) => {
      const body = new PassThrough();
      body.write(Buffer.alloc(typeof metaint === 'number' ? metaint : 16, 1));
      if (title !== null) body.write(block(`StreamTitle='${title}';`));
      body.write(Buffer.alloc(64, 1));
      const headers = metaint === null ? {} : { 'icy-metaint': String(metaint) };
      opts.signal?.addEventListener('abort', () => body.destroy(new Error('aborted')));
      return { status, headers, body: body as never, close: () => { closed.value = true; body.destroy(); } };
    });
    return { open, closed };
  }

  it('asks the stream for metadata, reads the first title, then lets the stream go', async () => {
    const s = station('Severina - Italiana');
    const np = createNowPlaying({ open: s.open });
    expect(await np.song('a', URL)).toEqual({ artist: 'Severina', title: 'Italiana' });
    expect(s.open).toHaveBeenCalledWith(URL, expect.objectContaining({ icyMetadata: true }));
    expect(s.closed.value).toBe(true);
  });

  it('asks a station once per window, however many listeners poll it', async () => {
    let t = 0;
    const s = station('A - B');
    const np = createNowPlaying({ open: s.open, now: () => t });
    await Promise.all([np.song('a', URL), np.song('a', URL)]);
    await np.song('a', URL);
    expect(s.open).toHaveBeenCalledTimes(1);
    t = NOW_TTL_MS + 1;
    await np.song('a', URL);
    expect(s.open).toHaveBeenCalledTimes(2);
  });

  it('names no song for a station that sends no titles, too many bytes first, or a refusal', async () => {
    expect(await createNowPlaying({ open: station('A - B', null).open }).song('a', URL)).toBeNull();
    expect(await createNowPlaying({ open: station('A - B', String(MAX_METAINT + 1)).open }).song('a', URL)).toBeNull();
    expect(await createNowPlaying({ open: station('A - B', 'x').open }).song('a', URL)).toBeNull();
    expect(await createNowPlaying({ open: station('A - B', 16, 404).open }).song('a', URL)).toBeNull();
    const down = vi.fn<Open>(async () => { throw new Error('ECONNREFUSED'); });
    expect(await createNowPlaying({ open: down }).song('a', URL)).toBeNull();
  });

  it('gives up on a station that sends no title in time', async () => {
    const s = station(null);
    const started = Date.now();
    expect(await createNowPlaying({ open: s.open, timeoutMs: 50 }).song('a', URL)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(s.closed.value).toBe(true);
  });
});
