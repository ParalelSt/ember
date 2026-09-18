import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CollectionSkeleton } from './CollectionSkeleton';
import { CollectionHeader, HEADER_CLASSES, HEADER_VARIANTS } from './CollectionHeader';

const cover = { src: null, icon: null } as const;

// The skeleton stands in for the header during a route load, so it must
// share the header's geometry exactly (docs/design-system.md section 3).
describe('CollectionSkeleton', () => {
  it('uses the same root classes as CollectionHeader', () => {
    render(
      <>
        <CollectionSkeleton />
        <CollectionHeader eyebrow="Playlist" title="Mix" meta={['3 songs']} cover={cover} />
      </>,
    );
    expect(screen.getByTestId('skeleton-header').className).toBe(screen.getByTestId('collection-header').className);
    expect(screen.getByTestId('skeleton-header').className).toBe(HEADER_CLASSES.root);
  });

  it('spaces title, meta and action placeholders with the header stack classes', () => {
    render(<CollectionSkeleton />);
    const text = screen.getByTestId('skeleton-header').children[1] as HTMLElement;
    const [eyebrow, title, meta, actions] = Array.from(text.children) as HTMLElement[];
    expect(eyebrow.className).not.toMatch(/\bmt-/);
    expect(title.className).toContain(HEADER_CLASSES.title);
    expect(meta.className).toContain(HEADER_CLASSES.meta);
    expect(actions.className).toContain(HEADER_CLASSES.actions);
    expect(actions.className).toContain('gap-cluster');
  });

  it('matches the header cover box for every variant', () => {
    for (const variant of ['collection', 'album', 'artist'] as const) {
      const { container: sk, unmount: u1 } = render(<CollectionSkeleton variant={variant} />);
      const skCover = (sk.querySelector('[data-testid="skeleton-header"]') as HTMLElement).children[0] as HTMLElement;
      const skClasses = skCover.className;
      u1();
      const { container: hd, unmount: u2 } = render(
        <CollectionHeader eyebrow="E" title="T" meta={[]} cover={cover} variant={variant} />,
      );
      const hdCover = (hd.querySelector('[data-testid="collection-header"]') as HTMLElement).children[0] as HTMLElement;
      const { cover: size, radius } = HEADER_VARIANTS[variant];
      for (const cls of `shrink-0 ${size} ${radius}`.split(' ')) {
        expect(hdCover.className.split(/\s+/)).toContain(cls);
        expect(skClasses.split(/\s+/)).toContain(cls);
      }
      u2();
    }
  });

  it('puts the rows a stack under the header, like CollectionPage', () => {
    const { container } = render(<CollectionSkeleton rows={3} />);
    expect((container.firstElementChild as HTMLElement).className).toContain('gap-stack');
  });
});
