// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Tauri's own update feed. Since the launch gate the app says how it was
// installed (?bundle={{bundle_type}}), and an .msi, .deb or .rpm install is
// handed its own kind of package. Apps that do not say get what they always
// got. EMBER_UPDATES_PAUSED turns it into 204.

vi.stubEnv('GITHUB_RELEASES_TOKEN', 'test-token');
vi.stubEnv('GITHUB_API_BASE', 'http://github.test');
vi.stubEnv('GITHUB_RELEASES_REPO', 'owner/ember');
vi.stubEnv('UPDATE_CACHE_MS', '0');
vi.stubEnv('PUBLIC_ORIGIN', 'https://ember.test');
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const NAMES = [
  'Ember-v0.4.22-windows-x64-setup.exe',
  'Ember-v0.4.22-windows-x64.msi',
  'Ember-v0.4.22-linux-x86_64.AppImage',
  'Ember-v0.4.22-linux-amd64.deb',
  'Ember-v0.4.22-linux-x86_64.rpm',
  'Ember-v0.4.22-macos-arm64.app.tar.gz',
];
const ASSETS = NAMES.flatMap((name, i) => [
  { id: 10 + i * 2, name, size: 100 },
  { id: 11 + i * 2, name: `${name}.sig`, size: 10 },
]);

const realFetch = globalThis.fetch;
globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('/releases?')) {
    return Response.json([{ tag_name: 'v0.4.22', draft: false, prerelease: false, body: 'Notes', assets: ASSETS }]);
  }
  const m = /\/releases\/assets\/(\d+)$/.exec(url);
  if (m) return new Response(`sig-of-${m[1]}`);
  return new Response('unexpected', { status: 404 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { GET } = await import('./route');

async function feed(target: string, arch: string, current: string, query = '') {
  const res = await GET(
    new Request(`http://localhost/api/desktop/update/${target}/${arch}/${current}${query}`) as never,
    { params: Promise.resolve({ target, arch, current }) } as never,
  );
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

const idOf = (name: string) => ASSETS.find((a) => a.name === name)!.id;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('PUBLIC_ORIGIN', 'https://ember.test');
});

describe('GET /api/desktop/update with ?bundle', () => {
  it('serves what it always did when the app does not say how it was installed', async () => {
    expect((await feed('windows', 'x86_64', '0.4.21')).body.url).toBe(`https://ember.test/api/desktop/asset/${idOf(NAMES[0])}`);
    expect((await feed('linux', 'x86_64', '0.4.21')).body.url).toBe(`https://ember.test/api/desktop/asset/${idOf(NAMES[2])}`);
  });

  it('an .msi install updates from the .msi, with its signature', async () => {
    const { body } = await feed('windows', 'x86_64', '0.4.21', '?bundle=msi');
    expect(body.url).toBe(`https://ember.test/api/desktop/asset/${idOf(NAMES[1])}`);
    expect(body.signature).toBe(`sig-of-${idOf(NAMES[1]) + 1}`);
  });

  it('a .deb install updates from the .deb, an .rpm one from the .rpm', async () => {
    expect((await feed('linux', 'x86_64', '0.4.21', '?bundle=deb')).body.url).toContain(`/asset/${idOf(NAMES[3])}`);
    expect((await feed('linux', 'x86_64', '0.4.21', '?bundle=rpm')).body.url).toContain(`/asset/${idOf(NAMES[4])}`);
    expect((await feed('linux', 'x86_64', '0.4.21', '?bundle=appimage')).body.url).toContain(`/asset/${idOf(NAMES[2])}`);
  });

  it('an unknown bundle name falls back to the default file', async () => {
    expect((await feed('windows', 'x86_64', '0.4.21', '?bundle=unknown')).body.url).toContain(`/asset/${idOf(NAMES[0])}`);
  });

  it('answers 204 for a platform the host paused, and only that one', async () => {
    vi.stubEnv('EMBER_UPDATES_PAUSED', 'linux');
    expect((await feed('linux', 'x86_64', '0.4.21', '?bundle=deb')).status).toBe(204);
    expect((await feed('darwin', 'aarch64', '0.4.21')).status).toBe(200);
  });

  it('answers 204 when up to date', async () => {
    expect((await feed('darwin', 'aarch64', '0.4.22')).status).toBe(204);
  });
});
