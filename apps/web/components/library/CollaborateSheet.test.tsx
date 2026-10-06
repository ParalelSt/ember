import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { CollabState } from '@/lib/collab';

// The sheet's own chrome (portal, focus trap) is not what is tested here.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => (
    <div data-testid={rest['data-testid'] as string}>{children}</div>
  ),
  SheetTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  SheetDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));

const { CollaborateSheet } = await import('./CollaborateSheet');

const olga = { id: 'olga', name: 'Olga', avatarUrl: null };
const mia = { id: 'mia', name: 'Mia', avatarUrl: '/pb/api/files/u/mia/a.png' };
const xan = { id: 'xan', name: 'Xan', avatarUrl: null };

function state(patch: Partial<CollabState> = {}): CollabState {
  return { collaborative: true, role: 'owner', owner: olga, members: [mia], maxMembers: 50, inviteCode: null, ...patch };
}

function setup(patch: Partial<Parameters<typeof CollaborateSheet>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    playlistName: 'Road trip',
    side: 'right' as const,
    state: state(),
    error: null,
    meId: 'olga',
    inviteLink: null,
    people: undefined,
    peopleLoading: false,
    picking: false,
    onPickingChange: vi.fn(),
    busy: false,
    onShareLink: vi.fn(),
    onStopSharing: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onNewLink: vi.fn(),
    onStopLink: vi.fn(),
    onCopyLink: vi.fn(),
    ...patch,
  };
  render(<CollaborateSheet {...props} />);
  return props;
}

describe('CollaborateSheet, the owner (link first)', () => {
  it('is titled Share "<name>" and has no Collaborative switch', () => {
    setup({ state: state({ collaborative: false, members: [] }) });
    expect(screen.getByRole('heading', { name: 'Share "Road trip"' })).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('first time: one big Copy invite link that turns sharing on; only you so far; no Stop sharing', () => {
    const p = setup({ state: state({ collaborative: false, members: [] }) });
    const link = screen.getByTestId('collab-link');
    expect(within(link).queryByTestId('collab-link-url')).toBeNull();
    fireEvent.click(within(link).getByRole('button', { name: 'Copy invite link' }));
    expect(p.onShareLink).toHaveBeenCalled();
    expect(screen.getByTestId('collab-people')).toHaveTextContent('Only you so far.');
    expect(screen.queryByTestId('collab-stop-sharing')).toBeNull();
  });

  it('shared but no link yet: the same Copy invite link makes one', () => {
    const p = setup();
    fireEvent.click(screen.getByTestId('collab-link-create'));
    expect(p.onShareLink).toHaveBeenCalled();
  });

  it('with a link: the link, Copy link, New link and Turn off link', () => {
    const p = setup({ inviteLink: 'https://ember.test/playlist/join/abc' });
    expect(screen.getByTestId('collab-link-url')).toHaveValue('https://ember.test/playlist/join/abc');
    expect(screen.queryByTestId('collab-link-create')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    fireEvent.click(screen.getByRole('button', { name: 'New link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn off link' }));
    expect(p.onCopyLink).toHaveBeenCalled();
    expect(p.onNewLink).toHaveBeenCalled();
    expect(p.onStopLink).toHaveBeenCalled();
  });

  it('People who can edit: the owner and members, and removes a member', () => {
    const p = setup();
    const people = screen.getByTestId('collab-people');
    expect(within(people).getByRole('heading', { name: 'People who can edit' })).toBeInTheDocument();
    expect(screen.getAllByTestId('collab-person').map((r) => r.textContent)).toEqual(['OOlgaOwner · You', 'Mia']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Mia' }));
    expect(p.onRemove).toHaveBeenCalledWith(mia);
  });

  it('Add by name opens the picker, which leaves out members and filters by name', () => {
    const first = setup({ state: state({ collaborative: false, members: [] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Add by name' }));
    expect(first.onPickingChange).toHaveBeenCalledWith(true);
  });

  it('the picker', () => {
    const p = setup({ picking: true, people: [mia, xan, { id: 'ana', name: 'Ana', avatarUrl: null }] });
    const picker = screen.getByTestId('collab-picker');
    expect(within(picker).getAllByTestId('collab-candidate').map((r) => r.textContent)).toEqual(['XXanAdd', 'AAnaAdd']);
    fireEvent.change(within(picker).getByRole('textbox', { name: 'Find someone by name' }), { target: { value: 'xa' } });
    expect(within(picker).getAllByTestId('collab-candidate')).toHaveLength(1);
    fireEvent.click(within(picker).getByRole('button', { name: 'Add Xan' }));
    expect(p.onAdd).toHaveBeenCalledWith(xan);
    fireEvent.click(within(picker).getByRole('button', { name: 'Close the picker' }));
    expect(p.onPickingChange).toHaveBeenCalledWith(false);
  });

  it('an email shows only when the server sent one (an admin owner)', () => {
    setup({ picking: true, people: [{ ...xan, email: 'xan@ember.test' }] });
    expect(screen.getByTestId('collab-candidate').textContent).toContain('xan@ember.test');
  });

  it('Stop sharing at the end, while it is shared', () => {
    const p = setup();
    fireEvent.click(screen.getByTestId('collab-stop-sharing'));
    expect(p.onStopSharing).toHaveBeenCalled();
  });

  it('sharing off with people still listed: says they get back in when it is shared again', () => {
    setup({ state: state({ collaborative: false }) });
    expect(screen.getByTestId('collab-people')).toHaveTextContent('Sharing is off.');
    expect(screen.queryByTestId('collab-stop-sharing')).toBeNull();
  });

  it('no Add by name at the cap', () => {
    setup({ state: state({ maxMembers: 1 }) });
    expect(screen.queryByRole('button', { name: 'Add by name' })).toBeNull();
  });

  it('busy: the link buttons wait', () => {
    setup({ busy: true, state: state({ collaborative: false, members: [] }) });
    expect(screen.getByRole('button', { name: 'Copy invite link' })).toBeDisabled();
  });
});

describe('CollaborateSheet, a member', () => {
  it('reads who can edit, and nothing else', () => {
    setup({ state: state({ role: 'member', inviteCode: undefined, members: [mia, xan] }), meId: 'mia' });
    expect(screen.getByRole('heading', { name: 'Who can edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add by name' })).toBeNull();
    expect(screen.queryByTestId('collab-link')).toBeNull();
    expect(screen.queryByTestId('collab-stop-sharing')).toBeNull();
    expect(screen.getAllByTestId('collab-person').map((r) => r.textContent)).toEqual(['OOlgaOwner', 'MiaYou', 'XXan']);
  });
});
