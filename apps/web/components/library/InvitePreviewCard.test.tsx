import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvitePreviewCard } from './InvitePreviewCard';
import type { InvitePreview } from '@/lib/collab';

const preview = {
  name: 'Road trip',
  artworkUrl: null,
  owner: { id: 'o', name: 'Olga', avatarUrl: null },
  people: [{ id: 'o', name: 'Olga', avatarUrl: null }],
  peopleCount: 1,
  songCount: 1,
  songs: [{ title: 'Song', artist: 'Artist', artworkUrl: null }],
} as unknown as InvitePreview;

describe('InvitePreviewCard soft list', () => {
  it('songs box is a filled block without an outline', () => {
    render(<InvitePreviewCard preview={preview} busy={false} onJoin={vi.fn()} onDecline={vi.fn()} />);
    const box = screen.getByTestId('invite-song').parentElement!;
    expect(box.className).toMatch(/bg-card/);
    expect(box.className).toMatch(/rounded-2xl/);
    expect(box.className).not.toMatch(/\bborder\b/);
  });

  it('Join is a full-width pill', () => {
    render(<InvitePreviewCard preview={preview} busy={false} onJoin={vi.fn()} onDecline={vi.fn()} />);
    const join = screen.getByRole('button', { name: 'Join' });
    expect(join.className).toMatch(/rounded-full/);
    expect(join.className).toMatch(/w-full/);
  });
});
