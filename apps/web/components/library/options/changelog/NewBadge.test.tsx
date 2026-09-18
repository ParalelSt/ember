import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NewBadge, UnreadDot } from './NewBadge';

describe('NewBadge', () => {
  it('Pulse: one pill reading New that carries the pulse class', () => {
    render(<NewBadge variant="pulse" />);
    const badge = screen.getByTestId('new-badge');
    expect(badge).toHaveTextContent(/^New$/);
    expect(badge).toHaveClass('ember-new-pulse', 'bg-ember');
    expect(screen.queryByTestId('new-badge-dot')).not.toBeInTheDocument();
  });

  it('Dot: a static pill plus a pulsing dot beside it', () => {
    render(<NewBadge variant="dot" />);
    const badge = screen.getByTestId('new-badge');
    expect(badge).toHaveTextContent(/^New$/);
    expect(badge).not.toHaveClass('ember-new-pulse');
    expect(badge.querySelector('.ember-new-pulse')).toBeNull();
    expect(screen.getByTestId('new-badge-dot')).toHaveClass('ember-new-dot');
    expect(screen.getByTestId('new-badge-dot')).toHaveAttribute('aria-hidden', 'true');
  });

  it('UnreadDot pulses with the same class and is hidden from screen readers', () => {
    render(<UnreadDot />);
    expect(screen.getByTestId('unread-dot')).toHaveClass('ember-new-dot');
    expect(screen.getByTestId('unread-dot')).toHaveAttribute('aria-hidden', 'true');
  });

  // Reduced motion is handled purely in CSS (no matchMedia check in the
  // component), so assert the guard itself: globals.css must switch off
  // both animation classes under prefers-reduced-motion: reduce.
  it('globals.css turns both animations off under prefers-reduced-motion', () => {
    const css = readFileSync(resolve(__dirname, '../../../../app/globals.css'), 'utf8');
    expect(css).toMatch(/\.ember-new-pulse\s*\{\s*animation:\s*ember-new-pulse/);
    expect(css).toMatch(/\.ember-new-dot\s*\{\s*animation:\s*ember-new-dot/);
    const guard = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ember-new-pulse,\s*\.ember-new-dot\s*\{\s*animation:\s*none !important;\s*\}\s*\}/,
    );
    expect(guard).not.toBeNull();
  });
});
