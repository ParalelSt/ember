import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useUiStore } from '@/stores/useUiStore';

vi.mock('@/components/RequestDialog', () => ({ RequestDialog: () => null }));
vi.mock('@/hooks/useBlockedTracks', () => ({ useBlockedTracks: () => ({ blocked: [], unblock: vi.fn() }) }));
import { HelpSection } from './RowSections';
import SettingsHelp from '@/app/(app)/settings/help/page';

beforeEach(() => useUiStore.setState({ introOpen: false }));

it('desktop Help has a Tour the new design row that reopens the intro', () => {
  render(<HelpSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Tour the new design' }));
  expect(useUiStore.getState().introOpen).toBe(true);
});

it('phone Help page has a Tour the new design button that reopens the intro', () => {
  render(<SettingsHelp />);
  fireEvent.click(screen.getByRole('button', { name: 'Tour the new design' }));
  expect(useUiStore.getState().introOpen).toBe(true);
});
