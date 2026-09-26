/** App Transport Security for the iPhone app (apps/mobile/ios/App/scripts/
 *  configure-ats.sh): plain http only to the Ember server itself, and only
 *  when its URL is http://. The iOS twin of Android's NetworkSecurityTest.
 *
 *      node tests/ios-ats.test.mjs      # or: npm run test:ios-ats
 *
 *  macOS only (the script uses plutil and PlistBuddy, which is also all an
 *  Xcode build has). Runs the real script against a throwaway Info.plist and
 *  capacitor.config.json per case, then reads the result back. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.log('SKIP  ios-ats: needs macOS (plutil, PlistBuddy)');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(root, 'apps/mobile/ios/App/scripts/configure-ats.sh');

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const BASE_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleName</key><string>App</string></dict></plist>`;

/** Runs the script for one server URL (undefined: no config file at all)
 *  and returns the resulting NSAppTransportSecurity dict, or null. */
function atsFor(url, { startPlist = BASE_PLIST } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ember-ats-'));
  try {
    const plist = join(dir, 'Info.plist');
    const config = join(dir, 'capacitor.config.json');
    writeFileSync(plist, startPlist);
    if (url !== undefined) writeFileSync(config, JSON.stringify({ appId: 'app.ember.music', server: { url } }));
    execFileSync('/bin/sh', [SCRIPT, config, plist], { stdio: 'pipe' });
    const json = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plist]).toString());
    return json.NSAppTransportSecurity ?? null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const exceptionOnly = (host) => ({
  NSExceptionDomains: { [host]: { NSExceptionAllowsInsecureHTTPLoads: true, NSIncludesSubdomains: false } },
});
const LOCAL = { NSAllowsLocalNetworking: true };

// https: ATS fully on, not even an empty dict.
check('https server: no ATS exception at all', atsFor('https://ember.example.ts.net') === null);
check('https server with a port and path: no exception', atsFor('https://ember.example.ts.net:8443/app') === null);

// http to a name: that host alone, subdomains excluded.
let got = atsFor('http://ember.example.com:3000');
check('http name: exception for that host only', same(got, exceptionOnly('ember.example.com')), JSON.stringify(got));
got = atsFor('HTTP://Ember.Example.COM/');
check('scheme and host are case-insensitive', same(got, exceptionOnly('ember.example.com')), JSON.stringify(got));
got = atsFor('http://user:pw@music.example.org:80/x?y#z');
check('userinfo, path, query and fragment are ignored', same(got, exceptionOnly('music.example.org')), JSON.stringify(got));

// http to an IP / local name: ATS takes no per-host exception for these.
got = atsFor('http://192.168.1.20:3000');
check('http LAN IP: local networking only', same(got, LOCAL), JSON.stringify(got));
got = atsFor('http://100.101.102.103:3000');
check('http Tailscale IP: local networking only', same(got, LOCAL), JSON.stringify(got));
got = atsFor('http://localhost:3190');
check('http localhost (simulator): local networking only', same(got, LOCAL), JSON.stringify(got));
got = atsFor('http://mac-mini.local:3000');
check('http .local name: local networking only', same(got, LOCAL), JSON.stringify(got));
got = atsFor('http://[fd7a:115c:a1e0::1]:3000');
check('http IPv6 literal: local networking only', same(got, LOCAL), JSON.stringify(got));

// Same fallback as capacitor.config.ts when nothing was synced.
got = atsFor(undefined);
check('no capacitor.config.json: falls back to http://localhost:3000', same(got, LOCAL), JSON.stringify(got));

// Rebuilding for another server must not keep the old exception.
const stale = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/></dict></dict></plist>`;
check('an earlier exception is removed for an https server', atsFor('https://ember.example.ts.net', { startPlist: stale }) === null);
got = atsFor('http://ember.example.com', { startPlist: stale });
check('an earlier exception is replaced, never merged', same(got, exceptionOnly('ember.example.com')), JSON.stringify(got));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
