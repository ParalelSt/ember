import { noneAdapter, type CacheAdapter } from './adapter';
import { createAndroidCacheAdapter } from './androidAdapter';
import { createOpfsAdapter, opfsSupported } from './opfsAdapter';
import { tauriCacheAdapter } from './tauriAdapter';

/** The engines PlayerProvider can pick (its backendKindRef). */
export type BackendKind = 'web' | 'capacitor' | 'android' | 'tauri-native' | 'native-stub';

/** The auto cache that goes with an engine. One place to plug a platform in:
 *  - web, capacitor (web audio in a browser or an older Android WebView
 *    shell): OPFS, blob: URLs the audio element plays;
 *  - android (the native Media3 player): androidAdapter, a mirror of the
 *    cache the native player keeps by itself;
 *  - tauri-native (the desktop Rust engine): tauriAdapter, the shell's
 *    cache dir, opened by the engine through `LoadOptions.cacheKey`.
 *  An app shell too old for its adapter resolves `ready()` false, and
 *  Settings says to update the app. Anything else without an adapter gets
 *  `noneAdapter`, and Settings says the feature is not available. */
export function createCacheAdapter(kind: BackendKind): CacheAdapter {
  switch (kind) {
    case 'web':
    case 'capacitor':
      return opfsSupported() ? createOpfsAdapter() : noneAdapter;
    case 'android':
      return createAndroidCacheAdapter();
    case 'tauri-native':
      // One per app: ready() asks the shell once and the answer holds.
      return tauriCacheAdapter;
    default:
      return noneAdapter;
  }
}
