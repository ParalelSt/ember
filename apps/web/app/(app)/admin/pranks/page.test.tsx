import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AdminPranksPage from './page';
import type { PrankLogEntry, PrankPerson, PrankSound } from '@/lib/pranks/types';

const state = vi.hoisted(() => ({
  send: vi.fn(),
  setEnabled: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  enabled: true,
}));

const library: PrankSound[] = [
  { id: 's1', kind: 'sound', name: 'Duck quack', durationSec: 2, sizeBytes: 1, mime: 'audio/mpeg', created: '', url: '/x' },
  { id: 's2', kind: 'song', name: 'Wrong song', durationSec: 200, sizeBytes: 1, mime: 'audio/mpeg', created: '', url: '/y' },
];

const people: PrankPerson[] = [
  { id: 'u1', name: 'Marko', avatarUrl: null, isAdmin: false, listening: true,
    line: 'Playing “Song X” by Band Y, 1:23 of 3:45, on Android' },
  { id: 'u2', name: 'Ivana', avatarUrl: null, isAdmin: false, listening: false, line: 'Not listening' },
];
const log: PrankLogEntry[] = [
  { id: 'p1', kind: 'ping', status: 'delivered', reason: '', engine: 'web', targetId: 'u1', targetName: 'Marko',
    issuerName: 'Aron', created: '2026-09-23 20:03:00.000Z', deliveredAt: null, doneAt: null, playedSec: null,
    line: 'Aron pinged Marko: delivered in the browser' },
];

vi.mock('@/hooks/useAdmin', () => ({
  useQueryPrankPeople: () => ({ data: people, isLoading: false }),
  useQueryPrankLog: () => ({ data: { pranks: log, enabled: state.enabled }, isLoading: false }),
  useQueryPrankSettings: () => ({ data: { enabled: state.enabled, forcedOff: false } }),
  useExecuteSendPrank: () => ({ mutate: state.send, isPending: false }),
  useExecuteSetPranksEnabled: () => ({ mutate: state.setEnabled, isPending: false }),
  useQueryPrankSounds: () => ({ data: library, isLoading: false }),
  useExecuteUploadPrankSound: () => ({ mutate: state.upload, isPending: false }),
  useExecuteDeletePrankSound: () => ({ mutate: state.remove, isPending: false }),
}));

beforeEach(() => {
  state.send.mockReset();
  state.setEnabled.mockReset();
  state.upload.mockReset();
  state.remove.mockReset();
  state.enabled = true;
});

describe('AdminPranksPage (temporary)', () => {
  it('says it is temporary', () => {
    render(<AdminPranksPage />);
    expect(screen.getByText(/Temporary page/)).toBeInTheDocument();
  });

  it('shows each person in words and never an id', () => {
    const { container } = render(<AdminPranksPage />);
    expect(screen.getByText('Playing “Song X” by Band Y, 1:23 of 3:45, on Android')).toBeInTheDocument();
    expect(screen.getByText('Aron pinged Marko: delivered in the browser')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bu1\b|\bp1\b/);
  });

  it('pings the picked person', () => {
    render(<AdminPranksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Ping Ivana' }));
    expect(state.send).toHaveBeenCalledWith({ targetId: 'u2', kind: 'ping' }, expect.any(Object));
  });

  it('plays a picked sound for a person, ducking by default; only sounds are offered', () => {
    render(<AdminPranksPage />);
    const sound = screen.getByRole('button', { name: 'Play the sound for Marko' });
    expect(sound).toBeDisabled();
    const picker = screen.getByRole('combobox', { name: 'Sound to play' });
    expect([...picker.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Pick a sound', 'Duck quack']);
    fireEvent.change(picker, { target: { value: 's1' } });
    fireEvent.click(sound);
    expect(state.send).toHaveBeenCalledWith(
      { targetId: 'u1', kind: 'sound', soundId: 's1', params: { mode: 'duck' } },
      expect.any(Object),
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Play the sound for Ivana' }));
    expect(state.send).toHaveBeenLastCalledWith(
      { targetId: 'u2', kind: 'sound', soundId: 's1', params: { mode: 'over' } },
      expect.any(Object),
    );
  });

  it('lists the library in words and deletes from it', () => {
    render(<AdminPranksPage />);
    const list = screen.getByRole('list', { name: 'Library' });
    expect(list.textContent).toContain('Duck quack');
    expect(list.textContent).toContain('Song, 3:20');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Wrong song' }));
    expect(state.remove).toHaveBeenCalledWith('s2', expect.any(Object));
  });

  it('uploads the chosen file with its kind and name', () => {
    const { container } = render(<AdminPranksPage />);
    const file = new File(['x'], 'moo.mp3', { type: 'audio/mpeg' });
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(screen.getByPlaceholderText('Name (optional)'), { target: { value: 'Cow' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind' }), { target: { value: 'song' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(state.upload).toHaveBeenCalledWith({ file, kind: 'song', name: 'Cow' }, expect.any(Object));
  });

  it('flips the global switch, and disables Ping while off', () => {
    render(<AdminPranksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Pranks are on' }));
    expect(state.setEnabled).toHaveBeenCalledWith(false, expect.any(Object));

    state.enabled = false;
    render(<AdminPranksPage />);
    expect(screen.getAllByRole('button', { name: 'Ping Marko' }).at(-1)).toBeDisabled();
  });
});
