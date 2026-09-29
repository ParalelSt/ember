import type { OutputKind } from './types';

/** The desktop engine and the browser name devices but do not say what they
 *  are; the name is the only hint for the icon (and for whether the music
 *  plays on the computer itself). Order matters: "AirPods Pro Speakers"
 *  are headphones, "Display Audio (HDMI)" is a screen. */
const RULES: [RegExp, OutputKind][] = [
  [/airplay/i, 'airplay'],
  [/airpods|buds|headphone|headset|earphone|earbud|beats|\bwh-|\bwf-/i, 'headphones'],
  [/bluetooth|\bbt\b/i, 'bluetooth'],
  [/hdmi|displayport|display audio|\btv\b|monitor/i, 'hdmi'],
  [/\busb\b|\bdac\b|interface|scarlett|focusrite/i, 'usb'],
  [/car\b|carplay/i, 'car'],
  [/built-?in|internal|macbook|imac|laptop|realtek|high definition audio|speakers? \(|^speakers?$/i, 'computer'],
];

export function guessKind(name: string): OutputKind {
  for (const [re, kind] of RULES) if (re.test(name)) return kind;
  return 'speaker';
}

/** A browser label without the USB vendor:product tail Chrome adds
 *  ("Scarlett 2i2 USB (1235:8210)"). */
export function cleanLabel(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
}
