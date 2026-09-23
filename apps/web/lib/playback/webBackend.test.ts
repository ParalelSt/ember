import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebBackend } from './webBackend';
import { makeFakeEvents } from '@/test-utils/fakeBackend';

vi.mock('@/lib/logger/client', () => ({
  logger: { breadcrumb: vi.fn(), error: vi.fn() },
}));

/** Make the element's play() reject the way a browser does. */
function rejectPlayWith(name: string) {
  return vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockImplementation(() => Promise.reject(new DOMException('play() failed', name)));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('webBackend load(autoplay)', () => {
  it('does not report a pause when play() was aborted by a newer load', async () => {
    // A newer src replacing a pending play() rejects it with AbortError. That
    // is a load being superseded, not the listener pausing.
    rejectPlayWith('AbortError');
    const events = makeFakeEvents();
    const b = createWebBackend(events);
    b.load('/s/a', { autoplay: true });
    await vi.waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();
    expect(events.onPause).not.toHaveBeenCalled();
    b.destroy();
  });

  it('still reports a pause when the browser refuses to autoplay', async () => {
    rejectPlayWith('NotAllowedError');
    const events = makeFakeEvents();
    const b = createWebBackend(events);
    b.load('/s/a', { autoplay: true });
    await vi.waitFor(() => expect(events.onPause).toHaveBeenCalledTimes(1));
    b.destroy();
  });
});

describe('webBackend seek', () => {
  it('seeks to the asked time while the element does not know the length yet', () => {
    // Right after a load the element's duration is NaN. Clamping to it sent
    // every early seek (the bar knows the length from the catalogue) to 0:00.
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(NaN);
    const events = makeFakeEvents();
    const b = createWebBackend(events);
    b.seek(90);
    expect(events.onTime).toHaveBeenLastCalledWith(90);
    b.destroy();
  });

  it('still clamps to a known length', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(200);
    const events = makeFakeEvents();
    const b = createWebBackend(events);
    b.seek(500);
    expect(events.onTime).toHaveBeenLastCalledWith(200);
    b.seek(-3);
    expect(events.onTime).toHaveBeenLastCalledWith(0);
    b.destroy();
  });
});
