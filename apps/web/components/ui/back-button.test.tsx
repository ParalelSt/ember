import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

const router = { back: vi.fn(), push: vi.fn() };
vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const { BackButton, BACK_BUTTON_CLASS } = await import('./back-button');
const { notePathname, resetInAppHistory } = await import('@/lib/inAppHistory');

beforeEach(() => {
  resetInAppHistory();
  router.back.mockClear();
  router.push.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('BackButton', () => {
  it('is a link with the bold arrow when given href', () => {
    render(<BackButton href="/admin" label="Back to Admin" />);
    const link = screen.getByRole('link', { name: 'Back to Admin' });
    expect(link).toHaveAttribute('href', '/admin');
    expect(link).toHaveAttribute('data-slot', 'back-button');
    expect(link.querySelector('.phosphor-arrow-left-bold')).not.toBeNull();
  });

  it('is a button when given onClick', () => {
    const onClick = vi.fn();
    render(<BackButton onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
  });

  it('is the round pick: a filled 36px circle, lighter on hover, with a 44px hit box', () => {
    render(<BackButton href="/x" className="extra" />);
    const el = screen.getByRole('link', { name: 'Back' });
    for (const c of BACK_BUTTON_CLASS.split(' ')) expect(el).toHaveClass(c);
    expect(el).toHaveClass('size-9', 'rounded-full', 'bg-secondary', 'text-foreground', 'hover:bg-accent', 'extra');
    expect(el).toHaveClass('relative', 'after:absolute', 'after:-inset-1');
    expect(el).not.toHaveClass('text-muted-foreground');
  });

  it('with neither href nor onClick goes Back when the page before was Ember', () => {
    notePathname('/library');
    notePathname('/playlist/p1');
    render(<BackButton fallbackHref="/library" />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('opened from outside Ember it goes to fallbackHref, home by default', () => {
    vi.stubGlobal('navigation', { canGoBack: false });
    const { unmount } = render(<BackButton fallbackHref="/library" />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.push).toHaveBeenCalledWith('/library');
    unmount();
    render(<BackButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.push).toHaveBeenLastCalledWith('/');
    expect(router.back).not.toHaveBeenCalled();
  });
});
