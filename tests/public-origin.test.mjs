/** The origin the desktop updater is told to download from.
 *
 *      node tests/public-origin.test.mjs   # or: npm run test:origin
 *
 *  Found in production: the update feed built its download URL from the
 *  request's own origin, which behind the Tailscale funnel is the INTERNAL
 *  http://localhost:30200. Installed apps were handed
 *  "https://localhost:30200/api/desktop/asset/..." and would have tried to
 *  download from localhost on the listener's own machine. The update check
 *  said "yes, 0.2.3 is available" and the download could only fail. */
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('../apps/web/lib/publicOrigin.ts', import.meta.url), 'utf8');
const js = src
  .replace("import 'server-only';", '')
  .replace(/export function publicOrigin\(request: Request\): string/, 'function publicOrigin(request)')
  .replace(/export function isLoopback\(origin: string\): boolean/, 'function isLoopback(origin)')
  .replace(/^\s*\/\*\*[\s\S]*?\*\/\s*$/gm, '')
  .replace(/const \{ hostname \} = new URL\(origin\);/, 'const { hostname } = new URL(origin);');
const mod = await import(`data:text/javascript,${encodeURIComponent(`${js}\nexport { publicOrigin, isLoopback };`)}`);
const { publicOrigin, isLoopback } = mod;

const req = (url, headers = {}) => ({ url, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });

const out = [];
const check = (name, fn) => {
  try { fn(); out.push([name, true]); console.log(`PASS  ${name}`); }
  catch (e) { out.push([name, false]); console.log(`FAIL  ${name}  — ${e.message}`); }
};

check('the reported bug: a funnel’s internal origin is not used', () => {
  const got = publicOrigin(req('https://localhost:30200/api/desktop/update/darwin/aarch64/0.2.2', {
    'x-forwarded-host': 'ember.tailf4de41.ts.net',
    'x-forwarded-proto': 'https',
  }));
  assert.equal(got, 'https://ember.tailf4de41.ts.net', `got ${got}`);
});

check('PUBLIC_ORIGIN wins over everything, and loses a trailing slash', () => {
  process.env.PUBLIC_ORIGIN = 'https://ember.example.ts.net/';
  assert.equal(publicOrigin(req('http://localhost:3000/x', { 'x-forwarded-host': 'wrong.example' })),
    'https://ember.example.ts.net');
  delete process.env.PUBLIC_ORIGIN;
});

check('a proxy chain uses the first hop, the one the client asked for', () => {
  assert.equal(
    publicOrigin(req('http://localhost:3000/x', {
      'x-forwarded-host': 'ember.ts.net, inner.local',
      'x-forwarded-proto': 'https, http',
    })),
    'https://ember.ts.net',
  );
});

check('no proxy in front: the request’s own origin is right', () => {
  assert.equal(publicOrigin(req('http://192.168.1.5:3000/api/x')), 'http://192.168.1.5:3000');
});

check('a forwarded host with no proto is assumed https', () => {
  assert.equal(publicOrigin(req('http://localhost:3000/x', { 'x-forwarded-host': 'ember.ts.net' })),
    'https://ember.ts.net');
});

check('loopback origins are recognised so they can be flagged', () => {
  for (const bad of ['https://localhost:30200', 'http://127.0.0.1:3000', 'http://[::1]:80', 'http://0.0.0.0:3000']) {
    assert.equal(isLoopback(bad), true, `${bad} should be loopback`);
  }
  for (const good of ['https://ember.tailf4de41.ts.net', 'http://192.168.1.5:3000']) {
    assert.equal(isLoopback(good), false, `${good} should NOT be loopback`);
  }
});

const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
