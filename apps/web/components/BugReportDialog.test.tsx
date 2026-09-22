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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

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

describe('BugReportDialog: attachments', () => {
  const MB = 1024 * 1024;
  const fakeFile = (name: string, type: string, size = 1000) => {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };
  const attach = (files: File[]) => userEvent.upload(screen.getByTestId('attachment-input'), files);

  beforeEach(() => {
    tauri.invoke.mockResolvedValue('');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps sending plain JSON when nothing is attached', async () => {
    const fetchMock = mockFetch();
    await submitReport();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(typeof init.body).toBe('string');
  });

  it('sends the files as multipart with the report JSON in a payload part', async () => {
    const fetchMock = mockFetch();
    render(<BugReportDialog />);
    await userEvent.type(screen.getByPlaceholderText('What happened? (optional)'), 'It went silent');
    await attach([fakeFile('shot.png', 'image/png'), fakeFile('clip.webm', 'video/webm')]);
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe('/api/bug-report');
    expect(init.headers).toBeUndefined();
    const form = init.body as FormData;
    const payload = JSON.parse(form.get('payload') as string);
    expect(payload.note).toBe('It went silent');
    expect(Array.isArray(payload.client.current)).toBe(true);
    expect((form.getAll('attachments') as File[]).map((f) => f.name)).toEqual(['shot.png', 'clip.webm']);
    await waitFor(() => expect(screen.queryAllByTestId('attach-thumb')).toHaveLength(0));
  });

  it('disables Send report while the files are not sendable', async () => {
    mockFetch();
    render(<BugReportDialog />);
    const send = screen.getByRole('button', { name: 'Send report' });
    await attach([fakeFile('long.mp4', 'video/mp4', 11 * MB)]);
    expect(screen.getByTestId('attach-problem')).toHaveTextContent('Files are 11 MB.');
    expect(send).toBeDisabled();
  });

  it('clears the files on Cancel', async () => {
    render(<BugReportDialog />);
    await attach([fakeFile('shot.png', 'image/png')]);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useUiStore.getState().bugReportOpen).toBe(false);
    useUiStore.setState({ bugReportOpen: true });
    expect(screen.queryAllByTestId('attach-thumb')).toHaveLength(0);
  });
});

describe('BugReportDialog: attachments Discord would not take', () => {
  it('says the report went without them', async () => {
    const { toast } = await import('sonner');
    tauri.invoke.mockResolvedValue('');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, triage: null, attachmentsDropped: true }),
    }));
    render(<BugReportDialog />);
    await userEvent.upload(screen.getByTestId('attachment-input'), new File(['x'], 'shot.png', { type: 'image/png' }));
    vi.mocked(toast.success).mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('Sent, but the attachments were too big for Discord'));
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(useUiStore.getState().bugReportOpen).toBe(false));
    vi.restoreAllMocks();
  });
});
