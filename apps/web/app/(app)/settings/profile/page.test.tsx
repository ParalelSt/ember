import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsProfile from './page';

const auth = vi.hoisted(() => ({
  user: { id: 'u1', email: 'robin@ember.test' } as { id: string; email: string } | null,
  name: 'Robin' as string | null,
  signOut: vi.fn(),
}));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: auth.user,
    name: auth.name,
    avatarUrl: '/pb/api/files/users/u1/avatar.png',
    refresh: vi.fn(),
    signOut: auth.signOut,
  }),
}));
const api = vi.hoisted(() => ({ updateProfile: vi.fn(async () => ({})) }));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/components/settings/PrivacyToggles', () => ({ PrivacyToggles: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'u1', email: 'robin@ember.test' };
  auth.name = 'Robin';
});

describe('SettingsProfile', () => {
  it('renders the current avatar through the shared Avatar', () => {
    const { container } = render(<SettingsProfile />);
    // The Avatar's structural classes (see components/primitives/Avatar.tsx).
    expect(container.querySelector('.rounded-full.grid.place-items-center')).not.toBeNull();
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/pb/api/files/users/u1/avatar.png');
    expect(screen.getByText('Upload picture')).toBeInTheDocument();
  });

  it('lets go of each picked picture preview once it is replaced or the page closes', () => {
    let n = 0;
    const create = vi.fn(() => `blob:preview-${++n}`);
    const revoke = vi.fn();
    const saved = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    const { container, unmount } = render(<SettingsProfile />);
    const input = container.querySelector('input[type="file"]')!;
    const pick = (name: string) => fireEvent.change(input, { target: { files: [new File(['x'], name, { type: 'image/png' })] } });

    pick('a.png');
    pick('b.png');
    expect(revoke).toHaveBeenCalledWith('blob:preview-1');
    expect(revoke).not.toHaveBeenCalledWith('blob:preview-2');
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:preview-2');
    URL.createObjectURL = saved.create;
    URL.revokeObjectURL = saved.revoke;
  });
});

describe('SettingsProfile name, opened before the account is known', () => {
  it('saving only a new picture does not clear the name', async () => {
    auth.user = null;
    auth.name = null;
    const { container, rerender } = render(<SettingsProfile />);
    auth.user = { id: 'u1', email: 'robin@ember.test' };
    auth.name = 'Robin';
    rerender(<SettingsProfile />);
    expect(screen.getByLabelText('Username')).toHaveValue('Robin');
    const input = container.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledTimes(1));
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ name: undefined }));
  });

  it('a name typed by hand is still sent, an empty one included', async () => {
    render(<SettingsProfile />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ name: '' })));
  });

  it('signs out from a full-width red row in its own block, with no Account heading', () => {
    render(<SettingsProfile />);
    const row = screen.getByRole('button', { name: 'Sign out' });
    expect(row.className).toContain('w-full');
    expect(row.className).toContain('text-destructive');
    expect(row.parentElement?.className).toContain('bg-card');
    expect(screen.queryByText('Account')).toBeNull();
    fireEvent.click(row);
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });
});
