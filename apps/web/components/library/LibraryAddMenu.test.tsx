import type { ComponentProps, PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

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

const screenSize = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => screenSize.desktop }));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, 'data-testid': testId }: PropsWithChildren<{ 'data-testid'?: string }>) => (
    <div role="dialog" data-testid={testId}>
      {children}
    </div>
  ),
  SheetHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));

const { LibraryAddMenu } = await import('./LibraryAddMenu');

const handlers = () => ({ onNewPlaylist: vi.fn(), onCarlist: vi.fn(), onImport: vi.fn() });

afterEach(() => {
  screenSize.desktop = true;
});

describe('LibraryAddMenu on desktop', () => {
  it('is a dropdown: New playlist, Start a carlist, Import, each calling its flow', () => {
    const h = handlers();
    render(<LibraryAddMenu {...h} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['New playlist', 'Start a carlist', 'Import']);
    fireEvent.click(screen.getByRole('menuitem', { name: /New playlist/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Start a carlist/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Import/ }));
    expect(h.onNewPlaylist).toHaveBeenCalledTimes(1);
    expect(h.onCarlist).toHaveBeenCalledTimes(1);
    expect(h.onImport).toHaveBeenCalledTimes(1);
  });
});

describe('LibraryAddMenu on a phone (popups1: a sheet from the bottom)', () => {
  it('the + opens a sheet with the three rows; a row runs its flow and closes the sheet', () => {
    screenSize.desktop = false;
    const h = handlers();
    render(<LibraryAddMenu {...h} />);
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    const plus = screen.getByTestId('library-add');
    expect(plus).toHaveAccessibleName('Create or import');
    fireEvent.click(plus);
    const sheet = screen.getByTestId('action-sheet');
    expect(within(sheet).getByRole('heading')).toHaveTextContent('Create or import');
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual([
      'New playlist',
      'Start a carlist',
      'Import',
    ]);
    fireEvent.click(within(sheet).getByRole('button', { name: /New playlist/ }));
    expect(h.onNewPlaylist).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(plus);
    fireEvent.click(screen.getByTestId('library-add-carlist'));
    expect(h.onCarlist).toHaveBeenCalledTimes(1);
    fireEvent.click(plus);
    fireEvent.click(screen.getByTestId('library-add-import'));
    expect(h.onImport).toHaveBeenCalledTimes(1);
  });

  it('with a carlist live, the carlist row says it opens yours', () => {
    screenSize.desktop = false;
    render(<LibraryAddMenu {...handlers()} carlistLive />);
    fireEvent.click(screen.getByTestId('library-add'));
    expect(screen.getByTestId('library-add-carlist')).toHaveTextContent('Open your carlist');
  });
});
