# Native Voice Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mic in the search box works in the native apps, free, using each platform's own recognizer: Android `android.speech.SpeechRecognizer`, macOS `SFSpeechRecognizer` + `AVAudioEngine`, Windows `Windows.Media.SpeechRecognition`. Browsers keep the Web Speech API. Owner's fixed decision: no host-side Whisper.

**Architecture:** One JS interface `NativeSpeech` (start/stop/abort, events partial/final/error/end) behind three adapters (web, capacitor, tauri) picked at runtime by `detectShell()` plus a bridge probe. A shared `SpeechSession` wrapper adds the 15 s hard timeout and the "end exactly once" guarantee. `useVoiceSearch` keeps its public API (`{ supported, listening, toggle }`). Android gets a Capacitor plugin `EmberSpeech`; the Tauri app gets `speech_*` commands emitting `speech:*` events, with the platform code behind `cfg(target_os)` and the pure parts (locale pick, error mapping, payload shapes) shared and unit tested.

**Tech Stack:** Next.js web app (vitest + happy-dom), Capacitor 7.6 Android (Kotlin 2.0, Robolectric 4.14 JVM tests), Tauri 2.11 (Rust; objc2 0.6.4 / objc2-foundation 0.3.2 / block2 0.6.2 already in Cargo.lock; `windows` crate 0.62.2 already in Cargo.lock).

**Branch:** `voice-search` in `/Users/aronmatoic/Documents/Main Projects/spotify-clone-wt/test-all`. Commit after each task, never push or merge unless the owner says so.

---

## Global constraints (repeat these to every worker)

- Worktree is `/Users/aronmatoic/Documents/Main Projects/spotify-clone-wt/test-all`. Use absolute paths.
- NEVER run `npm install`, `npm ci` or `npm version` in this worktree: `node_modules` are symlinks into the main checkout and npm will wreck the main install. No new JS dependencies (`@tauri-apps/api` and `sonner` are already installed and are all this plan needs). Cargo and Gradle dependencies are fine.
- Local app server: only port 3050 with PocketBase 8088, started with `/Users/aronmatoic/Documents/Main Projects/spotify-clone-wt/_sandbox/start-app.sh`; rebuild with `cd apps/web && POCKETBASE_URL=http://127.0.0.1:8088 npx next build --webpack`. Never touch :3000, :8090, any pocketbase binary or pb_data.
- Disk is tight. Android emulator cannot boot (JVM unit tests via Gradle are fine). A macOS debug `cargo build` / `cargo test` in `apps/desktop/src-tauri` is fine. Windows Rust code is checked with `cargo check --target x86_64-pc-windows-msvc` (the target IS installed per `rustup target list --installed`); if tauri-build's Windows resource step refuses to run on a Mac host, CI (`.github/workflows/native-build.yml`, `windows-latest`) is the gate, see Task 8.
- Release profile is `panic = "abort"`: no `unwrap`/`expect`/indexing on anything coming from ObjC, WinRT or the webview. Every nil is an `Err`/`None`, every ObjC call that can throw is wrapped in `objc2::exception::catch`.
- The web app is served by the host and loaded by whatever shell version the user has. Old shells (no bridge/plugin/command) must degrade to a clear "update the app" toast, never to a broken Web Speech path inside a WebView (WebView2 exposes `webkitSpeechRecognition` but every session fails with `network`; Android WebView is the same; WKWebView has no ctor at all). So: inside a shell, only the native adapter is ever used.
- Copy: no em dashes anywhere (code, comments, docs, toasts, this plan). Comments explain why.
- Tests for every task, run before committing: `cd apps/web && npx vitest run <files>` (never the whole suite unless a task says so), `cd apps/desktop/src-tauri && cargo test --lib speech`, `cd apps/mobile/android && ./gradlew testDebugUnitTest --tests 'app.ember.music.Speech*'`.
- `docs/superpowers/` is gitignored (commit 223ced6). This plan was committed with `git add -f`; the implementer does not need to touch it again.

## Fixed contract (all platforms)

Event payloads, kinds and copy are defined once here and every layer conforms.

```ts
// apps/web/lib/speech/types.ts
export type SpeechErrorKind =
  | 'permission-denied'   // mic or speech permission refused by the OS
  | 'unavailable'         // no recognizer on this device, or an old shell without the bridge
  | 'network'             // recognizer needs the network and has none
  | 'speech-setting-off'  // Windows only: "online speech recognition" privacy toggle is off
  | 'no-speech'           // silence / nothing recognised (quiet, no toast)
  | 'aborted';            // we cancelled it ourselves (quiet)

export interface SpeechEvents {
  /** Full text so far (not a delta), may be called many times. */
  onPartial(text: string): void;
  /** Full final text; at most once per start; followed by onEnd. */
  onFinal(text: string): void;
  /** At most once per start; followed by onEnd. `detail` is for the logger, never shown. */
  onError(kind: SpeechErrorKind, detail?: string): void;
  /** Exactly once per start, after final or error or a plain stop. */
  onEnd(): void;
}

export interface NativeSpeech {
  /** Begins listening; rejects only when it could not even begin (the reason is also sent through onError). */
  start(lang: string, events: SpeechEvents): Promise<void>;
  /** Stop capturing; the recogniser still delivers its final result, then onEnd. */
  stop(): void;
  /** Drop everything now; no final, then onEnd (kind 'aborted' is NOT emitted as an error). */
  abort(): void;
}

export type SpeechAdapterKind = 'web' | 'capacitor' | 'tauri';
export interface SpeechAdapter {
  kind: SpeechAdapterKind;
  create(): NativeSpeech;
}
```

User-facing copy (one place, `apps/web/lib/speech/messages.ts`):

