import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCallback, useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useBackDismiss } from './useBackDismiss';

/** A session history that behaves like Chromium's (and the Android
 *  WebView's): pushState drops the forward entries and adds one, and every
 *  back() is queued and applied in turn, each one stepping back from where
 *  the one before it landed, firing popstate as it lands. Two back() calls
 *  in one tick go back TWO entries; checked in real Chrome. */
class FakeHistory {
  entries: { state: unknown; url: string }[];
  index = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(urls: string[]) {
    this.entries = urls.map((url) => ({ state: { __NA: true, url }, url }));
    this.index = urls.length - 1;
  }

  get state() {
    return this.entries[this.index].state;
  }

  get url() {
    return this.entries[this.index].url;
  }

  pushState = (state: unknown) => {
    this.entries = [...this.entries.slice(0, this.index + 1), { state, url: this.url }];
    this.index++;
  };

  back = () => {
    this.queue = this.queue.then(async () => {
      await new Promise((r) => setTimeout(r, 0));
      if (this.index === 0) return;
      this.index--;
      window.dispatchEvent(new PopStateEvent('popstate', { state: this.state }));
    });
  };

  /** Lets every queued back() land, and React render what they did. */
  async settle() {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await this.queue;
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }
}

let fake: FakeHistory;
const real = {
  pushState: window.history.pushState,
  back: window.history.back,
  state: Object.getOwnPropertyDescriptor(History.prototype, 'state'),
};

beforeEach(() => {
  // Before the page the listener was on (W) is the page they came from.
  fake = new FakeHistory(['/library', '/']);
  window.history.pushState = fake.pushState as typeof window.history.pushState;
  window.history.back = fake.back;
  Object.defineProperty(window.history, 'state', { configurable: true, get: () => fake.state });
});

afterEach(() => {
  window.history.pushState = real.pushState;
  window.history.back = real.back;
  delete (window.history as unknown as { state?: unknown }).state;
  if (real.state) Object.defineProperty(History.prototype, 'state', real.state);
});

/** One overlay: its open flag and the hook, as NowPlaying and the search
 *  sheet use it. */
function useOverlay() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useBackDismiss(open, close);
  return { open, setOpen };
}

/** The search sheet and the full-screen player, mounted side by side in
 *  the app shell like the real ones. */
function useShell() {
  return { sheet: useOverlay(), player: useOverlay() };
}

describe('useBackDismiss', () => {
  it('Back closes a lone overlay and stays on the page', async () => {
    const { result } = renderHook(() => useOverlay());
    act(() => result.current.setOpen(true));
    expect(fake.entries).toHaveLength(3);

    fake.back();
    await fake.settle();

    expect(result.current.open).toBe(false);
    expect(fake.url).toBe('/');
    expect(fake.index).toBe(1);
  });

  it('closing a lone overlay from the UI drops its entry once', async () => {
    const { result } = renderHook(() => useOverlay());
    act(() => result.current.setOpen(true));
    act(() => result.current.setOpen(false));
    await fake.settle();

    expect(fake.index).toBe(1);
    expect(fake.url).toBe('/');
  });

  it('Back on the full-screen player over the search sheet closes only the player', async () => {
    const { result } = renderHook(() => useShell());
    act(() => result.current.sheet.setOpen(true));
    act(() => result.current.player.setOpen(true));
    expect(fake.index).toBe(3);

    fake.back();
    await fake.settle();

    expect(result.current.player.open).toBe(false);
    // The sheet the player was opened from is still there, on its own entry.
    expect(result.current.sheet.open).toBe(true);
    expect(fake.index).toBe(2);
    expect(fake.url).toBe('/');

    // A second Back closes the sheet and lands on the page under both.
    fake.back();
    await fake.settle();

    expect(result.current.sheet.open).toBe(false);
    expect(fake.index).toBe(1);
    expect(fake.url).toBe('/');
  });

  it('never steps back past the page the overlays were opened on', async () => {
    const { result } = renderHook(() => useShell());
    act(() => result.current.sheet.setOpen(true));
    act(() => result.current.player.setOpen(true));

    fake.back();
    await fake.settle();
    fake.back();
    await fake.settle();

    // The page before ('/library' here, '/search' on the owner's phone)
    // is never reached by closing overlays.
    expect(fake.url).not.toBe('/library');
  });

  it('closing the player from the UI over the sheet leaves the sheet and its entry', async () => {
    const { result } = renderHook(() => useShell());
    act(() => result.current.sheet.setOpen(true));
    act(() => result.current.player.setOpen(true));

    act(() => result.current.player.setOpen(false));
    await fake.settle();

    expect(result.current.sheet.open).toBe(true);
    expect(fake.index).toBe(2);

    act(() => result.current.sheet.setOpen(false));
    await fake.settle();
    expect(fake.index).toBe(1);
  });

  it('an overlay closed from the UI under another one leaves the top entry alone', async () => {
    const { result } = renderHook(() => useShell());
    act(() => result.current.sheet.setOpen(true));
    act(() => result.current.player.setOpen(true));

    // The sheet goes (a navigation closes it) while the player is on top:
    // stepping back now would pop the PLAYER's entry and close it.
    act(() => result.current.sheet.setOpen(false));
    await fake.settle();

    expect(result.current.player.open).toBe(true);
    expect(fake.index).toBe(3);
  });
});
