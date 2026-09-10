import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CollectionHeader } from './CollectionHeader';

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
    const { container } = render(
      <CollectionHeader eyebrow="Artist" title="Radiohead" meta={[]} cover={cover} />,
    );
    expect(container.querySelector('.mt-3')).toBeNull();
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
});
