import { describe, expect, it, vi } from 'vitest';
import { createUnplayableNotifier, REPEAT_QUIET_MS } from './unplayableNotifier';
import type { UnplayableNotice } from './unplayable';

const n = (id: string, over: Partial<UnplayableNotice> = {}): UnplayableNotice => ({
  trackId: id, title: id.toUpperCase(), kind: 'unavailable', reason: 'removed', outcome: 'skipped', ...over,
});

function setup() {
  let hidden = false;
  let visible: (() => void) | null = null;
  let t = 1_000;
  const show = vi.fn();
  const notifier = createUnplayableNotifier({
    show,
    isHidden: () => hidden,
    onVisible: (fn) => { visible = fn; return () => { visible = null; }; },
    now: () => t,
  });
  return {
    notifier, show,
    hide: () => { hidden = true; },
    comeBack: () => { hidden = false; visible?.(); },
    advance: (ms: number) => { t += ms; },
  };
}

describe('unplayable notifier', () => {
  it('on screen, a skip is shown at once, as info', () => {
    const s = setup();
    s.notifier.report([n('a')]);
    expect(s.show).toHaveBeenCalledWith('Couldn\'t play "A": removed from YouTube. Skipped to the next song.', 'info');
  });

  it('a stop is shown as an error', () => {
    const s = setup();
    s.notifier.report([n('a', { outcome: 'stopped' })]);
    expect(s.show).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('in the background nothing is shown; coming back shows ONE summary', () => {
    const s = setup();
    s.hide();
    s.notifier.report([n('a')]);
    s.notifier.report([n('b')]);
    s.notifier.report([n('c', { outcome: 'gave-up' })]);
    expect(s.show).not.toHaveBeenCalled();
    s.comeBack();
    expect(s.show).toHaveBeenCalledTimes(1);
    expect(s.show).toHaveBeenCalledWith('Couldn\'t play 3 songs ("A", "B" and 1 more): they\'re not available on YouTube. Playback stopped.', 'error');
    s.comeBack();
    expect(s.show).toHaveBeenCalledTimes(1);
  });

  it('a batch handed over on return (the Android player\'s) is one message', () => {
    const s = setup();
    s.notifier.report([n('a'), n('b')]);
    expect(s.show).toHaveBeenCalledTimes(1);
    expect(s.show.mock.calls[0][0]).toMatch(/^Couldn't play 2 songs/);
  });

  it('the same song is not announced twice in a row (a loop-all lap)', () => {
    const s = setup();
    s.notifier.report([n('a')]);
    s.notifier.report([n('a')]);
    expect(s.show).toHaveBeenCalledTimes(1);
    s.advance(REPEAT_QUIET_MS + 1);
    s.notifier.report([n('a')]);
    expect(s.show).toHaveBeenCalledTimes(2);
  });

  it('anything that stopped the music always gets through (play pressed again)', () => {
    const s = setup();
    s.notifier.report([n('a', { outcome: 'gave-up' })]);
    s.notifier.report([n('a', { outcome: 'gave-up' })]);
    s.notifier.report([n('b', { kind: 'transient', outcome: 'stopped' })]);
    s.notifier.report([n('b', { kind: 'transient', outcome: 'stopped' })]);
    expect(s.show).toHaveBeenCalledTimes(4);
  });

  it('a song only flagged ahead of time says nothing', () => {
    const s = setup();
    s.notifier.report([n('a', { outcome: 'flagged' })]);
    expect(s.show).not.toHaveBeenCalled();
  });
});
