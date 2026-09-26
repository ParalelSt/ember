// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The public desktop asset proxy (security audit 2026-09-25, M3). On main it
// forwarded ANY positive id to GitHub's release-asset endpoint with the
// host's token, so anyone could pull any asset of the private repo: older
// releases, drafts, the hand-download installers. Now only the latest
// published release's updater files are served, and anything else is a 404
// before GitHub is asked.

vi.stubEnv('GITHUB_RELEASES_TOKEN', 'test-token');
vi.stubEnv('GITHUB_API_BASE', 'http://github.test');
vi.stubEnv('GITHUB_RELEASES_REPO', 'owner/ember');
vi.stubEnv('UPDATE_CACHE_MS', '0');
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const releases = [
  { tag_name: 'v0.5.0', draft: true, prerelease: false, assets: [{ id: 501, name: 'Ember-v0.5.0-windows-x64-setup.exe', size: 1 }] },
  {
    tag_name: 'v0.4.0', draft: false, prerelease: false,
    assets: [
      { id: 401, name: 'Ember-v0.4.0-macos-arm64.app.tar.gz', size: 1 },
      { id: 402, name: 'Ember-v0.4.0-macos-arm64.app.tar.gz.sig', size: 1 },
      { id: 403, name: 'Ember-v0.4.0-windows-x64-setup.exe', size: 1 },
      { id: 404, name: 'Ember-v0.4.0-linux-x86_64.AppImage', size: 1 },
      { id: 405, name: 'latest.json', size: 1 },
      { id: 406, name: 'Ember-v0.4.0-macos-arm64.dmg', size: 1 },
      { id: 407, name: 'Ember-v0.4.0-android.apk', size: 1 },
      { id: 408, name: 'notes-internal.txt', size: 1 },
    ],
  },
  { tag_name: 'v0.3.0', draft: false, prerelease: false, assets: [{ id: 301, name: 'Ember-v0.3.0-windows-x64-setup.exe', size: 1 }] },
];

const assetFetches: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('/releases?')) return Response.json(releases);
  const m = /\/releases\/assets\/(\d+)$/.exec(url);
  if (m) {
    assetFetches.push(m[1]);
    return new Response(`BYTES-${m[1]}`, { headers: { 'content-type': 'application/octet-stream' } });
  }
  return new Response('unexpected', { status: 404 });
}) as typeof fetch;
afterAll(() => { globalThis.fetch = realFetch; });

const { GET } = await import('./route');
const { isUpdaterAssetName } = await import('@/lib/desktopUpdate');

let seq = 0;
function get(id: string) {
  seq += 1;
  const req = new Request(`http://localhost/api/desktop/asset/${id}`, { headers: { 'x-forwarded-for': `10.2.0.${seq}` } });
  return GET(req as never, { params: Promise.resolve({ id }) } as never);
}

beforeEach(() => { assetFetches.length = 0; });

describe('GET /api/desktop/asset/[id]', () => {
  it.each(['401', '402', '403', '404', '405'])('serves the latest release updater file %s', async (id) => {
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`BYTES-${id}`);
    expect(assetFetches).toEqual([id]);
  });

  it.each([
    ['a hand-download installer of the latest release', '406'],
    ['the latest release apk', '407'],
    ['another file of the latest release', '408'],
    ['an older release', '301'],
    ['a draft release', '501'],
    ['an id from nowhere', '999999'],
  ])('refuses %s without asking GitHub', async (_name, id) => {
    const res = await get(id);
    expect(res.status).toBe(404);
    expect(assetFetches).toEqual([]);
  });

  it('still rejects a malformed id with 400', async () => {
    expect((await get('abc')).status).toBe(400);
    expect((await get('-1')).status).toBe(400);
  });
});

describe('isUpdaterAssetName', () => {
  it('knows the updater files and nothing else', () => {
    for (const n of ['Ember-v1.0.0-macos-arm64.app.tar.gz', 'Ember-v1.0.0-macos-arm64.app.tar.gz.sig', 'Ember-v1.0.0-windows-x64-setup.exe',
      'Ember-v1.0.0-windows-arm64-setup.exe.sig', 'Ember-v1.0.0-linux-x86_64.AppImage', 'latest.json']) expect(isUpdaterAssetName(n)).toBe(true);
    for (const n of ['Ember-v1.0.0-macos-arm64.dmg', 'Ember-v1.0.0-windows-x64.msi', 'Ember-v1.0.0-linux-amd64.deb', 'Ember-v1.0.0-android.apk',
      'secrets.env', 'latest.json.bak', 'x.app.tar.gz.zip']) expect(isUpdaterAssetName(n)).toBe(false);
  });
});
