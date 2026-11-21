import { createContext, useContext, useEffect, type ComponentProps, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CLASSIC_LAYOUT_AVAILABLE, INTRO_SEEN_KEY, introBlockedPath, introSteps } from '@/lib/redesignIntro';
import { useUiStore } from '@/stores/useUiStore';

// @base-ui reaches a second React copy in tests (see RequestDialog.test), so
// stand in plain elements that keep the behaviour under test: Escape and a
// backdrop tap call onOpenChange(false).
const Ctx = createContext<(o: boolean) => void>(() => {});
vi.mock('@base-ui/react/dialog', () => ({
  Dialog: {
    Root: ({ open, onOpenChange, children }: PropsWithChildren<{ open: boolean; onOpenChange: (o: boolean) => void }>) => {
      useEffect(() => {
        if (!open) return;
        const k = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false);
        document.addEventListener('keydown', k);
        return () => document.removeEventListener('keydown', k);
      }, [open, onOpenChange]);
      return open ? <Ctx.Provider value={onOpenChange}>{children}</Ctx.Provider> : null;
    },
    Portal: ({ children }: PropsWithChildren) => <>{children}</>,
    Backdrop: (props: ComponentProps<'div'>) => {
      const change = useContext(Ctx);
      return <div {...props} onClick={() => change(false)} />;
    },
    Popup: ({ children, ...rest }: ComponentProps<'div'>) => (
      <div role="dialog" aria-modal="true" aria-labelledby="intro-title" {...rest}>
        {children}
      </div>
    ),
    Title: ({ children, ...rest }: ComponentProps<'h2'>) => (
      <h2 id="intro-title" {...rest}>
        {children}
      </h2>
    ),
  },
}));
vi.mock('@/components/RequestDialog', () => ({
  RequestDialog: ({ open, initialKind }: { open: boolean; initialKind?: string }) =>
    open ? <div data-testid="request-dialog" data-kind={initialKind} /> : null,
}));
const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null, path: '/' }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('next/navigation', () => ({ usePathname: () => auth.path }));

import { RedesignIntro } from './RedesignIntro';
import { INTRO_DELAY_MS, RedesignIntroHost } from './RedesignIntroHost';

function setWidth(width: number) {
  act(() => {
    const viewport = window as unknown as { happyDOM?: { setViewport?: (size: { width: number }) => void } };
    viewport.happyDOM?.setViewport?.({ width });
    window.innerWidth = width;
    window.dispatchEvent(new Event('resize'));
  });
}
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const title = () => screen.getByRole('dialog').querySelector('h2')?.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  auth.user = { id: 'u1' };
  auth.path = '/';
  useUiStore.setState({ introOpen: false, bugReportOpen: false, searchOpen: false });
  setWidth(390);
});
afterEach(() => vi.useRealTimers());

describe('introSteps', () => {
  it('phone has swipe, desktop does not; Classic shows now that its switch exists', () => {
    expect(CLASSIC_LAYOUT_AVAILABLE).toBe(true);
    expect(introSteps({ desktop: false })).toEqual(['new', 'swipe', 'tour', 'classic', 'fix']);
    expect(introSteps({ desktop: true })).toEqual(['new', 'tour', 'classic', 'fix']);
    expect(introSteps({ desktop: false, classic: false })).toEqual(['new', 'swipe', 'tour', 'fix']);
  });
  it('blocks auth, link and legal pages only', () => {
    for (const p of ['/auth', '/link/abc', '/privacy', '/terms']) expect(introBlockedPath(p)).toBe(true);
    for (const p of ['/', '/settings/help', '/library']) expect(introBlockedPath(p)).toBe(false);
  });
});

