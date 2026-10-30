import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import { connectionOk } from '@/lib/connectionBlip';
import { PROBE_MS, PROBE_PATH, checkServerNow, resetServerReach, serverUnreachable, waitingForServer } from './serverReach';

/** A browser that says online while nothing gets through: the player goes
 *  offline until the server answers again, to an api call or to its own
 *  small request every PROBE_MS. */
describe('serverReach', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    useAutoCacheStore.setState({ online: true });
    resetServerReach();
  });

  afterEach(() => {
    resetServerReach();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('checkServerNow', () => {
    it('two answers now end the watch and put the player online, without waiting for the next probe', async () => {
      fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));
      serverUnreachable();
      await expect(checkServerNow()).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(useAutoCacheStore.getState().online).toBe(true);
      expect(waitingForServer()).toBe(false);
      await vi.advanceTimersByTimeAsync(10 * PROBE_MS);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('also clears an offline the browser reported, when the server does answer', async () => {
      fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));
      useAutoCacheStore.setState({ online: false });
      await expect(checkServerNow()).resolves.toBe(true);
      expect(useAutoCacheStore.getState().online).toBe(true);
    });

    it('no answer leaves the player offline and the watch running', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      serverUnreachable();
      await expect(checkServerNow()).resolves.toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(useAutoCacheStore.getState().online).toBe(false);
      expect(waitingForServer()).toBe(true);
    });

    it('one answer that does not hold, or a sign-in page, is not back online', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })).mockRejectedValueOnce(new TypeError('Failed to fetch'));
      useAutoCacheStore.setState({ online: false });
      await expect(checkServerNow()).resolves.toBe(false);
      fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
      await expect(checkServerNow()).resolves.toBe(false);
      expect(useAutoCacheStore.getState().online).toBe(false);
    });
  });

  it('puts the player offline', () => {
    serverUnreachable();
    expect(useAutoCacheStore.getState().online).toBe(false);
    expect(waitingForServer()).toBe(true);
  });

  it('any api answer puts it back online', () => {
    serverUnreachable();
    connectionOk();
    expect(useAutoCacheStore.getState().online).toBe(true);
    expect(waitingForServer()).toBe(false);
  });

  it('asks the server every PROBE_MS until it answers', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Response(null, { status: 404 }));
    serverUnreachable();
    await vi.advanceTimersByTimeAsync(PROBE_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(PROBE_PATH);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'HEAD', cache: 'no-store' });
    expect(useAutoCacheStore.getState().online).toBe(false);
    // Any answer counts, a 404 too, once it holds for a second probe.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAutoCacheStore.getState().online).toBe(false);
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(useAutoCacheStore.getState().online).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * PROBE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('a second call while waiting starts no second watch', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    serverUnreachable();
    serverUnreachable();
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops asking once an api call got an answer', async () => {
    serverUnreachable();
    connectionOk();
    await vi.advanceTimersByTimeAsync(5 * PROBE_MS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a probe that never answers is given up on, and the next one still goes', async () => {
    // A dead pooled connection (a phone that changed networks) can leave a
    // request waiting for minutes: the watch must not wait with it.
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })).mockResolvedValue(new Response(null, { status: 200 }));
    serverUnreachable();
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * PROBE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(useAutoCacheStore.getState().online).toBe(true);
  });

  it('a gateway answering for a server that is down is not the server back', async () => {
    // The Tailscale Funnel answers 502 while Next restarts.
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 504 }))
      .mockResolvedValue(new Response(null, { status: 200 }));
    serverUnreachable();
    await vi.advanceTimersByTimeAsync(2 * PROBE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAutoCacheStore.getState().online).toBe(false);
    await vi.advanceTimersByTimeAsync(2 * PROBE_MS);
    expect(useAutoCacheStore.getState().online).toBe(true);
  });

  it('a Wi-Fi sign-in page answering for the probe is not the server back, however often it answers', async () => {
    // The page Ember asks for is an image; a captive portal answers every
    // request with its own HTML (often after a redirect). Taken as the
    // server, the player went online, the next song failed on the same page
    // and it went offline again, every PROBE_MS.
    fetchMock.mockImplementation(async () => {
      const page = new Response('<html>Sign in to the Wi-Fi</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      Object.defineProperty(page, 'redirected', { value: true });
      return page;
    });
    serverUnreachable();
    await vi.advanceTimersByTimeAsync(6 * PROBE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(useAutoCacheStore.getState().online).toBe(false);
    expect(waitingForServer()).toBe(true);
  });

  it('one odd answer between failures does not flip the player online: it takes two in a row', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    serverUnreachable();
    await vi.advanceTimersByTimeAsync(4 * PROBE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(useAutoCacheStore.getState().online).toBe(false);
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(useAutoCacheStore.getState().online).toBe(true);
  });
});
