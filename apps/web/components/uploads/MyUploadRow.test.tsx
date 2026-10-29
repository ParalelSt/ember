import type { ComponentProps, PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { MyUpload } from '@/types/track';

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
  DropdownMenuContent: ({ children }: PropsWithChildren) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick, variant }: PropsWithChildren<{ onClick?: () => void; variant?: string }>) => (
    <div role="menuitem" data-variant={variant} onClick={onClick}>
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

const { MyUploadRow } = await import('./MyUploadRow');

const upload: MyUpload = {
  id: 'upload:u1', source: 'upload', sourceId: 'u1', title: 'Night Drive', artist: 'Coastline',
  artistId: null, album: null, albumId: null, durationSec: 100, artworkUrl: '/api/uploads/u1/art', streamUrl: '',
  sizeBytes: 1024 * 1024, created: '2026-10-12 10:00:00.000Z',
};

function setup() {
  const onEdit = vi.fn();
  const onRemove = vi.fn();
  render(
    <ul>
      <MyUploadRow upload={upload} onEdit={onEdit} onRemove={onRemove} />
    </ul>,
  );
  return { onEdit, onRemove };
}

afterEach(() => {
  screenSize.desktop = true;
});

describe('MyUploadRow on desktop', () => {
  it('the ... is a dropdown: Edit details, then Remove in red', () => {
    const { onEdit, onRemove } = setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'More options for Night Drive' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit details', 'Remove']);
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveAttribute('data-variant', 'destructive');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit details' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(onEdit).toHaveBeenCalledWith(upload);
    expect(onRemove).toHaveBeenCalledWith(upload);
  });
});

describe('MyUploadRow on a phone (popups1: a sheet from the bottom)', () => {
  it('opens a sheet with the cover, title and artist on top; each row runs and closes it', () => {
    screenSize.desktop = false;
    const { onEdit, onRemove } = setup();
    expect(screen.queryByRole('menuitem')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More options for Night Drive' }));
    const sheet = screen.getByTestId('action-sheet');
    expect(within(sheet).getByRole('heading')).toHaveTextContent('Night Drive options');
    expect(sheet).toHaveTextContent('Coastline');
    expect(sheet.querySelector('img')).toHaveAttribute('src', '/api/uploads/u1/art');
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent)).toEqual(['Edit details', 'Remove']);
    expect(screen.getByTestId('upload-menu-remove')).toHaveClass('text-destructive');

    fireEvent.click(screen.getByTestId('upload-menu-edit'));
    expect(onEdit).toHaveBeenCalledWith(upload);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More options for Night Drive' }));
    fireEvent.click(screen.getByTestId('upload-menu-remove'));
    expect(onRemove).toHaveBeenCalledWith(upload);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
