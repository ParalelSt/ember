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
use stream_download::http::reqwest::header::{HeaderMap, HeaderValue, COOKIE};
use stream_download::http::reqwest::Client;
use stream_download::http::HttpStream;
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
    /// Output mixer cloned off the (thread-pinned) OutputStream. Used to build
    /// sinks. `None` when no output device could be opened — the app still
    /// starts (see `new_degraded`) and the webview falls back to web audio.
    mixer: Option<Mixer>,
    /// Current playback sink. `Arc<Mutex<..>>` so the position-polling task can
    /// share access. `None` when nothing is loaded.
    sink: Arc<Mutex<Option<Sink>>>,
    /// Monotonic load counter. Each `audio_load` bumps it; the position timer
    /// captures its value and exits once a newer load supersedes it.
    generation: Arc<AtomicU64>,
    /// Claimed at the START of every load, unlike `generation` which is taken
    /// after the download+decode. Without it, the load that FINISHES last wins:
    /// a slow startup load (hydrating the persisted track with autoplay=false)
    /// could land after the user clicked play and replace a playing sink with a
    /// paused one. That is the "had to click play several times" bug.
    load_seq: Arc<AtomicU64>,
    /// Last loaded absolute stream URL (for diagnostics / future recovery).
    current_url: Mutex<Option<String>>,
    /// Last volume the UI asked for. rodio applies volume PER SINK and every
    /// load builds a new one, so without remembering it here each track would
    /// start at rodio's default of 1.0 — i.e. the user sets 20%, the next song
    /// blasts at full. Applied in `new_sink`.
    volume: Mutex<f32>,
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
            mixer: Some(mixer),
            sink: Arc::new(Mutex::new(None)),
            generation: Arc::new(AtomicU64::new(0)),
            load_seq: Arc::new(AtomicU64::new(0)),
            current_url: Mutex::new(None),
            volume: Mutex::new(1.0),
            controls: Mutex::new(None),
        })
    }

    /// An engine with no output device. Every playback command fails cleanly
    /// instead of the whole app dying at launch.
    ///
    /// This is not hypothetical: a machine with no sound card, audio disabled,
    /// or (as CI proved) a headless Windows runner would abort the process
    /// before it drew a window — `panic = abort` turns the `.expect()` into
    /// exit code 0xC0000409 with nothing logged. A music app with no audio
    /// device should say so, not vanish.
    pub fn new_degraded() -> Self {
        Self {
            mixer: None,
            sink: Arc::new(Mutex::new(None)),
            generation: Arc::new(AtomicU64::new(0)),
            load_seq: Arc::new(AtomicU64::new(0)),
            current_url: Mutex::new(None),
            volume: Mutex::new(1.0),
            controls: Mutex::new(None),
        }
    }

    /// Whether a real output device is attached.
    pub fn has_output(&self) -> bool {
        self.mixer.is_some()
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

    /// Build a fresh Sink connected to this engine's output mixer, or Err when
    /// the machine has no audio output.
    fn new_sink(&self) -> Result<Sink, String> {
        let mixer = self
            .mixer
            .as_ref()
            .ok_or_else(|| "no audio output device on this machine".to_string())?;
        let sink = Sink::connect_new(mixer);
        // Carry the user's volume across the track change.
        sink.set_volume(self.volume());
        Ok(sink)
    }

    /// The volume every new sink starts at.
    pub fn volume(&self) -> f32 {
        self.volume.lock().map(|v| *v).unwrap_or(1.0)
    }

    /// Remember the UI's volume and apply it to whatever is playing now.
    pub fn set_volume(&self, amplitude: f32) {
        let clamped = amplitude.max(0.0);
        if let Ok(mut v) = self.volume.lock() {
            *v = clamped;
        }
        if let Ok(g) = self.sink.lock() {
            if let Some(s) = g.as_ref() {
                s.set_volume(clamped);
            }
        }
    }

    /// Take a ticket for a load that is about to start.
    pub fn claim_load(&self) -> u64 {
        self.load_seq.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Cut the sound of whatever is playing right now. A new load takes a
    /// second or two to connect, buffer and decode, and until this the old
    /// track kept playing over that gap — pressing skip left the previous
    /// song audible after the UI had already moved on.
    pub fn silence_current(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut guard) = self.sink.lock() {
            if let Some(sink) = guard.take() {
                sink.stop();
            }
        }
        if let Ok(mut u) = self.current_url.lock() {
            *u = None;
        }
    }

    /// Whether this load is still the newest one. A load that lost the race
    /// must throw its work away rather than install a stale sink.
    pub fn is_current_load(&self, seq: u64) -> bool {
        self.load_seq.load(Ordering::SeqCst) == seq
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
/// Write a line into the app log from the audio engine.
///
/// Playback faults here are intermittent and timing-dependent — the kind that
/// never reproduce while you're watching. Recording each load's sequence
/// number, start offset and outcome means the next bug report explains itself
/// instead of needing a re-run.
fn log_audio(app: &AppHandle, level: &str, msg: &str) {
    use tauri::Manager;
    if let Some(state) = app.try_state::<crate::applog::LogFile>() {
        if let Ok(path) = state.0.lock() {
            crate::applog::write_line(path.as_ref(), level, &format!("audio: {msg}"));
        }
    }
}

fn emit_err(app: &AppHandle, message: String) {
    use tauri::Emitter;
    let _ = app.emit("audio:error", ErrPayload { message });
}

// --- Commands ---------------------------------------------------------------

/// Builds the HTTP client used to pull audio.
///
/// `cookie` carries the webview's `pb_auth` session. Without it only PUBLIC
/// routes work: `/api/youtube/stream/...` is public, but member uploads
/// (`/api/uploads/<id>/stream`) require a session, so an uploaded song would
/// fail here while playing fine in any browser. Sending the session makes the
/// native engine as capable as the webview without opening uploads to the
/// whole internet.
fn http_client(cookie: Option<&str>) -> Result<Client, String> {
    let mut builder = Client::builder();
    if let Some(cookie) = cookie.filter(|c| !c.is_empty()) {
        let mut headers = HeaderMap::new();
        let value = HeaderValue::from_str(cookie).map_err(|_| "invalid cookie header".to_string())?;
        headers.insert(COOKIE, value);
        builder = builder.default_headers(headers);
    }
    builder.build().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn audio_load(
    app: AppHandle,
    engine: State<'_, AudioEngine>,
    url: String,
    autoplay: bool,
    start_at: f64,
    cookie: Option<String>,
) -> Result<(), String> {
    // Claim the load BEFORE any slow work, so a newer request can supersede
    // this one even if this one finishes later.
    let my_seq = engine.claim_load();
    engine.silence_current();
    log_audio(
        &app,
        "INFO",
        &format!("load #{my_seq} start_at={start_at:.1} autoplay={autoplay} url={url}"),
    );

    // Whole-load budget. Nothing downstream imposes one: on a bad connection
    // (or when the host stalls mid-response) HttpStream::new and the decoder
    // simply wait forever. The user sees a track that never starts, with no
    // error and no fallback — the position watchdog can't help because no sink
    // exists yet. Giving up lets the webview fall back to web audio, which
    // buffers progressively and copes better with a weak link.
    const LOAD_BUDGET: Duration = Duration::from_secs(25);
    let deadline = std::time::Instant::now() + LOAD_BUDGET;
    let remaining = || deadline.saturating_duration_since(std::time::Instant::now());
    let give_up = |app: &AppHandle, stage: &str| -> String {
        let msg = format!("timed out {stage} after {}s", LOAD_BUDGET.as_secs());
        log_audio(app, "WARN", &format!("load #{my_seq} {msg}"));
        emit_err(app, msg.clone());
        msg
    };

    // Build a seekable, buffered HTTP source backed by a temp file so seeks work.
    let parsed = url.parse().map_err(|_| "bad url".to_string())?;
    let client = http_client(cookie.as_deref())?;
    let stream = match tokio::time::timeout(remaining(), HttpStream::new(client, parsed)).await {
        Err(_) => return Err(give_up(&app, "connecting to the stream")),
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            let msg = e.to_string();
            emit_err(&app, msg.clone());
            return Err(msg);
        }
    };
    let reader = match tokio::time::timeout(
        remaining(),
        StreamDownload::from_stream(stream, TempStorageProvider::default(), Settings::default()),
    )
    .await
    {
        Err(_) => return Err(give_up(&app, "buffering the stream")),
        Ok(Ok(r)) => r,
        Ok(Err(e)) => {
            let msg = e.to_string();
            emit_err(&app, msg.clone());
            return Err(msg);
        }
    };

    // Fix 3: run blocking decoder I/O off the async runtime.
    let decoder = match tokio::time::timeout(
        remaining(),
        tauri::async_runtime::spawn_blocking(move || rodio::Decoder::new(reader)),
    )
    .await
    {
        // Say "timed out", not "unrecognized format" — a misleading error here
        // sends whoever reads the log hunting for a codec problem.
        Err(_) => return Err(give_up(&app, "decoding the track")),
        Ok(Ok(Ok(d))) => d,
        Ok(Ok(Err(e))) => {
            let msg = e.to_string();
            emit_err(&app, msg.clone());
            return Err(msg);
        }
        Ok(Err(e)) => {
            let msg = e.to_string();
            emit_err(&app, msg.clone());
            return Err(msg);
        }
    };

    let total = {
        use rodio::Source;
        decoder.total_duration()
    };

    // Someone asked for a different track while this one was downloading —
    // discard it silently rather than yanking playback back.
    if !engine.is_current_load(my_seq) {
        log_audio(&app, "INFO", &format!("load #{my_seq} superseded — discarded"));
        return Ok(());
    }

    // Fix 1: bump the generation BEFORE storing the new sink so that the
    // previous position-timer can never observe the new sink under the old
    // generation number.
    let my_gen = engine.generation.fetch_add(1, Ordering::SeqCst) + 1;

    let sink = engine.new_sink()?;
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

    log_audio(
        &app,
        "INFO",
        &format!(
            "load #{my_seq} playing (duration={:.0}s volume={:.2})",
            total.map(|d| d.as_secs_f64()).unwrap_or(0.0),
            engine.volume()
        ),
    );
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
    // Stored as well as applied: rodio volume lives on the SINK, and the next
    // track gets a brand new one. rodio amplifies above 1.0, preserving party
    // mode.
    engine.set_volume(amplitude);
}

// --- OS media controls (souvlaki) -------------------------------------------

/// Initialize OS media controls and route their transport-button presses to the
/// webview as `audio:cmd` events. Call ONCE at app setup (main thread).
///
/// macOS uses Now Playing, Linux MPRIS, Windows SMTC. Windows is the awkward
/// one: SMTC is attached to a window, so souvlaki needs the HWND — and its
/// Windows backend `.expect()`s on a None hwnd, i.e. it PANICS rather than
/// returning Err. So the handle is resolved up front and a missing one becomes
/// an ordinary Err, which the caller logs while playback carries on.
pub fn init_media_controls(app: &AppHandle, engine: &AudioEngine) -> Result<(), String> {
    #[cfg(windows)]
    let hwnd = {
        use tauri::Manager;
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "no main window for SMTC".to_string())?;
        let handle = window
            .hwnd()
            .map_err(|e| format!("could not get HWND for SMTC: {e}"))?;
        Some(handle.0 as *mut std::ffi::c_void)
    };
    #[cfg(not(windows))]
    let hwnd = None;

    {
    let config = PlatformConfig {
        display_name: "Ember",
        dbus_name: "ember",
        hwnd,
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
        // Stall watchdog. A sink can be un-paused and non-empty yet produce no
        // sound: the source is a blocking HTTP read, and if it starves, cpal
        // gets no samples and get_pos() freezes. It looks to the user like the
        // song simply won't play, with no error anywhere. Rather than sit
        // there, report it so the webview can fall back to web audio.
        const STALL_TICKS: u32 = 24; // 24 × 250ms = 6s of no progress
        let mut last_pos = f64::NAN;
        let mut stalled_for: u32 = 0;

        loop {
            interval.tick().await;
            if generation.load(Ordering::SeqCst) != my_gen {
                break; // superseded by a newer load / stop
            }
            let (pos, empty, paused) = {
                let g = match sink.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                match g.as_ref() {
                    Some(s) => (s.get_pos().as_secs_f64(), s.empty(), s.is_paused()),
                    None => break,
                }
            };
            emit_sec(&app, "audio:time", pos);
            if empty {
                emit_bare(&app, "audio:ended");
                break;
            }

            if paused {
                stalled_for = 0; // paused on purpose is not a stall
            } else if pos == last_pos {
                stalled_for += 1;
                if stalled_for >= STALL_TICKS {
                    log_audio(
                        &app,
                        "WARN",
                        &format!("playback stalled at {pos:.1}s — source starved, giving up"),
                    );
                    emit_err(&app, format!("playback stalled at {pos:.1}s"));
                    break;
                }
            } else {
                stalled_for = 0;
            }
            last_pos = pos;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    /// Serves one request and reports back which headers it saw.
    fn spy_server() -> (String, mpsc::Receiver<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            if let Ok((stream, _)) = listener.accept() {
                let mut reader = BufReader::new(stream.try_clone().expect("clone"));
                let mut headers = Vec::new();
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        break;
                    }
                    if line.trim().is_empty() {
                        break;
                    }
                    headers.push(line.trim().to_string());
                }
                let _ = tx.send(headers);
                let mut out = stream;
                let body = b"RIFF----WAVEfmt ";
                let _ = write!(
                    out,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: audio/wav\r\n\r\n",
                    body.len()
                );
                let _ = out.write_all(body);
                let _ = out.flush();
            }
        });
        (format!("http://{addr}/stream"), rx)
    }

    /// The engine must forward the webview's session, or authenticated routes
    /// (member uploads) 401 while the same song plays fine in a browser.
    #[tokio::test]
    async fn sends_the_session_cookie() {
        let (url, rx) = spy_server();
        let client = http_client(Some("pb_auth=test-token")).expect("client");
        let _ = HttpStream::new(client, url.parse().expect("url")).await;

        let headers = rx.recv_timeout(Duration::from_secs(5)).expect("server saw a request");
        assert!(
            headers.iter().any(|h| h.to_lowercase() == "cookie: pb_auth=test-token"),
            "Cookie header missing; server saw: {headers:?}"
        );
    }

    /// rodio applies volume per SINK, and every load builds a new one. Before
    /// this was stored on the engine, setting 20% then changing track played
    /// the next song at rodio's default 1.0 — full blast. The volume set
    /// BEFORE anything is loaded was discarded entirely.
    #[test]
    fn volume_survives_track_changes() {
        let engine = AudioEngine::new_degraded();
        assert_eq!(engine.volume(), 1.0, "fresh engine should be unity gain");

        // Set with nothing playing — the old code dropped this on the floor.
        engine.set_volume(0.2);
        assert!((engine.volume() - 0.2).abs() < f32::EPSILON);

        // Whatever a later load builds its sink with, it reads this value.
        engine.set_volume(0.45);
        assert!((engine.volume() - 0.45).abs() < f32::EPSILON);
    }

    /// Party mode amplifies above 1.0, so only the negative side is clamped.
    #[test]
    fn volume_clamps_negatives_but_allows_amplification() {
        let engine = AudioEngine::new_degraded();
        engine.set_volume(-3.0);
        assert_eq!(engine.volume(), 0.0);
        engine.set_volume(1.8);
        assert!((engine.volume() - 1.8).abs() < f32::EPSILON);
    }

    /// A load that started earlier but finishes later must NOT install its
    /// sink. The startup hydration load (autoplay=false) used to land after a
    /// user's click-to-play and replace a playing sink with a paused one.
    #[test]
    fn a_superseded_load_knows_it_lost() {
        let engine = AudioEngine::new_degraded();
        let slow = engine.claim_load();      // startup hydration begins
        let fast = engine.claim_load();      // user clicks play

        assert!(!engine.is_current_load(slow), "the older load must stand down");
        assert!(engine.is_current_load(fast), "the newest load owns playback");
    }

    /// Skipping used to leave the previous song audible for a beat, because
    /// the old sink played on until the new one finished connecting and
    /// decoding. Silencing drops the sink and bumps the generation (which
    /// stops the old position timer) right away.
    #[test]
    fn silencing_drops_the_current_sink_and_stops_its_timer() {
        let engine = AudioEngine::new_degraded();
        let before = engine.generation.load(Ordering::SeqCst);
        *engine.current_url.lock().unwrap() = Some("http://old/track".into());

        engine.silence_current();

        assert!(engine.sink.lock().unwrap().is_none(), "the old sink must be gone");
        assert!(engine.current_url.lock().unwrap().is_none(), "no track is loaded any more");
        assert!(engine.generation.load(Ordering::SeqCst) > before, "the old timer must stand down");
    }

    #[test]
    fn the_only_load_in_flight_is_current() {
        let engine = AudioEngine::new_degraded();
        let seq = engine.claim_load();
        assert!(engine.is_current_load(seq));
    }

    /// Public routes must keep working with no session attached.
    #[tokio::test]
    async fn omits_the_header_when_there_is_no_session() {
        let (url, rx) = spy_server();
        let client = http_client(None).expect("client");
        let _ = HttpStream::new(client, url.parse().expect("url")).await;

        let headers = rx.recv_timeout(Duration::from_secs(5)).expect("server saw a request");
        assert!(
            !headers.iter().any(|h| h.to_lowercase().starts_with("cookie:")),
            "unexpected Cookie header: {headers:?}"
        );
    }
}
