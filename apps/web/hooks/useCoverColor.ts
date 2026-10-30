'use client';

import { useEffect, useState } from 'react';
import { readableArtUrl } from '@/lib/artProxy';
import { darkenCoverColor, pickCoverColor } from '@/lib/coverColor';

const SAMPLE = 16;

const cache = new Map<string, Promise<string | null>>();

function loadColor(src: string): Promise<string | null> {
  const cached = cache.get(src);
  if (cached) return cached;
  const result = new Promise<string | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SAMPLE;
        const context = canvas.getContext('2d');
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
        const color = pickCoverColor(context.getImageData(0, 0, SAMPLE, SAMPLE).data);
        resolve(color ? darkenCoverColor(color) : null);
      } catch {
        // An image from another site can load and still refuse its pixels.
        resolve(null);
      }
    };
    image.onerror = () => {
      // Maybe only a dropped connection: the next look at this song tries again.
      cache.delete(src);
      resolve(null);
    };
    // YouTube's image hosts come through our own /api/art, so the pixels can
    // be read. Anything else is tried as it is and may well refuse.
    image.src = readableArtUrl(src) ?? src;
  });
  cache.set(src, result);
  return result;
}

/** A cover's colour, darkened so white text reads on it, or null when there
 *  is no cover or its colour cannot be read. A new cover keeps the last
 *  colour until its own is known, so a song change never blinks through the
 *  no-colour state. */
export function useCoverColor(url?: string | null): string | null {
  const [sample, setSample] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void loadColor(url).then((color) => {
      if (!cancelled) setSample(color);
    });
    return () => { cancelled = true; };
  }, [url]);
  return url ? sample : null;
}
