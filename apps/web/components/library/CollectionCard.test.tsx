import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));

const { CollectionCard } = await import('./CollectionCard');

const base = { title: 'Road trip', subtitle: 'Playlist', href: '/playlist/p1', cover: { src: null, icon: null }, size: 'md' as const };

describe('CollectionCard', () => {
  it('a playlist shared with you shows a "Shared by" pill with the owner\'s face, not the people mark', () => {
    render(<CollectionCard {...base} subtitle="Shared by Olga" shared sharedBy={{ name: 'Olga', avatarUrl: null }} />);
    const badge = screen.getByTestId('shared-by');
    expect(badge).toHaveTextContent('OShared by Olga');
    expect(screen.queryByTestId('shared-badge')).toBeNull();
    // The pill says it once: no second "Shared by Olga" line under it.
    expect(screen.getAllByText(/Shared by/)).toHaveLength(1);
  });

  it('your own collaborative playlist keeps the people mark and its subtitle', () => {
    render(<CollectionCard {...base} subtitle="Collaborative" shared />);
    expect(screen.getByTestId('shared-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('shared-by')).toBeNull();
    expect(screen.getByText('Collaborative')).toBeInTheDocument();
  });
});
