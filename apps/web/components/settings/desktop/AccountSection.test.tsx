import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { usePrivacyStore } from '@/stores/usePrivacyStore';
import { AccountSection } from './AccountSection';

const auth = vi.hoisted(() => ({ name: 'Robin' as string | null, refresh: vi.fn(async () => {}), signOut: vi.fn() }));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'robin@ember.test' },
    name: auth.name,
    avatarUrl: '/pb/api/files/users/u1/avatar.png',
    refresh: auth.refresh,
    signOut: auth.signOut,
  }),
}));
const api = vi.hoisted(() => ({ updateProfile: vi.fn(async () => ({ ok: true })), updatePrivacy: vi.fn(), getPrivacy: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const blockedTracks = vi.hoisted(() => ({ blocked: [] as { id: string; title: string; artist: string; artworkUrl: null }[], unblock: vi.fn() }));
vi.mock('@/hooks/useBlockedTracks', () => ({ useBlockedTracks: () => blockedTracks }));

beforeEach(() => {
  vi.clearAllMocks();
  auth.name = 'Robin';
  blockedTracks.blocked = [];
  usePrivacyStore.setState({ shareDiscord: false, shareListening: true, loaded: true, failed: false });
});

const pickPicture = () =>
  fireEvent.change(screen.getByTestId('avatar-input'), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });

describe('profile: saves by itself (edit A)', () => {
  it('saves the username when the field loses focus and shows a Saved tick, with no Save button', async () => {
    render(<AccountSection />);
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
    const field = screen.getByLabelText('Username');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '  Robin B ' } });
    expect(api.updateProfile).not.toHaveBeenCalled();
    fireEvent.blur(field);
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ name: 'Robin B' }));
    expect(auth.refresh).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });

  it('does not save an unchanged name on blur', () => {
    render(<AccountSection />);
    const field = screen.getByLabelText('Username');
    fireEvent.change(field, { target: { value: 'Robin' } });
    fireEvent.blur(field);
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it('saves a picture as soon as it is picked', async () => {
    render(<AccountSection />);
    pickPicture();
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ avatar: expect.any(File) }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });
});

describe('the rest of Account', () => {
  it('has the real privacy switches and sign out as rows', async () => {
    api.updatePrivacy.mockResolvedValue({ shareDiscord: true, shareListening: true });
    render(<AccountSection />);
    const discord = screen.getByRole('switch', { name: "Turn on Show what I'm playing on Discord" });
    expect(screen.getByRole('switch', { name: 'Turn off Show me in “Friends are listening to”' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(discord);
    await waitFor(() => expect(api.updatePrivacy).toHaveBeenCalledWith({ shareDiscord: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalled();
    expect(screen.getByText('Signed in as robin@ember.test')).toBeInTheDocument();
  });
});

describe('blocked songs (the phone keeps them under Settings > Library)', () => {
  it('sit between Privacy and Sign out, and say so when there are none', () => {
    render(<AccountSection />);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Profile', 'Privacy', 'Blocked songs']);
    const group = screen.getByRole('region', { name: 'Blocked songs' });
    expect(within(group).getByText('No blocked songs.')).toBeInTheDocument();
    expect(group.compareDocumentPosition(screen.getByRole('button', { name: 'Sign out' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lists each with Unblock', () => {
    blockedTracks.blocked = [{ id: 't1', title: 'Loud song', artist: 'Band', artworkUrl: null }];
    render(<AccountSection />);
    const group = screen.getByRole('region', { name: 'Blocked songs' });
    expect(within(group).getByText('Loud song')).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: 'Unblock Loud song' }));
    expect(blockedTracks.unblock).toHaveBeenCalledWith(blockedTracks.blocked[0]);
  });
});
