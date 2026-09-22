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

  it('web during SSR gives no adapter', () => {
    expect(selectSpeechAdapter('web', undefined).adapter).toBeNull();
  });

  it('a capacitor shell never falls back to the WebView recognizer', () => {
    expect(selectSpeechAdapter('capacitor', withCtor)).toEqual({ adapter: null, reason: 'no-bridge' });
  });

  it('a tauri shell never falls back to the WebView recognizer', () => {
    expect(selectSpeechAdapter('tauri', withCtor)).toEqual({ adapter: null, reason: 'no-bridge' });
  });

  it('a tauri shell with __TAURI_INTERNALS__ but no adapter yet gives no-bridge', () => {
    const win = { __TAURI_INTERNALS__: { invoke: () => Promise.resolve() } } as unknown as Window;
    expect(selectSpeechAdapter('tauri', win)).toEqual({ adapter: null, reason: 'no-bridge' });
  });
});
