import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminPranksPage from './page';
import { untilDate } from '@/components/admin/pranks/Composer';
import type { PrankLogEntry, PrankPerson, PrankSchedule, PrankSound } from '@/lib/pranks/types';

const state = vi.hoisted(() => ({
  send: vi.fn(),
  repeat: vi.fn(),
  stopRepeat: vi.fn(),
  stopAll: vi.fn(),
  setEnabled: vi.fn(),
  upload: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  enabled: true,
  schedules: [] as PrankSchedule[],
}));

const library: PrankSound[] = [
  { id: 's1', kind: 'sound', name: 'Duck quack', durationSec: 2, sizeBytes: 1, mime: 'audio/mpeg', created: '', url: '/api/pranks/media/s1' },
  { id: 's3', kind: 'sound', name: 'Air horn', durationSec: 4, sizeBytes: 1, mime: 'audio/mpeg', created: '', url: '/api/pranks/media/s3' },
  { id: 's2', kind: 'song', name: 'Leftover long file', durationSec: 200, sizeBytes: 1, mime: 'audio/mpeg', created: '', url: '/y' },
];

const people: PrankPerson[] = [
  { id: 'u1', name: 'Marko', avatarUrl: null, isAdmin: false, listening: true, hourCount: 3,
    line: 'Playing “Song X” by Band Y, 1:23 of 3:45, on Android' },
  { id: 'u2', name: 'Ivana', avatarUrl: null, isAdmin: false, listening: false, hourCount: 18, line: 'Not listening' },
];
const log: PrankLogEntry[] = [
  { id: 'p1', kind: 'sound', status: 'done', reason: '', engine: 'web', targetId: 'u1', targetName: 'Marko',
    issuerName: 'Aron', created: '2026-09-23 20:03:00.000Z', deliveredAt: null, doneAt: null, playedSec: 2, fromRepeat: false,
    line: 'Aron played a sound for Marko: done after 2 s' },
  { id: 'p2', kind: 'sound', status: 'skipped', reason: 'not-playing', engine: '', targetId: 'u2', targetName: 'Ivana',
    issuerName: 'Aron', created: '2026-09-23 20:04:00.000Z', deliveredAt: null, doneAt: null, playedSec: null, fromRepeat: true,
    line: 'Aron played a sound for Ivana: not played: nothing was playing' },
];
const repeatOnMarko: PrankSchedule = {
  id: 'sc1', targetId: 'u1', targetName: 'Marko', soundName: 'Duck quack', intervalSec: 120, mode: 'duck',
  endsAt: '2026-09-23 21:30:00.000Z', nextFireAt: '2026-09-23 20:10:00.000Z', fired: 4,
  line: '“Duck quack” for Marko, every 2 min',
};

vi.mock('@/hooks/useAdmin', () => ({
  useQueryPrankPeople: () => ({ data: people, isLoading: false }),
  useQueryPrankLog: () => ({ data: { pranks: log, enabled: state.enabled }, isLoading: false }),
  useQueryPrankSettings: () => ({ data: { enabled: state.enabled, forcedOff: false } }),
  useQueryPrankSounds: () => ({ data: library, isLoading: false }),
  useQueryPrankSchedules: () => ({ data: state.schedules }),
  useExecuteSendPrank: () => ({ mutate: state.send, isPending: false }),
  useExecuteRepeatPrank: () => ({ mutate: state.repeat, isPending: false }),
  useExecuteStopRepeat: () => ({ mutate: state.stopRepeat, isPending: false }),
  useExecuteStopAllPranks: () => ({ mutate: state.stopAll, isPending: false }),
  useExecuteSetPranksEnabled: () => ({ mutate: state.setEnabled, isPending: false }),
  useExecuteUploadPrankSound: () => ({ mutate: state.upload, isPending: false }),
  useExecuteRenamePrankSound: () => ({ mutate: state.rename, isPending: false }),
  useExecuteDeletePrankSound: () => ({ mutate: state.remove, isPending: false }),
}));

