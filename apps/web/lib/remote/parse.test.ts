// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cleanLabel, parseBeat, parseCommand, parseContext, parseTrack } from './parse';
import { makeTrack } from '@/test-utils/fakeBackend';

const T = makeTrack({ id: 'youtube:t1', sourceId: 't1', streamUrl: '/api/youtube/stream/t1' });
const light = { trackId: T.id, index: 0, queueHash: 'abc', position: 12, duration: 191, isPlaying: true, volume: 0.4, muted: false };
const full = { ...light, track: T, upNext: [], queueLength: 1, loopMode: 'off', shuffle: false, context: { type: 'liked' } };
const base = { deviceId: 'abcdef12', label: 'Windows', platform: 'windows', shell: 'tauri', acked: [] };
const queueOf = (n: number) => Array.from({ length: n }, (_, i) => ({ ...T, id: `youtube:x${i}`, sourceId: `x${i}` }));

describe('parseBeat', () => {
  it('takes a light or a full beat, not both and not neither', () => {
    expect(parseBeat({ ...base, light })?.light).toEqual(light);
    expect(parseBeat({ ...base, full })?.full?.track?.id).toBe(T.id);
    expect(parseBeat({ ...base, light, full })).toBeNull();
    expect(parseBeat(base)).toBeNull();
  });

  it('rejects a bad device id, platform or shell', () => {
    expect(parseBeat({ ...base, light, deviceId: 'short' })).toBeNull();
    expect(parseBeat({ ...base, light, deviceId: 'has spaces in it' })).toBeNull();
    expect(parseBeat({ ...base, light, deviceId: 'x'.repeat(65) })).toBeNull();
    expect(parseBeat({ ...base, light, platform: 'amiga' })).toBeNull();
    expect(parseBeat({ ...base, light, shell: 'electron' })).toBeNull();
  });

  it('bounds every field', () => {
    for (const bad of [
      { position: -1 }, { position: 86_401 }, { duration: Number.NaN }, { volume: 1.5 }, { volume: -0.1 },
      { index: 1.5 }, { index: -2 }, { isPlaying: 'yes' }, { queueHash: 'x'.repeat(65) }, { trackId: 'x'.repeat(201) },
    ]) {
      expect(parseBeat({ ...base, light: { ...light, ...bad } }), JSON.stringify(bad)).toBeNull();
    }
    expect(parseBeat({ ...base, full: { ...full, upNext: queueOf(21) } })).toBeNull();
    expect(parseBeat({ ...base, full: { ...full, loopMode: 'twice' } })).toBeNull();
    expect(parseBeat({ ...base, full: { ...full, trackId: 'youtube:other' } })).toBeNull();
    expect(parseBeat({ ...base, light, acked: ['ok', 'not ok!'] })).toBeNull();
  });

  it('cleans and cuts the label, falls back to the platform word', () => {
    expect(parseBeat({ ...base, light, label: 'Win\u0007dows '.repeat(20) })?.label).toHaveLength(60);
    expect(parseBeat({ ...base, light, label: '' })?.label).toBe('Windows');
    expect(cleanLabel('  a\nb  ', 'x')).toBe('a b');
  });
});

describe('parseTrack and parseContext', () => {
  it('rejects a track missing streamUrl or with an unknown source', () => {
    expect(parseTrack(T)).toEqual(T);
    expect(parseTrack({ ...T, streamUrl: undefined })).toBeNull();
    expect(parseTrack({ ...T, streamUrl: '' })).toBeNull();
    expect(parseTrack({ ...T, source: 'napster' })).toBeNull();
    expect(parseTrack({ ...T, title: 'x'.repeat(501) })).toBeNull();
  });

  it('keeps only known contexts', () => {
    expect(parseContext({ type: 'playlist', playlistId: 'p1', playlistName: 'Mix' })).toEqual({ type: 'playlist', playlistId: 'p1', playlistName: 'Mix' });
    expect(parseContext(null)).toBeNull();
    expect(parseContext({ type: 'evil' })).toBeUndefined();
    expect(parseContext({ type: 'single', exclude: [1] })).toBeUndefined();
  });
});

describe('parseCommand', () => {
  const cmd = (type: string, args?: unknown) => parseCommand({ target: 'abcdef12', from: 'phone1234', type, args });

  it('rejects an unknown command type and a bad target', () => {
    expect(cmd('format-disk')).toMatchObject({ ok: false, status: 400 });
    expect(parseCommand({ target: 'bad', type: 'play' })).toMatchObject({ ok: false, status: 400 });
    expect(cmd('play')).toEqual({ ok: true, target: 'abcdef12', from: 'phone1234', command: { type: 'play' } });
  });

  it('bounds seek and volume', () => {
    expect(cmd('seek', { sec: 20 })).toMatchObject({ ok: true, command: { type: 'seek', args: { sec: 20 } } });
    expect(cmd('seek', { sec: -1 })).toMatchObject({ ok: false });
    expect(cmd('seek', { sec: 86_401 })).toMatchObject({ ok: false });
    expect(cmd('setVolume', { volume: 0.5 })).toMatchObject({ ok: true });
    expect(cmd('setVolume', { volume: 2 })).toMatchObject({ ok: false });
    expect(cmd('playAt', { index: -1 })).toMatchObject({ ok: false });
    expect(cmd('setLoop', { mode: 'one' })).toMatchObject({ ok: true });
    expect(cmd('setShuffle', { on: 'yes' })).toMatchObject({ ok: false });
  });

  it('a device cannot fake a takeover pause', () => {
    expect(cmd('pause', { reason: 'took-over', by: 'Admin' })).toMatchObject({ ok: true, command: { type: 'pause' } });
    const r = cmd('pause', { reason: 'took-over' });
    expect(r.ok && 'args' in r.command).toBe(false);
  });

  it('takes up to 300 tracks in a setQueue, answers 413 above, 400 for a bad track', () => {
    const ok = cmd('setQueue', { tracks: queueOf(300), index: 0, play: true, startSec: 12, context: null });
    expect(ok).toMatchObject({ ok: true });
    expect(cmd('setQueue', { tracks: queueOf(301), index: 0, play: true })).toEqual({ ok: false, status: 413, error: 'Too many songs' });
    expect(cmd('setQueue', { tracks: [{ ...T, streamUrl: undefined }], index: 0, play: true })).toMatchObject({ ok: false, status: 400 });
    expect(cmd('setQueue', { tracks: [T], index: 1, play: true })).toMatchObject({ ok: false, status: 400 });
    expect(cmd('setQueue', { tracks: [T], index: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(cmd('addToQueue', { tracks: [T] })).toMatchObject({ ok: true });
    expect(cmd('addToQueue', { tracks: [] })).toMatchObject({ ok: false });
  });
});
