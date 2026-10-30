import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WhatsNewLink } from './WhatsNewLink';
import { NewBadge } from './NewBadge';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const ACTIVE_CLASS = 'bg-ember/14 text-sidebar-foreground';

describe('WhatsNewLink', () => {
  it('links to /whats-new', () => {
    render(<WhatsNewLink showNew={false} activePath="/" />);
    expect(screen.getByRole('link', { name: "What's new" })).toHaveAttribute('href', '/whats-new');
  });

  it('shows the New pill only when showNew', () => {
    const { rerender } = render(<WhatsNewLink showNew activePath="/" />);
    const badge = screen.getByTestId('new-badge');
    expect(badge).toHaveTextContent('New');
    expect(badge.className).not.toContain('animate');
    rerender(<WhatsNewLink showNew={false} activePath="/" />);
    expect(screen.queryByTestId('new-badge')).toBeNull();
  });

  it('highlights like the other nav rows when on the page', () => {
    const { rerender } = render(<WhatsNewLink showNew={false} activePath="/whats-new" />);
    expect(screen.getByRole('link').className).toContain(ACTIVE_CLASS);
    rerender(<WhatsNewLink showNew={false} activePath="/library" />);
    expect(screen.getByRole('link').className).not.toContain(ACTIVE_CLASS);
  });

  it('calls onNavigate (closes the drawer) on click', () => {
    const onNavigate = vi.fn();
    render(<WhatsNewLink showNew={false} activePath="/" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('link'));
    expect(onNavigate).toHaveBeenCalled();
  });
});

describe('NewBadge', () => {
  it('is a still pill with no animation class', () => {
    render(<NewBadge />);
    const cls = screen.getByTestId('new-badge').className;
    expect(cls).not.toContain('pulse');
    expect(cls).not.toContain('animate');
  });
});

describe('reduced motion', () => {
  it('globals.css switches the unread dot animation off under prefers-reduced-motion', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([^}]*)\}/g)].map((m) => m[1]);
    const block = blocks.find((b) => b.includes('.ember-new-dot'));
    expect(block).toBeDefined();
    expect(block).toMatch(/animation:\s*none/);
  });
});
