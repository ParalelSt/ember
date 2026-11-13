import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { usePrivacyStore } from '@/stores/usePrivacyStore';
import { AccountSection } from './AccountSection';
import { SettingsRowsProvider } from './rows';

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

const saved = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
beforeEach(() => {
  vi.clearAllMocks();
  auth.name = 'Robin';
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  usePrivacyStore.setState({ shareDiscord: false, shareListening: true, loaded: true, failed: false });
});
afterEach(() => {
  URL.createObjectURL = saved.create;
  URL.revokeObjectURL = saved.revoke;
});

const pickPicture = () =>
  fireEvent.change(screen.getByTestId('avatar-input'), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });

describe('edit A: saves by itself', () => {
  it('saves the username when the field loses focus and shows a Saved tick, with no Save button', async () => {
    render(<AccountSection edit="A" />);
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
    render(<AccountSection edit="A" />);
    const field = screen.getByLabelText('Username');
    fireEvent.change(field, { target: { value: 'Robin' } });
    fireEvent.blur(field);
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it('saves a picture as soon as it is picked', async () => {
    render(<AccountSection edit="A" />);
    pickPicture();
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ avatar: expect.any(File) }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });
});

describe('edit B: Edit button per row', () => {
  it('opens the name in place and Cancel puts it back without saving', () => {
    render(<AccountSection edit="B" />);
    expect(screen.getByText('Robin')).toBeInTheDocument();
    expect(screen.queryByLabelText('Username')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit username' }));
    const field = screen.getByLabelText('Username');
    expect(field).toHaveValue('Robin');
    fireEvent.change(field, { target: { value: 'Someone else' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(screen.getByText('Robin')).toBeInTheDocument();
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it('saves the edited name with Save and closes the editor', async () => {
    render(<AccountSection edit="B" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit username' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Robin B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ name: 'Robin B' }));
    await waitFor(() => expect(screen.queryByLabelText('Username')).toBeNull());
  });

  it('holds a picked picture until Save, and Cancel drops it', async () => {
    render(<AccountSection edit="B" />);
    pickPicture();
    expect(api.updateProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    pickPicture();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ avatar: expect.any(File) }));
  });
});

describe('edit C: Save button after a change', () => {
  it('shows Save only once something changed, and hides it when changed back', () => {
    render(<AccountSection edit="C" />);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    const field = screen.getByLabelText('Username');
    fireEvent.change(field, { target: { value: 'Robin B' } });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveAttribute('data-slot', 'button');
    expect(save.className).not.toContain('bg-ember');
    fireEvent.change(field, { target: { value: 'Robin' } });
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('saves the name and a picked picture together', async () => {
    render(<AccountSection edit="C" />);
    pickPicture();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Robin B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith({ name: 'Robin B', avatar: expect.any(File), removeAvatar: false }),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
  });
});

describe('the rest of Account', () => {
  it('has the real privacy switches and sign out as rows', async () => {
    api.updatePrivacy.mockResolvedValue({ shareDiscord: true, shareListening: true });
    render(
      <SettingsRowsProvider value="B">
        <AccountSection edit="A" />
      </SettingsRowsProvider>,
    );
    const discord = screen.getByRole('switch', { name: "Turn on Show what I'm playing on Discord" });
    expect(screen.getByRole('switch', { name: 'Turn off Show me in “Friends are listening to”' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(discord);
    await waitFor(() => expect(api.updatePrivacy).toHaveBeenCalledWith({ shareDiscord: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalled();
    expect(screen.getByText('Signed in as robin@ember.test')).toBeInTheDocument();
  });
});
