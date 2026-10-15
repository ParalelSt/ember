import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { toSummary } from '@/lib/collections';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const state = vi.hoisted(() => ({ desktop: true, online: true }));

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => state.desktop }));
vi.mock('@/lib/useOnline', () => ({ useOnline: () => state.online }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/stores/useOfflineStore', () => ({
  useOfflineStore: (sel: (s: { pins: unknown[] }) => unknown) => sel({ pins: [] }),
}));
vi.mock('@/hooks/useCollections', () => ({
  useCollections: () => ({
    system: [toSummary({ kind: 'liked' }, { count: 3 }), toSummary({ kind: 'recent' }, { count: 1 }), toSummary({ kind: 'uploads' })],
    playlists: [toSummary({ kind: 'playlist', id: 'p1' }, { name: 'Road Trip', trackCount: 9 })],
  }),
}));
// The desktop header's own buttons are covered by their tests; here they
// only have to be there.
vi.mock('@/components/session/CarlistButton', () => ({
  CarlistButton: () => <button data-testid="carlist-entry" aria-label="Carlist" />,
}));
vi.mock('@/components/track/menus/UploadTrackDialog', () => ({ UploadTrackDialog: () => null }));
vi.mock('@/components/library/PhoneLibrary', () => ({ PhoneLibrary: () => <div data-testid="phone-library" /> }));

const { default: LibraryPage } = await import('./page');

beforeEach(() => {
  state.desktop = true;
  state.online = true;
});

describe('Library page', () => {
  it('md and up keeps the desktop shelves exactly: title, carlist and upload buttons, Your collections, Playlists', () => {
    render(<LibraryPage />);
    expect(screen.getByRole('heading', { name: 'Your library' })).toBeInTheDocument();
    expect(screen.getByTestId('carlist-entry')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload songs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your collections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Playlists' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Road Trip/ })).toHaveAttribute('href', '/playlist/p1');
    // The desktop card keeps its old words, not the phone row's.
    expect(screen.getByRole('link', { name: /Road Trip/ })).toHaveTextContent('Playlist');
    expect(screen.getByRole('link', { name: /Road Trip/ })).not.toHaveTextContent('9 songs');
    expect(screen.queryByTestId('phone-library')).toBeNull();
  });

  it('a phone gets the new Library instead', () => {
    state.desktop = false;
    render(<LibraryPage />);
    expect(screen.getByTestId('phone-library')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your collections' })).toBeNull();
  });

  it('offline keeps the Downloaded shelf on either size', () => {
    state.online = false;
    state.desktop = false;
    render(<LibraryPage />);
    expect(screen.getByRole('heading', { name: 'Downloaded' })).toBeInTheDocument();
    expect(screen.queryByTestId('phone-library')).toBeNull();
  });
});
