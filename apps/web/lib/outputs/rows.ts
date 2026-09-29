import type { CastPath } from '@/stores/useCastStore';
import type { CastDevice, OutputKind, OutputPlatform, OutputSnapshot, SystemPicker } from './types';

/** The Devices sheet (phone) and menu (desktop bar), as data: which rows,
 *  in which sections, which one is lit. Kept pure so every platform's
 *  combination is tested without a DOM. */

export type RowAction =
  | { type: 'output'; id: string }
  | { type: 'system-picker' }
  | { type: 'cast-device'; id: string }
  | { type: 'cast-picker' }
  | { type: 'cast-stop' };

export interface DeviceRow {
  key: string;
  label: string;
  detail?: string;
  /** The icon: an output's kind, or a cast/system row's own. */
  icon: OutputKind | 'cast' | 'more' | 'stop';
  current: boolean;
  action: RowAction;
}

export interface DeviceSection {
  key: 'outputs' | 'cast';
  title: string;
  rows: DeviceRow[];
}

export interface CastSummary {
  path: CastPath;
  availability: 'unknown' | 'available' | 'none';
  connection: 'idle' | 'connecting' | 'connected';
  deviceName: string | null;
}

export interface OutputSummary extends OutputSnapshot {
  platform: OutputPlatform | null;
  castDevices: CastDevice[] | null;
}

/** The phone's or computer's own speaker: nothing worth a "Playing on". */
export function isBuiltIn(kind: OutputKind | null): boolean {
  return kind === 'computer' || kind === 'phone';
}

const SYSTEM_ROW: Record<SystemPicker, { label: string; detail: string }> = {
  'android-switcher': { label: 'More devices', detail: "Android's output switcher" },
  'ios-route-picker': { label: 'AirPlay or Bluetooth', detail: 'Speakers, headphones and TVs' },
  'web-select': { label: 'Choose another speaker', detail: "Your browser's list" },
  'web-permission': {
    label: 'Show all speakers',
    detail: 'Chrome lists them once Ember may use the microphone. Nothing is recorded.',
  },
};

function castSection(cast: CastSummary, castDevices: CastDevice[] | null): DeviceSection | null {
  if (!cast.path) return null;
  const connected = cast.connection === 'connected';
  const rows: DeviceRow[] = [];
  // The Android app lists the devices itself: tap one to cast to it.
  if (cast.path === 'android' && castDevices && castDevices.length > 0) {
    for (const d of castDevices) {
      rows.push({
        key: `cast:${d.id}`,
        label: d.name,
        detail: d.connecting ? 'Connecting' : d.description ?? undefined,
        icon: 'cast',
        current: d.selected && connected,
        action: { type: 'cast-device', id: d.id },
      });
    }
  } else if (connected) {
    rows.push({
      key: 'cast:current',
      label: cast.deviceName ?? (cast.path === 'airplay' ? 'AirPlay' : 'Cast device'),
      detail: cast.path === 'airplay' ? 'AirPlay' : 'Casting',
      icon: cast.path === 'airplay' ? 'airplay' : 'cast',
      current: true,
      action: { type: 'cast-picker' },
    });
  } else if (cast.connection === 'connecting' || cast.availability !== 'none') {
    rows.push({
      key: 'cast:picker',
      label: cast.path === 'airplay' ? 'AirPlay' : 'Cast to a device',
      detail: cast.connection === 'connecting'
        ? 'Connecting'
        : cast.path === 'airplay' ? 'Apple TV and AirPlay speakers' : 'Chromecast, Google speakers, Android TV',
      icon: cast.path === 'airplay' ? 'airplay' : 'cast',
      current: false,
      action: { type: 'cast-picker' },
    });
  }
  // AirPlay is stopped from its own picker (Safari has no call for it).
  if (connected && cast.path !== 'airplay') {
    rows.push({ key: 'cast:stop', label: 'Stop casting', icon: 'stop', current: false, action: { type: 'cast-stop' } });
  }
  if (rows.length === 0) return null;
  return { key: 'cast', title: cast.path === 'airplay' ? 'AirPlay' : 'Cast', rows };
}

/** Every section the Devices picker shows, in order. While casting, no local
 *  output is lit: the music is on the TV. */
export function deviceSections(out: OutputSummary, cast: CastSummary): DeviceSection[] {
  const sections: DeviceSection[] = [];
  const casting = cast.connection === 'connected';
  if (out.platform) {
    const rows: DeviceRow[] = out.devices.map((d) => ({
      key: `out:${d.id}`,
      label: d.name,
      detail: d.detail,
      icon: d.kind,
      current: !casting && d.id === out.currentId,
      action: { type: 'output', id: d.id },
    }));
    if (out.systemPicker) {
      const s = SYSTEM_ROW[out.systemPicker];
      rows.push({ key: 'system', label: s.label, detail: s.detail, icon: 'more', current: false, action: { type: 'system-picker' } });
    }
    if (rows.length > 0) {
      sections.push({ key: 'outputs', title: out.platform === 'desktop' || out.platform === 'web' ? 'This computer' : 'This phone', rows });
    }
  }
  const c = castSection(cast, out.castDevices);
  if (c) sections.push(c);
  return sections;
}

/** Whether the Devices button belongs on screen at all: an output to
 *  switch, or a way to cast (the cast button's own rule). */
export function devicesButtonVisible(out: Pick<OutputSummary, 'platform' | 'devices' | 'systemPicker'>, cast: CastSummary): boolean {
  if (out.platform && (out.devices.length > 0 || out.systemPicker)) return true;
  if (!cast.path) return false;
  return cast.connection !== 'idle' || cast.availability !== 'none';
}

/** "Playing on Pixel Buds" under the full-screen player: casting, or a
 *  speaker or headset that is not the phone (or computer) itself. */
export function playingOn(out: Pick<OutputSummary, 'platform' | 'currentName' | 'currentKind'>, cast: CastSummary): string | null {
  if (cast.connection === 'connected') {
    return cast.path === 'airplay' ? 'AirPlay' : cast.deviceName ?? 'a cast device';
  }
  if (!out.platform || !out.currentName || !out.currentKind || isBuiltIn(out.currentKind)) return null;
  return out.currentName;
}

/** The Devices button's accessible name and tooltip. */
export function devicesLabel(out: Pick<OutputSummary, 'platform' | 'currentName' | 'currentKind'>, cast: CastSummary): string {
  if (cast.connection === 'connecting') return 'Devices: connecting to a cast device';
  const on = playingOn(out, cast);
  return on ? `Devices: playing on ${on}` : 'Devices';
}
