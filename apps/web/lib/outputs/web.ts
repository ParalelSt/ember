import type { AudioBackend } from '@/lib/playback/types';
import { cleanLabel, guessKind } from './names';
import { SYSTEM_DEFAULT_ID, type OutputDevice, type OutputProvider, type OutputSnapshot } from './types';

/** Picking a speaker in a browser: HTMLMediaElement.setSinkId on the web
 *  engine's element (webBackend.setOutputDevice), which Chrome has on a
 *  computer. Remembered in this browser (localStorage), put back when the
 *  page loads and whenever the device comes back, and dropped for the
 *  system default while the device is gone (unplugged, switched off).
 *
 *  Browsers only name the speakers the page may use: Firefox asks through
 *  its own prompt (selectAudioOutput); Chrome names them once the page may
 *  use the microphone. Without either, only the system default is listed,
 *  and the picker offers the way to ask. */

export const WEB_OUTPUT_KEY = 'ember.output.web';

/** What enumerateDevices hands back, as far as this needs. */
export interface MediaDeviceLike {
  deviceId: string;
  kind: string;
  label: string;
}

export interface RememberedSink {
  id: string;
  label: string;
}

/** Chrome's stand-ins for "whatever the system uses", not devices. */
const PSEUDO = new Set(['', 'default', 'communications']);

/** The picker's rows from the browser's list. The system default always
 *  leads (named after the device it is right now, when the browser says);
 *  then every speaker the page may name. */
export function webSnapshot(list: MediaDeviceLike[], sinkId: string, canSelect: boolean): OutputSnapshot {
  const outputs = list.filter((d) => d.kind === 'audiooutput');
  const def = outputs.find((d) => d.deviceId === 'default' || d.deviceId === '');
  const defName = def?.label ? cleanLabel(def.label.replace(/^default\s*-\s*/i, '')) : '';
  const named = outputs.filter((d) => !PSEUDO.has(d.deviceId) && d.label);
  const devices: OutputDevice[] = [
    { id: SYSTEM_DEFAULT_ID, name: 'System default', kind: 'computer', ...(defName ? { detail: defName } : {}) },
    ...named.map((d) => ({ id: d.deviceId, name: cleanLabel(d.label), kind: guessKind(d.label) })),
  ];
  const currentId = sinkId === '' ? SYSTEM_DEFAULT_ID : sinkId;
  const current = devices.find((d) => d.id === currentId);
  const currentName = currentId === SYSTEM_DEFAULT_ID ? defName || 'This computer' : current?.name ?? null;
  return {
    devices,
    currentId,
    currentName,
    currentKind: currentId === SYSTEM_DEFAULT_ID ? (defName ? guessKind(defName) : 'computer') : current?.kind ?? null,
    systemPicker: canSelect ? 'web-select' : named.length === 0 ? 'web-permission' : null,
  };
}

/** What a change in the device list means for the sink:
 *  - the device playing now is gone: back to the system default, `lost`;
 *  - the remembered device is (back) here and not playing: move to it;
 *  - otherwise nothing. The remembered choice stays through a loss, so
 *    plugging the headset back in returns the music to it. */
export function reconcileSink(
  list: MediaDeviceLike[],
  current: string,
  remembered: RememberedSink | null,
): { apply: string | null; lost: boolean } {
  const outputs = list.filter((d) => d.kind === 'audiooutput' && !PSEUDO.has(d.deviceId));
  // A device the page may not name (no permission yet) is listed without
  // an id; that is not proof it is gone.
  const blind = outputs.length === 0 || outputs.every((d) => !d.label);
  if (current && !blind && !outputs.some((d) => d.deviceId === current)) {
    return { apply: '', lost: true };
  }
  if (remembered) {
    // Browsers re-key devices when site data is cleared: the label finds it then.
    const back = outputs.find((d) => d.deviceId === remembered.id)
      ?? outputs.find((d) => d.label && cleanLabel(d.label) === cleanLabel(remembered.label));
    if (back && back.deviceId !== current) return { apply: back.deviceId, lost: false };
  }
  return { apply: null, lost: false };
}

