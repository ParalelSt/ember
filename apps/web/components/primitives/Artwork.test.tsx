import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Artwork } from './Artwork';

describe('Artwork', () => {
  it('renders an image with the src and an empty alt by default', () => {
    const { container } = render(<Artwork src="/cover.jpg" size="xs" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', '/cover.jpg');
    expect(img).toHaveAttribute('alt', '');
    expect(img?.className).toContain('object-cover');
  });

  it('uses a given alt', () => {
    render(<Artwork src="/cover.jpg" alt="Album cover" size="sm" />);
    expect(screen.getByAltText('Album cover')).toBeInTheDocument();
  });

  it('renders no image and shows the children placeholder without a src', () => {
    const { container } = render(
      <Artwork src={null} size="md" fallback="gradient">
        <span>no art</span>
      </Artwork>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('no art')).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain('cover-placeholder');
  });

  it('maps every size to its art token class', () => {
    const sizes = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
    for (const size of sizes) {
      const { container, unmount } = render(<Artwork src="/a.jpg" size={size} />);
      expect(container.firstElementChild?.className).toContain(`size-art-${size}`);
      unmount();
    }
  });

  it('omits a size class when no size is given (fluid cards)', () => {
    const { container } = render(<Artwork src="/a.jpg" className="aspect-square w-full" />);
    expect(container.firstElementChild?.className).not.toContain('size-art-');
    expect(container.firstElementChild?.className).toContain('aspect-square');
  });

  it('rounds fully when shape is round', () => {
    const { container } = render(<Artwork src="/a.jpg" size="lg" shape="round" />);
    expect(container.firstElementChild?.className).toContain('rounded-full');
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    const { container } = render(<Artwork src="/a.jpg" size="xs" onClick={onClick} />);
    (container.firstElementChild as HTMLElement).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
