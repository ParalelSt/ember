import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/ui/dialog', () => import('@/test-utils/dialogMock'));

const { Popup } = await import('./popup');

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('Popup', () => {
  it('shows nothing while closed', () => {
    render(<Popup open={false} onOpenChange={() => {}} title="Hello" actionLabel="Go" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the title, description and content, and passes the rest to the box', () => {
    render(
      <Popup open onOpenChange={() => {}} title="Hello" description="Why" actionLabel="Go" data-testid="box" className="sm:max-w-md">
        <p>Body</p>
      </Popup>,
    );
    const box = screen.getByTestId('box');
    expect(box.className).toContain('sm:max-w-md');
    expect(box).toHaveTextContent('Hello');
    expect(box).toHaveTextContent('Why');
    expect(box).toHaveTextContent('Body');
  });

  it('Cancel calls onOpenChange(false); the action calls onAction', () => {
    const onOpenChange = vi.fn();
    const onAction = vi.fn();
    render(<Popup open onOpenChange={onOpenChange} title="T" actionLabel="Go" onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('busy disables both buttons and shows the busy label', () => {
    render(<Popup open onOpenChange={() => {}} title="T" actionLabel="Go" busyLabel="Going…" busy onAction={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Going…' })).toBeDisabled();
  });

  it('busy without a busy label keeps the plain label', () => {
    render(<Popup open onOpenChange={() => {}} title="T" actionLabel="Go" busy />);
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
  });

  it('actionDisabled leaves Cancel live', () => {
    render(<Popup open onOpenChange={() => {}} title="T" actionLabel="Go" actionDisabled />);
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled();
  });

  it('cancelLabel null leaves Cancel out', () => {
    render(<Popup open onOpenChange={() => {}} title="T" actionLabel="Go" cancelLabel={null} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('with onSubmit the action submits a form and Cancel does not', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onOpenChange = vi.fn();
    render(
      <Popup open onOpenChange={onOpenChange} title="T" actionLabel="Save" onSubmit={onSubmit}>
        <input aria-label="Name" />
      </Popup>,
    );
    const action = screen.getByRole('button', { name: 'Save' });
    expect(action).toHaveAttribute('type', 'submit');
    expect(action.closest('form')).toBe(screen.getByLabelText('Name').closest('form'));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(action);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('without onSubmit there is no form', () => {
    render(<Popup open onOpenChange={() => {}} title="T" actionLabel="Go" />);
    expect(screen.getByRole('dialog').querySelector('form')).toBeNull();
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'button');
  });

  // No visual change: the form must not become a box of its own between the
  // popup's grid and the header, content and footer. The mock drops the grid,
  // so this reads the source.
  it('its form takes no box of its own', () => {
    expect(read('components/ui/popup.tsx')).toContain('className="contents"');
  });

  it.each([
    'components/ui/confirm-dialog.tsx',
    'components/ui/password-reset-dialog.tsx',
    'components/library/RenamePlaylistDialog.tsx',
    'components/BugReportDialog.tsx',
    'components/RequestDialog.tsx',
    'components/track/menus/ReplaceTrackDialog.tsx',
    'components/track/menus/UploadTrackDialog.tsx',
    'components/session/SessionDialogs.tsx',
    'components/player/LyricsBody.tsx',
    'app/(app)/admin/invites/page.tsx',
  ])('%s is built on Popup, not on the raw dialog', (rel) => {
    const src = read(rel);
    expect(src).toContain('@/components/ui/popup');
    expect(src).not.toContain('@/components/ui/dialog');
  });
});
