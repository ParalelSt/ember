import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { UpdateReminder, resetUpdateReminderForTests } from './UpdateReminder';
import { REMINDER_WORDING } from './updateReminderLook';
import { resetUpdateForTests, setApplyDepsForTests, takeUpdateResume } from '@/lib/update/apply';
import { makeTrack } from '@/test-utils/fakeBackend';
import { QUIET_AFTER_PLAY_MS } from '@/lib/update/reminder';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { INITIAL_UPDATE_STATE, useUpdateStore } from '@/stores/useUpdateStore';

/** The banner at the top: "[0.7.44] New version ready [Update]", stays until
 *  tapped or closed; once per app start; a tap updates now, even while a song
 *  plays. */

type W = Window & { Capacitor?: unknown; __TAURI_INTERNALS__?: unknown };
const reload = vi.fn();
const SHOW_LONG_MS = 10 * 60 * 1000;
const click = (id: string) => fireEvent.click(screen.getByTestId(id));

function offer(version = '0.7.44', canApply = true) {
  act(() => useUpdateStore.getState().set({ status: 'available', offer: { kind: 'web', version, canApply, via: canApply ? 'reload' : 'desktop' } }));
}

beforeEach(() => {
  // The desktop app (detectShell: Tauri).
  (window as W).__TAURI_INTERNALS__ = { invoke: vi.fn(async () => null) };
  vi.useFakeTimers();
  resetUpdateForTests();
  resetUpdateReminderForTests();
  useUpdateStore.setState({ ...INITIAL_UPDATE_STATE });
  usePlayerStore.setState({ isPlaying: false });
  setApplyDepsForTests({ reload, installDesktop: async () => true });
  reload.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as W).Capacitor;
  delete (window as W).__TAURI_INTERNALS__;
});

describe('where the reminder runs', () => {
  it('never in a plain browser tab: a reload there is always the newest web', () => {
    delete (window as W).__TAURI_INTERNALS__;
    render(<UpdateReminder />);
    offer();
    expect(screen.queryByTestId('update-reminder')).toBeNull();
  });

  it('never in the iPhone app', () => {
    delete (window as W).__TAURI_INTERNALS__;
    (window as W).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
    render(<UpdateReminder />);
    offer();
    expect(screen.queryByTestId('update-reminder')).toBeNull();
  });

  it('in the Android app', () => {
    delete (window as W).__TAURI_INTERNALS__;
    (window as W).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} };
    render(<UpdateReminder />);
    offer();
    expect(screen.getByTestId('update-reminder')).toBeInTheDocument();
  });

  it('in the desktop app', () => {
    render(<UpdateReminder />);
    offer();
    expect(screen.getByTestId('update-reminder')).toBeInTheDocument();
  });
});

