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
    onToggle: vi.fn(),
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

describe('CollaborateSheet, the owner', () => {
  it('shows the switch, the owner and members, and removes a member', () => {
    const p = setup();
    expect(screen.getByRole('switch', { name: 'Collaborative' })).toHaveAttribute('aria-checked', 'true');
    const rows = screen.getAllByTestId('collab-person');
    expect(rows.map((r) => r.textContent)).toEqual(['OOlgaOwner · You', 'Mia']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Mia' }));
    expect(p.onRemove).toHaveBeenCalledWith(mia);
    fireEvent.click(screen.getByRole('switch', { name: 'Collaborative' }));
    expect(p.onToggle).toHaveBeenCalledWith(false);
  });

  it('while it is off: only the switch, no people or link', () => {
    setup({ state: state({ collaborative: false }) });
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('collab-people')).toBeNull();
    expect(screen.queryByTestId('collab-link')).toBeNull();
  });

  it('the picker leaves out members and filters by name', () => {
    const p = setup({ picking: true, people: [mia, xan, { id: 'ana', name: 'Ana', avatarUrl: null }] });
    const picker = screen.getByTestId('collab-picker');
    expect(within(picker).getAllByTestId('collab-candidate').map((r) => r.textContent)).toEqual(['XXanAdd', 'AAnaAdd']);
    fireEvent.change(within(picker).getByRole('textbox', { name: 'Find someone by name' }), { target: { value: 'xa' } });
    expect(within(picker).getAllByTestId('collab-candidate')).toHaveLength(1);
    fireEvent.click(within(picker).getByRole('button', { name: 'Add Xan' }));
    expect(p.onAdd).toHaveBeenCalledWith(xan);
  });

  it('an email shows only when the server sent one (an admin owner)', () => {
    setup({ picking: true, people: [{ ...xan, email: 'xan@ember.test' }] });
    expect(screen.getByTestId('collab-candidate').textContent).toContain('xan@ember.test');
  });

  it('the invite link: create when off; copy, replace and turn off when on', () => {
    const off = setup();
    fireEvent.click(screen.getByTestId('collab-link-create'));
    expect(off.onNewLink).toHaveBeenCalled();
  });

  it('with a link on', () => {
    const on = setup({ inviteLink: 'https://ember.test/playlist/join/abc' });
    expect(screen.getByTestId('collab-link-url')).toHaveValue('https://ember.test/playlist/join/abc');
    fireEvent.click(screen.getByTestId('collab-link-copy'));
    fireEvent.click(screen.getByTestId('collab-link-new'));
    fireEvent.click(screen.getByTestId('collab-link-off'));
    expect(on.onCopyLink).toHaveBeenCalled();
    expect(on.onNewLink).toHaveBeenCalled();
    expect(on.onStopLink).toHaveBeenCalled();
  });

  it('no Add people at the cap', () => {
    setup({ state: state({ maxMembers: 1 }) });
    expect(screen.queryByTestId('collab-add')).toBeNull();
  });
});

describe('CollaborateSheet, a member', () => {
  it('reads who can edit, and nothing else', () => {
    setup({ state: state({ role: 'member', inviteCode: undefined, members: [mia, xan] }), meId: 'mia' });
    expect(screen.getByRole('heading', { name: 'Who can edit' })).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByTestId('collab-add')).toBeNull();
    expect(screen.queryByTestId('collab-link')).toBeNull();
    expect(screen.getAllByTestId('collab-person').map((r) => r.textContent)).toEqual(['OOlgaOwner', 'MiaYou', 'XXan']);
  });
});
