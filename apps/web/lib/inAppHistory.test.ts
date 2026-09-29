import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canGoBackInApp, leavePage, notePathname, resetInAppHistory } from './inAppHistory';

beforeEach(() => resetInAppHistory());
afterEach(() => vi.unstubAllGlobals());

describe('inAppHistory', () => {
  it('the first page seen has nothing of Ember behind it', () => {
    notePathname('/tabs/x');
    notePathname('/tabs/x');
    expect(canGoBackInApp()).toBe(false);
  });

  it('a page reached after another one was seen was reached in Ember', () => {
    notePathname('/library');
    notePathname('/tabs/x');
    expect(canGoBackInApp()).toBe(true);
  });

  it('ignores a missing pathname', () => {
    notePathname(null);
    notePathname('/tabs/x');
    expect(canGoBackInApp()).toBe(false);
  });

  it('the Navigation API, where there is one, decides', () => {
    notePathname('/library');
    notePathname('/tabs/x');
    vi.stubGlobal('navigation', { canGoBack: false });
    expect(canGoBackInApp()).toBe(false);
    resetInAppHistory();
    vi.stubGlobal('navigation', { canGoBack: true });
    expect(canGoBackInApp()).toBe(true);
  });

  it('leavePage goes Back inside Ember, else home', () => {
    const router = { back: vi.fn(), push: vi.fn() };
    leavePage(router);
    expect(router.push).toHaveBeenCalledWith('/');
    expect(router.back).not.toHaveBeenCalled();
    notePathname('/library');
    notePathname('/tabs/x');
    leavePage(router);
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
