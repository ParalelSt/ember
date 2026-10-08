import { describe, expect, it } from 'vitest';
import { approvePath, parseScanned } from './parseScanned';

const ORIGIN = 'https://ember.example.com';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';

describe('parseScanned', () => {
  it('accepts this server\'s approve link', () => {
    expect(parseScanned(`${ORIGIN}/link/${TOKEN}`, ORIGIN)).toEqual({ kind: 'token', token: TOKEN });
  });

  it('accepts a trailing slash, surrounding space and an upper-case host', () => {
    expect(parseScanned(`  https://EMBER.example.com/link/${TOKEN}/ \n`, ORIGIN)).toEqual({ kind: 'token', token: TOKEN });
  });

  it('accepts a port when the app runs on the same one', () => {
    const origin = 'http://192.168.1.20:3050';
    expect(parseScanned(`${origin}/link/${TOKEN}`, origin)).toEqual({ kind: 'token', token: TOKEN });
    expect(parseScanned(`http://192.168.1.20:3051/link/${TOKEN}`, origin)).toBeNull();
  });

  it('refuses another origin, even another Ember', () => {
    expect(parseScanned(`https://evil.example.com/link/${TOKEN}`, ORIGIN)).toBeNull();
    expect(parseScanned(`https://ember.example.com.evil.io/link/${TOKEN}`, ORIGIN)).toBeNull();
    expect(parseScanned(`http://ember.example.com/link/${TOKEN}`, ORIGIN)).toBeNull();
    expect(parseScanned(`https://other-ember.example.com/link/${TOKEN}`, ORIGIN)).toBeNull();
  });

  it('refuses a user:password@ link to this host', () => {
    expect(parseScanned(`https://a:b@ember.example.com/link/${TOKEN}`, ORIGIN)).toBeNull();
  });

  it('refuses other paths and malformed tokens on this server', () => {
    expect(parseScanned(`${ORIGIN}/playlist/abc`, ORIGIN)).toBeNull();
    expect(parseScanned(`${ORIGIN}/link/short`, ORIGIN)).toBeNull();
    expect(parseScanned(`${ORIGIN}/link/${TOKEN}x`, ORIGIN)).toBeNull();
    expect(parseScanned(`${ORIGIN}/link/${TOKEN}/approve`, ORIGIN)).toBeNull();
    expect(parseScanned(`${ORIGIN}/x/link/${TOKEN}`, ORIGIN)).toBeNull();
    expect(parseScanned(`${ORIGIN}/link/${TOKEN.slice(0, 42)}!`, ORIGIN)).toBeNull();
  });

  it('refuses garbage', () => {
    for (const v of ['', '   ', 'hello world', 'WIFI:S:home;T:WPA;P:secret;;', 'javascript:alert(1)', `ftp://ember.example.com/link/${TOKEN}`, 'x'.repeat(5000)]) {
      expect(parseScanned(v, ORIGIN)).toBeNull();
    }
    expect(parseScanned(undefined, ORIGIN)).toBeNull();
    expect(parseScanned(42, ORIGIN)).toBeNull();
  });

  it('accepts a bare short code, as typed in Settings > Devices', () => {
    expect(parseScanned('ABCD-EFGH', ORIGIN)).toEqual({ kind: 'code', code: 'ABCDEFGH' });
    expect(parseScanned('abcd efgh', ORIGIN)).toEqual({ kind: 'code', code: 'ABCDEFGH' });
  });

  it('refuses a code of the wrong shape', () => {
    expect(parseScanned('ABCD-EFG', ORIGIN)).toBeNull();
    expect(parseScanned('ABCD-EFGHJ', ORIGIN)).toBeNull();
    expect(parseScanned('ABCD-EFGU', ORIGIN)).toBeNull();
  });

  it('a broken app origin refuses every link', () => {
    expect(parseScanned(`${ORIGIN}/link/${TOKEN}`, 'not a url')).toBeNull();
  });

  it('approvePath is the in-app approve page', () => {
    expect(approvePath(TOKEN)).toBe(`/link/${TOKEN}`);
  });
});
