import { describe, expect, it } from 'vitest';
import { selectSpeechAdapter } from './selectAdapter';

const withCtor = { webkitSpeechRecognition: class {} } as unknown as Window;
const bare = {} as Window;

describe('selectSpeechAdapter', () => {
  it('web with a recognizer gives the web adapter', () => {
    expect(selectSpeechAdapter('web', withCtor).adapter?.kind).toBe('web');
  });

  it('web without a recognizer gives no-recognizer', () => {
    expect(selectSpeechAdapter('web', bare)).toEqual({ adapter: null, reason: 'no-recognizer' });
  });

  it('a capacitor shell with the EmberSpeech plugin gives the capacitor adapter', () => {
    const win = { Capacitor: { Plugins: { EmberSpeech: {} } } } as unknown as Window;
    expect(selectSpeechAdapter('capacitor', win).adapter?.kind).toBe('capacitor');
  });

  it('a capacitor shell without the plugin (old APK) gives no-bridge', () => {
    const win = { Capacitor: { Plugins: { EmberPlayer: {} } } } as unknown as Window;
    expect(selectSpeechAdapter('capacitor', win)).toEqual({ adapter: null, reason: 'no-bridge' });
  });

  it('the plugin does not count outside a capacitor shell', () => {
    const win = { Capacitor: { Plugins: { EmberSpeech: {} } } } as unknown as Window;
    expect(selectSpeechAdapter('web', win)).toEqual({ adapter: null, reason: 'no-recognizer' });
  });

  it('a capacitor shell never falls back to the WebView recognizer', () => {
    expect(selectSpeechAdapter('capacitor', withCtor)).toEqual({ adapter: null, reason: 'no-bridge' });
  });

  it('a tauri shell never falls back to the WebView recognizer', () => {
    expect(selectSpeechAdapter('tauri', withCtor)).toEqual({ adapter: null, reason: 'no-bridge' });
  });

  it('a tauri shell with an invoke bridge gives the tauri adapter', () => {
    const win = { __TAURI_INTERNALS__: { invoke: () => Promise.resolve() } } as unknown as Window;
    expect(selectSpeechAdapter('tauri', win).adapter?.kind).toBe('tauri');
  });

  it('a tauri shell with __TAURI_INTERNALS__ but no invoke gives no-bridge', () => {
    const win = { __TAURI_INTERNALS__: {} } as unknown as Window;
    expect(selectSpeechAdapter('tauri', win)).toEqual({ adapter: null, reason: 'no-bridge' });
  });
});