describe('UpdateReminder', () => {
  it('shows nothing while Ember is current', () => {
    render(<UpdateReminder />);
    expect(screen.queryByTestId('update-reminder')).toBeNull();
  });

  it('says the new version in the chip, "New version ready" and an Update button', () => {
    render(<UpdateReminder />);
    offer();
    const pill = screen.getByTestId('update-reminder');
    expect(screen.getByTestId('update-reminder-chip')).toHaveTextContent('0.7.44');
    expect(pill).toHaveTextContent(REMINDER_WORDING.ready);
    expect(screen.getByTestId('update-reminder-action')).toHaveTextContent(REMINDER_WORDING.action);
    // The version is in the chip only, not repeated in the words.
    expect(pill.textContent?.match(/0\.7\.44/g)).toHaveLength(1);
  });

  it('stays visible long past the old six seconds', () => {
    render(<UpdateReminder />);
    offer();
    act(() => vi.advanceTimersByTime(SHOW_LONG_MS));
    expect(screen.getByTestId('update-reminder')).toHaveAttribute('data-phase', 'in');
  });

  it('the close button ("Not now") puts it away', () => {
    render(<UpdateReminder />);
    offer();
    expect(screen.getByLabelText('Not now')).toBe(screen.getByTestId('update-reminder-close'));
    click('update-reminder-close');
    expect(screen.getByTestId('update-reminder')).toHaveAttribute('data-phase', 'out');
    act(() => vi.advanceTimersByTime(400));
    expect(screen.queryByTestId('update-reminder')).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    // Put away, it does not come back by itself within this app start.
    offer();
    expect(screen.queryByTestId('update-reminder')).toBeNull();
  });

  it('comes back at the next app start after being put away', () => {
    const first = render(<UpdateReminder />);
    offer();
    click('update-reminder-close');
    act(() => vi.advanceTimersByTime(400));
    first.unmount();
    // A new app start: the page's memory of what it showed is gone.
    resetUpdateReminderForTests();
    render(<UpdateReminder />);
    expect(screen.getByTestId('update-reminder')).toBeInTheDocument();
  });

  it('shows each version once per app start', () => {
    render(<UpdateReminder />);
    offer();
    click('update-reminder-close');
    act(() => vi.advanceTimersByTime(400));
    // The next check finds the same update: no second reminder.
    offer();
    expect(screen.queryByTestId('update-reminder')).toBeNull();
    offer('0.7.45');
    expect(screen.getByTestId('update-reminder-chip')).toHaveTextContent('0.7.45');
  });

  it('keeps away from a song that just started', () => {
    render(<UpdateReminder />);
    act(() => usePlayerStore.setState({ isPlaying: true }));
    offer();
    expect(screen.queryByTestId('update-reminder')).toBeNull();
    act(() => vi.advanceTimersByTime(QUIET_AFTER_PLAY_MS));
    expect(screen.getByTestId('update-reminder')).toBeInTheDocument();
  });

  it('a tap while a song plays updates now with the current song and position', () => {
    render(<UpdateReminder />);
    act(() => usePlayerStore.setState({ queue: [makeTrack({ id: 'a' }), makeTrack({ id: 'b' })], index: 1, position: 95, isPlaying: true }));
    offer();
    act(() => vi.advanceTimersByTime(QUIET_AFTER_PLAY_MS));
    click('update-reminder-action');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().pending).toBe(false);
    expect(takeUpdateResume([{ id: 'a' }, { id: 'b' }])).toEqual({ index: 1, trackId: 'b', positionSec: 95 });
  });

  it('a tap with nothing playing updates at once', () => {
    render(<UpdateReminder />);
    offer();
    click('update-reminder-action');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a tap while offline waits: "Updating once back online", no reload, still visible', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    try {
      render(<UpdateReminder />);
      offer();
      click('update-reminder-action');
      expect(useUpdateStore.getState().pending).toBe(true);
      expect(reload).not.toHaveBeenCalled();
      expect(screen.getByTestId('update-reminder')).toHaveTextContent(REMINDER_WORDING.waitingOnline);
      act(() => vi.advanceTimersByTime(SHOW_LONG_MS));
      expect(screen.getByTestId('update-reminder')).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    }
  });

  it('"Couldn\'t update" stays tappable to retry', async () => {
    const install = vi.fn(async () => false);
    setApplyDepsForTests({ reload, installDesktop: install });
    render(<UpdateReminder />);
    act(() => useUpdateStore.getState().set({ status: 'available', offer: { kind: 'shell', version: '0.4.30', canApply: true, via: 'desktop' } }));
    click('update-reminder-action');
    await act(async () => {});
    expect(screen.getByTestId('update-reminder')).toHaveTextContent(REMINDER_WORDING.failed);
    expect(screen.getByTestId('update-reminder-action')).toHaveTextContent(REMINDER_WORDING.retry);
    click('update-reminder-action');
    await act(async () => {});
    expect(install).toHaveBeenCalledTimes(2);
  });

  it('a desktop app that cannot restart itself is told to quit and reopen', () => {
    render(<UpdateReminder />);
    offer('0.4.27', false);
    expect(screen.getByTestId('update-reminder')).toHaveTextContent(REMINDER_WORDING.reopen);
    expect(screen.queryByTestId('update-reminder-action')).toHaveTextContent(REMINDER_WORDING.reopen);
    click('update-reminder-action');
    expect(reload).not.toHaveBeenCalled();
  });

  it('checks the host by itself a little after the app starts', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ version: '0.0.1' }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    try {
      render(<UpdateReminder />);
      expect(f).not.toHaveBeenCalled();
      // 15 s, then the app's own version (asked of the shell, within 1.5 s).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(17_000);
      });
      expect(f).toHaveBeenCalledWith('/api/version', expect.objectContaining({ cache: 'no-store' }));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
