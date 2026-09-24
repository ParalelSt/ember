import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useScrollerOffset } from '@/hooks/useScrollerOffset';

// happy-dom lays nothing out: each element's top comes from this table, and
// the ResizeObserver callbacks are fired by hand.
const tops = new Map<string, number>();
let observers: { cb: () => void; targets: Element[]; disconnected: boolean }[] = [];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      o: (typeof observers)[number];
      constructor(cb: () => void) {
        this.o = { cb, targets: [], disconnected: false };
        observers.push(this.o);
      }
      observe(el: Element) {
        this.o.targets.push(el);
      }
      disconnect() {
        this.o.disconnected = true;
      }
    },
  );
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const top = tops.get(this.getAttribute('data-id') ?? '') ?? 0;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  tops.clear();
});

function Probe() {
  const [ref, offset] = useScrollerOffset<HTMLDivElement>();
  return (
    <div ref={ref} data-id="probe" data-testid="probe">
      {offset === null ? 'none' : String(offset)}
    </div>
  );
}

function InScroller({ scrollTop = 0 }: { scrollTop?: number }) {
  return (
    <div
      data-app-scroller
      data-id="scroller"
      ref={(el) => {
        if (el) el.scrollTop = scrollTop;
      }}
    >
      <main data-id="main">
        <Probe />
      </main>
    </div>
  );
}

describe('useScrollerOffset', () => {
  it('measures the distance below the scroller top', () => {
    tops.set('scroller', 80);
    tops.set('probe', 220.4);
    render(<InScroller />);
    expect(screen.getByTestId('probe').textContent).toBe('140');
  });

  it('counts the scrolled-away part, so the result is as if scrolled to the top', () => {
    tops.set('scroller', 80);
    tops.set('probe', 20);
    render(<InScroller scrollTop={120} />);
    expect(screen.getByTestId('probe').textContent).toBe('60');
  });

  it('remeasures when the scroller or the page column resizes, and stops on unmount', () => {
    tops.set('scroller', 80);
    tops.set('probe', 220);
    const { unmount } = render(<InScroller />);
    const ro = observers[0];
    expect(ro.targets.map((t) => t.getAttribute('data-id'))).toEqual(['scroller', 'main']);
    tops.set('probe', 260);
    act(() => ro.cb());
    expect(screen.getByTestId('probe').textContent).toBe('180');
    unmount();
    expect(ro.disconnected).toBe(true);
  });

  it('stays null outside the app scroller', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('none');
    expect(observers).toHaveLength(0);
  });
});
