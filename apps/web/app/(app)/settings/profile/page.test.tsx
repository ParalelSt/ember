import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SettingsProfile from './page';

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'robin@ember.test' },
    name: 'Robin',
    avatarUrl: '/pb/api/files/users/u1/avatar.png',
    refresh: vi.fn(),
    signOut: vi.fn(),
  }),
}));

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
