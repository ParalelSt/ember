export type CoverRGB = [number, number, number];

/** Ignore transparent pixels and grey borders when averaging the artwork. */
export function pickCoverColor(pixels: Uint8ClampedArray): CoverRGB | null {
  const sum: CoverRGB = [0, 0, 0];
  let weight = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    if (Math.max(...rgb) - Math.min(...rgb) < 20) continue;
    const alpha = pixels[i + 3] / 255;
    weight += alpha;
    rgb.forEach((value, channel) => { sum[channel] += value * alpha; });
  }
  return weight ? sum.map((value) => Math.round(value / weight)) as CoverRGB : null;
}

/** Preserve hue while limiting the brightest channel for white text. */
export function darkenCoverColor(rgb: CoverRGB): string {
  const scale = Math.min(1, 100 / Math.max(1, ...rgb));
  return `rgb(${rgb.map((value) => Math.round(Math.max(0, value) * scale)).join(', ')})`;
}

export function coverColorFallback(hex = '#232426'): string {
  const channels = hex.slice(1).match(/.{2}/g);
  if (!/^#[0-9a-f]{6}$/i.test(hex) || !channels) return coverColorFallback();
  return darkenCoverColor(channels.map((channel) => parseInt(channel, 16)) as CoverRGB);
}
