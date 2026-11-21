import { Suspense, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InvitePreview } from '@/lib/collab';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const api = vi.hoisted(() => ({ joinPlaylist: vi.fn(), previewPlaylistInvite: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const { default: JoinPlaylistPage } = await import('./page');

const CODE = 'c'.repeat(32);
const card = (patch: Partial<InvitePreview> = {}): InvitePreview => ({
  name: 'Road trip',
  artworkUrl: null,
  owner: { name: 'Olga', avatarUrl: null },
  people: [{ name: 'Olga', avatarUrl: null }, { name: 'Marko', avatarUrl: null }],
  peopleCount: 2,
  songCount: 6,
  songs: [
    { title: 'Motion Sickness', artist: 'Phoebe Bridgers', artworkUrl: null },
    { title: 'Dreams', artist: 'Fleetwood Mac', artworkUrl: null },
    { title: 'Slow Burn', artist: 'Kacey Musgraves', artworkUrl: null },
  ],
  alreadyIn: false,
  ...patch,
});

async function open(code: string) {
  const client = new QueryClient();
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback={null}>
          <JoinPlaylistPage params={Promise.resolve({ code })} />
        </Suspense>
      </QueryClientProvider>,
    );
  });
}

beforeEach(() => vi.clearAllMocks());

describe('/playlist/join/[code]', () => {
  it('shows the preview card first and joins nobody', async () => {
    api.previewPlaylistInvite.mockResolvedValue(card());
    await open(CODE);
    const preview = await screen.findByTestId('invite-preview');
    expect(api.previewPlaylistInvite).toHaveBeenCalledWith(CODE);
    expect(preview).toHaveTextContent('Olga invited you to edit');
    expect(screen.getByRole('heading', { name: 'Road trip' })).toBeInTheDocument();
    expect(preview).toHaveTextContent('6 songs · Olga and Marko');
    expect(screen.getAllByTestId('invite-song').map((r) => r.textContent)).toEqual([
      'Motion SicknessPhoebe Bridgers',
      'DreamsFleetwood Mac',
      'Slow BurnKacey Musgraves',
    ]);
    expect(preview).toHaveTextContent('and 3 more');
    expect(preview).toHaveTextContent('You can add, remove and reorder songs. You can leave any time.');
    expect(api.joinPlaylist).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('Join adds you and opens the playlist', async () => {
    api.previewPlaylistInvite.mockResolvedValue(card());
    api.joinPlaylist.mockResolvedValue({ playlistId: 'pl1', joined: true });
    await open(CODE);
    fireEvent.click(await screen.findByRole('button', { name: 'Join' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/playlist/pl1'));
    expect(api.joinPlaylist).toHaveBeenCalledTimes(1);
    expect(api.joinPlaylist).toHaveBeenCalledWith(CODE);
    expect(toast.success).toHaveBeenCalledWith('You can edit this playlist now');
  });

  it('Not now leaves without joining; the link still works', async () => {
    api.previewPlaylistInvite.mockResolvedValue(card());
    await open(CODE);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(api.joinPlaylist).not.toHaveBeenCalled();
    expect(toast.message).toHaveBeenCalledWith('Not joined. The link still works if you change your mind.');
    expect(nav.replace).toHaveBeenCalledWith('/library');
  });

  it('a failed join says why and keeps the card', async () => {
    api.previewPlaylistInvite.mockResolvedValue(card());
    api.joinPlaylist.mockRejectedValue(new Error('This playlist is already shared with 50 people'));
    await open(CODE);
    fireEvent.click(await screen.findByRole('button', { name: 'Join' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This playlist is already shared with 50 people'));
    expect(screen.getByTestId('invite-preview')).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('a short playlist has no "more" line, and one person reads as just the owner', async () => {
    api.previewPlaylistInvite.mockResolvedValue(
      card({ people: [{ name: 'Olga', avatarUrl: null }], peopleCount: 1, songCount: 1, songs: [card().songs[0]] }),
    );
    await open(CODE);
    const preview = await screen.findByTestId('invite-preview');
    expect(preview).toHaveTextContent('1 song · Olga');
    expect(preview).not.toHaveTextContent('more');
  });

  it('many people: names the first two and counts the rest', async () => {
    api.previewPlaylistInvite.mockResolvedValue(card({ peopleCount: 7 }));
    await open(CODE);
    expect(await screen.findByTestId('invite-preview')).toHaveTextContent('Olga, Marko and 5 more');
  });

  it('already on it (or the owner): straight to the playlist, no card, no join', async () => {
    api.previewPlaylistInvite.mockResolvedValue(card({ alreadyIn: true, playlistId: 'pl1' }));
    await open(CODE);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/playlist/pl1'));
    expect(screen.queryByTestId('invite-preview')).toBeNull();
    expect(api.joinPlaylist).not.toHaveBeenCalled();
  });

  it('a dead link says so and goes nowhere', async () => {
    api.previewPlaylistInvite.mockRejectedValue(new Error('This invite link doesn’t work anymore. Ask the owner for a new one.'));
    await open('dead');
    expect(await screen.findByTestId('join-problem')).toHaveTextContent(/doesn’t work anymore/);
    expect(nav.replace).not.toHaveBeenCalled();
    expect(api.joinPlaylist).not.toHaveBeenCalled();
  });
});
