import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { guessKind } from './names';
import { SYSTEM_DEFAULT_ID, type OutputDevice, type OutputProvider, type OutputSnapshot } from './types';

/** The desktop app: the native engine's own output devices (cpal). The
 *  engine moves the music without stopping it, remembers the choice across
 *  launches, drops back to the system default when that device goes, and
 *  returns to it when it comes back (apps/desktop, src/output.rs). A desktop
 *  build from before this has no `audio_outputs`: the call is refused and
 *  the picker shows only casting (there is none on desktop), i.e. no button. */

/** `audio_outputs` / `audio_set_output` / the `audio:outputs` event. */
export interface DesktopOutputs {
  devices: { id: string; name: string; isDefault: boolean }[];
  /** The device playing now. */
  active: string | null;
  /** The remembered choice; null follows the system default. */
  preferred: string | null;
}

export function desktopSnapshot(raw: DesktopOutputs): OutputSnapshot {
  const list = Array.isArray(raw?.devices) ? raw.devices : [];
  const def = list.find((d) => d.isDefault);
  const devices: OutputDevice[] = [
    { id: SYSTEM_DEFAULT_ID, name: 'System default', kind: 'computer', ...(def ? { detail: def.name } : {}) },
    ...list.map((d) => ({ id: d.id, name: d.name, kind: guessKind(d.name) })),
  ];
  const pinned = raw.preferred && list.some((d) => d.id === raw.preferred) ? raw.preferred : null;
  const active = list.find((d) => d.id === raw.active) ?? def ?? null;
  return {
    devices,
    currentId: pinned ?? SYSTEM_DEFAULT_ID,
    currentName: active?.name ?? null,
    currentKind: active ? guessKind(active.name) : null,
    systemPicker: null,
  };
}

export function createDesktopOutputs(): OutputProvider {
  return {
    platform: 'desktop',
    async snapshot() {
      try {
        return desktopSnapshot(await invoke<DesktopOutputs>('audio_outputs'));
      } catch {
        // An older desktop build, or no audio device at all.
        return null;
      }
    },
    async select(id) {
      const raw = await invoke<DesktopOutputs>('audio_set_output', { id: id === SYSTEM_DEFAULT_ID ? null : id });
      return desktopSnapshot(raw);
    },
    watch(onChange) {
      let stop: (() => void) | null = null;
      let done = false;
      listen<DesktopOutputs>('audio:outputs', (e) => onChange(desktopSnapshot(e.payload)))
        .then((u) => {
          if (done) u();
          else stop = u;
        })
        .catch(() => {});
      return () => {
        done = true;
        stop?.();
      };
    },
  };
}