export function loadRemembered(storage: Storage | null): RememberedSink | null {
  try {
    const raw = storage?.getItem(WEB_OUTPUT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<RememberedSink>;
    return typeof v.id === 'string' && v.id && typeof v.label === 'string' ? { id: v.id, label: v.label } : null;
  } catch {
    return null;
  }
}

export function saveRemembered(storage: Storage | null, sink: RememberedSink | null): void {
  try {
    if (sink) storage?.setItem(WEB_OUTPUT_KEY, JSON.stringify(sink));
    else storage?.removeItem(WEB_OUTPUT_KEY);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

type SelectAudioOutput = (opts?: { deviceId?: string }) => Promise<MediaDeviceLike>;

export interface WebOutputEnv {
  mediaDevices: MediaDevices & { selectAudioOutput?: SelectAudioOutput };
  storage: Storage | null;
  /** The page's own web engine (not a cast engine standing in for it). */
  backend: () => AudioBackend | null;
  /** Tells the listener the device went away. */
  onLost?: (name: string) => void;
}

/** Whether this browser can send the page's audio to another device. */
export function webOutputsSupported(): boolean {
  if (typeof window === 'undefined' || typeof HTMLMediaElement === 'undefined') return false;
  if (!('setSinkId' in HTMLMediaElement.prototype)) return false;
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.enumerateDevices === 'function';
}

export function createWebOutputs(env: WebOutputEnv): OutputProvider {
  const md = env.mediaDevices;
  const canSelect = typeof md.selectAudioOutput === 'function';
  const current = () => env.backend()?.outputDevice?.() ?? '';
  const list = async (): Promise<MediaDeviceLike[]> => {
    try {
      return (await md.enumerateDevices()) as MediaDeviceLike[];
    } catch {
      return [];
    }
  };
  const snapshot = async () => webSnapshot(await list(), current(), canSelect);

  /** Moves the sink to `id` ('' = system default). */
  const apply = async (id: string) => {
    const b = env.backend();
    if (!b?.setOutputDevice) throw new Error('no web audio engine to move');
    await b.setOutputDevice(id);
  };

  /** Puts the remembered device back, or leaves a vanished one. */
  const reconcile = async () => {
    const devices = await list();
    const before = current();
    const { apply: to, lost } = reconcileSink(devices, before, loadRemembered(env.storage));
    if (to === null) return devices;
    try {
      await apply(to);
      if (lost) {
        const gone = loadRemembered(env.storage);
        env.onLost?.(gone && gone.id === before ? gone.label : 'The speaker');
      }
    } catch {
      /* not allowed without a tap (or the device is half there): stay */
    }
    return devices;
  };
  // A page (re)load puts the music back on the remembered speaker.
  void reconcile();

  const remember = (id: string, label: string) =>
    saveRemembered(env.storage, id === '' ? null : { id, label: cleanLabel(label) });

  return {
    platform: 'web',
    snapshot,
    async select(id) {
      const target = id === null || id === SYSTEM_DEFAULT_ID ? '' : id;
      const before = await list();
      await apply(target);
      const label = before.find((d) => d.deviceId === target)?.label ?? '';
      remember(target, label);
      return snapshot();
    },
    async openSystemPicker() {
      if (canSelect) {
        // Firefox's own list; picking there is the permission too.
        const picked = await md.selectAudioOutput!();
        await apply(picked.deviceId);
        remember(picked.deviceId, picked.label);
        return snapshot();
      }
      // Chrome names the speakers once the page may use the microphone.
      // The stream is closed at once: nothing is recorded.
      const stream = await md.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await reconcile();
      return snapshot();
    },
    watch(onChange) {
      const handler = () => {
        void reconcile().then((devices) => onChange(webSnapshot(devices, current(), canSelect)));
      };
      md.addEventListener?.('devicechange', handler);
      return () => md.removeEventListener?.('devicechange', handler);
    },
  };
}
