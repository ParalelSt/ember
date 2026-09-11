import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUiStore } from '@/stores/useUiStore';
import type { ClientSnapshot } from '@/lib/logger/types';
import { BugReportDialog } from './BugReportDialog';

// The desktop bridge: the shell is Tauri and `invoke` is whatever the test
// sets. Both are module-level imports of BugReportDialog's dependency chain,
// so they have to be hoisted mocks.
const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => 'tauri' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @base-ui's Dialog and Button reach the repo root's hoisted React 18 through
// their own node_modules copy (the same resolution problem OnlineOnly.test.tsx
// documents), so render plain elements instead: this test is about the payload,
// not the chrome.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}));

/** The snapshot the route actually received. */
function sentSnapshot(fetchMock: ReturnType<typeof vi.fn>): ClientSnapshot {
  const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return (JSON.parse(String(init.body)) as { client: ClientSnapshot }).client;
}

function mockFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, triage: null }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function submitReport() {
  render(<BugReportDialog />);
  await userEvent.click(await screen.findByRole('button', { name: 'Send report' }));
}

beforeEach(() => {
  useUiStore.setState({ bugReportOpen: true });
  tauri.invoke.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  useUiStore.setState({ bugReportOpen: false });
});

describe('BugReportDialog: desktop log', () => {
  it('includes the log tail when the tauri command resolves', async () => {
    tauri.invoke.mockResolvedValue('[1] INFO ember-desktop starting\n[2] WARN no audio output');
    const fetchMock = mockFetch();

    await submitReport();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(tauri.invoke).toHaveBeenCalledWith('log_tail', { lines: 200 });
    expect(sentSnapshot(fetchMock).desktopLog).toContain('no audio output');
  });

  it('still sends the report, without the field, when the command rejects', async () => {
    tauri.invoke.mockRejectedValue(new Error('Command log_tail not allowed by ACL'));
    const fetchMock = mockFetch();

    await submitReport();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentSnapshot(fetchMock).desktopLog).toBeUndefined();
  });

  it('does not wait longer than the timeout for a bridge that never answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    tauri.invoke.mockReturnValue(new Promise(() => {}));
    const fetchMock = mockFetch();

    await submitReport();
    await vi.advanceTimersByTimeAsync(2100);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentSnapshot(fetchMock).desktopLog).toBeUndefined();
    vi.useRealTimers();
  });
});
