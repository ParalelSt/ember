import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DesktopTopBar } from './DesktopTopBar';

/** happy-dom does no layout, so offsetHeight is always 0. The bar's height
 *  is what it publishes as `--ember-topbar-h`, so give it a real one. */
const BAR_H = 80;
let heightSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'topbar-bar' ? BAR_H : 0;
  });
});
afterEach(() => heightSpy.mockRestore());

function renderBar(props: Partial<{ raised: boolean; onHeightChange: (h: number) => void }> = {}) {
  const onHeightChange = props.onHeightChange ?? vi.fn();
  const utils = render(
    <div data-app-scroller data-testid="scroller">
      <DesktopTopBar raised={props.raised ?? false} onHeightChange={onHeightChange}>
        <div role="search">pill</div>
      </DesktopTopBar>
      <main>page</main>
    </div>,
  );
  return { ...utils, onHeightChange };
}

function scrollTo(top: number) {
  const scroller = screen.getByTestId('scroller');
  act(() => {
    scroller.scrollTop = top;
    fireEvent.scroll(scroller);
  });
}

describe('DesktopTopBar', () => {
  it('is sticky at the top of the scroller, with the search box inside it', () => {
    renderBar();
    const bar = screen.getByTestId('topbar-bar');
    expect(bar.className).toMatch(/\bsticky\b/);
    expect(bar.className).toMatch(/\btop-0\b/);
    expect(bar.closest('[data-app-scroller]')).not.toBeNull();
    expect(bar.contains(screen.getByRole('search'))).toBe(true);
  });

  it('publishes its height, and 0 when it goes away', () => {
    const { onHeightChange, unmount } = renderBar();
    expect(onHeightChange).toHaveBeenLastCalledWith(BAR_H);
    unmount();
    expect(onHeightChange).toHaveBeenLastCalledWith(0);
  });

  it('draws nothing but the pill at scroll top', () => {
    renderBar();
    expect(screen.getByTestId('topbar-bar')).not.toHaveAttribute('data-scrolled');
    expect(screen.queryByTestId('topbar-cover')).toBeNull();
  });

  it('once scrolled, covers the bar and a 16px band under it, then fades, without taking layout space', () => {
    renderBar();
    scrollTo(300);
    const bar = screen.getByTestId('topbar-bar');
    expect(bar).toHaveAttribute('data-scrolled');
    const cover = screen.getByTestId('topbar-cover');
    expect(cover.className).toMatch(/\babsolute\b/);
    expect(cover.className).toMatch(/\binset-y-0\b/);
    expect(cover.className).toMatch(/\bleft-0\b/);
    // Stops short of the lyrics panel, which the layout sizes.
    expect(cover.style.right).toBe('var(--ember-lyrics-w, 0px)');
    expect(cover.className).toMatch(/\bpointer-events-none\b/);
    expect(cover).toHaveAttribute('aria-hidden');
    // Theme tokens only: the page background, never a literal colour.
    const [box, band, fade] = [...cover.children];
    expect(box.className).toMatch(/\bbg-background\b/);
    expect(band).toBe(screen.getByTestId('topbar-band'));
    expect(band.className).toMatch(/\bh-block\b/);
    expect(band.className).toMatch(/\bbg-background\b/);
    expect(fade.className).toMatch(/\bfrom-background\b/);
    expect(fade.className).toMatch(/\bto-transparent\b/);

    scrollTo(0);
    expect(screen.queryByTestId('topbar-cover')).toBeNull();
  });

  it('draws no cover when it holds nothing (the /search page has its own box)', () => {
    heightSpy.mockImplementation(() => 0);
    render(
      <div data-app-scroller data-testid="scroller">
        <DesktopTopBar raised={false} onHeightChange={vi.fn()}>
          {null}
        </DesktopTopBar>
      </div>,
    );
    scrollTo(300);
    expect(screen.queryByTestId('topbar-cover')).toBeNull();
  });

  it('keeps the pill over its own cover', () => {
    renderBar();
    scrollTo(300);
    const pillWrap = screen.getByRole('search').parentElement!;
    expect(pillWrap.className).toMatch(/\brelative\b/);
    // Later in the DOM than the absolute cover, so it paints over it.
    const cover = screen.getByTestId('topbar-cover');
    expect(cover.compareDocumentPosition(pillWrap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sits under the lyrics panel (z-30) until the search panel opens, then over it', () => {
    const { rerender } = renderBar({ raised: false });
    expect(screen.getByTestId('topbar-bar').className).toMatch(/\bz-20\b/);
    rerender(
      <div data-app-scroller data-testid="scroller">
        <DesktopTopBar raised onHeightChange={vi.fn()}>
          <div role="search">pill</div>
        </DesktopTopBar>
      </div>,
    );
    expect(screen.getByTestId('topbar-bar').className).toMatch(/\bz-40\b/);
  });
});