| kind | toast |
|---|---|
| `permission-denied` | "Allow microphone access to use voice search." (existing copy) |
| `unavailable` (web) | "Voice search isn't supported in this browser: try Chrome." (existing copy in `useSearchQuery.onMicClick`) |
| `unavailable` (shell, no bridge or command missing) | "Update the Ember app to use voice search." |
| `unavailable` (shell, recognizer really missing) | "Voice search isn't available on this device." |
| `network` | "Voice search needs an internet connection right now." |
| `speech-setting-off` | "Turn on Online speech recognition in Windows Settings (Privacy & security, Speech) to use voice search." |
| `no-speech`, `aborted` | no toast |

Language: the device/OS locale as a BCP-47 tag (`en-US`), never an underscore form; fall back to `en-US` when missing or malformed. Regex used everywhere: `^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$`. The JS passes `navigator.language` as a hint; native sides prefer their own OS locale and use the hint only when the OS one is missing.

Timing: native sides auto-stop on silence (their own end-of-speech detection). The JS `SpeechSession` enforces a hard 15 s cap (`stop()` at 15 s, `abort()` 3 s later if no `onEnd` arrived).

Bridge surfaces:

- Capacitor plugin `EmberSpeech` (reached as `window.Capacitor.Plugins.EmberSpeech`, never imported from npm): methods `available(): Promise<{ available: boolean; onDevice: boolean }>`, `start({ lang }): Promise<void>` (rejects with `code` = a `SpeechErrorKind` when it cannot start), `stop(): Promise<void>`, `abort(): Promise<void>`; events `partial {text}`, `final {text}`, `error {kind, detail?}`, `end {}`.
- Tauri commands `speech_available() -> { available, onDevice }`, `speech_start(lang: Option<String>)`, `speech_stop()`, `speech_abort()`; events `speech:partial {text}`, `speech:final {text}`, `speech:error {kind, detail?}`, `speech:end {}`. All four commands must be listed in `permissions/app-commands.toml` or the remote origin gets "not allowed by ACL".

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `apps/web/lib/speech/types.ts` (new) | 1 | contract above |
| `apps/web/lib/speech/messages.ts` (new) | 1 | kind to toast copy |
| `apps/web/lib/speech/webSpeech.ts` (new) | 1 | Web Speech API adapter (moved out of the hook, behaviour identical) |
| `apps/web/lib/speech/session.ts` (new) | 1 | `createSpeechSession`: timeout, end-once, state |
| `apps/web/lib/speech/selectAdapter.ts` (new) | 1, 2, 4 | runtime adapter pick |
| `apps/web/hooks/useVoiceSearch.ts` (modify) | 1 | uses session + adapter; same public API |
| `apps/web/hooks/useSearchQuery.ts` (modify) | 1 | shell-aware unsupported toast |
| `apps/web/lib/speech/capacitorSpeech.ts` (new) | 2 | Capacitor adapter |
| `apps/mobile/android/app/src/main/java/app/ember/music/{SpeechErrors,SpeechLocale,SpeechSession,EmberSpeechPlugin}.kt` (new) | 3 | Android recognizer |
| `apps/mobile/android/app/src/main/AndroidManifest.xml`, `MainActivity.java` (modify) | 3 | permission, `<queries>`, registration |
| `apps/web/lib/speech/tauriSpeech.ts` (new) | 4 | Tauri adapter |
| `apps/desktop/src-tauri/src/speech.rs`, `speech/macos.rs`, `speech/windows.rs`, `speech/unsupported.rs` (new) | 5, 6, 7 | commands, pure parts, platform code |
| `apps/desktop/src-tauri/{Cargo.toml,src/lib.rs,permissions/app-commands.toml,Info.plist,entitlements.plist,tauri.conf.json}` (modify/new) | 5, 6, 7 | wiring, plist strings, entitlement, ad-hoc signing |
| `.github/workflows/native-build.yml` (modify, temporary) | 8 | build `voice-search` on push so Windows compiles in CI |
| `apps/web/lib/changelog.ts`, `apps/web/package.json`, `apps/desktop/README.md`, `apps/mobile/README.md`, `APPS.md` (modify) | 9 | changelog + docs |

---

## Task 1: JS interface, web adapter, session, hook refactor (no behaviour change)

**Files:**
- Create: `apps/web/lib/speech/types.ts`, `messages.ts`, `webSpeech.ts`, `session.ts`, `selectAdapter.ts`
- Modify: `apps/web/hooks/useVoiceSearch.ts`, `apps/web/hooks/useSearchQuery.ts`
- Tests: `apps/web/lib/speech/webSpeech.test.ts`, `session.test.ts`, `selectAdapter.test.ts`, `messages.test.ts`, `apps/web/hooks/useVoiceSearch.test.tsx`; extend `apps/web/hooks/useSearchQuery.test.tsx`

**Steps:**

