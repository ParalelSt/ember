import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useUiStore } from '@/stores/useUiStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import type { LogEntry } from './logger/types';

// desktopLog.ts statically imports @tauri-apps/api/core; stub it (same as
// BugReportDialog.test.tsx) so the module resolves in happy-dom without a
// real Tauri bridge. detectShell defaults to 'web' here, so readDesktopLog
// short-circuits to '' without ever calling invoke.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const { maybeAutoReport } = await import('./autoReport');

function errorEntry(over: Partial<LogEntry> = {}): LogEntry {
  return {
    ts: Date.now(),
    kind: 'error',
    level: 'error',
    category: 'js',
    message: 'window error',
    sessionId: 's1',
    ...over,
  };
}

function mockFetch() {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, triage: null }) });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function signIn() {
  document.cookie = 'pb_auth=sometoken';
}

function signOut() {
  document.cookie = 'pb_auth=; Max-Age=0';
}

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  useUiStore.setState({ bugReportOpen: false });
  useSettingsStore.setState({ autoReportEnabled: true });
  signIn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  signOut();
});

describe('maybeAutoReport: gating', () => {
  it('does nothing when signed out', async () => {
    signOut();
    const fetchMock = mockFetch();
    maybeAutoReport(errorEntry());
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing while offline, and keeps the session slot for later', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fetchMock = mockFetch();
    maybeAutoReport(errorEntry());
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    maybeAutoReport(errorEntry());
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    online.mockRestore();
  });

  it('does nothing when the Settings toggle is off', async () => {
    useSettingsStore.setState({ autoReportEnabled: false });
    const fetchMock = mockFetch();
    maybeAutoReport(errorEntry());
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing while the manual report dialog is open', async () => {
    useUiStore.setState({ bugReportOpen: true });
    const fetchMock = mockFetch();
    maybeAutoReport(errorEntry());
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a non-error-level entry', async () => {
    const fetchMock = mockFetch();
    maybeAutoReport(errorEntry({ kind: 'breadcrumb', level: 'info' }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('maybeAutoReport: sends', () => {
  it('posts the dialog-shaped body with automatic:true and a category: message note', async () => {
    const fetchMock = mockFetch();
    maybeAutoReport(errorEntry({ category: 'playback', message: 'native audio failed' }));
    await vi.advanceTimersByTimeAsync(2000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/bug-report');
    const body = JSON.parse(String(init.body));
    expect(body.automatic).toBe(true);
    expect(body.note).toBe('playback: native audio failed');
    expect(body.client).toBeDefined();
  });

  it('debounces a burst of the same fingerprint into a single report', async () => {
    const fetchMock = mockFetch();
    const entry = errorEntry({ category: 'js', message: 'boom' });
    maybeAutoReport(entry);
    await vi.advanceTimersByTimeAsync(500);
    maybeAutoReport(entry);
    await vi.advanceTimersByTimeAsync(500);
    maybeAutoReport(entry);
    await vi.advanceTimersByTimeAsync(2000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never sends the same fingerprint twice in a session', async () => {
    const fetchMock = mockFetch();
    const entry = errorEntry({ category: 'js', message: 'boom' });
    maybeAutoReport(entry);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A later, unrelated occurrence of the exact same bug (well past the
    // debounce window, in a fresh call) still must not fire again.
    maybeAutoReport(errorEntry({ category: 'js', message: 'boom' }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps automatic reports at 3 per session even across distinct fingerprints', async () => {
    const fetchMock = mockFetch();
    for (let i = 0; i < 5; i++) {
      maybeAutoReport(errorEntry({ category: `cat${i}`, message: `distinct failure ${i}` }));
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
