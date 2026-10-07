// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET } from './codes';
import { hash, isSecret, newSecret, newShortCode, sameHash } from './secrets';

describe('newShortCode', () => {
  it('is 8 symbols from the alphabet', () => {
    for (let i = 0; i < 500; i++) {
      const code = newShortCode();
      expect(code).toMatch(/^[0-9A-Z]{8}$/);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it('uses the whole alphabet and does not repeat', () => {
    const seen = new Set<string>();
    const codes = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const code = newShortCode();
      codes.add(code);
      for (const ch of code) seen.add(ch);
    }
    expect(seen.size).toBe(32);
    expect(codes.size).toBe(2000);
  });
});

describe('newSecret', () => {
  it('is 32 random bytes as base64url (43 chars), never the same twice', () => {
    const a = newSecret();
    const b = newSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(isSecret(a)).toBe(true);
  });

  it('isSecret refuses anything else', () => {
    for (const v of ['', 'short', `${newSecret()}x`, 'a'.repeat(42) + '=', null, 42]) expect(isSecret(v)).toBe(false);
  });
});

describe('hash', () => {
  it('is sha256 as base64url', () => {
    expect(hash('abc')).toBe(createHash('sha256').update('abc').digest('base64url'));
    expect(hash('abc')).toHaveLength(43);
  });

  it('sameHash compares in constant time and refuses length mismatches', () => {
    expect(sameHash(hash('x'), hash('x'))).toBe(true);
    expect(sameHash(hash('x'), hash('y'))).toBe(false);
    expect(sameHash(hash('x'), '')).toBe(false);
    expect(sameHash('', '')).toBe(false);
  });
});
