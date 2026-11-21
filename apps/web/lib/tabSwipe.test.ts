import { afterEach, describe, expect, it } from 'vitest';
import {
  PHONE_TABS,
  TAB_SWIPE_MIN_PX,
  hasOpenOverlay,
  isTabSwipeBlocked,
  tabIndexFor,
  tabSwipeTarget,
} from './tabSwipe';

/** A sideways swipe on a phone tab page goes to the tab beside it in the
 *  bottom bar: left (finger right to left) is the next tab, right the one
 *  before, no wrap; a scroll, a short drag or a sub page goes nowhere. */

const swipe = (dx: number, pathname: string, extra: { dy?: number; search?: string; blocked?: boolean } = {}) =>
  tabSwipeTarget({ dx, dy: extra.dy ?? 0, pathname, search: extra.search, blocked: extra.blocked });

describe('tabSwipeTarget', () => {
  it('follows the bottom bar order: Home, Search, Library', () => {
    expect(PHONE_TABS).toEqual(['/', '/search', '/library']);
    expect(swipe(-80, '/')).toEqual({ href: '/search', dir: 'next' });
    expect(swipe(-80, '/search')).toEqual({ href: '/library', dir: 'next' });
    expect(swipe(80, '/library')).toEqual({ href: '/search', dir: 'prev' });
    expect(swipe(80, '/search')).toEqual({ href: '/', dir: 'prev' });
  });

  it('does not wrap at either end', () => {
    expect(swipe(80, '/')).toBeNull();
    expect(swipe(-80, '/library')).toBeNull();
  });

  it('needs a long enough, clearly sideways drag', () => {
    expect(swipe(-TAB_SWIPE_MIN_PX, '/')).not.toBeNull();
    expect(swipe(-(TAB_SWIPE_MIN_PX - 1), '/')).toBeNull();
    // A scroll that drifts sideways: |dx| must beat 1.5 * |dy|.
    expect(swipe(-90, '/', { dy: 60 })).toBeNull();
    expect(swipe(-90, '/', { dy: 59 })).not.toBeNull();
    expect(swipe(0, '/', { dy: 300 })).toBeNull();
  });

  it('does nothing when the drag started somewhere blocked', () => {
    expect(swipe(-120, '/', { blocked: true })).toBeNull();
  });

  it('only on the tab pages themselves, not sub pages or sub views', () => {
    expect(swipe(-80, '/library/liked')).toBeNull();
    expect(swipe(-80, '/playlist/abc')).toBeNull();
    expect(swipe(-80, '/settings')).toBeNull();
    expect(swipe(-80, '/radio')).toBeNull();
    expect(swipe(-80, '/', { search: '?focus=charts' })).toBeNull();
    expect(swipe(-80, '/', { search: '?row=mixes' })).toBeNull();
    expect(swipe(-80, null as unknown as string)).toBeNull();
  });

  it('a search query or trailing slash is still the tab', () => {
    expect(swipe(80, '/search', { search: '?q=abba' })).toEqual({ href: '/', dir: 'prev' });
    expect(tabIndexFor('/library/')).toBe(2);
    expect(tabIndexFor('/', '?utm=x')).toBe(0);
  });
});

describe('isTabSwipeBlocked', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mount(html: string): HTMLElement {
    const area = document.createElement('div');
    area.innerHTML = html;
    document.body.appendChild(area);
    return area;
  }

  it('plain page content is free to swipe', () => {
    const area = mount('<section><p id="t">Hello</p></section>');
    expect(isTabSwipeBlocked(area.querySelector('#t'), area)).toBe(false);
    // A text node starts from its element.
    expect(isTabSwipeBlocked(area.querySelector('#t')!.firstChild, area)).toBe(false);
  });

  it('typing, sliders, menus, dialogs and marked elements are not', () => {
    const area = mount(`
      <input id="input" />
      <textarea id="ta"></textarea>
      <div contenteditable="true"><span id="ce">x</span></div>
      <input id="range" type="range" />
      <div data-slot="slider"><span id="track">t</span></div>
      <div role="slider" id="thumb"></div>
      <div role="dialog"><button id="dlg">x</button></div>
      <div role="menu"><div id="menu">x</div></div>
      <div data-no-tab-swipe><span id="marked">x</span></div>
    `);
    for (const id of ['input', 'ta', 'ce', 'range', 'track', 'thumb', 'dlg', 'menu', 'marked']) {
      expect(isTabSwipeBlocked(area.querySelector(`#${id}`), area), id).toBe(true);
    }
  });

  it('anything that scrolls sideways itself (a row of tiles, chips) is not', () => {
    const area = mount('<div id="row" style="overflow-x: auto"><a id="tile">tile</a></div><div id="fits" style="overflow-x: auto"><a id="short">x</a></div>');
    const row = area.querySelector<HTMLElement>('#row')!;
    Object.defineProperty(row, 'scrollWidth', { value: 900 });
    Object.defineProperty(row, 'clientWidth', { value: 360 });
    expect(isTabSwipeBlocked(area.querySelector('#tile'), area)).toBe(true);
    // A row whose content fits does not scroll, so it swipes the tab.
    const fits = area.querySelector<HTMLElement>('#fits')!;
    Object.defineProperty(fits, 'scrollWidth', { value: 360 });
    Object.defineProperty(fits, 'clientWidth', { value: 360 });
    expect(isTabSwipeBlocked(area.querySelector('#short'), area)).toBe(false);
  });

  it('wide content that is clipped (overflow hidden) does not block', () => {
    const area = mount('<div id="clip" style="overflow-x: hidden"><span id="in">x</span></div>');
    const clip = area.querySelector<HTMLElement>('#clip')!;
    Object.defineProperty(clip, 'scrollWidth', { value: 900 });
    Object.defineProperty(clip, 'clientWidth', { value: 360 });
    expect(isTabSwipeBlocked(area.querySelector('#in'), area)).toBe(false);
  });
});

describe('hasOpenOverlay', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sees an open dialog or menu, not a hidden one', () => {
    expect(hasOpenOverlay(document)).toBe(false);
    document.body.innerHTML = '<div role="dialog" aria-hidden="true"></div>';
    expect(hasOpenOverlay(document)).toBe(false);
    document.body.innerHTML = '<div role="dialog" aria-hidden="false"></div>';
    expect(hasOpenOverlay(document)).toBe(true);
    document.body.innerHTML = '<div role="menu"></div>';
    expect(hasOpenOverlay(document)).toBe(true);
  });
});

describe('cameBySwipe', () => {
  it('is true just after a swipe and false later', async () => {
    const { markTabSwipe, cameBySwipe } = await import('./tabSwipe');
    markTabSwipe(10_000);
    expect(cameBySwipe(10_500)).toBe(true);
    expect(cameBySwipe(12_000)).toBe(false);
  });
});
