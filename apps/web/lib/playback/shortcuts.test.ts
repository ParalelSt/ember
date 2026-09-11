import { describe, expect, it } from 'vitest';
import { isTypingTarget, shortcutFor, type ShortcutAction, type ShortcutEvent, type ShortcutState } from './shortcuts';

function press(event: Partial<ShortcutEvent>, state: Partial<ShortcutState> = {}) {
  return shortcutFor(
    { key: '', ...event },
    { hasCurrent: true, volume: 0.5, ...state },
  );
}

describe('isTypingTarget', () => {
  it('is true for the form elements that own the keyboard', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('is false for ordinary elements and for no target at all', () => {
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON', isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

describe('shortcutFor: guards', () => {
  it('ignores every key while the user is typing', () => {
    // Space in a search box must type a space, not pause the music.
    expect(press({ code: 'Space', key: ' ', target: { tagName: 'INPUT' } })).toEqual({ type: 'ignore' });
    expect(press({ key: 'm', target: { tagName: 'TEXTAREA' } })).toEqual({ type: 'ignore' });
    expect(press({ key: 'ArrowUp', target: { tagName: 'DIV', isContentEditable: true } })).toEqual({ type: 'ignore' });
  });

  it('ignores every key when no track is loaded', () => {
    expect(press({ code: 'Space', key: ' ' }, { hasCurrent: false })).toEqual({ type: 'ignore' });
    expect(press({ key: 'ArrowRight' }, { hasCurrent: false })).toEqual({ type: 'ignore' });
  });

  it('returns null for keys it does not bind', () => {
    expect(press({ key: 'k' })).toBeNull();
    expect(press({ key: 'Enter', code: 'Enter' })).toBeNull();
    expect(press({ key: 'Escape' })).toBeNull();
  });
});

describe('shortcutFor: transport', () => {
  it('toggles on Space, by code or by key', () => {
    expect(press({ code: 'Space', key: ' ' })).toEqual({ type: 'toggle' });
    expect(press({ code: 'Space' })).toEqual({ type: 'toggle' });
    expect(press({ key: ' ' })).toEqual({ type: 'toggle' });
  });

  it('ignores a held Space so it cannot machine-gun play/pause', () => {
    expect(press({ code: 'Space', key: ' ', repeat: true })).toEqual({ type: 'ignore' });
  });

  it('mutes on M in either case, and ignores a held M', () => {
    expect(press({ key: 'm' })).toEqual({ type: 'mute' });
    expect(press({ key: 'M' })).toEqual({ type: 'mute' });
    expect(press({ key: 'm', repeat: true })).toEqual({ type: 'ignore' });
  });
});

describe('shortcutFor: seeking', () => {
  it('seeks back 5 seconds on ArrowLeft and forward 5 on ArrowRight', () => {
    expect(press({ key: 'ArrowLeft' })).toEqual({ type: 'seekBy', sec: -5 });
    expect(press({ key: 'ArrowRight' })).toEqual({ type: 'seekBy', sec: 5 });
  });

  it('keeps seeking while the key is held', () => {
    expect(press({ key: 'ArrowRight', repeat: true })).toEqual({ type: 'seekBy', sec: 5 });
  });
});

describe('shortcutFor: volume', () => {
  /** The clamped target volume the action carries, or null if it is not one. */
  function volumeOf(action: ShortcutAction | null): number | null {
    return action && action.type === 'volumeBy' ? action.volume : null;
  }

  it('steps up by 0.05 on ArrowUp and down by 0.05 on ArrowDown', () => {
    const up = press({ key: 'ArrowUp' }, { volume: 0.5 });
    expect(up).toMatchObject({ type: 'volumeBy', delta: 0.05 });
    expect(volumeOf(up)).toBeCloseTo(0.55, 5);

    const down = press({ key: 'ArrowDown' }, { volume: 0.5 });
    expect(down).toMatchObject({ type: 'volumeBy', delta: -0.05 });
    expect(volumeOf(down)).toBeCloseTo(0.45, 5);
  });

  it('clamps to the normal 0.85 ceiling', () => {
    expect(volumeOf(press({ key: 'ArrowUp' }, { volume: 0.83 }))).toBeCloseTo(0.85, 5);
  });

  it('clamps to 1 in party mode', () => {
    expect(volumeOf(press({ key: 'ArrowUp' }, { volume: 0.98, ceiling: 1 }))).toBeCloseTo(1, 5);
  });

  it('never goes below zero', () => {
    expect(volumeOf(press({ key: 'ArrowDown' }, { volume: 0.02 }))).toBeCloseTo(0, 5);
  });

  it('keeps stepping while the key is held', () => {
    expect(press({ key: 'ArrowUp', repeat: true })).toMatchObject({ type: 'volumeBy', delta: 0.05 });
  });
});
