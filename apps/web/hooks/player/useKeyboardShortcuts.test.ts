import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { makeFakeBackend, makeTrack, type FakeBackend } from './fakeBackend';

const track = makeTrack();

function setup(backend: FakeBackend | null = makeFakeBackend()) {
  const backendRef = { current: backend };
  const view = renderHook(() => useKeyboardShortcuts({ backendRef }));
  return { backendRef, backend, view };
}

/** Fire a keydown the way the browser does. Returns false when something
 *  called preventDefault, which is exactly what we want to assert. */
function press(
  init: KeyboardEventInit,
  target: EventTarget = window,
): boolean {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  return target.dispatchEvent(ev);
}

beforeEach(() => {
  usePlayerStore.setState({
    queue: [track],
    index: 0,
    volume: 0.5,
    muted: false,
    position: 0,
  });
  useSettingsStore.setState({ partyVolume: false });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useKeyboardShortcuts', () => {
  it('Space plays when paused and prevents the page from scrolling', () => {
    const { backend } = setup();
    backend!.paused = true;
    expect(press({ key: ' ', code: 'Space' })).toBe(false);
    expect(backend!.play).toHaveBeenCalledTimes(1);
    expect(backend!.pause).not.toHaveBeenCalled();
  });

  it('Space pauses when playing', () => {
    const { backend } = setup();
    backend!.paused = false;
    press({ key: ' ', code: 'Space' });
    expect(backend!.pause).toHaveBeenCalledTimes(1);
    expect(backend!.play).not.toHaveBeenCalled();
  });

  it('Space still preventDefaults with no backend, and does not throw', () => {
    setup(null);
    expect(press({ key: ' ', code: 'Space' })).toBe(false);
  });

  it('arrows seek by five seconds from the current playhead', () => {
    const { backend } = setup();
    backend!.currentTime = 30;
    expect(press({ key: 'ArrowRight' })).toBe(false);
    expect(backend!.seek).toHaveBeenCalledWith(35);
    press({ key: 'ArrowLeft' });
    expect(backend!.seek).toHaveBeenLastCalledWith(25);
  });

  it('does NOT preventDefault on a seek when there is no backend', () => {
    setup(null);
    // With no audio the arrow keys must still scroll the page.
    expect(press({ key: 'ArrowRight' })).toBe(true);
  });

  it('arrows step the volume and preventDefault', () => {
    setup();
    expect(press({ key: 'ArrowUp' })).toBe(false);
    expect(usePlayerStore.getState().volume).toBeCloseTo(0.55);
    press({ key: 'ArrowDown' });
    expect(usePlayerStore.getState().volume).toBeCloseTo(0.5);
  });

  it('volume up unmutes first', () => {
    usePlayerStore.setState({ muted: true });
    setup();
    press({ key: 'ArrowUp' });
    expect(usePlayerStore.getState().muted).toBe(false);
    expect(usePlayerStore.getState().volume).toBeCloseTo(0.55);
  });

  it('volume stops at the 0.85 ceiling, or 1 in party mode', () => {
    usePlayerStore.setState({ volume: 0.84 });
    setup();
    press({ key: 'ArrowUp' });
    expect(usePlayerStore.getState().volume).toBeCloseTo(0.85);
    useSettingsStore.setState({ partyVolume: true });
    usePlayerStore.setState({ volume: 0.99 });
    press({ key: 'ArrowUp' });
    expect(usePlayerStore.getState().volume).toBeCloseTo(1);
  });

  it('M toggles mute', () => {
    setup();
    expect(press({ key: 'm' })).toBe(false);
    expect(usePlayerStore.getState().muted).toBe(true);
    press({ key: 'M' });
    expect(usePlayerStore.getState().muted).toBe(false);
  });

  it('ignores keys typed into an input, without preventDefault', () => {
    const { backend } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(press({ key: ' ', code: 'Space' }, input)).toBe(true);
    expect(backend!.play).not.toHaveBeenCalled();
    expect(backend!.pause).not.toHaveBeenCalled();
  });

  it('does nothing with an empty queue', () => {
    usePlayerStore.setState({ queue: [], index: -1 });
    const { backend } = setup();
    expect(press({ key: ' ', code: 'Space' })).toBe(true);
    expect(backend!.play).not.toHaveBeenCalled();
  });

  it('ignores unbound keys', () => {
    const { backend } = setup();
    expect(press({ key: 'k' })).toBe(true);
    expect(backend!.play).not.toHaveBeenCalled();
    expect(backend!.seek).not.toHaveBeenCalled();
  });

  it('ignores a held Space but keeps repeating a held arrow', () => {
    const { backend } = setup();
    backend!.currentTime = 10;
    expect(press({ key: ' ', code: 'Space', repeat: true })).toBe(true);
    expect(backend!.play).not.toHaveBeenCalled();
    press({ key: 'ArrowRight', repeat: true });
    expect(backend!.seek).toHaveBeenCalledWith(15);
  });

  it('unregisters the listener on unmount', () => {
    const { backend, view } = setup();
    view.unmount();
    expect(press({ key: ' ', code: 'Space' })).toBe(true);
    expect(backend!.play).not.toHaveBeenCalled();
  });
});
