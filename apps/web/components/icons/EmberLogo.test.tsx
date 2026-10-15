import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { FlameIcon } from '@/components/icons';

// The brand flame must stay the original outline logo, whatever icon set the
// rest of the app uses (a Phosphor swap once turned it into the fire glyph).
describe('Ember logo', () => {
  it('is the outline flame on a 24 grid, not a filled icon-set glyph', () => {
    const { container } = render(<FlameIcon className="h-5 w-5" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg).toHaveClass('ember-logo', 'h-5', 'w-5');
    expect(svg.querySelector('path')?.getAttribute('d')).toMatch(/^M12 3q1 4 4 6\.5/);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });
});
