import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CollectionHeader, HEADER_CLASSES } from './CollectionHeader';

const cover = { src: null, icon: null } as const;

describe('CollectionHeader', () => {
  it('renders the eyebrow, title and meta joined with a middot', () => {
    render(
      <CollectionHeader eyebrow="Album" title="Kid A" meta={['2000', '10 tracks']} cover={cover} />,
    );
    expect(screen.getByText('Album')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Kid A' })).toBeInTheDocument();
    expect(screen.getByText('2000 · 10 tracks')).toBeInTheDocument();
  });

  it('renders meta nodes, not just strings', () => {
    render(
      <CollectionHeader
        eyebrow="Album"
        title="Kid A"
        meta={[<a key="a" href="https://example.com/artist/1">Radiohead</a>, '2000']}
        cover={cover}
      />,
    );
    expect(screen.getByRole('link', { name: 'Radiohead' })).toBeInTheDocument();
  });

  it('renders no meta line when there is no meta', () => {
    render(<CollectionHeader eyebrow="Artist" title="Radiohead" meta={[]} cover={cover} />);
    expect(screen.queryByTestId('collection-meta')).toBeNull();
  });

  it('renders the description slot under the title', () => {
    render(
      <CollectionHeader
        eyebrow="Artist"
        title="Radiohead"
        meta={[]}
        cover={cover}
        description={<p>From Oxford.</p>}
      />,
    );
    expect(screen.getByText('From Oxford.')).toBeInTheDocument();
  });

  it('renders a plain div for the cover without onCoverClick', () => {
    render(<CollectionHeader eyebrow="Playlist" title="Mix" meta={[]} cover={cover} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a cover button when onCoverClick is given, and fires it', () => {
    const onCoverClick = vi.fn();
    render(
      <CollectionHeader
        eyebrow="Playlist"
        title="Mix"
        meta={[]}
        cover={cover}
        onCoverClick={onCoverClick}
        coverLabel="Change cover"
      />,
    );
    const button = screen.getByRole('button', { name: 'Change cover' });
    button.click();
    expect(onCoverClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Change cover', { selector: 'span' })).toBeInTheDocument();
  });

  it('shows the uploading label and disables the cover while busy', () => {
    const onCoverClick = vi.fn();
    render(
      <CollectionHeader
        eyebrow="Playlist"
        title="Mix"
        meta={[]}
        cover={cover}
        onCoverClick={onCoverClick}
        coverLabel="Change cover"
        coverBusy
      />,
    );
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change cover' })).toBeDisabled();
  });

  it('sizes the cover per variant, keeping each page family as it shipped', () => {
    const { container, rerender } = render(
      <CollectionHeader eyebrow="Playlist" title="Mix" meta={[]} cover={cover} />,
    );
    const box = () => container.querySelector('.shrink-0') as HTMLElement;
    expect(box().className).toContain('size-art-hero md:size-art-lg');
    expect(box().className).toContain('rounded-2xl');

    rerender(<CollectionHeader eyebrow="Album" title="Kid A" meta={[]} cover={cover} variant="album" />);
    expect(box().className).toContain('size-art-hero md:size-art-xl');
    expect(box().className).toContain('rounded-md');

    rerender(<CollectionHeader eyebrow="Artist" title="R" meta={[]} cover={cover} variant="artist" />);
    expect(box().className).toContain('size-art-hero-sm md:size-art-hero');
    expect(box().className).toContain('rounded-full');
  });

  it('renders the action bar children', () => {
    render(
      <CollectionHeader eyebrow="Playlist" title="Mix" meta={[]} cover={cover}>
        <button type="button">Play</button>
      </CollectionHeader>,
    );
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  // docs/design-system.md section 3, Rhythm "Even" with actions "Beside":
  // cover to text stack 24, eyebrow to title and title to meta cluster 8,
  // description block 16, meta to action bar stack 24, and no outer margin.
  describe('stack geometry', () => {
    const renderFull = () =>
      render(
        <CollectionHeader
          eyebrow="Artist"
          title="Radiohead"
          meta={['2000']}
          cover={cover}
          description={<p>From Oxford.</p>}
        >
          <div data-testid="bar">
            <button type="button">Play</button>
          </div>
        </CollectionHeader>,
      );

    it('spaces cover and text with gap-stack and sets no outer margin', () => {
      renderFull();
      const root = screen.getByTestId('collection-header');
      expect(root.className).toContain('gap-stack');
      expect(root.className).toContain('md:flex-row');
      expect(root.className).toContain('md:items-end');
      expect(root.className).not.toMatch(/(^|\s)m[tbxy]?-/);
    });

    it('puts cluster between eyebrow, title and meta, on a data-testid meta line', () => {
      renderFull();
      const title = screen.getByRole('heading', { level: 1, name: 'Radiohead' });
      expect(title.className).toContain('mt-cluster');
      const meta = screen.getByTestId('collection-meta');
      expect(meta).toHaveTextContent('2000');
      expect(meta.className).toContain('mt-cluster');
      expect(meta.className).toContain('text-meta');
    });

    it('puts the description a block under the meta and the actions a stack under that, in the text column', () => {
      renderFull();
      const meta = screen.getByTestId('collection-meta');
      const description = screen.getByText('From Oxford.').parentElement!;
      const actions = screen.getByTestId('bar').parentElement!;
      expect(description.className).toBe(HEADER_CLASSES.description);
      expect(description.className).toBe('mt-block');
      expect(actions.className).toBe(HEADER_CLASSES.actions);
      expect(actions.className).toBe('mt-stack');
      // Beside: the action bar shares the meta line's text column.
      expect(actions.parentElement).toBe(meta.parentElement);
      expect(meta.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(description.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders no action wrapper (and so no stray gap) without children', () => {
      render(<CollectionHeader eyebrow="Album" title="Kid A" meta={['2000']} cover={cover} />);
      expect(screen.getByTestId('collection-header').querySelector('.mt-stack')).toBeNull();
    });
  });
});
