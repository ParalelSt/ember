import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef, type ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useTabSwipe } from './useTabSwipe';
import { useUiStore } from '@/stores/useUiStore';

/** The phone tab swipe, through real touch events on the app's scroller:
 *  it navigates on a clear sideways swipe on a tab page and leaves every
 *  other touch alone. */

const route = vi.hoisted(() => ({ pathname: '/', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: route.push, replace: vi.fn(), back: vi.fn() }),
}));
const desktop = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop.value }));

function Shell({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useTabSwipe(ref);
  return (
    <div ref={ref} data-testid="scroller">
      <main data-testid="main">
        <p data-testid="content">Page</p>
        {children}
      </main>
    </div>
  );
}

function swipe(el: Element, dx: number, dy = 0) {
  fireEvent.touchStart(el, { touches: [{ clientX: 200, clientY: 300 }] });
  fireEvent.touchEnd(el, { touches: [], changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
}

beforeEach(() => {
  route.pathname = '/';
  route.push.mockReset();
  desktop.value = false;
  useUiStore.setState({ searchOpen: false });
});
afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('TabSwipe', () => {
  it('swipe left on Home goes to Search', () => {
    render(<Shell />);
    swipe(screen.getByTestId('content'), -90);
    expect(route.push).toHaveBeenCalledWith('/search');
  });

  it('swipe right on Search goes to Home; left goes to Library', () => {
    route.pathname = '/search';
    render(<Shell />);
    swipe(screen.getByTestId('content'), 90);
    expect(route.push).toHaveBeenLastCalledWith('/');
    swipe(screen.getByTestId('content'), -90);
    expect(route.push).toHaveBeenLastCalledWith('/library');
  });

  it('does not wrap past Library or before Home', () => {
    route.pathname = '/library';
    const { unmount } = render(<Shell />);
    swipe(screen.getByTestId('content'), -120);
    unmount();
    route.pathname = '/';
    render(<Shell />);
    swipe(screen.getByTestId('content'), 120);
    expect(route.push).not.toHaveBeenCalled();
  });

  it('a vertical drag (a scroll) or a short one does nothing', () => {
    render(<Shell />);
    swipe(screen.getByTestId('content'), -10, 400);
    swipe(screen.getByTestId('content'), -80, 70);
    swipe(screen.getByTestId('content'), -40);
    expect(route.push).not.toHaveBeenCalled();
  });

  it('a swipe that starts inside a sideways scroller or an input does nothing', () => {
    render(
      <Shell>
        <div data-testid="row" style={{ overflowX: 'auto' }}>
          <a data-testid="tile">tile</a>
        </div>
        <input data-testid="field" />
        <div data-no-tab-swipe>
          <span data-testid="marked">x</span>
        </div>
      </Shell>,
    );
    const row = screen.getByTestId('row');
    Object.defineProperty(row, 'scrollWidth', { value: 900 });
    Object.defineProperty(row, 'clientWidth', { value: 360 });
    swipe(screen.getByTestId('tile'), -120);
    swipe(screen.getByTestId('field'), -120);
    swipe(screen.getByTestId('marked'), -120);
    expect(route.push).not.toHaveBeenCalled();
  });

  it('does nothing while a sheet or the search sheet is open', () => {
    render(<Shell />);
    const sheet = document.createElement('div');
    sheet.setAttribute('role', 'dialog');
    document.body.appendChild(sheet);
    swipe(screen.getByTestId('content'), -120);
    sheet.remove();
    act(() => useUiStore.setState({ searchOpen: true }));
    swipe(screen.getByTestId('content'), -120);
    expect(route.push).not.toHaveBeenCalled();
  });

  it('a sub page or a Home sub view does nothing', () => {
    route.pathname = '/library/liked';
    const { unmount } = render(<Shell />);
    swipe(screen.getByTestId('content'), 120);
    unmount();
    route.pathname = '/';
    window.history.replaceState(null, '', '/?focus=charts');
    render(<Shell />);
    swipe(screen.getByTestId('content'), -120);
    expect(route.push).not.toHaveBeenCalled();
  });

  it('a second finger (a pinch) is never a swipe', () => {
    render(<Shell />);
    const el = screen.getByTestId('content');
    fireEvent.touchStart(el, {
      touches: [
        { clientX: 200, clientY: 300 },
        { clientX: 250, clientY: 300 },
      ],
    });
    fireEvent.touchEnd(el, { touches: [], changedTouches: [{ clientX: 60, clientY: 300 }] });
    expect(route.push).not.toHaveBeenCalled();
  });

  it('desktop does nothing', () => {
    desktop.value = true;
    render(<Shell />);
    swipe(screen.getByTestId('content'), -120);
    expect(route.push).not.toHaveBeenCalled();
  });

  it('the new tab slides in from the side it came from', () => {
    const { rerender } = render(<Shell />);
    swipe(screen.getByTestId('content'), -90);
    route.pathname = '/search';
    rerender(<Shell />);
    expect(screen.getByTestId('main')).toHaveClass('ember-tab-in-next');
    fireEvent.animationEnd(screen.getByTestId('main'));
    expect(screen.getByTestId('main')).not.toHaveClass('ember-tab-in-next');
  });

  it('no slide under reduced motion', () => {
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) =>
        ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    try {
      const { rerender } = render(<Shell />);
      swipe(screen.getByTestId('content'), -90);
      expect(route.push).toHaveBeenCalledWith('/search');
      route.pathname = '/search';
      rerender(<Shell />);
      expect(screen.getByTestId('main').className).not.toMatch(/ember-tab-in/);
    } finally {
      mm.mockRestore();
    }
  });
});
