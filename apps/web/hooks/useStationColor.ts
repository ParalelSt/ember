'use client';

import { useCallback, useState } from 'react';
import { logoColor, stationTileColor, type LogoColor } from '@/lib/radio/logoColor';

/** What is known of a station's logo: undefined until it has loaded (or
 *  failed), then its colour, or 'failed' when it would not load. */
type Known = { color: LogoColor } | 'failed';

/** Per station id, for as long as the page is open: a tile scrolled away
 *  and back, or the page left and opened again, paints at once. */
const known = new Map<string, Known>();

/** Tests only. */
export function _resetStationColors() {
  known.clear();
}

/** The side of the square a logo is read at: plenty for its main colour. */
const SAMPLE = 32;

/** The logo's pixels, through a small canvas. null when they cannot be read
 *  (no canvas, or an image from another site). */
export function readLogoPixels(img: HTMLImageElement): Uint8ClampedArray | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
    return ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
  } catch {
    return null;
  }
}

export interface StationColor {
  /** The tile's background; null while the logo is still loading. */
  background: string | null;
  /** Draw the logo: it has one and it has not failed to load. */
  showLogo: boolean;
  /** For the logo img's onLoad and onError. */
  onLogoLoad: (img: HTMLImageElement) => void;
  onLogoError: () => void;
}

/** A station tile's colour (the owner's "Station colour" pick): its logo's
 *  own colour once the logo has loaded, read from the image itself (the
 *  logo comes through the host, so its pixels may be read), and a steady
 *  colour from the station id when it has no logo or the logo has no
 *  colour to give. Worked out once per station. */
export function useStationColor(id: string, hasLogo: boolean): StationColor {
  const [state, setState] = useState<{ id: string; known: Known | undefined }>(() => ({ id, known: known.get(id) }));
  // A different station in the same tile starts from what is known of it.
  const current = state.id === id ? state.known : known.get(id);
  const onLogoLoad = useCallback((img: HTMLImageElement) => {
    let next = known.get(id);
    if (!next) {
      const px = readLogoPixels(img);
      next = { color: px ? logoColor(px) : null };
      known.set(id, next);
    }
    setState({ id, known: next });
  }, [id]);
  const onLogoError = useCallback(() => {
    known.set(id, 'failed');
    setState({ id, known: 'failed' });
  }, [id]);
  const showLogo = hasLogo && current !== 'failed';
  let background: string | null;
  if (!showLogo) background = stationTileColor(id, null);
  else if (current && typeof current === 'object') background = stationTileColor(id, current.color);
  else background = null;
  return { background, showLogo, onLogoLoad, onLogoError };
}
