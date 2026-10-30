import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { PageTitle } from './PageTitle';
import { SectionHeader } from './SectionHeader';
import { Eyebrow } from './Eyebrow';
import { EmptyState } from './EmptyState';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));

describe('PageTitle', () => {
  it('renders an h1 with the page title utility', () => {
    render(<PageTitle>Home</PageTitle>);
    const heading = screen.getByRole('heading', { level: 1, name: 'Home' });
    expect(heading.className).toContain('text-page-title');
  });

  it('appends the caller className', () => {
    render(<PageTitle className="mb-8">Home</PageTitle>);
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('mb-8');
  });
});

describe('SectionHeader', () => {
  it('renders a bare h2 without an action', () => {
    const { container } = render(<SectionHeader title="Popular" className="mb-3" />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Popular' });
    expect(heading.className).toContain('text-section-title');
    expect(heading.className).toContain('mb-3');
    expect(container.firstElementChild).toBe(heading);
  });

  it('renders the action beside the heading', () => {
    const { container } = render(
      <SectionHeader title="Trending" action={<a href="/all">Show all</a>} />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Trending' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all' })).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain('justify-between');
  });
});

describe('Eyebrow', () => {
  it('renders its text with the eyebrow utility', () => {
    render(<Eyebrow>Album</Eyebrow>);
    expect(screen.getByText('Album').className).toContain('text-eyebrow');
  });
});

describe('EmptyState', () => {
  it('renders centred muted text', () => {
    render(<EmptyState>Loading…</EmptyState>);
    const node = screen.getByText('Loading…');
    expect(node.className).toContain('text-muted-foreground');
    expect(node.className).toContain('py-12');
    expect(node.className).toContain('text-center');
  });

  it('appends the caller className', () => {
    render(<EmptyState className="text-sm">No tracks</EmptyState>);
    expect(screen.getByText('No tracks').className).toContain('text-sm');
  });

  it('stays a single plain div without an icon, title or action', () => {
    const { container } = render(<EmptyState>Loading…</EmptyState>);
    expect(container.firstElementChild?.textContent).toBe('Loading…');
    expect(container.firstElementChild?.children).toHaveLength(0);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByTestId('empty-icon')).toBeNull();
  });

  it('shows a 56px soft round icon, a one-line title, the sentence and an ember link', () => {
    render(
      <EmptyState icon={<svg data-testid="glyph" />} title="Nothing liked yet" action={{ label: 'Find songs', href: '/search' }}>
        Tap the heart.
      </EmptyState>,
    );
    const icon = screen.getByTestId('empty-icon');
    expect(icon.className).toContain('size-14');
    expect(icon.className).toContain('rounded-full');
    expect(icon.className).toContain('bg-card');
    expect(icon).toContainElement(screen.getByTestId('glyph'));
    const title = screen.getByRole('heading', { level: 2, name: 'Nothing liked yet' });
    expect(title.className).toContain('truncate');
    expect(screen.getByText('Tap the heart.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Find songs' });
    expect(link).toHaveAttribute('href', '/search');
    expect(link.className).toContain('bg-ember');
  });

  it('an onClick action is a button that calls it', () => {
    const onClick = vi.fn();
    render(<EmptyState title="No playlists yet" action={{ label: 'New playlist', onClick }} />);
    const button = screen.getByRole('button', { name: 'New playlist' });
    expect(button.className).toContain('bg-ember');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('an icon and a title without an action shows no button', () => {
    render(<EmptyState icon={<svg />} title="No results">Nothing matched.</EmptyState>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a second action sits beside the first, quieter', () => {
    render(
      <EmptyState
        title="Something broke"
        titleAs="h1"
        action={{ label: 'Try again', onClick: vi.fn() }}
        secondaryAction={{ label: 'Report a bug', onClick: vi.fn() }}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Something broke' })).toBeInTheDocument();
    const second = screen.getByRole('button', { name: 'Report a bug' });
    expect(second.className).toContain('bg-secondary');
    expect(second.parentElement).toBe(screen.getByRole('button', { name: 'Try again' }).parentElement);
  });
});
