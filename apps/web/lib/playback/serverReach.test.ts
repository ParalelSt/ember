import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import { connectionOk } from '@/lib/connectionBlip';
import { PROBE_MS, PROBE_PATH, resetServerReach, serverUnreachable, waitingForServer } from './serverReach';

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
    // Any answer counts, a 404 too.
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAutoCacheStore.getState().online).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * PROBE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
});
