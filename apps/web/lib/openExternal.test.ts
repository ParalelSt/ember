import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isExternalUrl, openExternal, routeNewTabLinks } from './openExternal';

const UG = 'https://www.ultimate-guitar.com/search.php?search_type=title&value=Coastline+Copper+Sky';
type W = { __TAURI_INTERNALS__?: unknown };

let open: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  open = vi.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(() => {
  delete (window as W).__TAURI_INTERNALS__;
  open.mockRestore();
  document.body.innerHTML = '';
});

function desktop(invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>) {
  (window as W).__TAURI_INTERNALS__ = { invoke: vi.fn(invoke) };
  return (window as unknown as { __TAURI_INTERNALS__: { invoke: ReturnType<typeof vi.fn> } }).__TAURI_INTERNALS__.invoke;
}

describe('openExternal', () => {
  it('only web links', () => {
    expect(isExternalUrl(UG)).toBe(true);
    expect(isExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isExternalUrl('/tabs/x')).toBe(false);
  });

  it('on the web: a new tab, opened inside the click, with noopener', async () => {
    const p = openExternal(UG);
    // Synchronously, before any await: a popup blocker allows only that.
    expect(open).toHaveBeenCalledWith(UG, '_blank', 'noopener,noreferrer');
    expect(await p).toBe('opened');
  });

  it('refuses anything that is not a web link', async () => {
    expect(await openExternal('javascript:alert(1)')).toBe('failed');
    expect(open).not.toHaveBeenCalled();
  });

  it('in the desktop app: the system browser, through the shell', async () => {
    const invoke = desktop(async () => null);
    expect(await openExternal(UG)).toBe('opened');
    expect(invoke).toHaveBeenCalledWith('open_external', { url: UG });
    // Never window.open there: the webview drops it.
    expect(open).not.toHaveBeenCalled();
  });

  it('a desktop build without the command copies the link instead', async () => {
    desktop(async () => {
      throw new Error('Command open_external not allowed by ACL');
    });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    expect(await openExternal(UG)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(UG);
  });
});

describe('routeNewTabLinks (desktop app)', () => {
  function link(target = '_blank') {
    const a = document.createElement('a');
    a.href = UG;
    a.target = target;
    a.textContent = 'Ultimate Guitar';
    document.body.appendChild(a);
    return a;
  }

  it('sends a new-tab link to the system browser', async () => {
    const invoke = desktop(async () => null);
    const outcomes: string[] = [];
    const stop = routeNewTabLinks((o) => outcomes.push(o));
    const a = link();
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(outcomes).toEqual(['opened']));
    expect(invoke).toHaveBeenCalledWith('open_external', { url: UG });
    stop();
  });

  it('leaves same-tab links and links with their own handler alone', () => {
    const invoke = desktop(async () => null);
    const stop = routeNewTabLinks();
    link('').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const own = link();
    own.addEventListener('click', (e) => e.preventDefault());
    own.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(invoke).not.toHaveBeenCalled();
    stop();
  });

  it('does nothing on the web', () => {
    const stop = routeNewTabLinks();
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    stop();
  });
});
