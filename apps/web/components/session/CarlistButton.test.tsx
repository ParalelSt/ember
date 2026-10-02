import type { ComponentProps, PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
  DropdownMenuContent: ({ children }: PropsWithChildren) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) => (
    <div role="menuitem" onClick={onClick}>
      {children}
    </div>
  ),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/session/SessionDialogs', () => ({
  StartSessionDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="start-dialog" /> : null),
  JoinSessionDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="join-dialog" /> : null),
}));
const live = vi.hoisted(() => ({ data: null as null | { id: string; code: string; name: string; isHost: boolean } }));
vi.mock('@/hooks/useSession', () => ({ useQueryLiveCarlist: () => ({ data: live.data }) }));

const { CarlistButton } = await import('./CarlistButton');

beforeEach(() => {
  live.data = null;
});

describe('CarlistButton (Your library)', () => {
  it('nothing live: one Carlist button with Start a carlist and Join a carlist', () => {
    render(<CarlistButton />);
    expect(screen.getByTestId('carlist-entry')).toHaveTextContent('Carlist');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['Start a carlist', 'Join a carlist']);
    expect(screen.queryByText(/Session/)).toBeNull();
  });

  it('Start a carlist opens today’s Start dialog', () => {
    render(<CarlistButton />);
    expect(screen.queryByTestId('start-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /Start a carlist/ }));
    expect(screen.getByTestId('start-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('join-dialog')).toBeNull();
  });

  it('Join a carlist opens the Join dialog', () => {
    render(<CarlistButton />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Join a carlist/ }));
    expect(screen.getByTestId('join-dialog')).toBeInTheDocument();
  });

  it('a live carlist: "Live · CODE", and it opens that carlist', () => {
    live.data = { id: 's1', code: 'K7MPQ4', name: 'Road trip', isHost: false };
    render(<CarlistButton />);
    const link = screen.getByTestId('carlist-live');
    expect(link).toHaveTextContent('Live · K7MPQ4');
    expect(link).toHaveAttribute('href', '/session/s1');
    expect(screen.queryByTestId('carlist-entry')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
