import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const getPrivacy = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { getPrivacy: () => getPrivacy(), updatePrivacy: vi.fn() },
}));

const { PrivacyToggles } = await import('./PrivacyToggles');
const { usePrivacyStore } = await import('@/stores/usePrivacyStore');
const initial = usePrivacyStore.getState();

beforeEach(() => {
  usePrivacyStore.setState(initial, true);
  getPrivacy.mockReset();
});

describe('PrivacyToggles', () => {
  it('when the settings could not load, the switches stay disabled and Try again loads them', async () => {
    getPrivacy.mockRejectedValueOnce(new Error('offline'));
    await usePrivacyStore.getState().load();
    render(<PrivacyToggles />);

    for (const sw of screen.getAllByRole('switch')) expect(sw).toBeDisabled();
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();

    getPrivacy.mockResolvedValueOnce({ shareDiscord: true, shareListening: false });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('switch', { name: "Show what I'm playing on Discord" })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: "Show what I'm playing on Discord" })).not.toBeDisabled();
  });
});
