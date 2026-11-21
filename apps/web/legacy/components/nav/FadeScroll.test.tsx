import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FadeScroll } from './FadeScroll';

/** happy-dom has no layout, so give the scroller measured sizes by hand. */
function size(el: HTMLElement, v: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  for (const [k, val] of Object.entries(v)) Object.defineProperty(el, k, { configurable: true, writable: true, value: val });
}

describe('FadeScroll', () => {
  it('can shrink inside a flex column (min-h-0) and scrolls', () => {
    render(<FadeScroll>x</FadeScroll>);
    const el = screen.getByTestId('playlist-scroller');
    expect(el.className).toContain('min-h-0');
    expect(el.className).toContain('overflow-y-auto');
  });

  it('shows no fade when everything fits', () => {
    render(<FadeScroll>x</FadeScroll>);
    const el = screen.getByTestId('playlist-scroller');
    size(el, { scrollHeight: 200, clientHeight: 200, scrollTop: 0 });
    fireEvent.scroll(el);
    expect(el).toHaveAttribute('data-fade-top', 'false');
    expect(el).toHaveAttribute('data-fade-bottom', 'false');
  });

  it('fades only the bottom at the top of a long list, both mid-list, only the top at the end', () => {
    render(<FadeScroll>x</FadeScroll>);
    const el = screen.getByTestId('playlist-scroller');
    const at = (scrollTop: number) => {
      size(el, { scrollHeight: 1320, clientHeight: 300, scrollTop });
      fireEvent.scroll(el);
    };
    at(0);
    expect([el.dataset.fadeTop, el.dataset.fadeBottom]).toEqual(['false', 'true']);
    expect(el.style.maskImage || el.getAttribute('style')).toMatch(/#000 0px/);
    at(400);
    expect([el.dataset.fadeTop, el.dataset.fadeBottom]).toEqual(['true', 'true']);
    at(1020);
    expect([el.dataset.fadeTop, el.dataset.fadeBottom]).toEqual(['true', 'false']);
  });
});
