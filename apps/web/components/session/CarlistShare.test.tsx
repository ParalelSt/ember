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

  it('the QR, heading and code sit on a soft block; the link and pills sit under it', () => {
    render(<CarlistSharePanel code="K7MPQ4" />);
    const card = screen.getByTestId('carlist-share-card');
    expect(card).toHaveClass('bg-card', 'rounded-[18px]');
    expect(card).toContainElement(screen.getByTestId('qr'));
    expect(card).toContainElement(screen.getByTestId('share-code'));
    expect(card).toHaveTextContent('Scan with the phone camera to join');
    expect(card).not.toContainElement(screen.getByTestId('share-link'));

    const copy = screen.getByRole('button', { name: /Copy link/ });
    const share = screen.getByRole('button', { name: /Share/ });
    expect(card).not.toContainElement(copy);
    expect(copy).toHaveClass('rounded-full');
    expect(share).toHaveClass('rounded-full');
    expect(share).toHaveClass('bg-secondary');
    expect(share).not.toHaveClass('border-border');
  });

  it('Share hands the link to the system sheet, and falls back to copying', async () => {
    const shareFn = vi.fn().mockRejectedValue(new Error('no'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: shareFn, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CarlistSharePanel code="K7MPQ4" />);
    const link = `${window.location.origin}/session/join/K7MPQ4`;
    fireEvent.click(screen.getByRole('button', { name: /Share/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
    expect(shareFn).toHaveBeenCalledWith({ title: 'Join my carlist', url: link });
    Reflect.deleteProperty(navigator, 'share');
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