describe('RedesignIntro steps', () => {
  const renderIntro = (props: Partial<ComponentProps<typeof RedesignIntro>> = {}) => {
    const onClose = vi.fn();
    const onFixRequest = vi.fn();
    render(<RedesignIntro open onClose={onClose} onFixRequest={onFixRequest} {...props} />);
    return { onClose, onFixRequest };
  };

  it('is an aria-modal dialog labelled by the step title', () => {
    renderIntro();
    const d = screen.getByRole('dialog');
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(title()).toBe('The new Ember is here');
  });

  it('walks Next and Back through the phone steps; Classic can be hidden', () => {
    renderIntro({ classic: false });
    const seen = [title()];
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      seen.push(title());
    }
    expect(seen).toEqual(['The new Ember is here', 'Swipe to switch tabs', 'A few things that moved', 'Something not right?']);
    expect(screen.queryByText('Prefer the old look?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(title()).toBe('A few things that moved');
  });

  it('shows the Classic step by default, pointing at Settings > Appearance > Classic look', () => {
    renderIntro();
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(title()).toBe('Prefer the old look?');
    expect(screen.getByText('Classic look')).toBeInTheDocument();
    expect(screen.getByText('Use the previous design')).toBeInTheDocument();
    expect(screen.getByText(/Settings > Appearance > Classic look/)).toBeInTheDocument();
  });

  it('desktop skips the swipe step', () => {
    setWidth(1200);
    renderIntro();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(title()).toBe('A few things that moved');
  });

  it('Skip jumps to the last step, where the button reads Start listening and closes', () => {
    const { onClose } = renderIntro();
    fireEvent.click(screen.getByText('Skip'));
    expect(title()).toBe('Something not right?');
    expect(screen.getByText('Skip')).toHaveStyle({ visibility: 'hidden' });
    fireEvent.click(screen.getByRole('button', { name: 'Start listening' }));
    expect(onClose).toHaveBeenCalled();
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBe('1');
  });

  it('the tour cycles its three tips every 3.2s', () => {
    renderIntro();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Rows show whole cards. Show all opens the full list.')).toBeInTheDocument();
    advance(3200);
    expect(screen.getByText('Tap the magnifier to search inside any playlist.')).toBeInTheDocument();
    advance(3200);
    expect(screen.getByText('Queue and Lyrics sit right under the play buttons.')).toBeInTheDocument();
    advance(3200);
    expect(screen.getByText('Rows show whole cards. Show all opens the full list.')).toBeInTheDocument();
  });

  it('Escape and the backdrop close it and mark it seen', () => {
    const { onClose } = renderIntro();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBe('1');
    localStorage.clear();
    fireEvent.click(screen.getByTestId('intro-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBe('1');
  });
});

describe('RedesignIntroHost', () => {
  it('opens once when not seen, and marks seen on close', () => {
    const { unmount } = render(<RedesignIntroHost />);
    expect(screen.queryByRole('dialog')).toBeNull();
    advance(INTRO_DELAY_MS + 10);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Skip'));
    fireEvent.click(screen.getByRole('button', { name: 'Start listening' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBe('1');
    unmount();
    render(<RedesignIntroHost />);
    advance(10000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays closed when already seen', () => {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
    render(<RedesignIntroHost />);
    advance(10000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays closed when signed out and on auth, link and legal pages', () => {
    auth.user = null;
    const a = render(<RedesignIntroHost />);
    advance(10000);
    expect(screen.queryByRole('dialog')).toBeNull();
    a.unmount();
    auth.user = { id: 'u1' };
    for (const p of ['/auth', '/link/x', '/privacy', '/terms']) {
      auth.path = p;
      const r = render(<RedesignIntroHost />);
      advance(10000);
      expect(screen.queryByRole('dialog')).toBeNull();
      r.unmount();
    }
  });

  it('waits while another modal is open, then shows', () => {
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    document.body.appendChild(other);
    render(<RedesignIntroHost />);
    advance(5000);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    other.remove();
    advance(3000);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('still shows past a closed dialog that stays in the DOM (the full-screen player)', () => {
    // NowPlaying keeps a role="dialog" node mounted, aria-hidden when closed.
    const player = document.createElement('div');
    player.setAttribute('role', 'dialog');
    player.setAttribute('aria-hidden', 'true');
    document.body.appendChild(player);
    render(<RedesignIntroHost />);
    advance(INTRO_DELAY_MS + 10);
    expect(title()).toBe('The new Ember is here');
    player.remove();
  });

  it('Send a fix request closes the intro and opens the request dialog on Fix', () => {
    render(<RedesignIntroHost />);
    advance(INTRO_DELAY_MS + 10);
    fireEvent.click(screen.getByText('Skip'));
    fireEvent.click(screen.getByRole('button', { name: 'Send a fix request' }));
    expect(screen.queryByText('Something not right?')).toBeNull();
    expect(screen.getByTestId('request-dialog')).toHaveAttribute('data-kind', 'fix');
  });

  it('reopens when the store asks, even if seen', () => {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
    render(<RedesignIntroHost />);
    act(() => useUiStore.getState().setIntroOpen(true));
    expect(title()).toBe('The new Ember is here');
  });
});
