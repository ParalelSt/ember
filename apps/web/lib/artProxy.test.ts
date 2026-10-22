import { describe, expect, it } from 'vitest';
import { artProxyTarget, readableArtUrl } from './artProxy';

describe('artProxyTarget', () => {
  it('allows https covers on YouTube image hosts', () => {
    expect(artProxyTarget('https://i.ytimg.com/vi/abc/hqdefault.jpg')?.hostname).toBe('i.ytimg.com');
    expect(artProxyTarget('https://lh3.googleusercontent.com/x=w544-h544')).not.toBeNull();
    expect(artProxyTarget('https://yt3.ggpht.com/a/b')).not.toBeNull();
  });

  it('refuses anything else', () => {
    for (const bad of [
      null,
      '',
      'not a url',
      'http://i.ytimg.com/vi/abc/hq.jpg',
      'https://evil.com/i.ytimg.com.jpg',
      'https://i.ytimg.com.evil.com/x.jpg',
      'https://notytimg.com/x.jpg',
      'https://user:pw@i.ytimg.com/x.jpg',
      'https://i.ytimg.com:8443/x.jpg',
      'https://127.0.0.1/x.jpg',
      'file:///etc/passwd',
    ]) {
      expect(artProxyTarget(bad)).toBeNull();
    }
  });
});

describe('readableArtUrl', () => {
  it('keeps our own covers as they are and proxies YouTube ones', () => {
    expect(readableArtUrl('/pb/api/files/playlists/p1/c.jpg')).toBe('/pb/api/files/playlists/p1/c.jpg');
    expect(readableArtUrl('https://i.ytimg.com/vi/a b/x.jpg')).toBe('/api/art?url=https%3A%2F%2Fi.ytimg.com%2Fvi%2Fa%20b%2Fx.jpg');
  });

  it('gives null for a cover it cannot read', () => {
    expect(readableArtUrl('https://example.com/c.jpg')).toBeNull();
  });
});
