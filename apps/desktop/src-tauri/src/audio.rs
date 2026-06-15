// Ember desktop — native audio engine (Part 5).
//
// Streams a remote m4a/AAC URL (the host's /api/youtube/stream/<id>) via
// `stream-download` (seekable, temp-file-backed HTTP reader) -> `rodio::Decoder`
// (symphonia isomp4/aac) -> `rodio::Sink`, behind a small set of Tauri commands.
// A ~250ms polling task emits position + end-of-track events back to the webview.
//
// Crate API notes (verified against current docs):
//   * rodio 0.21: `OutputStreamBuilder::open_default_stream()` returns an
//     `OutputStream` that must be kept alive; `.mixer()` -> `&Mixer`;
//     `Sink::connect_new(mixer)` builds a Sink. Sink keeps `append/play/pause/
//     stop/set_volume/get_pos/try_seek/empty`. (0.22 renamed Sink->Player.)
//   * stream-download 0.24: `StreamDownload::new_http(url, storage, settings)` is
//     async and yields a blocking `Read + Seek` reader.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use rodio::mixer::Mixer;
use rodio::{OutputStreamBuilder, Sink};
use serde::Serialize;
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, PlatformConfig};
use stream_download::storage::temp::TempStorageProvider;
use stream_download::{Settings, StreamDownload};
use tauri::{AppHandle, State};

/// Native audio engine state, stored in Tauri managed state.
///
/// `rodio::OutputStream` (cpal `Stream`) is `!Send + !Sync`, so it cannot live in
/// Tauri's managed state directly. Instead we keep it alive on a dedicated parked
/// thread and store a cloned `Mixer` (which IS `Send + Sync + Clone`) here. New
/// `Sink`s are built from that mixer on demand.
pub struct AudioEngine {
    /// Output mixer cloned off the (thread-pinned) OutputStream. Used to build sinks.
    mixer: Mixer,
    /// Current playback sink. `Arc<Mutex<..>>` so the position-polling task can
    /// share access. `None` when nothing is loaded.
    sink: Arc<Mutex<Option<Sink>>>,
    /// Monotonic load counter. Each `audio_load` bumps it; the position timer
    /// captures its value and exits once a newer load supersedes it.
    generation: Arc<AtomicU64>,
    /// Last loaded absolute stream URL (for diagnostics / future recovery).
    current_url: Mutex<Option<String>>,
    /// OS media controls (macOS Now Playing / Windows SMTC / Linux MPRIS).
    /// `None` if init failed — playback still works without OS controls.
    /// On macOS `MediaControls` is a zero-sized unit struct (state lives in
    /// global MPNowPlayingInfoCenter/MPRemoteCommandCenter), so it is Send+Sync.
    controls: Mutex<Option<MediaControls>>,
}

impl AudioEngine {
    pub fn new() -> Result<Self, String> {
        // Open the output stream on a dedicated thread and keep it alive there
        // forever (the cpal Stream is !Send, so it must not cross threads). The
        // thread hands back a cloned Mixer, then parks holding the stream.
        let (tx, rx) = mpsc::channel::<Result<Mixer, String>>();
        std::thread::Builder::new()
            .name("ember-audio-output".into())
            .spawn(move || match OutputStreamBuilder::open_default_stream() {
                Ok(stream) => {
                    let _ = tx.send(Ok(stream.mixer().clone()));
                    // Keep `stream` alive for the lifetime of the process.
                    // Use a loop to guard against spurious wakeups from park().
                    loop {
                        std::thread::park();
                    }
                    #[allow(unreachable_code)]
                    drop(stream);
                }
                Err(e) => {
                    let _ = tx.send(Err(e.to_string()));
                }
            })
            .map_err(|e| e.to_string())?;

        let mixer = rx
            .recv()
            .map_err(|_| "audio output thread exited".to_string())??;

        Ok(Self {
            mixer,
            sink: Arc::new(Mutex::new(None)),
            generation: Arc::new(AtomicU64::new(0)),
            current_url: Mutex::new(None),
            controls: Mutex::new(None),
        })
    }

    /// Reflect play/paused state in the OS Now Playing widget. No-op if media
    /// controls failed to initialize.
    fn set_nowplaying(&self, playing: bool) {
        if let Ok(mut g) = self.controls.lock() {
            if let Some(c) = g.as_mut() {
                let pb = if playing {
                    MediaPlayback::Playing { progress: None }
                } else {
                    MediaPlayback::Paused { progress: None }
                };
                let _ = c.set_playback(pb);
            }
        }
    }

    /// Build a fresh Sink connected to this engine's output mixer.
    fn new_sink(&self) -> Sink {
        Sink::connect_new(&self.mixer)
    }

