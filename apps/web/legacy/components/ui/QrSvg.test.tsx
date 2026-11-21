import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import jsQR from '@/lib/vendor/jsqr';
import { QrSvg } from './QrSvg';

/** The sign-in QR with the Ember flame over its middle still scans: the
 *  rendered SVG (its dark path, its white quiet zone and the logo tile) is
 *  painted to pixels and read back with the vendored jsQR, the same decoder
 *  the in-app scanner falls back to. The tile is painted all dark, all
 *  light and as noise, since a camera may read the accent colour as either. */

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
const LINKS = [
  `https://ember.example.com/link/${TOKEN}`,
  `http://192.168.1.20:3000/link/${TOKEN}`,
  `https://a-rather-long-home-server-name.duckdns.org:8443/link/${TOKEN}`,
];

type Tile = 'dark' | 'light' | 'noise';

/** Paints what QrSvg rendered: `scale` pixels per module. */
function paint(svg: SVGSVGElement, scale: number, tile: Tile) {
  const [minX, minY, w] = svg.getAttribute('viewBox')!.split(' ').map(Number);
  const side = w * scale;
  const px = new Uint8ClampedArray(side * side * 4).fill(255);
  const fill = (x: number, y: number, fw: number, fh: number, dark: (i: number, j: number) => boolean) => {
    for (let j = 0; j < fh * scale; j++) {
      for (let i = 0; i < fw * scale; i++) {
        const X = Math.round((x - minX) * scale) + i;
        const Y = Math.round((y - minY) * scale) + j;
        const k = (Y * side + X) * 4;
        const v = dark(i, j) ? 0 : 255;
        px[k] = px[k + 1] = px[k + 2] = v;
      }
    }
  };
  // The background rect is white (already); the path is runs "M{x} {y}h{n}v1h-{n}z".
  const d = svg.querySelector('path')!.getAttribute('d')!;
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    fill(Number(m[1]), Number(m[2]), Number(m[3]), 1, () => true);
  }
  const logo = svg.querySelector('[data-testid="qr-logo"] rect');
  if (logo) {
    const x = Number(logo.getAttribute('x'));
    const y = Number(logo.getAttribute('y'));
    const s = Number(logo.getAttribute('width'));
    let seed = 7;
    const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 1) === 1;
    fill(x, y, s, s, () => (tile === 'dark' ? true : tile === 'light' ? false : noise()));
  }
  return { px, side };
}

function decode(value: string, tile: Tile, scale = 4): string | null {
  const { container } = render(<QrSvg value={value} logo size={256} />);
  const svg = container.querySelector('svg')!;
  const { px, side } = paint(svg, scale, tile);
  cleanup();
  return jsQR(px, side, side)?.data ?? null;
}

afterEach(cleanup);

describe('QrSvg with the Ember logo', () => {
  it('is level H, with the flame tile in the middle and the quiet zone white', () => {
    const { container, getByTestId } = render(<QrSvg value={LINKS[0]} logo />);
    const svg = container.querySelector('svg')!;
    expect(svg.dataset.ec).toBe('H');
    expect(getByTestId('qr-logo')).toBeInTheDocument();
    const bg = svg.querySelector('rect')!;
    expect(bg.getAttribute('fill')).toBe('#fff');
    // The light square covers well under level H's 30%: about 4% of the area.
    const tile = Number(svg.querySelector('[data-testid="qr-logo"] rect')!.getAttribute('width')) + 2;
    const modules = Number(svg.getAttribute('viewBox')!.split(' ')[2]) - 8;
    expect((tile * tile) / (modules * modules)).toBeLessThan(0.06);
  });

  it.each(LINKS.flatMap((l) => (['dark', 'light', 'noise'] as const).map((t) => [t, l] as const)))(
    'still decodes with the tile read as %s: %s',
    (tile, link) => {
      expect(decode(link, tile)).toBe(link);
    },
  );

  it('decodes at a small size too (3 px per module)', () => {
    expect(decode(LINKS[2], 'dark', 3)).toBe(LINKS[2]);
  });

  it('a value too long for level H falls back to a plain level M code with no logo', () => {
    const long = `https://example.com/${'x'.repeat(150)}`;
    const { container, queryByTestId } = render(<QrSvg value={long} logo />);
    expect(container.querySelector('svg')!.dataset.ec).toBe('M');
    expect(queryByTestId('qr-logo')).toBeNull();
  });

  it('no logo unless asked: the carlist invite stays a plain level M code', () => {
    const { container, queryByTestId } = render(<QrSvg value={LINKS[0]} />);
    expect(container.querySelector('svg')!.dataset.ec).toBe('M');
    expect(queryByTestId('qr-logo')).toBeNull();
  });
});
