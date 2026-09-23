import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AdminPranksPage from './page';
import type { PrankLogEntry, PrankPerson } from '@/lib/pranks/types';

const state = vi.hoisted(() => ({
  send: vi.fn(),
  setEnabled: vi.fn(),
  enabled: true,
}));

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
}));

beforeEach(() => {
  state.send.mockReset();
  state.setEnabled.mockReset();
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
    expect(state.send).toHaveBeenCalledWith('u2', expect.any(Object));
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
