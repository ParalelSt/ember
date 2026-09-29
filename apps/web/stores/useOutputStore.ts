'use client';

import { create } from 'zustand';
import type { CastDevice, OutputPlatform, OutputSnapshot } from '@/lib/outputs/types';

/** The Devices button's state (lib/outputs/controller keeps it current).
 *  `platform` null: this page cannot pick an output (Safari, Firefox without
 *  a speaker prompt, an app build from before output switching); the button
 *  then only shows for casting. */
interface OutputState extends OutputSnapshot {
  platform: OutputPlatform | null;
  /** Cast devices the Android app lists itself; null where the only way to
   *  cast is the platform's picker (Chrome, Safari, an older app build). */
  castDevices: CastDevice[] | null;
  /** A switch is under way. */
  busy: boolean;
  set: (patch: Partial<Omit<OutputState, 'set'>>) => void;
}

export const EMPTY_OUTPUTS: OutputSnapshot = {
  devices: [],
  currentId: null,
  currentName: null,
  currentKind: null,
  systemPicker: null,
};

export const useOutputStore = create<OutputState>()((set) => ({
  platform: null,
  ...EMPTY_OUTPUTS,
  castDevices: null,
  busy: false,
  set: (patch) => set(patch),
}));
