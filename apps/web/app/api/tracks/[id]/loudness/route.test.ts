// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// The gain lookup: a stored gain comes back (cacheable), a missing one comes
// back null and starts a background measurement, and anything that is not a
// YouTube track never touches the disk or ffmpeg.

const readTrackGain = vi.fn<(id: string) => number | null>();
const measureLoudness = vi.fn<(id: string) => Promise<number | null>>(async () => null);

vi.mock('@/lib/sources/youtube', () => ({
  readTrackGain: (id: string) => readTrackGain(id),
  measureLoudness: (id: string) => measureLoudness(id),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { GET } = await import('./route');

const call = (id: string) =>
  GET({} as NextRequest, { params: Promise.resolve({ id }) } as never) as Promise<Response>;

beforeEach(() => {
  readTrackGain.mockReset();
  measureLoudness.mockClear();
});

describe('GET /api/tracks/[id]/loudness', () => {
  it('returns a measured gain, cacheable, without measuring again', async () => {
    readTrackGain.mockReturnValue(-6.5);
    const res = await call('youtube:abcdefghijk');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gainDb: -6.5 });
    expect(res.headers.get('Cache-Control')).toContain('max-age');
    expect(readTrackGain).toHaveBeenCalledWith('abcdefghijk');
    expect(measureLoudness).not.toHaveBeenCalled();
  });

  it('a zero gain is a real answer, not a missing one', async () => {
    readTrackGain.mockReturnValue(0);
    const res = await call('youtube:abcdefghijk');
    expect(await res.json()).toEqual({ gainDb: 0 });
    expect(measureLoudness).not.toHaveBeenCalled();
  });

  it('unmeasured: null, not cached, and a background measurement starts', async () => {
    readTrackGain.mockReturnValue(null);
    const res = await call('youtube:abcdefghijk');
    expect(await res.json()).toEqual({ gainDb: null });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(measureLoudness).toHaveBeenCalledWith('abcdefghijk');
  });

  it('uploads and malformed ids are null and touch nothing', async () => {
    for (const id of ['upload:abc', 'youtube:short', 'youtube:../../etc/pw', 'abcdefghijk']) {
      const res = await call(id);
      expect(await res.json()).toEqual({ gainDb: null });
    }
    expect(readTrackGain).not.toHaveBeenCalled();
    expect(measureLoudness).not.toHaveBeenCalled();
  });
});
