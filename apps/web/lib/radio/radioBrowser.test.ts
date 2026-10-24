// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createRadioBrowser, SERVER_LIST_TTL_MS } from './radioBrowser';

/** A fake Radio Browser: each host answers with `answers[host]`. */
function fakeApi(answers: Record<string, () => Response | Promise<Response>>) {
  const calls: { url: URL; ua: string | null }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, ua: new Headers(init?.headers).get('user-agent') });
    const answer = answers[url.hostname];
    if (!answer) throw new TypeError('fetch failed');
    return answer();
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const stations = [{ stationuuid: 'a', name: 'One' }];

describe('createRadioBrowser', () => {
  it('asks a discovered server, with the parameters given and a User-Agent naming the app', async () => {
    const api = fakeApi({ 'de1.api.radio-browser.info': () => Response.json(stations) });
    const rb = createRadioBrowser({ fetch: api.fetch, servers: async () => ['de1.api.radio-browser.info'], userAgent: 'Ember/9.9.9' });
    const list = await rb.search({ countrycode: 'HR', hidebroken: 'true' });
    expect(list).toEqual(stations);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].url.pathname).toBe('/json/stations/search');
    expect(api.calls[0].url.searchParams.get('countrycode')).toBe('HR');
    expect(api.calls[0].url.searchParams.get('hidebroken')).toBe('true');
    expect(api.calls[0].ua).toBe('Ember/9.9.9');
  });

  it('moves on to the next server when one fails', async () => {
    const api = fakeApi({
      'a.api.radio-browser.info': () => new Response('down', { status: 503 }),
      'b.api.radio-browser.info': () => Response.json(stations),
    });
    const rb = createRadioBrowser({ fetch: api.fetch, servers: async () => ['a.api.radio-browser.info', 'b.api.radio-browser.info'] });
    expect(await rb.byUuid(['x', 'y'])).toEqual(stations);
    const last = api.calls[api.calls.length - 1].url;
    expect(last.pathname).toBe('/json/stations/byuuid');
    expect(last.searchParams.get('uuids')).toBe('x,y');
  });

  it('fails with a 502 when no server answers, and looks the servers up again next time', async () => {
    const servers = vi.fn(async () => ['dead.api.radio-browser.info']);
    const api = fakeApi({});
    const rb = createRadioBrowser({ fetch: api.fetch, servers });
    await expect(rb.search({})).rejects.toMatchObject({ status: 502 });
    await expect(rb.search({})).rejects.toMatchObject({ status: 502 });
    expect(servers).toHaveBeenCalledTimes(2);
  });

  it('keeps the server list for an hour', async () => {
    let t = 0;
    const servers = vi.fn(async () => ['de1.api.radio-browser.info']);
    const api = fakeApi({ 'de1.api.radio-browser.info': () => Response.json([]) });
    const rb = createRadioBrowser({ fetch: api.fetch, servers, now: () => t });
    await rb.search({});
    t = SERVER_LIST_TTL_MS - 1;
    await rb.search({});
    expect(servers).toHaveBeenCalledTimes(1);
    t = SERVER_LIST_TTL_MS + 1;
    await rb.search({});
    expect(servers).toHaveBeenCalledTimes(2);
  });

  it('refuses an answer that is not a list', async () => {
    const api = fakeApi({ 'de1.api.radio-browser.info': () => Response.json({ error: 'nope' }) });
    const rb = createRadioBrowser({ fetch: api.fetch, servers: async () => ['de1.api.radio-browser.info'] });
    await expect(rb.search({})).rejects.toMatchObject({ status: 502 });
  });
});
