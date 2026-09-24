import { noneAdapter, type CacheAdapter } from './adapter';
import { createOpfsAdapter, opfsSupported } from './opfsAdapter';

/** The engines PlayerProvider can pick (its backendKindRef). */
export type BackendKind = 'web' | 'capacitor' | 'android' | 'tauri-native' | 'native-stub';

/** The auto cache that goes with an engine. One place to plug a platform in:
 *  - web, capacitor (web audio in a browser or an older Android WebView
 *    shell): OPFS, blob: URLs the audio element plays;
 *  - android (the native Media3 player): androidAdapter, Task 6;
 *  - tauri-native (the desktop Rust engine): tauriAdapter, Task 7.
 *  Anything without an adapter gets `noneAdapter`, and Settings says the
 *  feature is not available in this app version. */
export function createCacheAdapter(kind: BackendKind): CacheAdapter {
  switch (kind) {
    case 'web':
    case 'capacitor':
      return opfsSupported() ? createOpfsAdapter() : noneAdapter;
    default:
      return noneAdapter;
  }
}
