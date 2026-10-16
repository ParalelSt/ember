import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as icons from './index';

afterEach(cleanup);

describe('Phosphor icons', () => {
  // FlameIcon is the Ember logo, not part of the icon set (EmberLogo.test.tsx).
  for (const [name, Icon] of Object.entries(icons).filter(([n]) => n !== 'FlameIcon')) {
    it(`${name} renders a filled, decorative icon and passes classes through`, () => {
      const { container } = render(<Icon className="size-5 text-ember" />);
      const svg = container.querySelector('svg')!;
      expect(svg).toHaveAttribute('viewBox', '0 0 256 256');
      expect(svg).toHaveAttribute('fill', 'currentColor');
      expect(svg).toHaveAttribute('width', '24');
      expect(svg).toHaveAttribute('height', '24');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveClass('size-5', 'text-ember');
      expect(svg.querySelector('path')).not.toBeNull();
    });
    it(`${name} exposes a label instead of hiding from assistive technology`, () => {
      const { container } = render(<Icon aria-label="Example" aria-hidden />);
      expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'Example');
      expect(container.querySelector('svg')).not.toHaveAttribute('aria-hidden');
    });
  }

  it('bold icons use the official bold geometry and a distinct class', () => {
    const { container } = render(<><icons.ArrowLeftIcon /><icons.ArrowRightIcon /></>);
    expect(container.querySelector('.phosphor-arrow-left-bold')).not.toBeNull();
    expect(container.querySelector('.phosphor-arrow-right-bold')).not.toBeNull();
    expect(container.querySelector('.phosphor-caret-left')).toBeNull();
  });

  it('renders the folder-simple-plus and cloud-arrow-down fill icons', () => {
    const { container } = render(<><icons.FolderSimplePlusIcon /><icons.CloudArrowDownIcon /></>);
    expect(container.querySelector('.phosphor-folder-simple-plus')).not.toBeNull();
    expect(container.querySelector('.phosphor-cloud-arrow-down')).not.toBeNull();
    expect(container.querySelectorAll('svg[viewBox="0 0 256 256"] path')).toHaveLength(2);
  });

  it('supports sizing, styles, attributes and refs while ignoring Lucide stroke props', () => {
    let node: SVGSVGElement | null = null;
    const { container } = render(<icons.HomeIcon size={32} width={40} height="2em"
      style={{ opacity: 0.5 }} data-testid="home" strokeWidth={4}
      ref={(value) => { node = value; }} />);
    const svg = container.querySelector('svg');
    expect(node).toBe(svg);
    expect(svg).toHaveAttribute('width', '40');
    expect(svg).toHaveAttribute('height', '2em');
    expect(svg).toHaveStyle({ opacity: '0.5' });
    expect(svg).toHaveAttribute('data-testid', 'home');
    expect(svg).not.toHaveAttribute('stroke-width');
    expect(svg).not.toHaveAttribute('stroke');
  });
});
