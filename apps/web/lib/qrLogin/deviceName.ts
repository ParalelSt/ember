/** A friendlier name for the device label the server built (lib/qrLogin/
 *  device.ts, "Chrome on Windows"), for the approve sheet's big line and its
 *  icon: "Windows PC", a computer. Only the fixed words device.ts can
 *  produce are mapped; anything else keeps the label as the name. */

export type DeviceKind = 'computer' | 'phone' | 'tablet' | 'car';

const BY_OS: Record<string, { name: string; kind: DeviceKind }> = {
  Windows: { name: 'Windows PC', kind: 'computer' },
  macOS: { name: 'Mac', kind: 'computer' },
  Linux: { name: 'Linux computer', kind: 'computer' },
  ChromeOS: { name: 'Chromebook', kind: 'computer' },
  iPad: { name: 'iPad', kind: 'tablet' },
  iPhone: { name: 'iPhone', kind: 'phone' },
  Android: { name: 'Android device', kind: 'phone' },
  'Android Automotive': { name: 'Car screen', kind: 'car' },
  'a phone': { name: 'Phone', kind: 'phone' },
  'a computer': { name: 'Computer', kind: 'computer' },
};

export function describeDevice(label: string): { name: string; kind: DeviceKind } {
  const os = / on (.+)$/.exec(label)?.[1];
  return (os && BY_OS[os]) || { name: label || 'A device', kind: 'computer' };
}
