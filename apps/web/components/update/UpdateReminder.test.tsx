import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { UpdateReminder, resetUpdateReminderForTests } from './UpdateReminder';
import { REMINDER_WORDING } from './updateReminderLook';
import { resetUpdateForTests, setApplyDepsForTests } from '@/lib/update/apply';
import { QUIET_AFTER_PLAY_MS, SHOW_MS } from '@/lib/update/reminder';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { INITIAL_UPDATE_STATE, useUpdateStore } from '@/stores/useUpdateStore';

/** The reminder at the top: "[0.7.44] New version", a few seconds, then
 *  gone; once per app start; a tap waits for the song to end. */

type W = Window & { Capacitor?: unknown };
const reload = vi.fn();

function offer(version = '0.7.44', canApply = true) {
  act(() => useUpdateStore.getState().set({ status: 'available', offer: { kind: 'web', version, canApply, via: canApply ? 'reload' : 'restart' } }));
}

beforeEach(() => {
  vi.useFakeTimers();
  resetUpdateForTests();
  resetUpdateReminderForTests();
  useUpdateStore.setState({ ...INITIAL_UPDATE_STATE });
  usePlayerStore.setState({ isPlaying: false });
  setApplyDepsForTests({ reload, restartShell: async () => true });
  reload.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as W).Capacitor;
});

describe('UpdateReminder', () => {
  it('shows nothing while Ember is current', () => {
    render(<UpdateReminder />);
    expect(screen.queryByTestId('update-reminder')).toBeNull();
  });

  it('says the new version in the chip and "New version", then goes by itself', () => {
    render(<UpdateReminder />);
    offer();
    const pill = screen.getByTestId('update-reminder');
    expect(screen.getByTestId('update-reminder-chip')).toHaveTextContent('0.7.44');
    expect(pill).toHaveTextContent(REMINDER_WORDING.ready);
    // The version is in the chip only, not repeated in the words.
    expect(pill.textContent?.match(/0\.7\.44/g)).toHaveLength(1);
    act(() => vi.advanceTimersByTime(SHOW_MS));
    expect(screen.getByTestId('update-reminder')).toHaveAttribute('data-phase', 'out');
    act(() => vi.advanceTimersByTime(400));
    expect(screen.queryByTestId('update-reminder')).toBeNull();
  });

  it('shows each version once per app start', () => {
    render(<UpdateReminder />);
    offer();
    act(() => vi.advanceTimersByTime(SHOW_MS + 400));
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

  it('a tap while a song plays waits for it: "Updating after this song", no reload', () => {
    render(<UpdateReminder />);
    offer();
    act(() => usePlayerStore.setState({ isPlaying: true }));
    fireEvent.click(screen.getByTestId('update-reminder'));
    expect(screen.getByTestId('update-reminder')).toHaveTextContent(REMINDER_WORDING.waiting);
    expect(useUpdateStore.getState().pending).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a tap with nothing playing updates at once', () => {
    render(<UpdateReminder />);
    offer();
    fireEvent.click(screen.getByTestId('update-reminder'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a desktop app that cannot restart itself is told to quit and reopen', () => {
    render(<UpdateReminder />);
    offer('0.4.27', false);
    expect(screen.getByTestId('update-reminder')).toHaveTextContent(REMINDER_WORDING.reopen);
    fireEvent.click(screen.getByTestId('update-reminder'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('checks the host by itself a little after the app starts', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ version: '0.0.1' }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    try {
      render(<UpdateReminder />);
      expect(f).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
      expect(f).toHaveBeenCalledWith('/api/version', expect.objectContaining({ cache: 'no-store' }));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
