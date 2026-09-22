import { describe, expect, it } from 'vitest';
import {
  APPLE_ONLY_WAY,
  MATCHED_BY_NAME,
  NOTHING_TO_MATCH,
  routesFor,
  serviceById,
  soleRoute,
  SPOTIFY_LINK_CAP,
  TRANSFER_SERVICES,
} from './transferRoutes';
import { YTMUSIC_HEADERS_STEPS } from './sources/ytmusicLiked';

describe('the four services a transfer asks about', () => {
  it('names them in plain words, and each has at least one real way in', () => {
    expect(TRANSFER_SERVICES.map((s) => s.name)).toEqual(['Spotify', 'YouTube Music', 'Apple Music', 'Somewhere else']);
    for (const s of TRANSFER_SERVICES) {
      expect(s.routes.length, s.name).toBeGreaterThan(0);
      for (const r of s.routes) {
        expect(r.steps.length, r.id).toBeGreaterThan(0);
        expect(r.notes.length, r.id).toBeGreaterThan(0);
      }
    }
  });

  it('asks what a person has, never which technical route to take', () => {
    const asked = TRANSFER_SERVICES.flatMap((s) => s.routes.map((r) => r.whatYouHave));
    for (const q of asked) expect(q).not.toMatch(/CSV|JSON|export|headers/i);
  });

  it('has no em dashes in anything it says', () => {
    const everything = TRANSFER_SERVICES.flatMap((s) => [s.name, s.heading, ...s.routes.flatMap((r) => [r.whatYouHave, ...r.steps, ...r.notes])]);
    for (const line of everything) expect(line).not.toContain('\u2014');
  });
});

describe('the real limits, said where the path shows up', () => {
  it('a Spotify link is for a playlist, and stops at 100 songs', () => {
    const link = serviceById('spotify').routes.find((r) => r.kind === 'link')!;
    expect(link.steps[0]).toMatch(/cannot share your liked songs as a link/);
    expect(link.notes).toContain(SPOTIFY_LINK_CAP);
    expect(SPOTIFY_LINK_CAP).toContain('100');
  });

  it('Apple Music is the privacy copy and nothing else', () => {
    const apple = serviceById('apple');
    expect(apple.routes).toHaveLength(1);
    expect(apple.routes[0].kind).toBe('file');
    expect(apple.routes[0].notes).toContain(APPLE_ONLY_WAY);
  });

  it('every route but the account read warns that songs are found by name', () => {
    for (const s of TRANSFER_SERVICES) {
      for (const r of s.routes) {
        if (r.kind === 'ytmusic') expect(r.notes, r.id).toContain(NOTHING_TO_MATCH);
        else expect(r.notes, r.id).toContain(MATCHED_BY_NAME);
      }
    }
  });

  it('the YouTube Music account steps are the ones the parser ships with, word for word', () => {
    const account = serviceById('ytmusic').routes.find((r) => r.kind === 'ytmusic')!;
    expect(account.steps).toEqual(YTMUSIC_HEADERS_STEPS);
    expect(account.desktopOnly).toBe(true);
    expect(account.likedOnly).toBe(true);
  });
});

describe('what a destination leaves on offer', () => {
  it('the account read is offered for Liked songs only', () => {
    const ytmusic = serviceById('ytmusic');
    expect(routesFor(ytmusic, 'liked').map((r) => r.kind)).toEqual(['link', 'ytmusic']);
    expect(routesFor(ytmusic, 'playlist').map((r) => r.kind)).toEqual(['link']);
  });

  it('one way left is no question: YouTube Music into a playlist, and Apple Music always', () => {
    expect(soleRoute(serviceById('ytmusic'), 'playlist')?.kind).toBe('link');
    expect(soleRoute(serviceById('ytmusic'), 'liked')).toBeNull();
    expect(soleRoute(serviceById('apple'), 'liked')?.id).toBe('apple-export');
  });
});
