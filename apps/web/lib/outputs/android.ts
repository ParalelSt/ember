import type { CastDevice, OutputKind, OutputProvider, OutputSnapshot } from './types';

/** The Android app: the phone's outputs as AudioManager lists them, one
 *  pinned through the native player (ExoPlayer.setPreferredAudioDevice), and
 *  Android's own Output Switcher for the rest (a Bluetooth device that is
 *  paired but not the active one, which an app cannot switch to by itself).
 *  Cast devices are listed here too, from the MediaRouter the Cast button
 *  already runs. All of it on the EmberPlayer plugin (apps/mobile, Kotlin);
 *  an app build from before it lacks the methods, and then there is no
 *  picker (the Cast button's own path still works). */

export interface AndroidOutputs {
  outputs: { id: string; name: string; kind: string }[];
  currentId: string | null;
  preferredId: string | null;
  systemSwitcher: boolean;
}

interface ListenerHandle {
  remove?: () => unknown;
}

interface OutputsPlugin {
  getOutputs(): Promise<AndroidOutputs>;
  setOutput(o: { id: string | null }): Promise<AndroidOutputs>;
  showOutputSwitcher?(): Promise<{ shown: boolean; fallback?: string }>;
  getCastDevices?(): Promise<{ devices: CastDevice[] }>;
  selectCastDevice?(o: { id: string }): Promise<void>;
  stopCasting?(): Promise<void>;
  addListener(event: string, cb: (data: never) => void): Promise<ListenerHandle> | ListenerHandle;
}

function plugin(): Partial<OutputsPlugin> | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { Capacitor?: { Plugins?: { EmberPlayer?: Partial<OutputsPlugin> } } })
    .Capacitor?.Plugins?.EmberPlayer ?? null;
}

/** The plugin, when this app build has output switching. */
export function androidOutputsPlugin(): OutputsPlugin | null {
  const p = plugin();
  return p && typeof p.getOutputs === 'function' && typeof p.setOutput === 'function' && typeof p.addListener === 'function'
    ? (p as OutputsPlugin)
    : null;
}

const KINDS: Record<string, OutputKind> = {
  speaker: 'phone',
  headphones: 'headphones',
  bluetooth: 'bluetooth',
  usb: 'usb',
  hdmi: 'hdmi',
};

export function androidSnapshot(raw: AndroidOutputs): OutputSnapshot {
  const devices = (Array.isArray(raw?.outputs) ? raw.outputs : []).map((o) => ({
    id: String(o.id),
    name: o.name,
    kind: KINDS[o.kind] ?? 'other',
  }));
  const current = devices.find((d) => d.id === raw.currentId) ?? null;
  return {
    devices,
    currentId: current?.id ?? null,
    currentName: current?.name ?? null,
    currentKind: current?.kind ?? null,
    systemPicker: raw.systemSwitcher ? 'android-switcher' : null,
  };
}

/** Subscribes, whether this Capacitor hands back the handle or a promise of it. */
function subscribe(p: Pick<OutputsPlugin, 'addListener'>, event: string, cb: (data: never) => void): () => void {
  let handle: ListenerHandle | null = null;
  let done = false;
  try {
    void Promise.resolve(p.addListener(event, cb))
      .then((h) => {
        if (done) void h?.remove?.();
        else handle = h;
      })
      .catch(() => {});
  } catch {
    /* a broken bridge must not break the player */
  }
  return () => {
    done = true;
    void handle?.remove?.();
  };
}

export function createAndroidOutputs(p: OutputsPlugin): OutputProvider {
  const snapshot = async () => androidSnapshot(await p.getOutputs());
  return {
    platform: 'android',
    snapshot: () => snapshot().catch(() => null),
    async select(id) {
      return androidSnapshot(await p.setOutput({ id }));
    },
    async openSystemPicker() {
      await p.showOutputSwitcher?.();
      return snapshot().catch(() => null);
    },
    watch: (onChange) => subscribe(p, 'outputs', (raw: AndroidOutputs) => onChange(androidSnapshot(raw))),
  };
}

// ── Cast devices ────────────────────────────────────────────────────────

/** The plugin's cast device list, when this app build has it. */
export function androidCastPlugin(): (OutputsPlugin & Required<Pick<OutputsPlugin, 'getCastDevices' | 'selectCastDevice'>>) | null {
  const p = plugin();
  return p && typeof p.getCastDevices === 'function' && typeof p.selectCastDevice === 'function' && typeof p.addListener === 'function'
    ? (p as OutputsPlugin & Required<Pick<OutputsPlugin, 'getCastDevices' | 'selectCastDevice'>>)
    : null;
}

export function castDevicesOf(raw: { devices?: unknown } | null | undefined): CastDevice[] {
  const list = Array.isArray(raw?.devices) ? (raw!.devices as Partial<CastDevice>[]) : [];
  return list
    .filter((d) => typeof d.id === 'string' && typeof d.name === 'string')
    .map((d) => ({
      id: d.id!,
      name: d.name!,
      description: typeof d.description === 'string' && d.description ? d.description : null,
      selected: d.selected === true,
      connecting: d.connecting === true,
    }));
}

export function watchAndroidCastDevices(onChange: (d: CastDevice[]) => void): () => void {
  const p = androidCastPlugin();
  if (!p) return () => {};
  void p.getCastDevices().then((r) => onChange(castDevicesOf(r)), () => {});
  return subscribe(p, 'castDevices', (r: { devices: CastDevice[] }) => onChange(castDevicesOf(r)));
}
