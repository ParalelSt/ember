import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MixCard } from './MixCard';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const props = {
  title: 'Rock & Metal',
  subtitle: 'Linkin Park, System Of A Down, Deftones and more',
  href: '/mix/rock-metal',
  artworkUrls: ['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg'],
  color: '#f2b8a8',
  ink: '#141414',
};

describe('MixCard', () => {
  it('is the Radio card: MIX label, three round faces, the name without "Mix", the artists under it', () => {
    render(<MixCard {...props} />);
    const link = screen.getByRole('link', { name: 'Rock & Metal Mix' });
    expect(link).toHaveAttribute('href', '/mix/rock-metal');
    expect(link.textContent).toContain('MIX');
    const faces = link.querySelectorAll('[data-mix-face]');
    expect(faces).toHaveLength(3);
    // The first artist is the big one in front.
    expect(faces[0].className).toContain('z-10');
    expect(faces[0].getAttribute('src')).toBe('/a.jpg');
    // Every face is ringed in the card colour.
    for (const f of faces) expect((f as HTMLElement).style.boxShadow).toContain('3px');
    expect(screen.getByText('Rock & Metal')).toBeInTheDocument();
    expect(screen.getByText(props.subtitle)).toBeInTheDocument();
    const card = link.firstElementChild as HTMLElement;
    expect(card.style.backgroundColor).toBeTruthy();
  });

  it('draws only the faces it has', () => {
    render(<MixCard {...props} artworkUrls={['/a.jpg']} />);
    expect(document.querySelectorAll('[data-mix-face]')).toHaveLength(1);
  });

  it.each([
    ['style', 'Rock & Metal', 'MIX', 'Rock & Metal Mix'],
    ['artist', 'Gojira', 'ARTIST MIX', 'Gojira Mix'],
    ['discover', 'New to you', 'DISCOVER', 'New to you'],
    ['on-repeat', 'Your top songs', 'ON REPEAT', 'Your top songs'],
    ['throwback', 'Back again', 'THROWBACK', 'Back again'],
  ] as const)('%s: its own label and name', (kind, title, label, name) => {
    render(<MixCard {...props} kind={kind} title={title} />);
    const link = screen.getByRole('link', { name });
    expect(link).toHaveAttribute('data-mix-kind', kind);
    expect(link.querySelector('[data-mix-label]')?.textContent).toBe(label);
    expect(link.querySelectorAll('[data-mix-face]')).toHaveLength(3);
  });

  it('lays the covers out by kind: round faces, a big artist, fanned or stacked squares, sepia for Throwback', () => {
    const faces = (kind: 'style' | 'artist' | 'discover' | 'on-repeat' | 'throwback') => {
      const { unmount } = render(<MixCard {...props} kind={kind} />);
      const cls = [...document.querySelectorAll('[data-mix-face]')].map((f) => f.className);
      unmount();
      return cls;
    };
    expect(faces('style').every((c) => c.includes('rounded-full'))).toBe(true);
    expect(faces('artist')[0]).toContain('size-[52%]');
    expect(faces('artist')[1]).toContain('size-[22%]');
    expect(faces('discover').every((c) => c.includes('rounded-[6px]'))).toBe(true);
    expect(faces('discover')[1]).toContain('-rotate-6');
    expect(faces('on-repeat')[0]).toContain('z-20');
    expect(faces('throwback').every((c) => c.includes('sepia'))).toBe(true);
    expect(faces('style').some((c) => c.includes('sepia'))).toBe(false);
  });
});
