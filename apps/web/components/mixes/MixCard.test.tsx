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
});
