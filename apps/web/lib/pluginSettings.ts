/** The plugin switches on Settings > Plugins, stored per user in the
 *  `plugins` JSON field (pb_hooks/ensure_plugin_settings.pb.js) so they
 *  follow the account across devices. Adding a plugin means adding its key
 *  here and a default in stores/useSettingsStore.ts; no schema change. */

export const PLUGIN_KEYS = ['partyVolume', 'tabsEnabled'] as const;

export type PluginKey = (typeof PLUGIN_KEYS)[number];

/** What the account has stored. A missing key means "never saved". */
export type StoredPlugins = Partial<Record<PluginKey, boolean>>;

const isPluginKey = (k: string): k is PluginKey => (PLUGIN_KEYS as readonly string[]).includes(k);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The known, boolean-valued keys of whatever the field holds. */
export function readStoredPlugins(raw: unknown): StoredPlugins {
  const out: StoredPlugins = {};
  if (!isPlainObject(raw)) return out;
  for (const k of PLUGIN_KEYS) {
    if (typeof raw[k] === 'boolean') out[k] = raw[k];
  }
  return out;
}

/** A PATCH body: a non-empty object of known keys with boolean values.
 *  Anything else (an unknown key, a non-boolean, an empty object) is null. */
export function parsePluginPatch(body: unknown): StoredPlugins | null {
  if (!isPlainObject(body)) return null;
  const entries = Object.entries(body);
  if (entries.length === 0) return null;
  const out: StoredPlugins = {};
  for (const [k, v] of entries) {
    if (!isPluginKey(k) || typeof v !== 'boolean') return null;
    out[k] = v;
  }
  return out;
}
