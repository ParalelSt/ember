import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CastButton, CastNote } from './CastButton';
import { castButtonVisible, useCastStore } from '@/stores/useCastStore';

const requestCast = vi.fn(async () => {});
vi.mock('@/lib/cast/controller', () => ({ requestCast: () => requestCast() }));

beforeEach(() => {
  requestCast.mockClear();
  useCastStore.setState({ path: null, availability: 'none', connection: 'idle', deviceName: null });
});

describe('CastButton', () => {
  it('is not there when this page cannot cast (desktop app, Firefox, an old Android app)', () => {
    useCastStore.setState({ path: null, availability: 'available' });
    render(<CastButton />);
    expect(screen.queryByTestId('cast-button')).toBeNull();
  });

  it('is not there when no device is around', () => {
    useCastStore.setState({ path: 'google', availability: 'none' });
    render(<CastButton />);
    expect(screen.queryByTestId('cast-button')).toBeNull();
  });

  it('shows when a device is around, or when the browser cannot tell before the first tap', () => {
    useCastStore.setState({ path: 'google', availability: 'available' });
    const { unmount } = render(<CastButton />);
    expect(screen.getByRole('button', { name: 'Cast' })).toHaveAttribute('aria-pressed', 'false');
    unmount();
    useCastStore.setState({ availability: 'unknown' });
    render(<CastButton />);
    expect(screen.getByRole('button', { name: 'Cast' })).toBeInTheDocument();
  });

  it('a tap opens the picker', () => {
    useCastStore.setState({ path: 'android', availability: 'available' });
    render(<CastButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Cast' }));
    expect(requestCast).toHaveBeenCalled();
  });

  it('is lit while casting and names the device, even if the device then drops off the list', () => {
    useCastStore.setState({ path: 'google', availability: 'none', connection: 'connected', deviceName: 'Living Room TV' });
    render(<CastButton />);
    const b = screen.getByRole('button', { name: 'Casting to Living Room TV' });
    expect(b).toHaveAttribute('aria-pressed', 'true');
    expect(b.className).toContain('text-ember');
    expect(b.getAttribute('title')).toContain('equalizer');
  });

  it('Safari gets the AirPlay button', () => {
    useCastStore.setState({ path: 'airplay', availability: 'available' });
    render(<CastButton />);
    expect(screen.getByRole('button', { name: 'AirPlay' })).toBeInTheDocument();
  });
});

describe('CastNote', () => {
  it('says where the music plays and that the equalizer is off, only while casting', () => {
    const { rerender } = render(<CastNote />);
    expect(screen.queryByTestId('cast-note')).toBeNull();
    useCastStore.setState({ path: 'android', connection: 'connected', deviceName: 'Kitchen speaker' });
    rerender(<CastNote />);
    expect(screen.getByTestId('cast-note')).toHaveTextContent('Playing on Kitchen speaker. The equalizer and volume leveling are off while casting.');
  });
});

describe('castButtonVisible', () => {
  it('needs a way to cast and a device (or a session already going)', () => {
    expect(castButtonVisible({ path: null, availability: 'available', connection: 'connected' })).toBe(false);
    expect(castButtonVisible({ path: 'google', availability: 'none', connection: 'idle' })).toBe(false);
    expect(castButtonVisible({ path: 'google', availability: 'none', connection: 'connecting' })).toBe(true);
    expect(castButtonVisible({ path: 'airplay', availability: 'unknown', connection: 'idle' })).toBe(true);
  });
});
