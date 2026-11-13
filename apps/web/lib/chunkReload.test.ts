import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isChunkLoadError, reloadForChunkFailure, RELOAD_WINDOW_MS } from './chunkReload';

describe('isChunkLoadError', () => {
  it('matches the name, the JS chunk message and the CSS chunk message', () => {
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk 5897 failed. (error: /_next/static/chunks/a.js)'))).toBe(true);
    expect(isChunkLoadError(undefined, 'Loading CSS chunk app-layout failed.')).toBe(true);
  });
  it('ignores other errors', () => {
    expect(isChunkLoadError(new Error('boom'))).toBe(false);
    expect(isChunkLoadError(undefined, 'Loading failed')).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('reloadForChunkFailure', () => {
  const reload = vi.fn();
  const assign = vi.fn();
  beforeEach(() => {
    window.sessionStorage.clear();
    reload.mockClear();
    assign.mockClear();
    vi.stubGlobal('location', { ...window.location, pathname: '/settings', search: '', hash: '', origin: window.location.origin, reload, assign });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reloads once, then refuses inside the window', () => {
    expect(reloadForChunkFailure(1_000_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadForChunkFailure(1_000_000 + RELOAD_WINDOW_MS - 1)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('reloads again after the window', () => {
    reloadForChunkFailure(1_000_000);
    expect(reloadForChunkFailure(1_000_000 + RELOAD_WINDOW_MS + 1)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it('does not reload when storage is unusable (cannot guard)', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(reloadForChunkFailure()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
