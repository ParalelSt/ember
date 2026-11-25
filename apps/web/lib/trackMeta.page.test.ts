import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const getTrack = vi.fn();
vi.mock('@/lib/sources/youtube', () => ({
  getTrack: (...a: unknown[]) => getTrack(...a),
  findArtistId: vi.fn(),
}));
// No PocketBase: every lookup falls through to getTrack.
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: vi.fn().mockRejectedValue(new Error('down')) }));
vi.mock('@/lib/mapTrack', () => ({ mapTrackRow: vi.fn() }));

import { BROWSER_META_WAIT_MS, clearTrackMetaCache, fetchTrackMetaCached, fetchTrackMetaForPage, isPreviewCrawler } from './trackMeta';

const ID = 'Sn1HdLrl94A';
const track = { id: `youtube:${ID}`, title: 'Song', artist: 'Band' };

beforeEach(() => {
  clearTrackMetaCache();
  getTrack.mockReset();
  vi.useRealTimers();
});

describe('fetchTrackMetaCached', () => {
  it('shares one lookup between concurrent opens and answers a repeat from memory', async () => {
    getTrack.mockResolvedValue(track);
    const [a, b] = await Promise.all([fetchTrackMetaCached(ID), fetchTrackMetaCached(ID)]);
    expect(a).toEqual(track);
    expect(b).toEqual(track);
    expect(await fetchTrackMetaCached(ID)).toEqual(track);
    expect(getTrack).toHaveBeenCalledTimes(1);
  });

  it('does not keep "not found"', async () => {
    getTrack.mockResolvedValue(null);
    await fetchTrackMetaCached(ID);
    await fetchTrackMetaCached(ID);
    expect(getTrack).toHaveBeenCalledTimes(2);
  });

  it('answers null for a malformed id without a lookup', async () => {
    expect(await fetchTrackMetaCached('nope')).toBeNull();
    expect(getTrack).not.toHaveBeenCalled();
  });
});

describe('fetchTrackMetaForPage', () => {
  it('lets a person\'s page go ahead with default metadata when the lookup is slow, and fills the cache', async () => {
    let release!: (t: unknown) => void;
    getTrack.mockReturnValue(new Promise((r) => { release = r; }));
    vi.useFakeTimers();
    const page = fetchTrackMetaForPage(ID, { patient: false });
    await vi.advanceTimersByTimeAsync(BROWSER_META_WAIT_MS + 1);
    expect(await page).toBeNull();
    release(track);
    await vi.advanceTimersByTimeAsync(0);
    // The slow lookup finished meanwhile: the next open has it at once.
    expect(await fetchTrackMetaForPage(ID, { patient: false })).toEqual(track);
    expect(getTrack).toHaveBeenCalledTimes(1);
  });

  it('makes a crawler wait for the real answer however long it takes', async () => {
    let release!: (t: unknown) => void;
    getTrack.mockReturnValue(new Promise((r) => { release = r; }));
    vi.useFakeTimers();
    const page = fetchTrackMetaForPage(ID, { patient: true });
    await vi.advanceTimersByTimeAsync(BROWSER_META_WAIT_MS * 10);
    release(track);
    expect(await page).toEqual(track);
  });

  it('returns the real answer to a person when the lookup is quick', async () => {
    getTrack.mockResolvedValue(track);
    expect(await fetchTrackMetaForPage(ID, { patient: false })).toEqual(track);
  });
});

describe('isPreviewCrawler', () => {
  it.each([
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'facebookexternalhit/1.1',
    'Slackbot-LinkExpanding 1.0',
    'WhatsApp/2.23',
    'TelegramBot (like TwitterBot)',
    'Twitterbot/1.0',
  ])('treats %s as a crawler', (ua) => {
    expect(isPreviewCrawler(ua)).toBe(true);
  });

  it.each([
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
    null,
  ])('treats %s as a person', (ua) => {
    expect(isPreviewCrawler(ua)).toBe(false);
  });
});
