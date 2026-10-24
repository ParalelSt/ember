import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './api';
import { logger } from '@/lib/logger/client';
import { NO_ANSWER_MESSAGE, connectionOk } from '@/lib/connectionBlip';

// Something answers, but not Ember: the Tailscale Funnel's 502 while Next
// restarts, a Wi-Fi sign-in page answering 200 with its own HTML, a body
// cut off by a dropped connection. None of it is the server answering.

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/connectionBlip', async (orig) => ({
  ...(await orig<typeof import('@/lib/connectionBlip')>()),
  connectionOk: vi.fn(),
}));

const html = (status: number) => new Response('<!DOCTYPE html><html><body>Sign in to the Wi-Fi</body></html>', {
  status,
  headers: { 'content-type': 'text/html' },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(logger.error).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(connectionOk).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('req(): an answer that is not from Ember', () => {
  it('a gateway 502 with no JSON is retried like a network failure, and the GET gets the answer after', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValue(json({ playlists: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const p = api.listPlaylists();
    await vi.advanceTimersByTimeAsync(300);

    await expect(p).resolves.toEqual({ playlists: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a gateway that keeps answering is a network failure: no status, one network error, never the connection back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('Bad Gateway', { status: 502 })));

    const p = api.listPlaylists();
    const settled = expect(p).rejects.toThrow(NO_ANSWER_MESSAGE);
    await vi.advanceTimersByTimeAsync(1300);
    await settled;
    const err = await p.catch((e: unknown) => e as { status?: number });

    expect(err.status).toBeUndefined();
    expect(connectionOk).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.error).mock.calls[0][2]).toMatchObject({ method: 'GET', path: '/playlists', network: true });
  });

  it("Ember's own 502 (JSON) is still its answer: not retried, status kept", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: 'YouTube said no' }, 502));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.listPlaylists()).rejects.toMatchObject({ status: 502, message: 'YouTube said no' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(connectionOk).toHaveBeenCalled();
  });

  it('a Wi-Fi sign-in page answering 200 says the server cannot be reached, not a JSON parse error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => html(200)));

    const p = api.renamePlaylist('p1', 'New name');
    await expect(p).rejects.toThrow(NO_ANSWER_MESSAGE);
    expect(connectionOk).not.toHaveBeenCalled();
    expect(vi.mocked(logger.error).mock.calls[0][2]).toMatchObject({ method: 'PATCH', network: true });
  });

  it('a POST that met a gateway is not sent again (it may have applied)', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(null, { status: 504 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.createPlaylist('Mix')).rejects.toThrow(NO_ANSWER_MESSAGE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a body cut off mid-read on a GET is retried', async () => {
    const cut = { ok: true, status: 200, headers: new Headers(), json: () => Promise.reject(new TypeError('network error')) };
    const fetchMock = vi.fn().mockResolvedValueOnce(cut).mockResolvedValue(json({ playlists: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const p = api.listPlaylists();
    await vi.advanceTimersByTimeAsync(300);
    await expect(p).resolves.toEqual({ playlists: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('an error status with an HTML body that is not a gateway one keeps its status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => html(404)));

    await expect(api.listPlaylists()).rejects.toMatchObject({ status: 404 });
    expect(connectionOk).toHaveBeenCalled();
  });

  it('an error status whose JSON body is null keeps its status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json(null, 500)));

    await expect(api.listPlaylists()).rejects.toMatchObject({ status: 500 });
  });
});