    /// Shared handles for the position-polling task.
    fn inner_arc(&self) -> (Arc<Mutex<Option<Sink>>>, Arc<AtomicU64>) {
        (Arc::clone(&self.sink), Arc::clone(&self.generation))
    }
}

// --- Event payloads ---------------------------------------------------------

#[derive(Clone, Serialize)]
struct SecPayload {
    sec: f64,
}
#[derive(Clone, Serialize)]
struct ErrPayload {
    message: String,
}
/// An OS media-button press forwarded to the webview. `kind` is one of
/// play/pause/toggle/next/prev/seek; `sec` is set only for seek.
#[derive(Clone, Serialize)]
struct CmdPayload {
    kind: &'static str,
    sec: Option<f64>,
}

fn emit_sec(app: &AppHandle, event: &str, sec: f64) {
    use tauri::Emitter;
    let _ = app.emit(event, SecPayload { sec });
}
fn emit_bare(app: &AppHandle, event: &str) {
    use tauri::Emitter;
    let _ = app.emit(event, ());
}
fn emit_err(app: &AppHandle, message: String) {
    use tauri::Emitter;
    let _ = app.emit("audio:error", ErrPayload { message });
}

// --- Commands ---------------------------------------------------------------

#[tauri::command]
pub async fn audio_load(
    app: AppHandle,
    engine: State<'_, AudioEngine>,
    url: String,
    autoplay: bool,
    start_at: f64,
) -> Result<(), String> {
    // Build a seekable, buffered HTTP source backed by a temp file so seeks work.
    let reader = match StreamDownload::new_http(
        url.parse().map_err(|_| "bad url".to_string())?,
        TempStorageProvider::default(),
        Settings::default(),
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            let msg = e.to_string();
            emit_err(&app, msg.clone());
            return Err(msg);
        }
    };

    // Fix 3: run blocking decoder I/O off the async runtime.
    let decoder = match tauri::async_runtime::spawn_blocking(move || rodio::Decoder::new(reader))
        .await
    {
        Ok(Ok(d)) => d,
        Ok(Err(e)) => {
            let msg = e.to_string();
            emit_err(&app, msg.clone());
            return Err(msg);
        }
        Err(e) => {
            let msg = e.to_string();
            emit_err(&app, msg.clone());
            return Err(msg);
        }
    };
    let total = {
        use rodio::Source;
        decoder.total_duration()
    };

    // Fix 1: bump the generation BEFORE storing the new sink so that the
    // previous position-timer can never observe the new sink under the old
    // generation number.
    let my_gen = engine.generation.fetch_add(1, Ordering::SeqCst) + 1;

    let sink = engine.new_sink();
    sink.append(decoder);
    if start_at > 1.0 {
        let _ = sink.try_seek(Duration::from_secs_f64(start_at));
    }
    if autoplay {
        sink.play();
    } else {
        sink.pause();
    }

    *engine.sink.lock().map_err(|_| "lock")? = Some(sink);
    *engine.current_url.lock().map_err(|_| "lock")? = Some(url);

    if let Some(d) = total {
        emit_sec(&app, "audio:duration", d.as_secs_f64());
    }
    if autoplay {
        emit_bare(&app, "audio:play");
    }
    engine.set_nowplaying(autoplay);

    let (sink_arc, generation) = engine.inner_arc();
    spawn_position_timer(app, sink_arc, generation, my_gen);
    Ok(())
}

#[tauri::command]
pub fn audio_play(app: AppHandle, engine: State<'_, AudioEngine>) {
    let mut acted = false;
    if let Ok(g) = engine.sink.lock() {
        if let Some(s) = g.as_ref() {
            s.play();
            emit_bare(&app, "audio:play");
            acted = true;
        }
    }
    // Only reflect "Playing" in the OS widget when a track actually resumed, and
    // outside the sink lock (set_nowplaying takes the controls lock).
    if acted {
        engine.set_nowplaying(true);
    }
}

#[tauri::command]
pub fn audio_pause(app: AppHandle, engine: State<'_, AudioEngine>) {
    let mut acted = false;
    if let Ok(g) = engine.sink.lock() {
        if let Some(s) = g.as_ref() {
            s.pause();
            emit_bare(&app, "audio:pause");
            acted = true;
        }
    }
    if acted {
        engine.set_nowplaying(false);
    }
}

#[tauri::command]
pub fn audio_stop(engine: State<'_, AudioEngine>) {
    // Bumping the generation also stops the active position timer.
    engine.generation.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut guard) = engine.sink.lock() {
        if let Some(sink) = guard.take() {
            sink.stop();
        }
    }
    if let Ok(mut u) = engine.current_url.lock() {
        *u = None;
    }
}

