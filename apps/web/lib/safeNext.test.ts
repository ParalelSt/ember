import { describe, expect, it } from 'vitest';
import { safeNext } from './safeNext';

/** Where /auth?next= may send you after sign-in: only a page on this site
 *  (bughunt V2). `next` arrives already decoded once, as searchParams.get()
 *  hands it over. */
const ORIGIN = 'https://ember.example';
const param = (raw: string) => new URLSearchParams(`next=${raw}`).get('next');

describe('safeNext [bughunt V2]', () => {
  it('keeps same-site paths, with their query and hash', () => {
    expect(safeNext('/library', ORIGIN)).toBe('/library');
    expect(safeNext('/library/liked?tab=all#top', ORIGIN)).toBe('/library/liked?tab=all#top');
    expect(safeNext(param('%2Flibrary%2Fliked%3Ftab%3Dall'), ORIGIN)).toBe('/library/liked?tab=all');
  });

  it('falls back to home when there is nothing usable', () => {
    for (const raw of [null, undefined, '', 'library', ' /library']) expect(safeNext(raw, ORIGIN), String(raw)).toBe('/');
  });

  it('refuses backslash tricks (browsers read \\ as /)', () => {
    for (const raw of ['/\\example.com', '/\\/example.com', '\\\\example.com', '/..\\example.com', param('/%5Cexample.com'), param('%5C%5Cexample.com')]) {
      expect(safeNext(raw, ORIGIN), String(raw)).toBe('/');
    }
  });

  it('refuses protocol-relative links, however spelled', () => {
    for (const raw of ['//example.com', '///example.com', '//example.com/library', param('%2F%2Fexample.com'), param('/%2Fexample.com'), '/\t/example.com', '/\n/example.com']) {
      expect(safeNext(raw, ORIGIN), JSON.stringify(raw)).toBe('/');
    }
  });

  it('refuses absolute and script links', () => {
    for (const raw of ['https://example.com', 'http://example.com/library', 'https:example.com', 'javascript:alert(1)', param('https%3A%2F%2Fexample.com'), `${ORIGIN}.evil.com/x`]) {
      expect(safeNext(raw, ORIGIN), raw!).toBe('/');
    }
  });

  it('a still-encoded value stays a path on this site', () => {
    // Double-encoded: arrives as a literal %5C, which is a path character.
    expect(safeNext(param('/%255Cexample.com'), ORIGIN)).toBe('/%5Cexample.com');
  });
});
