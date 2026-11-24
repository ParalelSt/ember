import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './api';
import { logger } from '@/lib/logger/client';
import type { Track } from '@/types/track';

// discord-2026-10-04 item 6: a brief connection drop failed several calls at
// once and each one sent its own automatic report. GETs and the background
// writes now retry a network failure (no HTTP answer) quietly first.

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const ok = (body: unknown = { playlists: [] }) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => body,
});

const networkError = () => new TypeError('Failed to fetch');

const track = { id: 't1', title: 'Song', artist: 'Artist', source: 'youtube' } as unknown as Track;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(logger.error).mockClear();
  vi.mocked(logger.warn).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('req(): GETs retry a network failure', () => {
  it('succeeds on the second try without logging an error', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    const p = api.listPlaylists();
    await vi.advanceTimersByTimeAsync(300);

    await expect(p).resolves.toEqual({ playlists: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('gives up after two retries (300 ms, then 1 s) and logs one network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(networkError());
    vi.stubGlobal('fetch', fetchMock);

    const p = api.listPlaylists();
    const settled = expect(p).rejects.toThrow('Failed to fetch');
    await vi.advanceTimersByTimeAsync(299);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    await settled;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'api',
      'GET /playlists network error',
      expect.objectContaining({ method: 'GET', path: '/playlists', network: true }),
      expect.any(TypeError),
    );
  });

  it('does not retry an HTTP 500', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      json: async () => ({ error: 'boom' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.listPlaylists()).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry an abort, and does not mark it as a network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.listPlaylists()).rejects.toThrow('aborted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'api',
      'GET /playlists network error',
      expect.objectContaining({ method: 'GET', path: '/playlists', network: false }),
      expect.anything(),
    );
  });

  it('does not retry an ordinary POST (it could apply twice)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(networkError());
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.createPlaylist('Mix')).rejects.toThrow('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('req(): background writes retry quietly', () => {
  it('the history record succeeds on a retry without logging an error', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue(ok({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const p = api.recordPlay(track);
    await vi.advanceTimersByTimeAsync(300);

    await expect(p).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a Discord presence update that keeps failing ends as a warning, never an error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(networkError());
    vi.stubGlobal('fetch', fetchMock);

    const p = api.updateDiscord(track, true, 1, 200);
    const settled = expect(p).rejects.toThrow('Failed to fetch');
    await vi.advanceTimersByTimeAsync(1300);
    await settled;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenLastCalledWith(
      'api',
      'POST /discord/update network error',
      expect.objectContaining({ method: 'POST', path: '/discord/update', network: true }),
    );
  });
});

// Reports 2026-11-03/13/21 ("api: network errors for over 30s"): every entry
// read only { method, path, network }, so a report could not tell a gateway
// answering for a stopped Ember (the Funnel's 502 during an update) from a
// fetch that never got through (DNS, TLS, a dead socket) or one that hung.
// Each network entry now says what came back and how long it took.
describe('req(): a network entry says what failed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const gateway502 = () => ({
    ok: false,
    status: 502,
    headers: new Headers(),
    json: async () => {
      throw new SyntaxError('Unexpected token <');
    },
  });

  it('a gateway answer (502, not JSON) is logged with its status and the time it took', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const fetchMock = vi.fn().mockImplementation(async () => {
      now += 120;
      return gateway502();
    });
    vi.stubGlobal('fetch', fetchMock);

    const p = api.listPlaylists();
    const settled = expect(p).rejects.toThrow("Can't reach Ember");
    await vi.advanceTimersByTimeAsync(1300);
    await settled;

    expect(logger.warn).toHaveBeenCalledWith(
      'api',
      'GET /playlists network error, retrying',
      expect.objectContaining({ attempt: 1, answered: 502, ms: 120 }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'api',
      'GET /playlists network error',
      expect.objectContaining({ method: 'GET', path: '/playlists', network: true, answered: 502, ms: 120 }),
      expect.any(Error),
    );
  });

  it('a fetch that never got an answer is logged with the browser error and the time it took', async () => {
    let now = 5_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const fetchMock = vi.fn().mockImplementation(async () => {
      now += 30_000;
      throw networkError();
    });
    vi.stubGlobal('fetch', fetchMock);

    const p = api.listPlaylists();
    const settled = expect(p).rejects.toThrow('Failed to fetch');
    await vi.advanceTimersByTimeAsync(1300);
    await settled;

    const data = vi.mocked(logger.error).mock.calls[0][2] as Record<string, unknown>;
    expect(data).toMatchObject({ network: true, error: 'TypeError: Failed to fetch', ms: 30_000 });
    expect(data).not.toHaveProperty('answered');
  });
});
