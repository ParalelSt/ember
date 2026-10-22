import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Track } from '@/types/track';

const blocking = vi.hoisted(() => ({ blocked: [] as Track[], unblock: vi.fn(async () => {}) }));
vi.mock('@/hooks/useBlockedTracks', () => ({
  useBlockedTracks: () => ({ blocked: blocking.blocked, unblock: blocking.unblock }),
}));

const { default: SettingsLibrary } = await import('./page');

// next/link reads the app router context, which no test renders.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// The Transfer entry point in Settings > Library: a row that opens the same
// Transfer page the Liked songs page opens. The page itself is covered by
// components/import/TransferFlow.test.tsx.

describe('Settings > Library', () => {
  it('has a Transfer from another app row explaining what it does', () => {
    render(<SettingsLibrary />);
    expect(screen.getByText('Transfer from another app')).toBeInTheDocument();
    expect(screen.getByText(/become your likes, or a new playlist/)).toBeInTheDocument();
  });

  it('the row opens the Transfer page, and Back returns here', () => {
    render(<SettingsLibrary />);
    const link = screen.getByTestId('settings-transfer-button');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', `/transfer?from=${encodeURIComponent('/settings/library')}`);
  });
});

describe('Settings > Library: blocked songs (owner request 2026-10-22)', () => {
  it('says there are none', () => {
    blocking.blocked = [];
    render(<SettingsLibrary />);
    expect(within(screen.getByTestId('blocked-songs')).getByText('No blocked songs.')).toBeInTheDocument();
  });

  it('lists each blocked song with an Unblock button that unblocks it', () => {
    const song = { id: 'youtube:a', title: 'Bad Song', artist: 'Someone', artworkUrl: null } as Track;
    blocking.blocked = [song];
    render(<SettingsLibrary />);
    const list = screen.getByTestId('blocked-songs');
    expect(within(list).getByText('Bad Song')).toBeInTheDocument();
    expect(within(list).getByText('Someone')).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Unblock Bad Song' }));
    expect(blocking.unblock).toHaveBeenCalledWith(song);
  });
});
