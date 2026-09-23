// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The prank library must never leak into a normal surface: search, the
// uploads library, recent searches, listening history, playlists. Those all
// read other collections and other directories; this test holds that line by
// reading the source. Only the admin prank routes and the gated media route
// may name the collection, the library's directory helpers, or the media URL.

const WEB = path.resolve(__dirname, '..', '..');
const POCKETBASE = path.resolve(WEB, '..', '..', 'pocketbase');
const SCAN = ['app', 'components', 'hooks', 'lib', 'stores', 'types', 'instrumentation.ts', 'proxy.ts'];

function walk(p: string, out: string[] = []): string[] {
  if (!fs.existsSync(p)) return out;
  if (fs.statSync(p).isFile()) {
    if (/\.(ts|tsx|js|mjs)$/.test(p) && !/\.test\.(ts|tsx)$/.test(p)) out.push(p);
    return out;
  }
  for (const entry of fs.readdirSync(p)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    walk(path.join(p, entry), out);
  }
  return out;
}

const sources = SCAN.flatMap((d) => walk(path.join(WEB, d)));
const rel = (f: string) => path.relative(WEB, f).split(path.sep).join('/');
const mentioning = (needle: RegExp) => sources.filter((f) => needle.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();

const ADMIN_PRANKS = /^app\/api\/admin\/pranks\//;
const MEDIA_ROUTE = /^app\/api\/pranks\/media\//;

describe('the prank library stays out of normal surfaces', () => {
  it('scans a real tree', () => {
    expect(sources.length).toBeGreaterThan(100);
    for (const surface of ['app/api/search', 'app/api/uploads', 'app/api/history', 'app/api/recent-searches', 'app/api/playlists']) {
      expect(fs.existsSync(path.join(WEB, surface)), surface).toBe(true);
    }
  });

  it('only the admin prank routes and the media route read prank_sounds', () => {
    const readers = mentioning(/prank_sounds/);
    expect(readers.length).toBeGreaterThan(0);
    for (const f of readers) expect(ADMIN_PRANKS.test(f) || MEDIA_ROUTE.test(f), f).toBe(true);
    expect(readers).toContain('app/api/pranks/media/[id]/route.ts');
  });

  it('only those routes (and the module itself) touch the library files', () => {
    const users = mentioning(/@\/lib\/pranks\/media|prankDir\(|resolvePrankPath\(/);
    for (const f of users) {
      expect(ADMIN_PRANKS.test(f) || MEDIA_ROUTE.test(f) || f === 'lib/pranks/media.ts', f).toBe(true);
    }
  });

  it('no normal surface names the prank media URL or the pranks directory', () => {
    const named = mentioning(/api\/pranks\/media|join\([^)]*['"`]pranks['"`]/);
    for (const f of named) {
      expect(ADMIN_PRANKS.test(f) || MEDIA_ROUTE.test(f) || f === 'lib/pranks/media.ts', f).toBe(true);
    }
  });

  it('no other PocketBase hook touches the library collection', () => {
    const hooks = fs.readdirSync(path.join(POCKETBASE, 'pb_hooks')).filter((f) => f.endsWith('.js'));
    const touching = hooks.filter((f) => fs.readFileSync(path.join(POCKETBASE, 'pb_hooks', f), 'utf8').includes('prank_sounds'));
    expect(touching).toEqual(['ensure_pranks.pb.js']);
  });

  it('the library directory is not inside the uploads directory', async () => {
    const prev = process.env.MUSIC_DIR;
    process.env.MUSIC_DIR = '/srv/music';
    try {
      const { prankDir } = await import('./media');
      const { UPLOAD_DIR } = await import('@/lib/uploads');
      expect(prankDir()).toBe('/srv/music/pranks');
      expect(prankDir().startsWith(`${UPLOAD_DIR}${path.sep}`)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MUSIC_DIR;
      else process.env.MUSIC_DIR = prev;
    }
  });
});
