import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnlineOnly } from './OnlineOnly';

const useOnline = vi.hoisted(() => vi.fn());
vi.mock('@/lib/useOnline', () => ({ useOnline }));

// next/link reads the app router context, which no test renders, and next
// itself is hoisted to the repo root where it resolves React 18. The
// offline placeholder only needs the anchor.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe('OnlineOnly', () => {
  it('renders its children while online', () => {
    useOnline.mockReturnValue(true);
    render(
      <OnlineOnly>
        <p>Album page</p>
      </OnlineOnly>,
    );
    expect(screen.getByText('Album page')).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).toBeNull();
  });

  it('renders the placeholder instead of its children while offline', () => {
    useOnline.mockReturnValue(false);
    render(
      <OnlineOnly>
        <p>Album page</p>
      </OnlineOnly>,
    );
    expect(screen.queryByText('Album page')).toBeNull();
    expect(screen.getByText("You're offline")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Downloaded' })).toBeInTheDocument();
  });
});
