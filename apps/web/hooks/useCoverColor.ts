'use client';

import { useEffect, useState } from 'react';
import { coverColorFallback, darkenCoverColor, pickCoverColor } from '@/lib/coverColor';

const cache = new Map<string, Promise<string | null>>();

function loadColor(url: string): Promise<string | null> {
  const cached = cache.get(url);
  if (cached) return cached;
  const result = new Promise<string | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 16;
        const context = canvas.getContext('2d');
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, 16, 16);
        const color = pickCoverColor(context.getImageData(0, 0, 16, 16).data);
        resolve(color ? darkenCoverColor(color) : null);
      } catch {
        // Remote artwork can load successfully but still taint the canvas.
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
  cache.set(url, result);
  return result;
}

export function useCoverColor(url?: string | null, fallbackHex?: string): string {
  const fallback = coverColorFallback(fallbackHex);
  const [sample, setSample] = useState<{ url: string; color: string | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void loadColor(url).then((color) => {
      if (!cancelled) setSample({ url, color });
    });
    return () => { cancelled = true; };
  }, [url]);
  return sample && sample.url === url ? sample.color ?? fallback : fallback;
}
