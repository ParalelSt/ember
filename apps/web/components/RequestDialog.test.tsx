import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestDialog } from './RequestDialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger/client', () => ({
  logger: {
    snapshot: () => ({
      current: [],
      previous: [],
      sessionId: 's1',
      context: { appVersion: '1.0.0', shell: 'web', route: '/settings/help', platform: 'MacIntel' },
    }),
  },
}));

// @base-ui components reach the repo root's hoisted React 18 through their own
// node_modules copy (see BugReportDialog.test.tsx), so render plain elements
// for anything built on it: this test is about state and the request body,
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
vi.mock('@/components/ui/input', () => ({
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
}));

// Stand-in for base-ui's Tabs.Root/Tab: captures the live onValueChange in a
// hoisted ref so TabsTrigger's click handler (a separate mocked component)
// can call it, without needing React context or base-ui's own wiring.
const tabsState = vi.hoisted(() => ({ onValueChange: (_v: string) => {} }));
vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children, onValueChange }: PropsWithChildren<{ onValueChange: (v: string) => void }>) => {
    tabsState.onValueChange = onValueChange;
    return <div>{children}</div>;
  },
  TabsList: ({ children }: PropsWithChildren) => <div role="tablist">{children}</div>,
  TabsTrigger: ({ children, value }: PropsWithChildren<{ value: string }>) => (
    <button type="button" role="tab" onClick={() => tabsState.onValueChange(value)}>
      {children}
    </button>
  ),
}));

function mockFetch(ok = true, body: unknown = { ok: true }) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body, statusText: 'error' });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>) {
  const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return JSON.parse(String(init.body));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RequestDialog: default kind', () => {
  it('shows the feature labels and placeholders', () => {
    render(<RequestDialog open onOpenChange={() => {}} />);
    expect(screen.getByPlaceholderText('Short name, e.g. Sleep timer')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(
        'What should it do, and when would you use it? e.g. Stop playback after 30 minutes so I can fall asleep to music.',
      ),
    ).toBeInTheDocument();
  });
});

describe('RequestDialog: switching kind', () => {
  it('changes labels and placeholders and keeps typed text', async () => {
    render(<RequestDialog open onOpenChange={() => {}} />);
    const nameInput = screen.getByPlaceholderText('Short name, e.g. Sleep timer');
    await userEvent.type(nameInput, 'Something');

    await userEvent.click(screen.getByRole('tab', { name: 'Fix' }));

    expect(screen.getByPlaceholderText('What needs fixing, e.g. Queue jumps to the top')).toHaveValue('Something');
    expect(screen.getByText('Recommended approach')).toBeInTheDocument();
  });
});

describe('RequestDialog: Send disabled state', () => {
  it('disables Send until name and main are filled', async () => {
    render(<RequestDialog open onOpenChange={() => {}} />);
    const sendButton = screen.getByRole('button', { name: 'Send' });
    expect(sendButton).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('Short name, e.g. Sleep timer'), 'Sleep timer');
    expect(sendButton).toBeDisabled();

    await userEvent.type(
      screen.getByPlaceholderText(
        'What should it do, and when would you use it? e.g. Stop playback after 30 minutes so I can fall asleep to music.',
      ),
      'Stop after 30 min',
    );
    expect(sendButton).not.toBeDisabled();
  });
});

describe('RequestDialog: submit', () => {
  it('posts the right body', async () => {
    const fetchMock = mockFetch();
    render(<RequestDialog open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText('Short name, e.g. Sleep timer'), 'Sleep timer');
    await userEvent.type(
      screen.getByPlaceholderText(
        'What should it do, and when would you use it? e.g. Stop playback after 30 minutes so I can fall asleep to music.',
      ),
      'Stop after 30 min',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe('/api/requests');
    expect(init.method).toBe('POST');
    const body = requestBody(fetchMock);
    expect(body).toMatchObject({
      kind: 'feature',
      name: 'Sleep timer',
      main: 'Stop after 30 min',
      context: { appVersion: '1.0.0', shell: 'web', route: '/settings/help', platform: 'MacIntel' },
    });
  });

  it('shows the API error text on failure', async () => {
    mockFetch(false, { error: 'Requests are not set up on this server' });
    render(<RequestDialog open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText('Short name, e.g. Sleep timer'), 'Sleep timer');
    await userEvent.type(
      screen.getByPlaceholderText(
        'What should it do, and when would you use it? e.g. Stop playback after 30 minutes so I can fall asleep to music.',
      ),
      'Stop after 30 min',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Requests are not set up on this server')).toBeInTheDocument();
  });

  it('closes and resets on success', async () => {
    const fetchMock = mockFetch();
    const onOpenChange = vi.fn();
    render(<RequestDialog open onOpenChange={onOpenChange} />);
    await userEvent.type(screen.getByPlaceholderText('Short name, e.g. Sleep timer'), 'Sleep timer');
    await userEvent.type(
      screen.getByPlaceholderText(
        'What should it do, and when would you use it? e.g. Stop playback after 30 minutes so I can fall asleep to music.',
      ),
      'Stop after 30 min',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
