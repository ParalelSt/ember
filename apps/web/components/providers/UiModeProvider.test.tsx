import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { UiModeProvider, uiModeReload, useUiMode } from './UiModeProvider';

const flush = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/nativeCookies', () => ({ flushNativeCookies: flush }));

function Probe() {
  const { mode, setMode } = useUiMode();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <button onClick={() => void setMode(mode === 'new' ? 'legacy' : 'new').catch(() => undefined)}>switch</button>
    </div>
  );
}

const reload = vi.fn();
const fetchMock = vi.fn();

beforeEach(() => {
  reload.mockReset();
  fetchMock.mockReset();
  vi.spyOn(uiModeReload, 'reload').mockImplementation(reload);
  vi.stubGlobal('fetch', fetchMock);
  document.documentElement.dataset.ui = 'new';
  document.cookie = 'ember_ui=; Max-Age=0; Path=/';
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.ui;
});

describe('UiModeProvider', () => {
  it('hands down the mode the server rendered', () => {
    render(<UiModeProvider mode="legacy"><Probe /></UiModeProvider>);
    expect(screen.getByTestId('mode').textContent).toBe('legacy');
  });

  it('setMode posts the new mode, then hard-reloads', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    render(<UiModeProvider mode="new"><Probe /></UiModeProvider>);
    await act(async () => screen.getByText('switch').click());
    expect(fetchMock).toHaveBeenCalledWith('/api/ui-mode', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ mode: 'legacy' }),
    }));
    expect(reload).toHaveBeenCalledTimes(1);
    // The phone app's cookie store is written to disk before the reload.
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]);
  });

  it('does not reload when the server refuses or cannot be reached', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    render(<UiModeProvider mode="new"><Probe /></UiModeProvider>);
    await act(async () => screen.getByText('switch').click());
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await act(async () => screen.getByText('switch').click());
    expect(reload).not.toHaveBeenCalled();
  });

  it('a page restored from the back/forward cache reloads when the cookie names the other look', () => {
    render(<UiModeProvider mode="new"><Probe /></UiModeProvider>);
    document.cookie = 'ember_ui=legacy; Path=/';
    const shown = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(shown, 'persisted', { value: true });
    window.dispatchEvent(shown);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves a restored page alone when cookie and page agree, or for a fresh load', () => {
    render(<UiModeProvider mode="new"><Probe /></UiModeProvider>);
    document.cookie = 'ember_ui=new; Path=/';
    const restored = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(restored, 'persisted', { value: true });
    window.dispatchEvent(restored);
    document.cookie = 'ember_ui=legacy; Path=/';
    const fresh = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(fresh, 'persisted', { value: false });
    window.dispatchEvent(fresh);
    expect(reload).not.toHaveBeenCalled();
  });

  it('outside a provider: the new look', () => {
    render(<Probe />);
    expect(screen.getByTestId('mode').textContent).toBe('new');
  });
});
