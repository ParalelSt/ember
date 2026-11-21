import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageTitle } from './PageTitle';
import { SectionHeader } from './SectionHeader';
import { Eyebrow } from './Eyebrow';
import { EmptyState } from './EmptyState';

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
});
