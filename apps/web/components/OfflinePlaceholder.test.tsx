import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const toast = vi.hoisted(() => ({ message: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));

const { OfflinePlaceholder } = await import('./OfflinePlaceholder');

const setOnLine = (value: boolean) => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);

beforeEach(() => toast.message.mockClear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OfflinePlaceholder', () => {
  it('shows the icon, title, line, the link as the main button and Try again beside it', () => {
    render(<OfflinePlaceholder />);
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "You're offline" })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Go to Downloaded' });
    expect(link).toHaveAttribute('href', '/library');
    expect(link.className).toContain('bg-ember');
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry.className).toContain('bg-secondary');
    expect(retry.parentElement).toBe(link.parentElement);
  });

  it('keeps a caller\'s own link', () => {
    render(<OfflinePlaceholder href="/x" label="Elsewhere" />);
    expect(screen.getByRole('link', { name: 'Elsewhere' })).toHaveAttribute('href', '/x');
  });

  it('Try again with still no connection says so and does not reload into an error page', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    setOnLine(false);
    render(<OfflinePlaceholder />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).not.toHaveBeenCalled();
    expect(toast.message).toHaveBeenCalledWith(expect.stringMatching(/^Still offline/));
  });

  it('Try again with the connection back reloads', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    setOnLine(true);
    render(<OfflinePlaceholder />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toast.message).not.toHaveBeenCalled();
  });
});
