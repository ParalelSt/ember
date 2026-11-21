import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { CarlistSharePanel, QrCode, joinLinkFor } = await import('./CarlistShare');
const { encodeQr } = await import('@/lib/qr');

beforeEach(() => vi.clearAllMocks());

describe('CarlistSharePanel', () => {
  it('a QR code of the join link, the code, and Copy link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CarlistSharePanel code="K7MPQ4" />);
    const link = `${window.location.origin}/session/join/K7MPQ4`;
    expect(joinLinkFor('K7MPQ4')).toBe(link);
    expect(screen.getByTestId('share-link')).toHaveTextContent(link);
    expect(screen.getByTestId('share-code')).toHaveTextContent('K7MPQ4');
    expect(screen.getByTestId('qr')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Copy link/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
    expect(toast.success).toHaveBeenCalledWith('Join link copied');
  });
});

describe('QrCode', () => {
  it('draws the encoder’s modules with a 4-module quiet zone', () => {
    const value = 'https://ember.example/session/join/K7MPQ4';
    const { container } = render(<QrCode value={value} size={120} />);
    const size = encodeQr(value).size;
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe(`-4 -4 ${size + 8} ${size + 8}`);
    const d = container.querySelector('path')!.getAttribute('d')!;
    // Top-left finder: a run of seven dark modules on row 0.
    expect(d.startsWith('M0 0h7v1h-7z')).toBe(true);
  });
});
