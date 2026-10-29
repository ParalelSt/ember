import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ScrollToTopOnNavigate } from './ScrollToTopOnNavigate';

const nav = vi.hoisted(() => ({ path: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }));

function setup() {
  const ref = createRef<HTMLDivElement>();
  const el = document.createElement('div');
  (ref as { current: HTMLDivElement | null }).current = el;
  el.scrollTo = vi.fn((opts: ScrollToOptions) => { el.scrollTop = opts.top ?? 0; }) as unknown as typeof el.scrollTo;
  el.scrollTop = 500;
  const ui = () => <ScrollToTopOnNavigate scrollRef={ref} />;
  const view = render(ui());
  return { el, rerender: () => view.rerender(ui()) };
}

describe('ScrollToTopOnNavigate', () => {
  it('does not touch the scroll on first render', () => {
    nav.path = '/a';
    const { el } = setup();
    expect(el.scrollTop).toBe(500);
  });
  it('resets to the top when the pathname changes', () => {
    nav.path = '/library';
    const { el, rerender } = setup();
    nav.path = '/search';
    rerender();
    expect(el.scrollTop).toBe(0);
  });
  it('resets when only the dynamic id changes', () => {
    nav.path = '/playlist/a';
    const { el, rerender } = setup();
    el.scrollTop = 300;
    nav.path = '/playlist/b';
    rerender();
    expect(el.scrollTop).toBe(0);
  });
  it('leaves the scroll alone on a rerender with the same path', () => {
    nav.path = '/x';
    const { el, rerender } = setup();
    rerender();
    expect(el.scrollTop).toBe(500);
  });
});