beforeEach(() => {
  for (const f of [state.send, state.repeat, state.stopRepeat, state.stopAll, state.setEnabled, state.upload, state.rename, state.remove]) {
    f.mockReset();
  }
  state.enabled = true;
  state.schedules = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

const pick = (name: string) => fireEvent.click(screen.getByRole('button', { name: `Pick ${name}` }));
const composer = () => screen.getByTestId('prank-composer');
const sendButton = () => within(composer()).getByRole('button', { name: /^(Send|Repeat .*)$/ });

describe('AdminPranksPage (Control room)', () => {
  it('shows people and the log in words, never an id, and no swap anywhere', () => {
    const { container } = render(<AdminPranksPage />);
    expect(screen.getByText('Playing “Song X” by Band Y, 1:23 of 3:45, on Android')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Prank log' });
    expect(table.textContent).toContain('Aron played a sound for Marko: done after 2 s');
    expect(table.textContent).toContain('nothing was playing (repeat)');
    expect(container.textContent).not.toMatch(/\bu1\b|\bp1\b|\bs1\b/);
    expect(container.textContent).not.toMatch(/swap/i);
    expect(screen.queryByText(/Temporary page/)).toBeNull();
  });

  it('the composer fills in when a person is picked, with their limit line', () => {
    render(<AdminPranksPage />);
    expect(within(composer()).getByText('Pick a person to send a sound')).toBeInTheDocument();
    expect(screen.queryByTestId('prank-limit')).toBeNull();
    pick('Marko');
    expect(within(composer()).getByText('Send a sound to Marko')).toBeInTheDocument();
    expect(within(composer()).getByText('Playing “Song X” by Band Y, 1:23 of 3:45, on Android')).toBeInTheDocument();
    expect(screen.getByTestId('prank-limit').textContent).toBe('3 of 20 this hour for Marko · 15 s between sounds');
    pick('Ivana');
    expect(screen.getByTestId('prank-limit').textContent).toMatch(/^18 of 20 this hour for Ivana/);
  });

  it('offers only sounds, and Send waits for a person and a sound', () => {
    render(<AdminPranksPage />);
    const options = within(screen.getByRole('radiogroup', { name: 'Sound' })).getAllByRole('radio');
    expect(options.map((o) => o.textContent)).toEqual(['Duck quack0:02', 'Air horn0:04']);
    expect(sendButton()).toBeDisabled();
    pick('Marko');
    expect(sendButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Duck quack/ }));
    expect(sendButton()).toBeEnabled();
  });

  it('sends a sound with the music turned down by default, or over it', () => {
    render(<AdminPranksPage />);
    pick('Marko');
    fireEvent.click(screen.getByRole('radio', { name: /Duck quack/ }));
    fireEvent.click(sendButton());
    expect(state.send).toHaveBeenCalledWith(
      { targetId: 'u1', kind: 'sound', soundId: 's1', params: { mode: 'duck' } },
      expect.any(Object),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Over their music' }));
    fireEvent.click(sendButton());
    expect(state.send).toHaveBeenLastCalledWith(
      { targetId: 'u1', kind: 'sound', soundId: 's1', params: { mode: 'over' } },
      expect.any(Object),
    );
  });

  it('starts a repeat every N minutes until a stop time', () => {
    render(<AdminPranksPage />);
    pick('Marko');
    fireEvent.click(screen.getByRole('radio', { name: /Air horn/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Repeat until a stop time' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Every how many minutes' }), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Stop time'), { target: { value: '23:59' } });
    expect(sendButton()).toHaveTextContent('Repeat every minute');
    fireEvent.click(sendButton());
    expect(state.send).not.toHaveBeenCalled();
    const [body] = state.repeat.mock.calls[0];
    expect(body).toMatchObject({ targetId: 'u1', soundId: 's3', intervalSec: 60, params: { mode: 'duck' } });
    const ends = new Date(body.endsAt);
    expect([ends.getHours(), ends.getMinutes()]).toEqual([23, 59]);
    expect(ends.getTime()).toBeGreaterThan(Date.now());
  });

  it('will not repeat with a bad interval', () => {
    render(<AdminPranksPage />);
    pick('Marko');
    fireEvent.click(screen.getByRole('radio', { name: /Air horn/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Repeat until a stop time' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Every how many minutes' }), { target: { value: '0' } });
    expect(sendButton()).toBeDisabled();
  });

  it('lists running repeats with Stop, and the composer Stop ends the picked person\'s', () => {
    state.schedules = [repeatOnMarko];
    render(<AdminPranksPage />);
    const list = screen.getByRole('list', { name: 'Repeats running' });
    expect(list.textContent).toContain('“Duck quack” for Marko, every 2 min until');
    expect(list.textContent).toContain('Played 4 times so far');
    fireEvent.click(within(list).getByRole('button', { name: /^Stop / }));
    expect(state.stopRepeat).toHaveBeenCalledWith('sc1', expect.any(Object));

    pick('Ivana');
    expect(within(composer()).getByRole('button', { name: 'Stop' })).toBeDisabled();
    pick('Marko');
    expect(within(composer()).getByText('1 repeat running on Marko')).toBeInTheDocument();
    fireEvent.click(within(composer()).getByRole('button', { name: 'Stop' }));
    expect(state.stopRepeat).toHaveBeenLastCalledWith('sc1', expect.any(Object));
  });

  it('Stop everything calls the route', () => {
    render(<AdminPranksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop everything' }));
    expect(state.stopAll).toHaveBeenCalledTimes(1);
  });

  it('flips the global switch; while off nothing can be sent', () => {
    render(<AdminPranksPage />);
    const sw = screen.getByRole('switch', { name: 'Pranks on or off' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    expect(state.setEnabled).toHaveBeenCalledWith(false, expect.any(Object));
  });

  it('with the switch off the composer says so and stays disabled', () => {
    state.enabled = false;
    render(<AdminPranksPage />);
    expect(screen.getByRole('switch', { name: 'Pranks on or off' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Nobody can be pranked right now.')).toBeInTheDocument();
    pick('Marko');
    expect(within(composer()).getByText('Pranks are off, so nothing can be sent.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Duck quack/ })).toBeDisabled();
    expect(sendButton()).toBeDisabled();
  });
});

describe('the sound library', () => {
  it('uploads a sound with its name, and clears the form once it lands', async () => {
    state.upload.mockImplementation((_input, opts) => opts.onSuccess({ sound: { name: 'Cow' } }));
    const { container } = render(<AdminPranksPage />);
    const file = new File(['x'], 'moo.mp3', { type: 'audio/mpeg' });
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(screen.getByPlaceholderText('Name (optional)'), { target: { value: 'Cow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(state.upload).toHaveBeenCalledWith({ file, kind: 'sound', name: 'Cow' }, expect.any(Object));
    await waitFor(() => expect(screen.getByPlaceholderText('Name (optional)')).toHaveValue(''));
  });

  it('lists sounds only, renames and deletes', () => {
    render(<AdminPranksPage />);
    const list = screen.getByRole('list', { name: 'Library' });
    expect(list.textContent).toContain('Duck quack');
    expect(list.textContent).not.toContain('Leftover long file');
    fireEvent.click(screen.getByRole('button', { name: 'Rename Duck quack' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New name' }), { target: { value: 'Big quack' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(state.rename).toHaveBeenCalledWith({ id: 's1', name: 'Big quack' }, expect.any(Object));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Air horn' }));
    expect(state.remove).toHaveBeenCalledWith('s3', expect.any(Object));
  });

  it('previews a sound here and stops it again', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    render(<AdminPranksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview Duck quack' }));
    expect(play).toHaveBeenCalledTimes(1);
    const stop = await screen.findByRole('button', { name: 'Stop Duck quack' });
    fireEvent.click(stop);
    expect(pause).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Preview Duck quack' })).toBeInTheDocument();
  });
});

describe('untilDate', () => {
  const now = new Date(2026, 8, 23, 20, 0, 0);
  it('is today when the time is still ahead, tomorrow once it has passed', () => {
    expect(untilDate('21:30', now)).toEqual(new Date(2026, 8, 23, 21, 30, 0));
    expect(untilDate('19:00', now)).toEqual(new Date(2026, 8, 24, 19, 0, 0));
  });
  it('refuses anything that is not a time', () => {
    expect(untilDate('25:00', now)).toBeNull();
    expect(untilDate('soon', now)).toBeNull();
  });
});