- [ ] `types.ts`: exactly the contract above. `messages.ts`: `export function speechErrorMessage(kind, shell: Shell, reason?: 'no-bridge' | 'no-recognizer'): string | null` returning the table copy (null for `no-speech`/`aborted`).
- [ ] `webSpeech.ts`: move `getCtor()` and the local `SpeechRecognitionLike` types out of the hook. `export function webSpeechAvailable(win = globalThis.window): boolean` and `export function createWebSpeech(win?): NativeSpeech`. Keep today's semantics: `interimResults = true`, `continuous = false`, accumulate `results[i][0].transcript` into one string, call `onPartial(text)` while not final and `onFinal(text)` when the last result `isFinal`. Map `onerror`: `not-allowed`/`service-not-allowed` to `permission-denied`, `network` to `network`, `no-speech` to `no-speech`, `aborted` to `aborted`, `audio-capture`/`language-not-supported` to `unavailable`, else `unavailable` with `detail = e.error`. `onend` calls `onEnd()` once. `stop()` calls `rec.stop()`, `abort()` calls `rec.abort()`.
- [ ] `session.ts`: `export function createSpeechSession(adapter: SpeechAdapter, opts: { lang: string; events: SpeechEvents; hardTimeoutMs?: number /* 15000 */; abortGraceMs?: number /* 3000 */; setTimeout?, clearTimeout? })` returning `{ start(): Promise<void>; stop(): void; abort(): void; }`. Guarantees: `onEnd` forwarded at most once; `onPartial`/`onFinal`/`onError` ignored after end; `onError('aborted')` is swallowed (quiet); timers cleared on end. Timer functions are injectable so tests use fake timers deterministically.
- [ ] `selectAdapter.ts`: `export function selectSpeechAdapter(shell = detectShell(), win = globalThis.window): { adapter: SpeechAdapter | null; reason?: 'no-bridge' | 'no-recognizer' }`. In this task: `web` returns the web adapter when `webSpeechAvailable`, else `{ adapter: null, reason: 'no-recognizer' }`; `capacitor` and `tauri` return `{ adapter: null, reason: 'no-bridge' }` (Tasks 2 and 4 fill them in). Never returns the web adapter for a shell.
- [ ] `useVoiceSearch.ts`: same signature and return `{ supported, listening, toggle }`. `supported` = `useSyncExternalStore(subscribeNever, () => selectSpeechAdapter().adapter !== null, () => false)`. `toggle`: when listening call `session.stop()`; else build a session with `lang = navigator.language || 'en-US'` and events: partial/final call `onTranscriptRef.current(text, isFinal)` (skip empty text, as today); error calls `toast.error(msg)` when `speechErrorMessage` returns copy and `logger.error('voice', 'speech recognition error', { kind, detail })` for everything except `no-speech`/`aborted`/`permission-denied` (today's rule); end sets `listening=false`. Unmount aborts. `listening` becomes true only after `start()` resolves; a rejected `start()` leaves it false.
- [ ] `useSearchQuery.ts`: `onMicClick` keeps the existing web copy; when `detectShell() !== 'web'` and `!voice.supported`, toast "Update the Ember app to use voice search." Nothing else changes for callers (`SearchOverlay.tsx`, `SearchOverlayContainer.tsx`, `search/page.tsx` untouched).
- [ ] Tests (vitest, happy-dom). `webSpeech.test.ts`: fake ctor on `window.webkitSpeechRecognition`; asserts lang, interim/continuous flags, accumulation across results, final flag, every error mapping row, `onEnd` once, `stop`/`abort` call through. `session.test.ts` (fake timers): hard timeout calls `stop` at 15 s and `abort` at 18 s if no end; end-once; events ignored after end; `aborted` swallowed; start rejection still ends. `selectAdapter.test.ts`: shell x window matrix, including "capacitor shell with `webkitSpeechRecognition` present still returns null" and "tauri shell with `__TAURI_INTERNALS__` present but no adapter yet returns no-bridge". `messages.test.ts`: the table. `useVoiceSearch.test.tsx` (`renderHook`, mock `selectSpeechAdapter` with a fake adapter recording calls): supported false on SSR snapshot and true with an adapter; toggle starts and sets listening; partial/final reach the callback with the right `isFinal`; error kinds toast the right copy via a mocked `sonner`; second toggle stops; unmount aborts. `useSearchQuery.test.tsx`: add a case with `detectShell` mocked to `capacitor` and `supported:false` asserting the update toast.
- [ ] Run: `cd apps/web && npx vitest run lib/speech hooks/useVoiceSearch.test.tsx hooks/useSearchQuery.test.tsx components/search app/\(app\)/search` and `npx tsc --noEmit -p .` and `npx eslint lib/speech hooks/useVoiceSearch.ts hooks/useSearchQuery.ts`.
- [ ] Commit: `refactor(voice): NativeSpeech interface, web adapter and session behind useVoiceSearch`.

## Task 2: Capacitor adapter (JS side)

**Files:**
- Create: `apps/web/lib/speech/capacitorSpeech.ts`, `capacitorSpeech.test.ts`
- Modify: `apps/web/lib/speech/selectAdapter.ts` (+ test)

**Steps:**

- [ ] `capacitorSpeech.ts`: local `EmberSpeechPlugin` interface (same style as `apps/web/lib/playback/androidBackend.ts`, never an npm import): `addListener(event, cb): Promise<{ remove(): void }> | { remove(): void }`, `available()`, `start({ lang })`, `stop()`, `abort()`. `export function capacitorSpeechPresent(win?): boolean` (`window.Capacitor?.Plugins?.EmberSpeech` exists). `createCapacitorSpeech()`: on `start` register the four listeners, then `await plugin.start({ lang })`; a rejection is mapped through `err.code` (a `SpeechErrorKind` string set by Kotlin) else `unavailable`, forwarded to `onError` then `onEnd`, and rethrown. Listener handles are removed on end (they can be promises: `await` them before remove, as Capacitor 7 returns `Promise<PluginListenerHandle>`).
- [ ] `selectAdapter.ts`: `capacitor` shell returns the capacitor adapter when `capacitorSpeechPresent()`, else `no-bridge`.
- [ ] Tests: fake `window.Capacitor.Plugins.EmberSpeech` object in `beforeEach` like `capacitorBackend.test.ts`; assert start passes `{ lang }`, events flow to `SpeechEvents`, rejection with `{ code: 'permission-denied' }` maps, listeners removed after end, `stop`/`abort` call through. Extend `selectAdapter.test.ts`.
- [ ] Run the speech tests + tsc + eslint. Commit: `feat(voice): Capacitor adapter for the EmberSpeech plugin`.

## Task 3: Android plugin (Kotlin)

**Files:**
- Create: `apps/mobile/android/app/src/main/java/app/ember/music/SpeechErrors.kt`, `SpeechLocale.kt`, `SpeechSession.kt`, `EmberSpeechPlugin.kt`
- Modify: `apps/mobile/android/app/src/main/AndroidManifest.xml`, `apps/mobile/android/app/src/main/java/app/ember/music/MainActivity.java`
- Tests: `apps/mobile/android/app/src/test/java/app/ember/music/SpeechErrorsTest.kt`, `SpeechLocaleTest.kt`, `SpeechSessionTest.kt`

**Steps:**

- [ ] `SpeechErrors.kt`: `object SpeechErrors { fun kind(code: Int): String }` mapping `SpeechRecognizer.ERROR_*`: `INSUFFICIENT_PERMISSIONS` to `permission-denied`; `NETWORK`, `NETWORK_TIMEOUT`, `SERVER`, `SERVER_DISCONNECTED` (API 31) to `network`; `NO_MATCH`, `SPEECH_TIMEOUT` to `no-speech`; `AUDIO`, `CLIENT`, `RECOGNIZER_BUSY`, `LANGUAGE_NOT_SUPPORTED`, `LANGUAGE_UNAVAILABLE`, `TOO_MANY_REQUESTS`, `CANNOT_CHECK_SUPPORT`, unknown to `unavailable`. Use the int constants from `android.speech.SpeechRecognizer` (Robolectric provides them; plain constants, so a plain JUnit test also works).
- [ ] `SpeechLocale.kt`: `object SpeechLocale { val TAG = Regex("^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$"); fun pick(requested: String?, device: String?): String }` returns the first of `device`, `requested`, `"en-US"` that matches (device first: the OS knows better than the page's `navigator.language`, which in a WebView is the same anyway). Normalises `_` to `-`.
- [ ] `SpeechSession.kt`: pure state machine, no Android imports beyond nothing. `class SpeechSession(private val emit: (event: String, payload: Map<String, Any?>) -> Unit)` with `fun start()`, `fun partial(texts: List<String>)`, `fun results(texts: List<String>)`, `fun error(code: Int)`, `fun ended()`, `fun abort()`, `val active: Boolean`. Rules: `partial` emits `partial` with `texts[0]` if non-blank; `results` emits `final` then `end`; `error(NO_MATCH or SPEECH_TIMEOUT)` after at least one partial emits `final` with the last partial (Android often reports NO_MATCH after perfectly good partials) then `end`; any other error emits `error {kind, detail:"code N"}` then `end`; `end` at most once per `start`; anything after `end` is ignored; `abort()` emits only `end`.
- [ ] `EmberSpeechPlugin.kt`: `@CapacitorPlugin(name = "EmberSpeech", permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")])`. Methods: `available(call)` resolves `{ available: SpeechRecognizer.isRecognitionAvailable(context), onDevice: Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context) }`. `start(call)`: if `getPermissionState("microphone") != GRANTED` call `requestPermissionForAlias("microphone", call, "onMicPermission")` and continue in `@PermissionCallback fun onMicPermission(call)` (reject with `call.reject("microphone", "permission-denied")` when still denied; Capacitor surfaces the second argument as `err.code`). Then on the main thread (`bridge.executeOnMainThread`, SpeechRecognizer must be created and driven there): if `!isRecognitionAvailable` reject with code `unavailable`; create `SpeechRecognizer.createSpeechRecognizer(context)` (the default recognizer picks on-device by itself where Google supports it; do not force `createOnDeviceSpeechRecognizer`, it rejects most locales), set a `RecognitionListener` that forwards `onPartialResults`/`onResults` (`bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)`) and `onError` into a `SpeechSession` whose `emit` does `bridge.executeOnMainThread { notifyListeners(event, JSObject(payload)) }`; intent `RecognizerIntent.ACTION_RECOGNIZE_SPEECH` with `EXTRA_LANGUAGE_MODEL = LANGUAGE_MODEL_FREE_FORM`, `EXTRA_PARTIAL_RESULTS = true`, `EXTRA_MAX_RESULTS = 1`, `EXTRA_LANGUAGE = SpeechLocale.pick(call.getString("lang"), Locale.getDefault().toLanguageTag())`, `EXTRA_CALLING_PACKAGE = context.packageName`; `startListening(intent)`; resolve the call. `stop(call)`: `recognizer?.stopListening()`. `abort(call)`: `recognizer?.cancel()`, `session.abort()`, destroy. Always `destroy()` the recognizer on `end` and in `handleOnDestroy`. Any exception around `startListening` becomes `error {kind:'unavailable'}` + `end` and a `NativeLog.warn("speech", ...)` so it lands in bug reports.
- [ ] Manifest: add `<uses-permission android:name="android.permission.RECORD_AUDIO" />` and, for API 30+ package visibility (without it `isRecognitionAvailable` is false on Android 11+), a top-level `<queries><intent><action android:name="android.speech.RecognitionService" /></intent></queries>`.
- [ ] `MainActivity.java`: `registerPlugin(EmberSpeechPlugin.class);` next to the other two.
- [ ] Tests: `SpeechErrorsTest` (every row), `SpeechLocaleTest` (device wins, underscore normalised, malformed falls through, all null gives en-US), `SpeechSessionTest` (plain JUnit, capture emits into a list: partial then results gives partial/final/end in order; NO_MATCH after partial promotes it to final; error before any partial gives error+end; end once; events after end ignored; abort emits only end). Follow `SafeAreaInsetsTest.kt` style; use Robolectric (`@RunWith(RobolectricTestRunner::class) @Config(sdk = [34])`) only if a test needs a real `android.*` class.
- [ ] Run: `cd apps/mobile/android && ./gradlew testDebugUnitTest --tests 'app.ember.music.Speech*'` and `./gradlew compileDebugKotlin`. Do not build an APK here unless disk allows (`./gradlew assembleDebug` is the owner's call).
- [ ] Commit: `feat(android): EmberSpeech plugin, native voice search over SpeechRecognizer`.

## Task 4: Tauri adapter (JS side)

**Files:**
- Create: `apps/web/lib/speech/tauriSpeech.ts`, `tauriSpeech.test.ts`
- Modify: `apps/web/lib/speech/selectAdapter.ts` (+ test)

**Steps:**

- [ ] `tauriSpeech.ts`: `import { invoke } from '@tauri-apps/api/core'` and `listen` from `@tauri-apps/api/event` (same as `tauriBackend.ts`). `export function tauriSpeechPresent(win?): boolean` = `typeof window.__TAURI_INTERNALS__?.invoke === 'function'` (same probe as `nativeBackendReady`). `createTauriSpeech()`: on `start`, subscribe to the four `speech:*` events (collect unlisteners), then `await invoke('speech_start', { lang })` with a 2 s race like `readDesktopLog` so a dead bridge cannot hang the mic. Rejection mapping: message containing `not allowed by ACL` or `not found` means an old desktop build, so `onError('unavailable', msg)` and the adapter marks `reason = 'no-bridge'` for the toast copy (expose via a thrown error `{ kind: 'unavailable', reason: 'no-bridge' }` that the hook passes to `speechErrorMessage`); other rejections carry `{ kind, detail }` from Rust (commands return `Result<_, SpeechError>` serialised as `{ kind, detail }`). `stop` invokes `speech_stop`, `abort` invokes `speech_abort`; both swallow rejections. Unlisten on end.
- [ ] `selectAdapter.ts`: `tauri` shell returns the tauri adapter when `tauriSpeechPresent()`.
- [ ] Tests: `vi.mock('@tauri-apps/api/core')` / `('@tauri-apps/api/event')` (see how `tauriBackend` tests do it, or mock inline): start invokes with `{ lang }`; emitted events reach `SpeechEvents`; ACL rejection maps to `unavailable` + `no-bridge`; `{kind:'permission-denied'}` rejection maps; timeout race rejects with `unavailable`; unlisten called after end. Extend `selectAdapter.test.ts`.
- [ ] Run speech tests + tsc + eslint. Commit: `feat(voice): Tauri adapter over speech_* commands`.

## Task 5: Rust commands, pure parts, unsupported platform (compiles everywhere)

**Files:**
- Create: `apps/desktop/src-tauri/src/speech.rs`, `apps/desktop/src-tauri/src/speech/unsupported.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/permissions/app-commands.toml`

**Steps:**

- [ ] `speech.rs` public surface:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpeechErrorKind { PermissionDenied, Unavailable, Network, SpeechSettingOff, NoSpeech, Aborted }

#[derive(Clone, Debug, serde::Serialize)]
pub struct SpeechError { pub kind: SpeechErrorKind, pub detail: Option<String> }

#[derive(serde::Serialize)] pub struct Availability { pub available: bool, #[serde(rename = "onDevice")] pub on_device: bool }

/// BCP-47 pick: os locale first, then the page's hint, then en-US. Normalises `_` to `-`.
pub fn pick_locale(os: Option<&str>, requested: Option<&str>) -> String;

/// Platform backends implement this; commands only talk to it.
pub trait SpeechBackend: Send + Sync + 'static {
    fn available(&self) -> Availability;
    fn start(&self, lang: String, app: tauri::AppHandle) -> Result<(), SpeechError>;
    fn stop(&self);
    fn abort(&self);
}
pub struct SpeechState(pub Box<dyn SpeechBackend>);

pub fn emit_partial(app: &AppHandle, text: &str); pub fn emit_final(app: &AppHandle, text: &str);
pub fn emit_error(app: &AppHandle, err: &SpeechError); pub fn emit_end(app: &AppHandle);
/// Tracks "end exactly once" for a session; backends hold one per start.
pub struct EndOnce(std::sync::atomic::AtomicBool);

#[tauri::command] pub fn speech_available(state: State<SpeechState>) -> Availability;
#[tauri::command] pub fn speech_start(app: AppHandle, state: State<SpeechState>, lang: Option<String>) -> Result<(), SpeechError>;
#[tauri::command] pub fn speech_stop(state: State<SpeechState>);
#[tauri::command] pub fn speech_abort(state: State<SpeechState>);
pub fn new_backend(log: Option<&std::path::Path>) -> SpeechState; // cfg-dispatch to macos / windows / unsupported
```

  Event names `speech:partial|final|error|end`, payloads `{ "text" }`, `{ "kind", "detail" }`, `{}`; use `tauri::Emitter` like `audio.rs` and ignore emit errors. `mod macos; mod windows; mod unsupported;` behind `#[cfg(target_os = "macos")]`, `#[cfg(target_os = "windows")]`, `#[cfg(not(any(target_os = "macos", target_os = "windows")))]`.
- [ ] `unsupported.rs`: `available()` is `{false,false}`, `start` returns `Err(Unavailable, "no speech recognizer on this platform")`. Linux builds keep working.
- [ ] `lib.rs`: `mod speech;`, `.manage(speech::new_backend(log_path.as_ref()))`, add the four commands to `generate_handler!`, and in `setup` write one log line `speech: available=<bool> onDevice=<bool>` through `applog::write_line` (CI reads it in Task 8).
- [ ] `permissions/app-commands.toml`: append `speech_available`, `speech_start`, `speech_stop`, `speech_abort` to `allow` with a comment saying why (remote origin ACL).
- [ ] Tests (`#[cfg(test)] mod tests` in `speech.rs`): `pick_locale` rows (`Some("en_GB")` gives `en-GB`; malformed os falls to requested; both missing gives `en-US`); `SpeechErrorKind` serialises to the exact kebab strings the JS expects (`serde_json::to_string`); `SpeechError` JSON shape `{"kind":"network","detail":null}`; `EndOnce` fires once. Cross-platform tests only: nothing here touches ObjC/WinRT.
- [ ] Run: `cd apps/desktop/src-tauri && cargo test --lib speech && cargo build` (debug). Commit: `feat(desktop): speech_* commands with a pure core and an unsupported fallback`.

## Task 6: macOS backend (SFSpeechRecognizer + AVAudioEngine) and bundle signing

**Files:**
- Create: `apps/desktop/src-tauri/src/speech/macos.rs`, `apps/desktop/src-tauri/Info.plist`
- Modify: `apps/desktop/src-tauri/Cargo.toml`, `entitlements.plist`, `tauri.conf.json`

**Steps:**

- [ ] `Cargo.toml`, under `[target.'cfg(target_os = "macos")'.dependencies]` (all resolve against the objc2 0.6.4 / objc2-foundation 0.3.2 / block2 0.6.2 already in `Cargo.lock`; verified on crates.io: objc2-speech 0.3.2 requires objc2 >=0.6.2, objc2-foundation ^0.3.2, block2 >=0.6.1):

```toml
objc2 = { version = "0.6", features = ["exception"] }   # exception::catch: an ObjC throw must not abort the app
objc2-foundation = { version = "0.3", features = ["NSString", "NSLocale", "NSError", "NSArray", "NSObject", "NSDictionary"] }
objc2-speech = { version = "0.3.2", default-features = false, features = ["std", "SFSpeechRecognizer", "SFSpeechRecognitionRequest", "SFSpeechRecognitionResult", "SFSpeechRecognitionTask", "SFTranscription", "SFErrors", "block2", "objc2-avf-audio"] }
objc2-avf-audio = { version = "0.3.2", default-features = false, features = ["std", "AVAudioEngine", "AVAudioNode", "AVAudioIONode", "AVAudioFormat", "AVAudioBuffer", "AVAudioTime"] }
objc2-av-foundation = { version = "0.3.2", default-features = false, features = ["std", "AVCaptureDevice", "AVMediaFormat"] }   # mic TCC status + prompt
block2 = "0.6"
```

  If `cargo build` reports a missing feature for a type the code uses, add that feature; do not switch to default features (compile time).
- [ ] `macos.rs` design: one dedicated `std::thread` ("ember-speech") owns every ObjC object (`Retained<T>` is not `Send`, so nothing crosses threads). `MacSpeech` (the `SpeechBackend`) holds a `Mutex<Option<mpsc::Sender<Cmd>>>` with `enum Cmd { Start { lang, app, reply: mpsc::Sender<Result<(), SpeechError>> }, Stop, Abort }`; the thread is spawned lazily on first start and loops forever. Callbacks (block2 `RcBlock`) capture only `AppHandle` (Send + Sync), an `Arc<EndOnce>`, and an `Arc<Mutex<String>>` for the last text. Start sequence, every step returning `Err` instead of panicking:
  1. Speech auth: `SFSpeechRecognizer::authorizationStatus()`; if `NotDetermined`, call `requestAuthorization` with a block that sends the status back over a channel and wait up to 60 s (user is looking at a dialog); `Denied`/`Restricted` gives `PermissionDenied`.
  2. Mic auth: `AVCaptureDevice::authorizationStatusForMediaType(AVMediaTypeAudio)`; `NotDetermined` prompts via `requestAccessForMediaType_completionHandler` the same way; denied gives `PermissionDenied`. (Without this step a denied mic makes the engine deliver silence and the user sees nothing.)
  3. Recognizer: `SFSpeechRecognizer::initWithLocale(NSLocale::localeWithLocaleIdentifier(lang))`; nil, then `SFSpeechRecognizer::new()` (current locale), then `en-US`; still nil or `!isAvailable()` gives `Unavailable`. `on_device = recognizer.supportsOnDeviceRecognition()`.
  4. Request: `SFSpeechAudioBufferRecognitionRequest::new()`, `setShouldReportPartialResults(true)`, `setRequiresOnDeviceRecognition(on_device)` (macOS 13+; prefer on-device when supported, otherwise Apple's server, which needs the network), `setTaskHint(Search)`.
  5. Engine: `AVAudioEngine::new()`, `inputNode()`, `format = input.outputFormatForBus(0)`; if `format.channelCount() == 0 || sampleRate() == 0.0` there is no usable input, give `Unavailable` ("no microphone"). Wrap `installTapOnBus_bufferSize_format_block(0, 1024, Some(&format), block)` where the block calls `request.appendAudioPCMBuffer(buffer)`, then `engine.prepare()` and `engine.startAndReturnError()`, all inside `objc2::exception::catch`; a caught exception or an error gives `Unavailable` with the description as detail.
  6. Task: `recognizer.recognitionTaskWithRequest_resultHandler(&request, block)`; the block reads `result.bestTranscription().formattedString()` and emits partial, or final when `result.isFinal()`, then `end` via `EndOnce`; an `NSError` maps through `map_error(domain, code)` (pure fn, tested): `NSURLErrorDomain` (any code) gives `Network`; `kAFAssistantErrorDomain` 1110 gives `NoSpeech`, 1101 gives `Unavailable`, 203 gives `Network`; `kLSRErrorDomain` (on-device) 301 gives `Unavailable`; a cancel after our own stop/abort (code 216 or 301 while `stopping`) gives `Aborted` (quiet); anything else `Unavailable` with `detail = "<domain> <code>: <localizedDescription>"`.
  7. Silence: run a watchdog in the thread loop (`recv_timeout(500 ms)`): if 2.5 s pass with no new partial after at least one partial, or 8 s with no partial at all, do a `Stop`. (Apple's request has no configurable silence timeout on macOS.)
  `Stop`: `engine.stop()`, `input.removeTapOnBus(0)`, `request.endAudio()`; the task then delivers the final result. `Abort`: `task.cancel()`, engine teardown, `emit_end` through `EndOnce`. Keep the current `task`, `request`, `engine` in the thread's local state and always tear down before the next start (a second start while listening is a Stop followed by a Start).
- [ ] `Info.plist` (new file in `apps/desktop/src-tauri`; Tauri merges it into the bundle's generated plist):

```xml
<key>NSMicrophoneUsageDescription</key><string>Ember listens to your voice for voice search.</string>
<key>NSSpeechRecognitionUsageDescription</key><string>Ember turns what you say into a search.</string>
```

- [ ] `entitlements.plist`: add `com.apple.security.device.audio-input` = true with a comment (hardened runtime blocks the mic without it).
- [ ] `tauri.conf.json` under `bundle.macOS`: `"signingIdentity": "-"`. Why: TCC only grants mic/speech to a validly signed bundle; the current local bundle has a linker-only signature on the Mach-O and none on the bundle ("code has no resources but signature indicates they must be present"), which already breaks NSOpenPanel. Ad-hoc signing the whole bundle fixes both. In CI and in `scripts/build-mac.sh`, the `APPLE_SIGNING_IDENTITY` env var (real Developer ID) still takes precedence when set; confirm in the build output ("Signing with identity ...") and record the answer in `apps/desktop/README.md`. If it turns out the env var does NOT override the config value, make `scripts/set-url.mjs` write `signingIdentity` from `APPLE_SIGNING_IDENTITY` (fallback `-`) and note that in the README.
- [ ] Tests in `macos.rs` (`#[cfg(test)]`, pure only): `map_error` rows; the silence watchdog decision as a pure fn `fn should_stop(now, last_partial: Option<Instant>, started: Instant) -> bool`. Everything ObjC stays untested at unit level (owner's device check below).
- [ ] Run: `cd apps/desktop/src-tauri && cargo test --lib speech && cargo build` (debug, macOS). Then the release bundle for the signature check: `cd apps/desktop && npm run build:mac:local` (release + LTO; only if disk allows, otherwise the owner does it) and `codesign --verify --deep --strict --verbose=2 src-tauri/target/release/bundle/macos/Ember.app` must print `valid on disk` and `satisfies its Designated Requirement`; `codesign -d --entitlements - Ember.app` must show `audio-input`; `plutil -p Ember.app/Contents/Info.plist | grep Usage` must show both strings.
- [ ] Commit: `feat(desktop): macOS voice search with SFSpeechRecognizer, mic entitlement, ad-hoc bundle signing`.

## Task 7: Windows backend (Windows.Media.SpeechRecognition)

**Files:**
- Create: `apps/desktop/src-tauri/src/speech/windows.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`

**Steps:**

- [ ] `Cargo.toml`, under `[target.'cfg(windows)'.dependencies]`: `windows = { version = "0.62", features = ["Foundation", "Foundation_Collections", "Globalization", "Media_SpeechRecognition"] }` (0.62.2 is already in `Cargo.lock`; the feature names are confirmed in that crate's manifest). No appx manifest exists (desktop app), so there is no `microphone` capability to declare; the OS toggle "Let desktop apps access your microphone" governs access and shows up as an error mapped below.
- [ ] `windows.rs` design: WinRT objects here are agile, but keep the same shape as macOS for symmetry: a worker thread owning the `SpeechRecognizer`, driven by `Cmd`s. Start:
  1. Locale: build `Language::CreateLanguage(&HSTRING::from(lang))`; if `SpeechRecognizer::SupportedTopicLanguages()` contains its tag use `SpeechRecognizer::Create(&language)`, else `SpeechRecognizer::new()` (system speech language). Log which.
  2. `recognizer.Timeouts()?.SetInitialSilenceTimeout(8 s)`, `SetEndSilenceTimeout(2.5 s)`; `recognizer.ContinuousRecognitionSession()?.SetAutoStopSilenceTimeout(2.5 s)`.
  3. `CompileConstraintsAsync()?.get()?` (dictation grammar, no constraints added); `Status()` other than `Success` gives `Unavailable` with the status as detail.
  4. Events: `recognizer.HypothesisGenerated(&TypedEventHandler::new(|_, args| { args.Hypothesis()?.Text() }))` emits partial; `session.ResultGenerated` emits final with `args.Result()?.Text()` (only when `Confidence` is not `Rejected`, else `NoSpeech`); `session.Completed` maps `args.Status()`: `Success` and `TimeoutExceeded` after a final are plain end; `TimeoutExceeded` with no text gives `NoSpeech`; `NetworkFailure` gives `Network`; `MicrophoneUnavailable` gives `PermissionDenied`; `UserCanceled` gives `Aborted`; `Unknown`/`PauseLimitExceeded`/`AudioQualityFailure`/`TopicLanguageNotSupported`/`GrammarLanguageMismatch`/`GrammarCompilationFailure` give `Unavailable` with the status name. Then `emit_end` through `EndOnce`. Keep the event tokens so they can be removed on teardown.
  5. `session.StartAsync()?.get()`: map the HRESULT of a failure with the pure fn `map_hresult(hr: i32) -> SpeechErrorKind`: `0x80045509` (`SPERR_SPEECH_PRIVACY_POLICY_NOT_ACCEPTED`, the "Online speech recognition" privacy toggle is off, which the dictation grammar requires) gives `SpeechSettingOff`; `0x80070005` (`E_ACCESSDENIED`, microphone privacy toggle) gives `PermissionDenied`; `0x800455A0`-range and anything else give `Unavailable` with `format!("hresult {hr:#x}")`. This is also what `available()` reports: it tries `SpeechRecognizer::new()` + `CompileConstraintsAsync` once at startup and caches `available`; `on_device` is always `false` on Windows (dictation is a cloud grammar).
  `Stop`: `session.StopAsync()`; `Abort`: `session.CancelAsync()`, then `emit_end` through `EndOnce`.
- [ ] Every WinRT call is `?` into `SpeechError::from(windows::core::Error)` (pure `From` impl: `Unavailable` with the message, except the two HRESULTs above). No `unwrap`.
- [ ] Tests (`#[cfg(test)]`, pure): `map_hresult` rows; `Completed` status mapping as a pure fn over a plain enum copy of the statuses; `From<windows::core::Error>` shape. Note `cargo test` on the Mac cannot run these (they are `cfg(windows)`); they run in CI's Windows job (Task 8 adds `cargo test`).
- [ ] Run: `cd apps/desktop/src-tauri && cargo check --target x86_64-pc-windows-msvc`. If it fails inside `tauri-build`'s Windows resource step (host tooling, not our code), note it and rely on Task 8. Commit: `feat(desktop): Windows voice search over Windows.Media.SpeechRecognition`.

## Task 8: CI gate for Windows (temporary branch trigger)

**Files:**
- Modify: `.github/workflows/native-build.yml`

**Steps:**

- [ ] Add `voice-search` to `on.push.branches` next to `feat/windows-desktop` with a comment "temporary: remove before merging to main". The matrix on a branch push already builds `windows-latest` and `ubuntu-latest` (Linux proves the `unsupported` module), so this is one line.
- [ ] Add a step before the Tauri build on `windows-latest` only: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib speech` (runs the `cfg(windows)` pure tests).
- [ ] In the existing "Smoke-test the Windows build" step, print (do not fail on) the `speech:` line from the log, and fail if the line is missing entirely (proves the backend initialised without crashing on a runner with no mic and the privacy toggle off; the expected value there is `available=false`).
- [ ] The owner pushes the branch (this plan never pushes). Commit: `ci(native): build voice-search pushes, run speech tests, report speech status on Windows`.

## Task 9: Changelog and docs

**Files:**
- Modify: `apps/web/lib/changelog.ts`, `apps/web/package.json`, `apps/desktop/README.md`, `apps/mobile/README.md`, `APPS.md`

**Steps:**

- [ ] `changelog.ts`: new first entry `{ id: 'native-voice-search', version: '0.4.1', date: <commit date>, title: 'Voice search in the apps', summary: 'The mic in the search box now works in the Android app and on the desktop, using your device\'s own speech recognition.', bullets: [ 'Tap the mic and speak; the words fill the search box as you say them, and the search runs when you stop.', 'Android uses the phone\'s own recognizer, macOS uses Apple\'s (on the device where it can), Windows uses Microsoft\'s and needs the Online speech recognition setting turned on.', 'The first use asks for microphone access. Older app builds show a note to update.' ] }`. Bump `apps/web/package.json` version to `0.4.1` so `changelog.test.ts` ("newest entry version equals apps/web/package.json") stays green. See Decision 1 below.
- [ ] `apps/desktop/README.md`: a "Voice search" section: which recognizer per OS, the Info.plist strings, the audio-input entitlement, `signingIdentity "-"` and why (TCC + the NSOpenPanel crash), how to verify (`codesign --verify --deep --strict`), the Windows privacy setting. `apps/mobile/README.md`: RECORD_AUDIO, the `<queries>` entry, EmberSpeech plugin surface. `APPS.md`: one line under native extras.
- [ ] Run `cd apps/web && npx vitest run lib/changelog.test.ts` and `npx tsc --noEmit -p .`. Commit: `docs(voice): changelog 0.4.1 and native voice search notes`.

---

## Owner's device checks (after the branch is built)

Android (needs a new APK from CI or `./gradlew assembleDebug` when disk allows; install over the old one):
1. Open Search, tap the mic. Expect the system "Allow Ember to record audio?" dialog. Deny once: toast "Allow microphone access to use voice search."
2. Tap again, allow. Say "daft punk around the world". Expect the words to appear in the box while speaking and results to load after you stop.
3. Tap the mic and stay silent about 5 s. Expect the pulse to stop with no toast.
4. Airplane mode, tap the mic, speak. Expect either results (on-device model present) or "Voice search needs an internet connection right now."
5. Old web build check is automatic; old APK check: open the host with the previous APK, tap the mic, expect "Update the Ember app to use voice search."

macOS (build with `npm run build:mac` in `apps/desktop`, run the `.app` from `src-tauri/target/release/bundle/macos`):
1. First mic tap: two system prompts, Speech Recognition then Microphone. Allow both. Speak; words appear; search runs.
2. System Settings, Privacy & Security, Microphone: turn Ember off; tap the mic: toast "Allow microphone access...". Turn it back on.
3. Cmd+O style check that NSOpenPanel no longer crashes the app (bug report screenshot picker), which confirms the bundle signature.
4. Run `codesign --verify --deep --strict --verbose=2 Ember.app` and paste the output into the PR.

Windows (installer from the CI artifact `ember-desktop-windows-latest`):
1. Settings, Privacy & security, Speech: Online speech recognition OFF. Tap the mic: toast "Turn on Online speech recognition in Windows Settings...". Turn it on.
2. Settings, Privacy & security, Microphone: "Let desktop apps access your microphone" ON. Tap the mic, speak; words appear; search runs.
3. Stay silent about 8 s: pulse stops, no toast.

Web (Chrome on the sandbox :3050): behaviour identical to before the branch (same prompts, same "try Chrome" toast in Firefox).

## Decisions for the owner (with recommendation)

1. **Version bump for the changelog entry.** The newest entry today is 0.4.0 (dated 2026-09-20) and `changelog.test.ts` pins it to `apps/web/package.json`. Recommended: new entry at **0.4.1** and bump `apps/web/package.json` to 0.4.1 (shell versions in `tauri.conf.json`, `Cargo.toml`, `build.gradle` get set to 0.4.1 only when the shells are tagged, per `docs/changelog-system.md`). Alternative: append bullets to the 0.4.0 entry if 0.4.0 has not reached users yet.
2. **Ad-hoc signing in config (`signingIdentity: "-"`).** Recommended yes: it is required for TCC and fixes the NSOpenPanel crash; a real Developer ID via `APPLE_SIGNING_IDENTITY` still wins in CI and in `build-mac.sh`. Ad-hoc bundles still need the Gatekeeper right-click Open on other Macs, same as today.
3. **Android on-device recognizer.** Recommended: let `createSpeechRecognizer` choose (Google routes on-device where it can). Forcing `createOnDeviceSpeechRecognizer` fails for most locales and gives worse text. Report `onDevice` in `available()` only for diagnostics.
4. **macOS on-device forcing.** Recommended: `requiresOnDeviceRecognition = supportsOnDeviceRecognition` (on-device when Apple has the model, server otherwise). Forcing on-device everywhere would make the mic dead on Macs without the language model.
5. **CI branch trigger.** Adding `voice-search` to the workflow's push branches costs billed Windows + Linux minutes per push; the only way to compile the Windows backend for real. Remove the line before merging.
6. **Sonnet or Opus.** Tasks 1, 2, 4, 5, 8, 9 are sonnet-worker sized. Task 3 (Android) and especially Tasks 6 and 7 (ObjC/WinRT FFI under `panic = "abort"`) should go to opus-worker with the worktree absolute path (per the Ember routing note).