#[tauri::command]
pub fn audio_seek(app: AppHandle, engine: State<'_, AudioEngine>, sec: f64) {
    if let Ok(g) = engine.sink.lock() {
        if let Some(s) = g.as_ref() {
            let _ = s.try_seek(Duration::from_secs_f64(sec.max(0.0)));
            emit_sec(&app, "audio:time", sec.max(0.0)); // optimistic
        }
    }
}

#[tauri::command]
pub fn audio_set_volume(engine: State<'_, AudioEngine>, amplitude: f32) {
    if let Ok(g) = engine.sink.lock() {
        if let Some(s) = g.as_ref() {
            // rodio amplifies for values > 1.0, preserving party mode.
            s.set_volume(amplitude.max(0.0));
        }
    }
}

// --- OS media controls (souvlaki) -------------------------------------------

/// Initialize OS media controls and route their transport-button presses to the
/// webview as `audio:cmd` events. Call ONCE at app setup (main thread). On
/// Windows, SMTC needs the window HWND (not wired this slice), so init will fail
/// there — the caller logs it and degrades gracefully (playback unaffected).
pub fn init_media_controls(app: &AppHandle, engine: &AudioEngine) -> Result<(), String> {
    // Windows SMTC requires the window HWND; souvlaki's Windows backend PANICS on
    // a None hwnd (it `.expect()`s) rather than returning Err, which the non-fatal
    // caller couldn't catch. Until the HWND is wired, bail out with an Err here so
    // startup degrades gracefully (logged) instead of crashing.
    #[cfg(windows)]
    {
        let _ = (app, engine);
        return Err("Windows SMTC not wired yet (needs window HWND)".to_string());
    }
    #[cfg(not(windows))]
    {
    let config = PlatformConfig {
        display_name: "Ember",
        dbus_name: "ember",
        hwnd: None, // macOS/Linux: None.
    };
    let mut controls = MediaControls::new(config).map_err(|e| format!("{e:?}"))?;
    let app2 = app.clone();
    controls
        .attach(move |event: MediaControlEvent| {
            use tauri::Emitter;
            // The souvlaki callback runs on its own thread — only emit to the
            // webview here (never touch the sink lock). Toggle is resolved in
            // the webview from its own play/paused mirror.
            let payload = match event {
                MediaControlEvent::Play => CmdPayload { kind: "play", sec: None },
                MediaControlEvent::Pause => CmdPayload { kind: "pause", sec: None },
                MediaControlEvent::Toggle => CmdPayload { kind: "toggle", sec: None },
                MediaControlEvent::Next => CmdPayload { kind: "next", sec: None },
                MediaControlEvent::Previous => CmdPayload { kind: "prev", sec: None },
                MediaControlEvent::SetPosition(pos) => {
                    CmdPayload { kind: "seek", sec: Some(pos.0.as_secs_f64()) }
                }
                // Stop / Seek / SeekBy / SetVolume / OpenUri / Raise: ignored.
                _ => return,
            };
            let _ = app2.emit("audio:cmd", payload);
        })
        .map_err(|e| format!("{e:?}"))?;
    *engine
        .controls
        .lock()
        .map_err(|_| "controls lock".to_string())? = Some(controls);
    Ok(())
    }
}

#[tauri::command]
pub fn audio_set_metadata(
    engine: State<'_, AudioEngine>,
    title: String,
    artist: String,
    album: String,
    artwork_url: String,
) {
    if let Ok(mut g) = engine.controls.lock() {
        if let Some(c) = g.as_mut() {
            // MediaMetadata borrows &str; the local Strings outlive this call.
            let _ = c.set_metadata(MediaMetadata {
                title: Some(&title),
                artist: Some(&artist),
                album: Some(&album),
                cover_url: if artwork_url.is_empty() { None } else { Some(&artwork_url) },
                ..Default::default()
            });
        }
    }
}

// --- Position timer + end detection -----------------------------------------

fn spawn_position_timer(
    app: AppHandle,
    sink: Arc<Mutex<Option<Sink>>>,
    generation: Arc<AtomicU64>,
    my_gen: u64,
) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(250));
        loop {
            interval.tick().await;
            if generation.load(Ordering::SeqCst) != my_gen {
                break; // superseded by a newer load / stop
            }
            let (pos, empty) = {
                let g = match sink.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                match g.as_ref() {
                    Some(s) => (s.get_pos().as_secs_f64(), s.empty()),
                    None => break,
                }
            };
            emit_sec(&app, "audio:time", pos);
            if empty {
                emit_bare(&app, "audio:ended");
                break;
            }
        }
    });
}
