// Ember desktop, native audio engine (Part 5).
//
// Streams a remote m4a/AAC URL (the host's /api/youtube/stream/<id>) via
// `stream-download` (seekable, temp-file-backed HTTP reader) -> `rodio::Decoder`
// (symphonia isomp4/aac) -> `rodio::Sink`, behind a small set of Tauri commands.
// A ~250ms polling task emits position + end-of-track events back to the webview.
//
// Crate API notes (verified against current docs):
//   * rodio 0.21: `Sink::connect_new(mixer)` builds a Sink. Sink keeps
//     `append/play/pause/stop/set_volume/get_pos/try_seek/empty`. (0.22
//     renamed Sink->Player.) The mixer every sink connects to is the master
//     mixer of src/output.rs, not a device's own: the device under it can
//     change while a song plays (see that file).
//   * stream-download 0.24: `StreamDownload::new_http(url, storage, settings)` is
//     async and yields a blocking `Read + Seek` reader.

use std::io::{Read, Seek};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rodio::mixer::Mixer;
use rodio::Sink;
use serde::Serialize;
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig};
use stream_download::http::reqwest::header::{HeaderMap, HeaderValue, COOKIE};
use stream_download::http::reqwest::Client;
use stream_download::http::HttpStream;
use stream_download::storage::temp::TempStorageProvider;
use stream_download::{Settings, StreamDownload, StreamPhase};
use tauri::{AppHandle, Runtime, State};

/// The loaded sink, shared with the position timer.
type SharedSink = Arc<Mutex<Option<Arc<Sink>>>>;

/// Stops a streamed load's download.
pub(crate) type DownloadStop = Box<dyn Fn() + Send + Sync>;

/// Native audio engine state, stored in Tauri managed state.
///
/// `rodio::OutputStream` (cpal `Stream`) is `!Send + !Sync`, so it cannot live in
/// Tauri's managed state directly. It lives on the output router's thread
/// (src/output.rs), and this holds the router's master `Mixer` (which IS
/// `Send + Sync + Clone`) plus a handle on the router. New `Sink`s are built
/// from that mixer on demand.
pub struct AudioEngine {
    /// The master mixer (see src/output.rs). Used to build sinks; the output
    /// device under it can change without any sink noticing. `None` when no
    /// output device could be opened: the app still starts (see
    /// `new_degraded`) and the webview falls back to web audio.
    mixer: Option<Mixer>,
    /// The output router: lists devices and switches between them. `None`
    /// for a degraded engine and for the tests' engine (`with_output`), which
    /// have no device to switch.
    outputs: Option<crate::output::OutputRouter>,
    /// Current playback sink. `Arc<Mutex<..>>` so the position-polling task can
    /// share access. `None` when nothing is loaded. The sink itself is in an
    /// `Arc` so a seek can run on it without holding this lock (see
    /// `seek_in_place`).
    sink: SharedSink,
    /// Monotonic load counter. Each `audio_load` bumps it; the position timer
    /// captures its value and exits once a newer load supersedes it.
    generation: Arc<AtomicU64>,
    /// Claimed at the START of every load, unlike `generation` which is taken
    /// after the download+decode. Without it, the load that FINISHES last wins:
    /// a slow startup load (hydrating the persisted track with autoplay=false)
    /// could land after the user clicked play and replace a playing sink with a
    /// paused one. That is the "had to click play several times" bug.
    load_seq: Arc<AtomicU64>,
    /// The newest load that has finished, installed or failed. A load is in
    /// flight while this trails `load_seq`.
    settled_seq: AtomicU64,
    /// Play or pause, as the listener last asked. A load in flight has no
    /// sink to act on, so play and pause set this and the load honours it when
    /// its sink goes in, rather than the autoplay it was started with. Written
    /// and read under the `sink` lock.
    want_play: AtomicBool,
    /// A seek asked for while a load was in flight, which the load starts at
    /// instead of its own start (bughunt 2026-09-25 D2). Written and read
    /// under the `sink` lock, cleared by every new load.
    pending_seek: Mutex<Option<f64>>,
    /// Seeks handed to the decoder and not yet done. The position timer
    /// neither reports nor judges a stall while one runs: the decoder is
    /// waiting on the host for the bytes it seeks to, and the position it
    /// would report is the one being left.
    seeks_running: AtomicU64,
    /// The generation (see `generation`) of the sink the latest seek is on:
    /// only that sink's timer holds back, not the next song's.
    seek_generation: AtomicU64,
    /// The webview's tag for its latest `audio_load` (bughunt 2026-09-25 D5),
    /// and the tag of the load whose sink is in. Every position, end and
    /// playback error carries the tag of the load it is about, so the webview
    /// can drop one that was already on its way when it loaded the next song
    /// (it used to take the old song's playhead, or its end, as the new
    /// one's). `None` for a webview that sends none; it then checks nothing.
    asked_token: Mutex<Option<u64>>,
    installed_token: Mutex<Option<u64>>,
    /// Stops the download behind the loaded sink (a streamed one).
    ///
    /// Every sink plays on the one audio thread, and a stream that has
    /// stopped arriving blocks that thread in its read for as long as its
    /// download keeps retrying: dropping the sink does not end the read, so
    /// the next song stayed silent behind it (D8). Stopping the download
    /// does: the read returns an error and the source ends.
    current_download: Mutex<Option<DownloadStop>>,
    /// The last track a load was asked for: url, cookie, start, cache key.
    /// What play tries again when that load failed and nothing is loaded.
    requested: Mutex<Option<Requested>>,
    /// Last loaded absolute stream URL: diagnostics, and what a backward seek
    /// in a forward-only track re-opens (see `plan_seek`).
    current_url: Mutex<Option<String>>,
    /// The session cookie that URL was loaded with, for the same re-open.
    current_cookie: Mutex<Option<String>>,
    /// The loaded track is decoded forward-only (a fragmented stream, see
    /// `open_decoder`), so its demuxer cannot go back to an earlier packet.
    forward_only: AtomicBool,
    /// Whether the source behind the loaded sink has failed. Set by the
    /// reader wrapper (see `FailFlagged`) and by a seek the decoder refused,
    /// read by the position timer so a dead stream is reported as an error
    /// rather than as the end of the track. One per load.
    source_failed: Mutex<Arc<AtomicBool>>,
    /// Repeat one, as the webview last set it (`audio_set_loop`): the song
    /// playing goes back to the top by itself instead of ending (src/repeat.rs).
    repeat_one: Arc<AtomicBool>,
    /// The loaded song's lap clock: what its loops added to the sink's clock.
    loop_clock: Mutex<Arc<crate::repeat::LoopClock>>,
    /// What the decoder said the loaded track lasts. Read by `audio_seek`:
    /// rodio clamps every seek target to this figure, so a decoder that
    /// reports zero (a fragmented mp4, which is what the stream route proxies
    /// when its download failed) would turn every seek into a seek to 0.
    current_total: Mutex<Option<Duration>>,
    /// Last volume the UI asked for. rodio applies volume PER SINK and every
    /// load builds a new one, so without remembering it here each track would
    /// start at rodio's default of 1.0, i.e. the user sets 20%, the next song
    /// blasts at full. Applied in `new_sink`.
    volume: Mutex<f32>,
    /// The equalizer every song plays through (src/eq.rs). Shared with the
    /// `Equalized` wrapper of the loaded song, which picks a change up at
    /// once, so it outlives track changes the way `volume` does.
    eq: Arc<crate::eq::EqControl>,
    /// OS media controls (macOS Now Playing / Windows SMTC / Linux MPRIS).
    /// `None` if init failed, playback still works without OS controls.
    /// On macOS `MediaControls` is a zero-sized unit struct (state lives in
    /// global MPNowPlayingInfoCenter/MPRemoteCommandCenter), so it is Send+Sync.
    controls: Mutex<Option<MediaControls>>,
    /// The last metadata the webview asked to show (title, artist, album,
    /// artwork_url). Kept so the duration can be added to it once the
    /// decoder reports one (bughunt L5): `audio_set_metadata` usually runs
    /// before `current_total` is known, so re-sending it there would send
    /// `duration: None` and leave the OS widget with no scrubber.
    nowplaying_meta: Mutex<Option<(String, String, String, String)>>,
    /// What the OS widget was last told, kept whether or not media controls
    /// exist, so tests (which have none) can check it.
    widget: Mutex<Widget>,
    /// The clocks of the playback watchdog (see `judge_frozen`).
    play_budgets: PlayBudgets,
    /// The song the webview asked for last has already been opened again
    /// once after a stall (see `spawn_position_timer`). Cleared by every
    /// `audio_load`, so each song gets one native retry.
    stall_retried: AtomicBool,
}

/// The OS Now Playing widget's state as last sent.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Widget {
    pub playback: Option<MediaPlayback>,
    pub title: Option<String>,
    pub duration: Option<Duration>,
}

impl AudioEngine {
    pub fn new() -> Result<Self, String> {
        // The output router opens the system default output on a thread of
        // its own and keeps every stream there (the cpal Stream is !Send, so
        // it must not cross threads). It hands back the master mixer, which
        // the songs play into whichever device is under it (src/output.rs).
        let (mixer, router) = crate::output::start(
            crate::output::system_backend(),
            crate::output::RouterConfig::for_this_os(),
        )?;

        Ok(Self {
            mixer: Some(mixer),
            outputs: Some(router),
            sink: Arc::new(Mutex::new(None)),
            generation: Arc::new(AtomicU64::new(0)),
            load_seq: Arc::new(AtomicU64::new(0)),
            settled_seq: AtomicU64::new(0),
            want_play: AtomicBool::new(false),
            pending_seek: Mutex::new(None),
            seeks_running: AtomicU64::new(0),
            seek_generation: AtomicU64::new(0),
            asked_token: Mutex::new(None),
            installed_token: Mutex::new(None),
            current_download: Mutex::new(None),
            requested: Mutex::new(None),
            current_url: Mutex::new(None),
            current_cookie: Mutex::new(None),
            forward_only: AtomicBool::new(false),
            current_total: Mutex::new(None),
            source_failed: Mutex::new(Arc::new(AtomicBool::new(false))),
            repeat_one: Arc::new(AtomicBool::new(false)),
            loop_clock: Mutex::new(Arc::default()),
            volume: Mutex::new(1.0),
            eq: Arc::new(crate::eq::EqControl::new()),
            controls: Mutex::new(None),
            nowplaying_meta: Mutex::new(None),
            widget: Mutex::new(Widget::default()),
            play_budgets: PlayBudgets::DEFAULT,
            stall_retried: AtomicBool::new(false),
        })
    }

    /// An engine with no output device. Every playback command fails cleanly
    /// instead of the whole app dying at launch.
    ///
    /// This is not hypothetical: a machine with no sound card, audio disabled,
    /// or (as CI proved) a headless Windows runner would abort the process
    /// before it drew a window, `panic = abort` turns the `.expect()` into
    /// exit code 0xC0000409 with nothing logged. A music app with no audio
    /// device should say so, not vanish.
    pub fn new_degraded() -> Self {
        Self {
            mixer: None,
            outputs: None,
            sink: Arc::new(Mutex::new(None)),
            generation: Arc::new(AtomicU64::new(0)),
            load_seq: Arc::new(AtomicU64::new(0)),
            settled_seq: AtomicU64::new(0),
            want_play: AtomicBool::new(false),
            pending_seek: Mutex::new(None),
            seeks_running: AtomicU64::new(0),
            seek_generation: AtomicU64::new(0),
            asked_token: Mutex::new(None),
            installed_token: Mutex::new(None),
            current_download: Mutex::new(None),
            requested: Mutex::new(None),
            current_url: Mutex::new(None),
            current_cookie: Mutex::new(None),
            forward_only: AtomicBool::new(false),
            current_total: Mutex::new(None),
            source_failed: Mutex::new(Arc::new(AtomicBool::new(false))),
            repeat_one: Arc::new(AtomicBool::new(false)),
            loop_clock: Mutex::new(Arc::default()),
            volume: Mutex::new(1.0),
            eq: Arc::new(crate::eq::EqControl::new()),
            controls: Mutex::new(None),
            nowplaying_meta: Mutex::new(None),
            widget: Mutex::new(Widget::default()),
            play_budgets: PlayBudgets::DEFAULT,
            stall_retried: AtomicBool::new(false),
        }
    }

    /// An engine that plays into `mixer` instead of a device: the tests pull
    /// its samples themselves, the way the output device would.
    #[cfg(test)]
    pub(crate) fn with_output(mixer: Mixer) -> Self {
        Self { mixer: Some(mixer), ..Self::new_degraded() }
    }

    /// The same, with the playback watchdog on shorter clocks.
    #[cfg(test)]
    pub(crate) fn with_play_budgets(self, play_budgets: PlayBudgets) -> Self {
        Self { play_budgets, ..self }
    }

    /// Whether a real output device is attached.
    pub fn has_output(&self) -> bool {
        self.mixer.is_some()
    }

    /// The output router, when there is a device to route to.
    pub fn outputs(&self) -> Option<&crate::output::OutputRouter> {
        self.outputs.as_ref()
    }

    /// Reflect play/paused state in the OS Now Playing widget, including the
    /// current position: without it (bughunt L5) the widget knows only
    /// Playing/Paused and never a position, so it has no scrubber. No-op if
    /// media controls failed to initialize.
    fn set_nowplaying(&self, playing: bool) {
        let pos = self.sink.lock().ok().and_then(|g| g.as_ref().map(|s| self.track_pos(s)));
        self.set_playback(nowplaying_state(playing, pos));
    }

    /// Where the loaded song is: the sink's clock less what loops added.
    fn track_pos(&self, sink: &Sink) -> Duration {
        let pos = sink.get_pos();
        match self.loop_clock.lock() {
            Ok(c) => c.track_pos(pos),
            Err(_) => pos,
        }
    }

    fn set_playback(&self, pb: MediaPlayback) {
        if let Ok(mut w) = self.widget.lock() {
            w.playback = Some(pb.clone());
        }
        if let Ok(mut g) = self.controls.lock() {
            if let Some(c) = g.as_mut() {
                let _ = c.set_playback(pb);
            }
        }
    }

    /// Re-sends the last metadata the webview set, with `duration` filled in
    /// from `current_total` (bughunt L5). Called both from `audio_set_metadata`
    /// (which usually runs before the decoder has reported a duration) and
    /// from `load_track` once it has one, so the widget picks up the
    /// duration without the webview needing to ask again.
    fn push_metadata(&self) {
        let Ok(meta_guard) = self.nowplaying_meta.lock() else { return };
        let Some((title, artist, album, artwork_url)) = meta_guard.as_ref() else { return };
        let duration = self.current_total.lock().ok().and_then(|g| *g);
        if let Ok(mut w) = self.widget.lock() {
            w.title = Some(title.clone());
            w.duration = duration;
        }
        if let Ok(mut g) = self.controls.lock() {
            if let Some(c) = g.as_mut() {
                let _ = c.set_metadata(MediaMetadata {
                    title: Some(title),
                    artist: Some(artist),
                    album: Some(album),
                    cover_url: if artwork_url.is_empty() { None } else { Some(artwork_url) },
                    duration,
                });
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

    /// Change the equalizer; the song playing now follows at once.
    pub fn set_eq(&self, settings: crate::eq::EqSettings) {
        self.eq.set(settings);
    }

    /// The equalizer as last set.
    pub fn eq(&self) -> crate::eq::EqSettings {
        self.eq.get()
    }

    /// Take a ticket for a load that is about to start.
    pub fn claim_load(&self) -> u64 {
        self.load_seq.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Everything a load must settle the moment it is asked for, before any
    /// awaiting: its ticket, whether it should play, and that a seek meant for
    /// an earlier load is void. Separate from the load itself so a command
    /// that starts one in the background (a re-open, a retry) makes it visible
    /// to the next command at once: play pressed right after such a seek then
    /// finds a load in flight and leaves it be, instead of starting a second.
    fn begin_load(&self, autoplay: bool) -> u64 {
        let seq = self.claim_load();
        if let Ok(_sink) = self.sink.lock() {
            self.want_play.store(autoplay, Ordering::SeqCst);
            if let Ok(mut p) = self.pending_seek.lock() {
                *p = None;
            }
        }
        seq
    }

    /// Cut the sound of whatever is playing right now. A new load takes a
    /// second or two to connect, buffer and decode, and until this the old
    /// track kept playing over that gap, pressing skip left the previous
    /// song audible after the UI had already moved on.
    pub fn silence_current(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut guard) = self.sink.lock() {
            if let Some(sink) = guard.take() {
                sink.stop();
            }
        }
        self.stop_download();
        if let Ok(mut u) = self.current_url.lock() {
            *u = None;
        }
        self.forward_only.store(false, Ordering::SeqCst);
        if let Ok(mut d) = self.current_total.lock() {
            *d = None;
        }
    }

    /// Stops the download behind the sink that just went (see
    /// `current_download`).
    fn stop_download(&self) {
        if let Some(stop) = self.current_download.lock().ok().and_then(|mut d| d.take()) {
            stop();
        }
    }

    /// Whether this load is still the newest one. A load that lost the race
    /// must throw its work away rather than install a stale sink.
    pub fn is_current_load(&self, seq: u64) -> bool {
        self.load_seq.load(Ordering::SeqCst) == seq
    }

    /// Whether music is playing, or about to once its load lands. The
    /// Windows updater quits the app to install, so it waits for this.
    pub fn is_playing(&self) -> bool {
        let Ok(g) = self.sink.lock() else { return false };
        match g.as_ref() {
            Some(s) => !s.is_paused() && !s.empty(),
            None => self.load_in_flight() && self.want_play.load(Ordering::SeqCst),
        }
    }

    /// Whether the newest load is still connecting, buffering or decoding.
    fn load_in_flight(&self) -> bool {
        self.settled_seq.load(Ordering::SeqCst) < self.load_seq.load(Ordering::SeqCst)
    }

    /// What the OS widget was last told.
    #[cfg(test)]
    pub(crate) fn widget(&self) -> Widget {
        self.widget.lock().map(|w| w.clone()).unwrap_or_default()
    }

    /// Shared handles for the position-polling task.
    fn inner_arc(&self) -> (SharedSink, Arc<AtomicU64>) {
        (Arc::clone(&self.sink), Arc::clone(&self.generation))
    }
}

/// A load as it was asked for: url, cookie, start, cache key.
type Requested = (String, Option<String>, f64, Option<String>);

// --- Event payloads ---------------------------------------------------------

#[derive(Clone, Serialize)]
struct SecPayload {
    sec: f64,
    /// The load this is about (see `AudioEngine::asked_token`).
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<u64>,
}
#[derive(Clone, Serialize)]
struct TokenPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<u64>,
}
/// Whether the webview should try this track again on web audio.
///
/// `WEB_AUDIO` is anything this engine could not do with bytes it did get (no
/// output device, a codec rodio lacks): a browser may well manage. `NONE` is
/// the host refusing or failing to deliver the song at all, the browser would
/// ask the same server for the same bytes and wait all over again, and the
/// swap costs the whole session its OS media keys. Reported so the webview can
/// tell the two apart instead of falling back on every error.
const RETRY_WEB_AUDIO: &str = "web-audio";
const RETRY_NONE: &str = "none";

#[derive(Clone, Serialize)]
struct ErrPayload {
    message: String,
    retry: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<u64>,
    /// The engine has already done what a native retry could (it opened the
    /// song again once, or there was nothing to fetch again), so the webview
    /// should not try one of its own. Older engines send no such field.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    retried: bool,
}
/// An OS media-button press forwarded to the webview. `kind` is one of
/// play/pause/toggle/next/prev/seek; `sec` is set only for seek.
#[derive(Clone, Serialize)]
struct CmdPayload {
    kind: &'static str,
    sec: Option<f64>,
}

fn emit_sec<R: Runtime>(app: &AppHandle<R>, event: &str, sec: f64, token: Option<u64>) {
    use tauri::Emitter;
    let _ = app.emit(event, SecPayload { sec, token });
}
fn emit_bare<R: Runtime>(app: &AppHandle<R>, event: &str) {
    use tauri::Emitter;
    let _ = app.emit(event, ());
}
/// Write a line into the app log from the audio engine.
///
/// Playback faults here are intermittent and timing-dependent, the kind that
/// never reproduce while you're watching. Recording each load's sequence
/// number, start offset and outcome means the next bug report explains itself
/// instead of needing a re-run.
fn log_audio<R: Runtime>(app: &AppHandle<R>, level: &str, msg: &str) {
    use tauri::Manager;
    if let Some(state) = app.try_state::<crate::applog::LogFile>() {
        if let Ok(path) = state.0.lock() {
            crate::applog::write_line(path.as_ref(), level, &format!("audio: {msg}"));
        }
    }
}

fn emit_err<R: Runtime>(app: &AppHandle<R>, retry: &'static str, message: String) {
    emit_err_about(app, retry, message, None);
}

/// `emit_err` for a failure of one particular load's playback.
fn emit_err_about<R: Runtime>(app: &AppHandle<R>, retry: &'static str, message: String, token: Option<u64>) {
    use tauri::Emitter;
    let _ = app.emit("audio:error", ErrPayload { message, retry, token, retried: false });
}

/// `emit_err_about` for a playback stall the engine has already retried, or
/// that a retry could not help (see `ErrPayload::retried`).
fn emit_stall<R: Runtime>(app: &AppHandle<R>, message: String, token: Option<u64>) {
    use tauri::Emitter;
    let _ = app.emit("audio:error", ErrPayload { message, retry: RETRY_WEB_AUDIO, token, retried: true });
}

// --- Commands ---------------------------------------------------------------

/// Builds the HTTP client used to pull audio.
///
/// `cookie` carries the webview's `pb_auth` session. Without it only PUBLIC
/// routes work: `/api/youtube/stream/...` serves songs already on the host to
/// anyone, but a song it has to fetch first, and member uploads
/// (`/api/uploads/<id>/stream`), require a session, so they would fail here
/// while playing fine in any browser. Sending the session makes the
/// native engine as capable as the webview without opening uploads to the
/// whole internet.
///
/// Callers pass the cookie through `session_cookie_for` first: it is for
/// the Ember server only, never for a third-party stream URL.
pub(crate) fn http_client(cookie: Option<&str>) -> Result<Client, String> {
    let mut builder = Client::builder();
    if let Some(cookie) = cookie.filter(|c| !c.is_empty()) {
        let mut headers = HeaderMap::new();
        let value = HeaderValue::from_str(cookie).map_err(|_| "invalid cookie header".to_string())?;
        headers.insert(COOKIE, value);
        builder = builder.default_headers(headers);
    }
    builder.build().map_err(|e| e.to_string())
}

/// The session cookie, only when `url` is on the Ember server itself (same
/// scheme, host and port as `server`). A Jamendo song streams straight from
/// Jamendo, and the webview hands every load and prefetch its `pb_auth`
/// cookie; attached there, it gave the user's session token to a third party.
pub(crate) fn session_cookie_for(url: &str, server: Option<&tauri::Url>, cookie: Option<String>) -> Option<String> {
    let server = server?;
    let target = tauri::Url::parse(url).ok()?;
    (target.origin() == server.origin()).then_some(cookie).flatten()
}

/// `session_cookie_for` with the server the main window is configured to load.
pub(crate) fn session_cookie_for_app<R: Runtime>(app: &AppHandle<R>, url: &str, cookie: Option<String>) -> Option<String> {
    session_cookie_for(url, crate::connect::server_url(app.config()).as_ref(), cookie)
}

/// A reader that remembers whether it ever failed.
///
/// rodio's symphonia decoder turns ANY read error into "the source ended"
/// (`decoder/symphonia.rs`: `self.format.next_packet().ok()?`), which is
/// exactly what a finished song looks like from the outside: the sink goes
/// empty. `StreamDownload`'s reader fails permanently once its download task
/// gives up (a truncated body, a refill that 403s, a laptop that slept), so
/// without this flag the engine reports a stream that died half way through a
/// song as "track finished", and the webview answers by playing the next one.
pub(crate) struct FailFlagged<R> {
    pub(crate) inner: R,
    pub(crate) failed: Arc<AtomicBool>,
}

impl<R: Read> Read for FailFlagged<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.inner
            .read(buf)
            .inspect_err(|_| self.failed.store(true, Ordering::SeqCst))
    }
}

impl<R: Seek> Seek for FailFlagged<R> {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        self.inner
            .seek(pos)
            .inspect_err(|_| self.failed.store(true, Ordering::SeqCst))
    }
}

/// Build the decoder the engine plays from.
///
/// `rodio::Decoder::new` leaves symphonia's media source NOT seekable and with
/// no byte length, and a non-seekable isomp4 demuxer can only move forwards:
/// any seek that lands behind its read buffer makes the next packet read fail,
/// which rodio reports as the end of the source: i.e. the track "ends" and
/// the player starts the next song. Handing it the byte length the HTTP
/// response already declared makes the source seekable, and `StreamDownload`
/// serves the seek from its temp file or a Range request.
///
/// Without a content length there is nothing to seek against, so that case
/// keeps the old non-seekable decoder rather than promising more than it can
/// do.
fn build_decoder<R: Read + Seek + Send + Sync + 'static>(
    reader: R,
    byte_len: Option<u64>,
) -> Result<rodio::Decoder<R>, rodio::decoder::DecoderError> {
    let builder = rodio::Decoder::builder().with_data(reader);
    match byte_len {
        Some(len) => builder.with_byte_len(len).with_seekable(true).build(),
        None => builder.build(),
    }
}

/// Whether an mp4 body is FRAGMENTED, judged from its first bytes: `Some`
/// once it can tell, `None` while it needs more of them.
///
/// Fragmented means moof/mdat pairs, one per ~10 s of audio: the layout
/// googlevideo serves (ftyp, moov with an mvex, sidx, moof, mdat, moof, ...),
/// so it is what the stream route proxies, and what a host keeps on disk when
/// yt-dlp could not run its ffmpeg fixup. A remuxed file (ftyp, moov, mdat) is
/// not. Anything that is not an mp4 at all (webm) is "not fragmented", which
/// leaves it on the path it always took.
#[cfg(test)]
pub(crate) fn sniff_fragmented(head: &[u8]) -> Option<bool> {
    sniff_layout(head, None).map(|l| l.fragmented)
}

/// What the head of a streamed body says about how it is laid out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct HeadLayout {
    /// See `sniff_fragmented`.
    pub fragmented: bool,
    /// Where the payload of the body's one mdat starts, when that mdat runs
    /// to the end of the body and the index (moov) came before it: ftyp,
    /// moov, free, mdat, which is how yt-dlp's ffmpeg fixup leaves every song
    /// on the host. Nothing follows such an mdat (see `TailSkip`).
    pub trailing_mdat: Option<u64>,
}

/// `sniff_fragmented`, plus where an mdat that ends the body starts.
/// `byte_len` is the length the response declared; without it nothing is
/// claimed about the end of the body.
pub(crate) fn sniff_layout(head: &[u8], byte_len: Option<u64>) -> Option<HeadLayout> {
    const PLAIN: HeadLayout = HeadLayout { fragmented: false, trailing_mdat: None };
    const FRAGMENTED: HeadLayout = HeadLayout { fragmented: true, trailing_mdat: None };
    let atom_at = |pos: usize| -> Option<(u64, [u8; 4], usize)> {
        let h = head.get(pos..pos + 8)?;
        let kind = [h[4], h[5], h[6], h[7]];
        match u32::from_be_bytes([h[0], h[1], h[2], h[3]]) {
            1 => {
                let l = head.get(pos + 8..pos + 16)?;
                Some((u64::from_be_bytes(l.try_into().ok()?), kind, 16))
            }
            size => Some((u64::from(size), kind, 8)),
        }
    };
    let mut pos = 0usize;
    let mut moov_seen = false;
    loop {
        let (size, kind, header) = atom_at(pos)?;
        if pos == 0 && &kind != b"ftyp" {
            return Some(PLAIN);
        }
        if &kind == b"mdat" {
            // A size of zero means "to the end of the body", by definition.
            let ends_body = byte_len.is_some_and(|len| size == 0 || (pos as u64).checked_add(size) == Some(len));
            let trailing_mdat = (moov_seen && ends_body).then_some((pos + header) as u64);
            return Some(HeadLayout { fragmented: false, trailing_mdat });
        }
        if size < header as u64 {
            // Zero ("to the end") or a corrupt size: nothing after it to find.
            return Some(PLAIN);
        }
        match &kind {
            b"moof" | b"sidx" => return Some(FRAGMENTED),
            b"moov" => {
                // An mvex (movie extends) child is what declares fragments.
                let end = pos.checked_add(usize::try_from(size).ok()?)?;
                let body = head.get(pos + header..end)?;
                let mut child = 0usize;
                while let Some(h) = body.get(child..child + 8) {
                    if &h[4..8] == b"mvex" {
                        return Some(FRAGMENTED);
                    }
                    let len = u32::from_be_bytes([h[0], h[1], h[2], h[3]]) as usize;
                    if len < 8 {
                        break;
                    }
                    child += len;
                }
                moov_seen = true;
            }
            _ => {}
        }
        pos = pos.checked_add(usize::try_from(size).ok()?)?;
    }
}

/// Reads the head of `reader` until `sniff_layout` can decide, then puts the
/// reader back at the start. Reads only forwards, so it never asks the host
/// for anything but the bytes already on their way. Also says how many bytes
/// it read.
fn sniff_stream<R: Read + Seek>(reader: &mut R, byte_len: Option<u64>) -> std::io::Result<(HeadLayout, u64)> {
    /// A moov for a long remuxed track is ~130 KB; past this, give up and
    /// treat the body the way every body used to be treated.
    const MAX_HEAD: usize = 2 * 1024 * 1024;
    let mut head = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    let plain = HeadLayout { fragmented: false, trailing_mdat: None };
    let verdict = loop {
        if let Some(v) = sniff_layout(&head, byte_len) {
            break v;
        }
        if head.len() >= MAX_HEAD {
            break plain;
        }
        let n = reader.read(&mut chunk)?;
        if n == 0 {
            break plain;
        }
        head.extend_from_slice(&chunk[..n]);
    };
    reader.seek(std::io::SeekFrom::Start(0))?;
    Ok((verdict, head.len() as u64))
}

/// How far past everything read so far a jump has to land before `TailSkip`
/// answers it itself. The decoder, while it is built, reads the first
/// samples just after the mdat header (within the head the sniff read);
/// symphonia's skip over the mdat lands 64 KB before the end of the body.
const TAIL_SKIP_MARGIN: u64 = 256 * 1024;

/// The reader a streamed decoder is BUILT from: answers symphonia's skip over
/// an mdat that ends the body without asking the host.
///
/// A seekable mp4 reader walks every top-level atom before it plays, and it
/// gets past the mdat by seeking to the last 64 KB of it and reading them
/// (`MediaSourceStream::ignore_bytes`), only to find the end of the body. For
/// a streamed song that seek is a Range request, sent while the first
/// response is still arriving and no longer read, so its answer waits behind
/// everything already on its way: on a slow Funnel link longer than the 25 s
/// request budget, twice (Luka, 2026-10-09, src/audio/one_request.rs). A
/// browser never asks for those bytes, and neither does the demuxer need
/// them: it discards them unread. So while the decoder is being built, a jump
/// into such an mdat, well past everything read so far, moves only this
/// reader's position, and reads there give zeros up to the end of the body.
/// The next seek (symphonia goes back to the start right after) is a real one
/// again. Once the decoder is built (`finish_building`) every seek is passed
/// on, and a read left at a stand-in position first moves the real reader
/// there.
pub(crate) struct TailSkip<R> {
    inner: R,
    /// The trailing mdat's payload start and the body's length, when the
    /// body has one (see `HeadLayout::trailing_mdat`).
    skippable: Option<(u64, u64)>,
    building: Arc<AtomicBool>,
    /// The position the decoder sees.
    pos: u64,
    /// The furthest byte read so far.
    read_to: u64,
    /// `inner` is not at `pos`: reads are being answered here.
    standing_in: bool,
}

impl<R> TailSkip<R> {
    /// `inner` must be at the start of the body; `read_so_far` is how much of
    /// it has already been read (the sniffed head).
    pub(crate) fn new(inner: R, skippable: Option<(u64, u64)>, read_so_far: u64) -> Self {
        Self {
            inner,
            skippable,
            building: Arc::new(AtomicBool::new(true)),
            pos: 0,
            read_to: read_so_far,
            standing_in: false,
        }
    }

    /// The decoder is built: from now on every seek is the real reader's.
    #[cfg(test)]
    pub(crate) fn finish_building(&self) {
        self.building.store(false, Ordering::SeqCst);
    }

    /// `finish_building`, for after the reader has moved into the decoder.
    fn build_done(&self) -> impl Fn() {
        let building = Arc::clone(&self.building);
        move || building.store(false, Ordering::SeqCst)
    }

    fn is_building(&self) -> bool {
        self.building.load(Ordering::SeqCst)
    }
}

impl<R: Read + Seek> Read for TailSkip<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.standing_in {
            match self.skippable {
                Some((_, len)) if self.is_building() => {
                    let n = usize::try_from(len.saturating_sub(self.pos)).unwrap_or(usize::MAX).min(buf.len());
                    buf[..n].fill(0);
                    self.pos += n as u64;
                    return Ok(n);
                }
                _ => {
                    self.inner.seek(std::io::SeekFrom::Start(self.pos))?;
                    self.standing_in = false;
                }
            }
        }
        let n = self.inner.read(buf)?;
        self.pos += n as u64;
        self.read_to = self.read_to.max(self.pos);
        Ok(n)
    }
}

impl<R: Read + Seek> Seek for TailSkip<R> {
    fn seek(&mut self, to: std::io::SeekFrom) -> std::io::Result<u64> {
        use std::io::SeekFrom;
        if let (Some((mdat, len)), true) = (self.skippable, self.is_building()) {
            let target = match to {
                SeekFrom::Start(p) => Some(p),
                SeekFrom::Current(d) => self.pos.checked_add_signed(d),
                SeekFrom::End(d) => len.checked_add_signed(d),
            };
            if let Some(target) = target {
                if target >= mdat && target <= len && target > self.read_to.saturating_add(TAIL_SKIP_MARGIN) {
                    self.pos = target;
                    self.standing_in = true;
                    return Ok(target);
                }
            }
        }
        // The real reader is not where the decoder thinks it is: say where.
        let to = match (self.standing_in, to) {
            (true, SeekFrom::Current(d)) => SeekFrom::Start(
                self.pos
                    .checked_add_signed(d)
                    .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "seek before the start"))?,
            ),
            (_, other) => other,
        };
        let at = self.inner.seek(to)?;
        self.pos = at;
        self.standing_in = false;
        Ok(at)
    }
}

/// Builds the decoder a STREAMED load plays from, and says whether it is
/// forward-only.
///
/// A seekable decoder (see `build_decoder`) makes symphonia's mp4 reader walk
/// every top-level atom before it plays a sample. For a fragmented body that
/// is one moof per ~10 s, and each hop over a ~160 KB mdat is a seek past what
/// has arrived, which `StreamDownload` answers with a brand new Range request.
/// So the old engine made 33 requests in series to open EOugbQC1r0s (5:37),
/// 43 for TwFXwkKyGSQ (7:21), all before the first note, and over the Funnel
/// the app talks to, a single one of those round trips taking 3 s ended the
/// load: "the song stopped arriving while decoding (nothing for 3s)". A
/// browser plays the same body from one linear request, which is why web
/// audio could play what the engine could not.
///
/// A fragmented body is therefore decoded forward-only, from the one request
/// already flowing; its segment index still gives the track's length. What it
/// cannot do is seek backwards, and `plan_seek` re-opens it for that. Every
/// other body keeps the seekable decoder. Its walk hops over one mdat, and
/// when that mdat ends the body (every remuxed song on the host) `TailSkip`
/// makes the hop without a request, so it too opens from one request.
pub(crate) fn open_decoder<R: Read + Seek + Send + Sync + 'static>(
    mut reader: R,
    byte_len: Option<u64>,
) -> Result<(rodio::Decoder<TailSkip<R>>, bool), rodio::decoder::DecoderError> {
    // A sniff that fails leaves the reader wherever it stopped; the build
    // below then reports the same failure the old path would have.
    let (layout, head_len) = match byte_len {
        Some(_) => sniff_stream(&mut reader, byte_len).ok(),
        None => None,
    }
    .unwrap_or((HeadLayout { fragmented: false, trailing_mdat: None }, 0));
    let fragmented = layout.fragmented;
    let len = if fragmented { None } else { byte_len };
    let skippable = layout.trailing_mdat.zip(len);
    let reader = TailSkip::new(reader, skippable, head_len);
    let built = reader.build_done();
    let out = build_decoder(reader, len).map(|d| (d, fragmented));
    built();
    out
}

/// What `audio_seek` does with a seek.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum SeekPlan {
    /// Hand it to the decoder.
    InPlace(Duration),
    /// The decoder cannot go there (a forward-only track, backwards): load the
    /// track again, starting at this point.
    Reopen(Duration),
    /// Nothing can service it honestly (see `seek_target`).
    Refuse,
}

/// Decides a seek to `sec` in a track playing at `pos`.
///
/// A forward-only decoder asked to go back does not fail the seek, it fails
/// the NEXT packet ("packet out-of-bounds for a non-seekable stream"), which
/// rodio reports as the end of the track. So a backward seek there never
/// reaches it: the engine re-opens the stream at the target instead, which
/// costs one round trip and some bytes rather than the song.
pub(crate) fn plan_seek(total: Option<Duration>, forward_only: bool, pos: Duration, sec: f64) -> SeekPlan {
    match seek_target(total, sec) {
        None => SeekPlan::Refuse,
        Some(target) if forward_only && target < pos => SeekPlan::Reopen(target),
        Some(target) => SeekPlan::InPlace(target),
    }
}

/// Where a seek to `sec` should land, or `None` when the engine must refuse it.
///
/// rodio clamps every seek target to the decoder's total duration. A
/// fragmented mp4 (what the stream route proxies whenever its download failed)
/// carries no sample count, so the decoder reports ZERO: and then a seek to
/// 1:31 is clamped to 0, restarting the song instead of moving the playhead.
/// A zero total means "I don't know how long this is", so no seek can be
/// serviced honestly. An absent total is different: rodio clamps nothing then,
/// and the demuxer gets the real target.
// --- Load budgets -----------------------------------------------------------

/// How long the HOST gets to answer with response headers.
///
/// Deliberately the long one: the first play of a track has the host running
/// yt-dlp before it can send a byte, which legitimately takes tens of seconds.
/// Nothing has arrived yet, so there is no progress to judge it by.
const CONNECT_BUDGET: Duration = Duration::from_secs(25);

/// Longest silence allowed AFTER the headers, before the source is called dead.
///
/// Headers mean the bytes exist, a file on disk, or a live stream already
/// flowing, so a gap this long is a source that has stopped, not a slow one.
/// Every chunk resets it, so a weak link that keeps delivering is never cut
/// off by it; `PROGRESS_BUDGET` is what bounds that case.
const STALL_BUDGET: Duration = Duration::from_secs(3);

/// Backstop for everything after the headers while the download IS still
/// progressing: the old flat budget, kept for exactly that case.
const PROGRESS_BUDGET: Duration = Duration::from_secs(25);

/// The clocks one load runs on. A struct so a test can drive the real
/// `open_source` with short ones instead of waiting out the real budgets.
#[derive(Clone, Copy, Debug)]
pub(crate) struct LoadBudgets {
    pub connect: Duration,
    pub stall: Duration,
    pub progress: Duration,
}

impl LoadBudgets {
    /// What a real load uses.
    pub(crate) const DEFAULT: Self = Self {
        connect: CONNECT_BUDGET,
        stall: STALL_BUDGET,
        progress: PROGRESS_BUDGET,
    };
}

/// The clocks the playback watchdog runs on (see `judge_frozen`). A struct
/// so a test can run the real watchdog on short ones.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct PlayBudgets {
    /// A playhead stopped this long is looked at; shorter is a hiccup.
    pub frozen: Duration,
    /// A download that has brought nothing for this long, while the song
    /// waits on it, is dead. Shorter silences are what a slow link costs:
    /// every request a playing song makes (the rest of the body after the
    /// decoder read the tail, or `stream-download` asking again after 5 s
    /// without a chunk) waits behind whatever is already on its way.
    pub quiet: Duration,
    /// Longest a playhead may stand still while the download is still
    /// bringing bytes: past it the link is too slow to play from.
    pub buffering: Duration,
}

impl PlayBudgets {
    /// What real playback uses.
    pub(crate) const DEFAULT: Self = Self {
        frozen: Duration::from_secs(6),
        quiet: Duration::from_secs(20),
        buffering: Duration::from_secs(30),
    };
}

/// What a playhead that has not moved for `frozen` means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Frozen {
    /// Not long enough to say anything.
    Fine,
    /// The song is waiting on bytes the host is still sending.
    Buffering,
    /// The song is not going to move: report it (or open it again).
    Stalled,
}

/// The download a playing song reads from, as the watchdog sees it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DownloadView {
    /// Since the last chunk arrived.
    pub quiet: Duration,
    /// How long the reader has been waiting in a seek, if it is.
    pub seek_wait: Option<Duration>,
    /// The whole body is here.
    pub complete: bool,
    /// What a request gets to be answered (see `is_stalled_during`).
    pub request_grace: Duration,
}

impl DownloadProgress {
    pub(crate) fn view(&self) -> DownloadView {
        DownloadView {
            quiet: self.quiet_for(),
            seek_wait: self.seek_wait(),
            complete: self.is_complete(),
            request_grace: self.request_grace,
        }
    }
}

/// Judges a playhead that has stood still for `frozen` while playing.
///
/// It used to be one rule: 6 s without moving is a starved source, report
/// it, and the webview swaps the session to web audio. But a song that
/// started on the little its first response brought then waits on a new
/// request, and on a slow link that wait alone is longer than 6 s ("playback
/// stalled at 1.1s", Luka, 2026-10-02). So while the download behind the
/// song is still moving, the song is buffering, up to `buffering`. A song
/// with nothing left to download (a cached copy, a finished download) has no
/// such excuse and keeps the old rule.
pub(crate) fn judge_frozen(frozen: Duration, download: Option<DownloadView>, b: PlayBudgets) -> Frozen {
    if frozen < b.frozen {
        return Frozen::Fine;
    }
    match download {
        Some(d)
            if !d.complete
                && frozen < b.buffering
                && !is_stalled_during(d.quiet, d.seek_wait, false, b.quiet, d.request_grace) =>
        {
            Frozen::Buffering
        }
        _ => Frozen::Stalled,
    }
}

/// Why the engine stopped waiting for a source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LoadStop {
    /// Nothing has arrived for `STALL_BUDGET`: a dead source.
    Stalled,
    /// Bytes keep coming, but far too slowly to play.
    TooSlow,
    /// The reader jumped to bytes that had not arrived (the decoder reading
    /// the tail of a remuxed file), and the request for them was not answered
    /// within the connect budget.
    Unanswered,
}

/// Whether a source that has been quiet for `quiet` should be called dead.
///
/// `complete` means the whole body has already arrived, and then silence is
/// simply what a finished download sounds like: waiting on it is correct, so
/// nothing is a stall after that.
pub(crate) fn is_stalled(quiet: Duration, complete: bool, grace: Duration) -> bool {
    !complete && quiet > grace
}

/// `is_stalled`, for a reader that may be blocked in a seek: `seek_wait` is
/// how long it has been waiting there, if it is.
///
/// A seek to bytes that have not arrived is a NEW request, and until its
/// response starts nothing arrives, by design: the reader stops reading the
/// response it had while it waits. On a shared link that answer queues behind
/// every byte already in flight to this client, the old response's included,
/// so a silence far longer than `grace` is what a busy link looks like, not a
/// dead source (Luka, 2026-09-24: two loads of a 6 MB song, and the 64 KB tail
/// read waited more than 3 s, twice). The host's answer is judged like any
/// answer to a request, on `request_grace`, and from whichever is later: the
/// seek or the last chunk.
pub(crate) fn is_stalled_during(
    quiet: Duration,
    seek_wait: Option<Duration>,
    complete: bool,
    grace: Duration,
    request_grace: Duration,
) -> bool {
    match seek_wait {
        Some(waited) => !complete && quiet.min(waited) > request_grace.max(grace),
        None => is_stalled(quiet, complete, grace),
    }
}

/// When the download last moved, shared between `stream-download`'s progress
/// hook and the loader waiting on it.
pub(crate) struct DownloadProgress {
    started: std::time::Instant,
    /// Milliseconds after `started` at the most recent chunk.
    last_ms: AtomicU64,
    /// The body has arrived in full; nothing more is coming, by design.
    complete: AtomicBool,
    /// Stops the download task, captured from the first progress callback.
    ///
    /// Held as a closure rather than the token itself so this file needs no
    /// dependency on tokio-util just to name the type. It matters because
    /// giving up on a load only drops OUR future: the download task behind it
    /// carries on, reconnecting every few seconds forever (that is its retry
    /// behaviour), with a temp file and a thread to go with it.
    stop: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
    /// Milliseconds after `started` at which the reader began waiting in a
    /// seek, or `NOT_SEEKING` (see `SeekWatched`).
    seek_from_ms: AtomicU64,
    /// How long the host gets to answer the request a seek makes.
    request_grace: Duration,
}

const NOT_SEEKING: u64 = u64::MAX;

impl DownloadProgress {
    /// Starts the clock now, call it when the headers land, so the first
    /// chunk is measured from there and not from the request.
    pub(crate) fn started_now() -> Self {
        Self {
            started: std::time::Instant::now(),
            last_ms: AtomicU64::new(0),
            complete: AtomicBool::new(false),
            stop: Mutex::new(None),
            seek_from_ms: AtomicU64::new(NOT_SEEKING),
            request_grace: CONNECT_BUDGET,
        }
    }

    /// The same, giving the request a seek makes `grace` to be answered.
    pub(crate) fn with_request_grace(self, grace: Duration) -> Self {
        Self { request_grace: grace, ..self }
    }

    fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis().min(u64::from(u32::MAX) as u128) as u64
    }

    /// The reader is about to seek (see `SeekWatched`).
    pub(crate) fn seek_started(&self) {
        self.seek_from_ms.store(self.now_ms(), Ordering::SeqCst);
    }

    /// The seek has its bytes.
    pub(crate) fn seek_finished(&self) {
        self.seek_from_ms.store(NOT_SEEKING, Ordering::SeqCst);
    }

    /// How long the reader has been waiting in a seek, if it is.
    pub(crate) fn seek_wait(&self) -> Option<Duration> {
        match self.seek_from_ms.load(Ordering::SeqCst) {
            NOT_SEEKING => None,
            from => Some(Duration::from_millis(self.now_ms().saturating_sub(from))),
        }
    }

    /// Remember how to stop this download. The first caller wins; later ones
    /// are the same token again.
    pub(crate) fn on_stop(&self, stop: Box<dyn Fn() + Send + Sync>) {
        if let Ok(mut slot) = self.stop.lock() {
            slot.get_or_insert(stop);
        }
    }

    /// Stop the download, if anything has arrived to tell us how. A source
    /// that never sent a byte has nothing to cancel.
    pub(crate) fn stop_download(&self) {
        if let Ok(slot) = self.stop.lock() {
            if let Some(stop) = slot.as_ref() {
                stop();
            }
        }
    }

    /// One chunk processed. `complete` comes from the stream's phase.
    pub(crate) fn record(&self, complete: bool) {
        let ms = self.started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        self.last_ms.store(ms, Ordering::SeqCst);
        if complete {
            self.complete.store(true, Ordering::SeqCst);
        }
    }

    /// The whole body has arrived.
    pub(crate) fn is_complete(&self) -> bool {
        self.complete.load(Ordering::SeqCst)
    }

    /// How long the source has been silent.
    pub(crate) fn quiet_for(&self) -> Duration {
        self.started
            .elapsed()
            .saturating_sub(Duration::from_millis(self.last_ms.load(Ordering::SeqCst)))
    }

    pub(crate) fn is_stalled(&self, grace: Duration) -> bool {
        is_stalled_during(
            self.quiet_for(),
            self.seek_wait(),
            self.complete.load(Ordering::SeqCst),
            grace,
            self.request_grace,
        )
    }
}

/// A reader that tells `DownloadProgress` while it waits in a seek.
///
/// `StreamDownload::seek` to bytes it does not have yet sends a Range request
/// and blocks until the first of them arrive; a seek into bytes it has returns
/// at once. So "blocked in a seek" is exactly "waiting on the host to answer a
/// new request", which is judged on the request budget, not the stall one
/// (see `is_stalled_during`).
pub(crate) struct SeekWatched<R> {
    pub(crate) inner: R,
    pub(crate) progress: Arc<DownloadProgress>,
}

impl<R: Read> Read for SeekWatched<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.inner.read(buf)
    }
}

impl<R: Seek> Seek for SeekWatched<R> {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        self.progress.seek_started();
        let out = self.inner.seek(pos);
        self.progress.seek_finished();
        out
    }
}

/// Awaits `fut` for as long as the download keeps moving.
///
/// Gives up the moment the source has been quiet for `grace`, which is the
/// difference between a song that will not load and one that is merely slow,
/// and, for a source that IS delivering but far too slowly to be worth
/// waiting on, at `hard`.
///
/// Time the reader spends waiting in a seek does not count towards `hard`.
/// That wait is the host answering a new request (the decoder's read of the
/// tail of a remuxed file), which has its own budget (`request_grace`, see
/// `is_stalled_during`). Counted twice, a slow link ran out the clock while
/// the host was answering everything: "the song was still decoding after
/// 25s" (Luka, 2026-10-02, src/audio/slow_start.rs).
pub(crate) async fn while_progressing<F: std::future::Future>(
    fut: F,
    progress: &DownloadProgress,
    grace: Duration,
    hard: Duration,
) -> Result<F::Output, LoadStop> {
    tokio::pin!(fut);
    let mut deadline = tokio::time::Instant::now() + hard;
    let mut last_tick = tokio::time::Instant::now();
    let mut tick = tokio::time::interval(Duration::from_millis(100));
    loop {
        tokio::select! {
            out = &mut fut => return Ok(out),
            _ = tick.tick() => {
                let now = tokio::time::Instant::now();
                if progress.seek_wait().is_some() {
                    deadline += now - last_tick;
                }
                last_tick = now;
                if progress.is_stalled(grace) {
                    return Err(if progress.seek_wait().is_some() {
                        LoadStop::Unanswered
                    } else {
                        LoadStop::Stalled
                    });
                }
                if tokio::time::Instant::now() >= deadline {
                    return Err(LoadStop::TooSlow);
                }
            }
        }
    }
}

/// Settings for the temp-file-backed download, wired to report progress.
///
/// No prefetch. `stream-download` restarts its prefetch after every seek into
/// bytes it does not have yet, and the prefetch path never wakes the reader
/// waiting on that seek: a seek to a short range (the last 64 KB of a file,
/// which is exactly what the decoder reads while it is built) was answered
/// only when the linear download behind it reached the same spot, i.e. after
/// the WHOLE body. Measured on a cached 5.4 MB track at 1 MB/s: 7.4 s to a
/// decoder with the default 256 KB prefetch, 0.7 s without. The reader blocks
/// until its bytes are there either way, so the prefetch bought nothing.
pub(crate) fn download_settings(
    progress: Arc<DownloadProgress>,
) -> Settings<HttpStream<Client>> {
    Settings::default().prefetch_bytes(0).on_progress(move |_stream, state, cancel| {
        let cancel = cancel.clone();
        progress.on_stop(Box::new(move || cancel.cancel()));
        progress.record(matches!(state.phase, StreamPhase::Complete));
    })
}

fn seek_target(total: Option<Duration>, sec: f64) -> Option<Duration> {
    if total == Some(Duration::ZERO) {
        return None;
    }
    // A Duration cannot hold an absurd target (or infinity), and
    // `from_secs_f64` panics on one, which `panic = abort` makes a crash of
    // the whole app. NaN.max(0.0) is 0.
    Duration::try_from_secs_f64(sec.max(0.0)).ok()
}

/// Pure state mapping for the OS Now Playing widget (bughunt L5), factored
/// out of `set_nowplaying` so it can be unit tested without a real souvlaki
/// backend (headless test/CI machines have none, so `AudioEngine::controls`
/// is always `None` there). `pos` is `None` when nothing is loaded.
fn nowplaying_state(playing: bool, pos: Option<Duration>) -> MediaPlayback {
    let progress = pos.map(MediaPosition);
    if playing {
        MediaPlayback::Playing { progress }
    } else {
        MediaPlayback::Paused { progress }
    }
}

/// The reader a load decodes from: a temp-file-backed HTTP download that
/// remembers whether it ever failed.
type StreamReader = TailSkip<FailFlagged<SeekWatched<StreamDownload<TempStorageProvider>>>>;

/// A source that is ready to play.
pub(crate) struct OpenedSource {
    pub decoder: rodio::Decoder<StreamReader>,
    /// What the decoder says the track lasts, if it can say.
    pub total: Option<Duration>,
    /// Set if the stream dies later; the position timer reads it to tell a
    /// dead stream from a finished song.
    pub failed: Arc<AtomicBool>,
    /// Decoded forward-only (see `open_decoder`).
    pub forward_only: bool,
    /// Stops the download (see `AudioEngine::current_download`).
    pub stop: DownloadStop,
    /// How the download is going, for the playback watchdog.
    pub progress: Arc<DownloadProgress>,
}

/// Why a source could not be opened, in words the app log can print, plus
/// whether the webview should try this track again on web audio.
pub(crate) struct OpenError {
    pub message: String,
    pub retry: &'static str,
    /// The host answered and then went quiet. The one failure worth a second
    /// attempt on a fresh connection (see `open_source_retrying`).
    pub stalled: bool,
}

/// Connects to `url`, buffers enough of it, and builds the decoder.
///
/// The budgets are the point. Nothing downstream imposes one: `HttpStream::new`,
/// the prefetch and the decoder all wait forever on a source that has gone
/// quiet, and the position watchdog cannot help because no sink exists yet. One
/// flat 25s budget over all three (what this used to be) made EVERY unplayable
/// song cost the full 25s, because "the host is still downloading the song" and
/// "the host will never send anything" look identical until you measure
/// progress. So the host gets the long budget to answer at all, and once it
/// has, silence is judged in seconds while a download that keeps moving is left
/// alone.
pub(crate) async fn open_source(
    client: Client,
    url: &str,
    budgets: LoadBudgets,
) -> Result<OpenedSource, OpenError> {
    let host_error = |message: String| OpenError { message, retry: RETRY_NONE, stalled: false };
    let parsed = url.parse().map_err(|_| OpenError {
        message: "bad url".into(),
        retry: RETRY_WEB_AUDIO,
        stalled: false,
    })?;

    let stream = match tokio::time::timeout(budgets.connect, HttpStream::new(client, parsed)).await {
        Err(_) => {
            return Err(host_error(format!(
                "the host sent nothing for {}s",
                budgets.connect.as_secs()
            )))
        }
        Ok(Ok(s)) => s,
        // Includes a non-2xx status: the host answering "I cannot serve this
        // song" (which it now does promptly when a download fails) lands here,
        // and web audio would only ask the same server the same question.
        Ok(Err(e)) => return Err(host_error(format!("the host refused the song: {e}"))),
    };

    // From here the response has started, so every wait is judged on progress.
    let progress = Arc::new(DownloadProgress::started_now().with_request_grace(budgets.connect));
    let stalled = |stop: LoadStop, stage: &str| OpenError {
        stalled: matches!(stop, LoadStop::Stalled | LoadStop::Unanswered),
        ..host_error(load_stop_message(stop, stage, budgets))
    };

    let reader = match while_progressing(
        StreamDownload::from_stream(
            stream,
            TempStorageProvider::default(),
            download_settings(Arc::clone(&progress)),
        ),
        &progress,
        budgets.stall,
        budgets.progress,
    )
    .await
    {
        Err(stop) => {
            // Nothing else can reach this download now: our future is the only
            // handle on it, and we are dropping it.
            progress.stop_download();
            return Err(stalled(stop, "buffering"));
        }
        Ok(Ok(r)) => r,
        Ok(Err(e)) => return Err(host_error(format!("the stream could not be read: {e}"))),
    };

    // The length the HTTP response declared, so the decoder can be built
    // seekable (see build_decoder).
    let byte_len = reader.content_length();
    // Taken BEFORE the reader moves into the blocking task. Giving up on a
    // decode leaves that task blocked inside a read that will never return, and
    // a blocking task cannot be cancelled: cancelling the DOWNLOAD is what ends
    // it, so the thread (and the temp file behind it) are not held for the life
    // of the app.
    let download = reader.cancellation_token();
    // One flag per load: the reader sets it if the stream ever fails.
    let failed = Arc::new(AtomicBool::new(false));
    let reader = FailFlagged {
        inner: SeekWatched { inner: reader, progress: Arc::clone(&progress) },
        failed: Arc::clone(&failed),
    };

    // Fix 3: run blocking decoder I/O off the async runtime. Building the
    // decoder READS (a seekable one reads the tail as well), so it blocks on
    // the same download and is judged the same way.
    let (decoder, forward_only) = match while_progressing(
        tauri::async_runtime::spawn_blocking(move || open_decoder(reader, byte_len)),
        &progress,
        budgets.stall,
        budgets.progress,
    )
    .await
    {
        // Say "stopped arriving", not "unrecognized format", a misleading
        // error here sends whoever reads the log hunting for a codec problem.
        Err(stop) => {
            download.cancel();
            return Err(stalled(stop, "decoding"));
        }
        Ok(Ok(Ok(d))) => d,
        // Bytes arrived and this engine could not make sense of them: a format
        // rodio was not built for (the route also serves webm/opus) is exactly
        // what a browser does handle, so this one IS worth a retry there.
        Ok(Ok(Err(e))) => {
            return Err(OpenError {
                message: format!("this engine could not decode the song: {e}"),
                retry: RETRY_WEB_AUDIO,
                stalled: false,
            })
        }
        Ok(Err(e)) => {
            return Err(OpenError { message: e.to_string(), retry: RETRY_WEB_AUDIO, stalled: false })
        }
    };

    let total = {
        use rodio::Source;
        decoder.total_duration()
    };
    let stop: DownloadStop = Box::new(move || download.cancel());
    Ok(OpenedSource { decoder, total, failed, forward_only, stop, progress })
}

/// Why a load gave up waiting while it was `stage` ("decoding", ...), in the
/// words the app log and the webview get.
fn load_stop_message(stop: LoadStop, stage: &str, budgets: LoadBudgets) -> String {
    match stop {
        LoadStop::Stalled => format!(
            "the song stopped arriving while {stage} (nothing for {}s)",
            budgets.stall.as_secs()
        ),
        LoadStop::TooSlow => format!("the song was still {stage} after {}s", budgets.progress.as_secs()),
        LoadStop::Unanswered => format!(
            "the host did not answer a request for more of the song while {stage} (nothing for {}s)",
            budgets.connect.as_secs()
        ),
    }
}

/// Moves a STREAMED decoder to where its song starts, before it plays.
///
/// That seek usually lands past the bytes that have arrived (the engine
/// opening a stalled song again where it stopped, or a song resumed after a
/// restart), so it is a Range request, and the decoder waits on it. Through
/// the sink, as it used to be done, that wait had no clock at all: the load
/// sat inside rodio's `try_seek` before its sink was in, so no watchdog
/// looked at it either, and a host that did not answer left the song
/// loading forever with nothing said. Here it is judged like the open
/// itself (`while_progressing`), and a seek the decoder refuses is left for
/// the sink's own seek to meet, as before.
async fn seek_streamed(
    decoder: Box<dyn rodio::Source + Send>,
    target: Duration,
    progress: &DownloadProgress,
    budgets: LoadBudgets,
) -> Result<Box<dyn rodio::Source + Send>, String> {
    let task = tauri::async_runtime::spawn_blocking(move || {
        let mut decoder = decoder;
        let _ = decoder.try_seek(target);
        decoder
    });
    match while_progressing(task, progress, budgets.stall, budgets.progress).await {
        Ok(Ok(decoder)) => Ok(decoder),
        Ok(Err(e)) => Err(e.to_string()),
        Err(stop) => Err(load_stop_message(
            stop,
            &format!("seeking to {:.1}s", target.as_secs_f64()),
            budgets,
        )),
    }
}

/// `open_source`, with one more attempt when the first one STALLED.
///
/// A stall is the host answering and then going quiet, which on a relayed
/// connection is as often a hiccup as a dead source. Before this it ended the
/// load on the spot ("Couldn't load"), and the only way to try again was to
/// click the song again. The second attempt is a new request, so the stream
/// route resolves the song afresh. Anything else (a refusal, a host that never
/// answered, a link far too slow) would fail the same way twice, so it is
/// reported at once, as before. `still_wanted` stops a retry for a load the
/// listener has already moved on from; `on_retry` gets the first failure.
pub(crate) async fn open_source_retrying(
    client: Client,
    url: &str,
    budgets: LoadBudgets,
    still_wanted: impl Fn() -> bool,
    on_retry: impl FnOnce(&str),
) -> Result<OpenedSource, OpenError> {
    match open_source(client.clone(), url, budgets).await {
        Err(first) if first.stalled && still_wanted() => {
            on_retry(&first.message);
            open_source(client, url, budgets).await.map_err(|again| OpenError {
                message: format!("{} (on a second attempt, after: {})", again.message, first.message),
                ..again
            })
        }
        other => other,
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // the webview's invoke arguments, one each
pub async fn audio_load<R: Runtime>(
    app: AppHandle<R>,
    engine: State<'_, AudioEngine>,
    url: String,
    autoplay: bool,
    start_at: f64,
    cookie: Option<String>,
    cache_key: Option<String>,
    token: Option<u64>,
) -> Result<(), String> {
    if let Ok(mut t) = engine.asked_token.lock() {
        *t = token;
    }
    // A song the webview asks for gets its own native retry after a stall.
    engine.stall_retried.store(false, Ordering::SeqCst);
    load_track(&app, engine.inner(), url, autoplay, start_at, cookie, cache_key).await
}

/// A decoder over a file in the auto cache (see cache.rs).
///
/// Seekable, with the file's length: a local seek costs nothing, so the
/// forward-only treatment streamed fragmented bodies get is not needed.
pub(crate) type CachedDecoder = rodio::Decoder<FailFlagged<std::io::BufReader<std::fs::File>>>;

pub(crate) fn open_cached(
    path: &std::path::Path,
) -> Result<(CachedDecoder, Option<Duration>, Arc<AtomicBool>), String> {
    let file = std::fs::File::open(path).map_err(|e| format!("could not open the cached copy: {e}"))?;
    let len = file.metadata().map_err(|e| format!("could not read the cached copy: {e}"))?.len();
    let failed = Arc::new(AtomicBool::new(false));
    let reader = FailFlagged { inner: std::io::BufReader::new(file), failed: Arc::clone(&failed) };
    let decoder = build_decoder(reader, Some(len))
        .map_err(|e| format!("the cached copy could not be decoded: {e}"))?;
    let total = {
        use rodio::Source;
        decoder.total_duration()
    };
    Ok((decoder, total, failed))
}

/// The cached file for `cache_key`, when the auto cache has one.
fn cached_path_for<R: Runtime>(app: &AppHandle<R>, cache_key: Option<&str>) -> Option<(String, std::path::PathBuf)> {
    use tauri::Manager;
    let key = cache_key?;
    let cache = app.try_state::<crate::cache::AudioCache>()?;
    cache.path_for(key).map(|p| (key.to_string(), p))
}

/// Whether `url` is something the streaming path can fetch. The web side may
/// send `cache:<id>` instead of a URL for a cached track (see tauriAdapter.ts).
fn is_http_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

/// What `audio_load` does, callable from inside the engine as well: a
/// backward seek in a forward-only track re-opens the track through here.
///
/// `cache_key` is the Ember track id. When the auto cache holds it, the song
/// plays from that file (online or not: it is instant and costs no data);
/// otherwise, or when the file cannot be decoded, it streams `url`.
async fn load_track<R: Runtime>(
    app: &AppHandle<R>,
    engine: &AudioEngine,
    url: String,
    autoplay: bool,
    start_at: f64,
    cookie: Option<String>,
    cache_key: Option<String>,
) -> Result<(), String> {
    // Claim the load BEFORE any slow work, so a newer request can supersede
    // this one even if this one finishes later.
    let my_seq = engine.begin_load(autoplay);
    load_claimed(app, engine, my_seq, url, autoplay, start_at, cookie, cache_key).await
}

/// Starts a load from a sync command: claimed here, run in the background.
/// A sync command runs on the main thread, and a load takes a round trip.
fn spawn_load<R: Runtime>(
    app: &AppHandle<R>,
    engine: &AudioEngine,
    track: Requested,
    autoplay: bool,
) {
    let (url, cookie, start_at, cache_key) = track;
    let seq = engine.begin_load(autoplay);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri::Manager;
        let engine = app.state::<AudioEngine>();
        let _ = load_claimed(&app, engine.inner(), seq, url, autoplay, start_at, cookie, cache_key).await;
    });
}

/// The load itself, for a ticket `begin_load` has already taken.
#[allow(clippy::too_many_arguments)]
async fn load_claimed<R: Runtime>(
    app: &AppHandle<R>,
    engine: &AudioEngine,
    my_seq: u64,
    url: String,
    autoplay: bool,
    start_at: f64,
    cookie: Option<String>,
    cache_key: Option<String>,
) -> Result<(), String> {
    let _settled = Settled(&engine.settled_seq, my_seq);
    // A load started in the background can be overtaken before it runs;
    // silencing then would cut off the newer one.
    if !engine.is_current_load(my_seq) {
        return Ok(());
    }
    engine.silence_current();
    // A re-open or a retry is the same song the webview asked for last.
    let token = engine.asked_token.lock().ok().and_then(|t| *t);
    if let Ok(mut r) = engine.requested.lock() {
        *r = Some((url.clone(), cookie.clone(), start_at, cache_key.clone()));
    }
    log_audio(
        app,
        "INFO",
        &format!("load #{my_seq} start_at={start_at:.1} autoplay={autoplay} url={url}"),
    );
    {
        use tauri::Manager;
        if let Some(cache) = app.try_state::<crate::cache::AudioCache>() {
            cache.set_playing(cache_key.clone());
        }
    }

    // The auto cache first. A copy that will not open is deleted (it would
    // fail the same way next time) and the song streams instead, once.
    let mut stream_url = url.clone();
    let mut from_cache = None;
    if let Some((key, path)) = cached_path_for(app, cache_key.as_deref()) {
        let opened = tauri::async_runtime::spawn_blocking(move || open_cached(&path))
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
        match opened {
            Ok(o) => {
                use tauri::Manager;
                if let Some(cache) = app.try_state::<crate::cache::AudioCache>() {
                    cache.touch(&key);
                }
                log_audio(app, "INFO", &format!("load #{my_seq} from the auto cache ({key})"));
                from_cache = Some(o);
            }
            Err(e) => {
                use tauri::Manager;
                if let Some(cache) = app.try_state::<crate::cache::AudioCache>() {
                    if !is_http_url(&stream_url) {
                        if let Some(source) = cache.source_url(&key) {
                            stream_url = source;
                        }
                    }
                    let _ = cache.evict(std::slice::from_ref(&key));
                }
                log_audio(
                    app,
                    "WARN",
                    &format!("load #{my_seq} cached copy of {key} unusable ({e}); deleted it, streaming instead"),
                );
            }
        }
    } else if !is_http_url(&stream_url) {
        // A `cache:<id>` request whose copy has gone since the page looked
        // (cleared, evicted): stream from where that copy came from, if known.
        use tauri::Manager;
        if let Some(source) = cache_key
            .as_deref()
            .and_then(|k| app.try_state::<crate::cache::AudioCache>().and_then(|c| c.source_url(k)))
        {
            stream_url = source;
        }
    }

    // Everything from "connect" to "we have a decoder", with the budgets that
    // keep a dead source from costing half a minute (see `open_source`).
    //
    // A failure there is REPORTED through `audio:error` and then returns Ok:
    // that event carries the retry decision the webview needs, and an Err as
    // well would race a second, less informed report through invoke()'s catch.
    type Playable = (
        Box<dyn rodio::Source + Send>,
        Option<Duration>,
        Arc<AtomicBool>,
        bool,
        Option<DownloadStop>,
        Option<Arc<DownloadProgress>>,
    );
    let opened: Result<Playable, OpenError> = match from_cache {
        Some((decoder, total, failed)) => Ok((Box::new(decoder), total, failed, false, None, None)),
        None if !is_http_url(&stream_url) => Err(OpenError {
            message: "the song is not in the cache and has no stream URL".into(),
            retry: RETRY_NONE,
            stalled: false,
        }),
        None => {
            let client = http_client(session_cookie_for_app(app, &stream_url, cookie.clone()).as_deref())?;
            open_source_retrying(
                client,
                &stream_url,
                LoadBudgets::DEFAULT,
                || engine.is_current_load(my_seq),
                |first| log_audio(app, "WARN", &format!("load #{my_seq} {first}; trying once more")),
            )
            .await
            .map(|o| {
                let OpenedSource { decoder, total, failed, forward_only, stop, progress } = o;
                let source: Box<dyn rodio::Source + Send> = Box::new(decoder);
                (source, total, failed, forward_only, Some(stop), Some(progress))
            })
        }
    };
    let opened = match opened {
        Ok(o) => o,
        Err(e) => {
            log_audio(app, "WARN", &format!("load #{my_seq} {}", e.message));
            // The webview pins every `audio:error` on the song it has now, so
            // the failure of a song the listener already moved on from would
            // stop (or swap the engine under) the one that is playing.
            if !engine.is_current_load(my_seq) {
                log_audio(app, "INFO", &format!("load #{my_seq} superseded, failure not reported"));
                return Ok(());
            }
            // Tagged, so the webview can tell it from a failure of a load it
            // has sent since and the engine has not claimed yet.
            emit_err_about(app, e.retry, e.message, token);
            return Ok(());
        }
    };
    let (decoder, total, failed, forward_only, stop, progress) = opened;

    // Someone asked for a different track while this one was downloading,
    // discard it silently rather than yanking playback back.
    if !engine.is_current_load(my_seq) {
        log_audio(app, "INFO", &format!("load #{my_seq} superseded, discarded"));
        return Ok(());
    }

    // A seek pressed while this was on its way wins over where it was asked
    // to start (D2): the slider already shows it.
    let early_seek = engine.pending_seek.lock().ok().and_then(|mut p| p.take());
    let start_at = early_seek.unwrap_or(start_at);
    // Same guard as audio_seek: a decoder that reports no length would
    // clamp this to 0, so resuming a proxied track just starts it over.
    let start = if start_at > 1.0 { seek_target(total, start_at) } else { None };
    // A streamed song goes there before it plays, on the load's clocks (see
    // `seek_streamed`); a cached one seeks in its file, at once.
    let decoder = match (start, progress.as_deref()) {
        (Some(target), Some(watch)) => match seek_streamed(decoder, target, watch, LoadBudgets::DEFAULT).await {
            Ok(d) => d,
            Err(message) => {
                if let Some(stop) = &stop {
                    stop();
                }
                log_audio(app, "WARN", &format!("load #{my_seq} {message}"));
                if !engine.is_current_load(my_seq) {
                    if let (Some(sec), Ok(mut p)) = (early_seek, engine.pending_seek.lock()) {
                        p.get_or_insert(sec);
                    }
                    log_audio(app, "INFO", &format!("load #{my_seq} superseded, failure not reported"));
                    return Ok(());
                }
                // The engine's own second try at a stalled song: the webview
                // must not try natively again.
                if engine.stall_retried.load(Ordering::SeqCst) {
                    emit_stall(app, message, token);
                } else {
                    emit_err_about(app, RETRY_NONE, message, token);
                }
                return Ok(());
            }
        },
        _ => decoder,
    };

    // Fix 1: bump the generation BEFORE storing the new sink so that the
    // previous position-timer can never observe the new sink under the old
    // generation number.
    let my_gen = engine.generation.fetch_add(1, Ordering::SeqCst) + 1;

    let sink = Arc::new(engine.new_sink()?);
    // Held paused until play or pause is decided below: a new sink starts
    // playing, so the start of the song (and on a slow run, far more of it)
    // sounded before the seek to where it resumes, or before a launch load
    // meant to stay paused was paused.
    sink.pause();
    // Through the equalizer, which passes the samples through untouched
    // while it is off.
    // Repeat one loops the song in here, from the bytes already loaded
    // (src/repeat.rs). A forward-only stream cannot go back: it ends, and the
    // webview opens it again.
    let clock = Arc::new(crate::repeat::LoopClock::default());
    let looping = crate::repeat::Looping::new(
        decoder,
        Arc::clone(&engine.repeat_one),
        Arc::clone(&failed),
        !forward_only,
        Arc::clone(&clock),
    );
    sink.append(crate::eq::Equalized::new(looping, Arc::clone(&engine.eq)));
    // Through the sink as well, so its position reads from there. A streamed
    // decoder is already there (above), so this costs no request.
    if let Some(target) = start {
        let _ = sink.try_seek(target);
    }
    // Play or pause as the listener wants NOW: a pause pressed while this
    // load was on its way used to be dropped (there was no sink to pause),
    // and the song started anyway.
    let (playing, late_seek) = {
        let mut slot = engine.sink.lock().map_err(|_| "lock")?;
        // Checked again under the lock: a stop or a newer load that came in
        // since the check above would otherwise get this sink anyway.
        if !engine.is_current_load(my_seq) {
            // A seek taken above may have been meant for the load that
            // overtook this one: hand it back.
            if let (Some(sec), Ok(mut p)) = (early_seek, engine.pending_seek.lock()) {
                p.get_or_insert(sec);
            }
            return Ok(());
        }
        let playing = engine.want_play.load(Ordering::SeqCst);
        if playing {
            sink.play();
        } else {
            sink.pause();
        }
        if let Ok(mut c) = engine.loop_clock.lock() {
            *c = Arc::clone(&clock);
        }
        *slot = Some(Arc::clone(&sink));
        // Settled now, under the lock, rather than when this function
        // returns: a seek in between would find a load "in flight", be kept
        // for it, and never be taken.
        engine.settled_seq.fetch_max(my_seq, Ordering::SeqCst);
        if let Ok(mut t) = engine.installed_token.lock() {
            *t = token;
        }
        if let Ok(mut d) = engine.current_download.lock() {
            *d = stop;
        }
        // A seek that came in after the start was decided and before the
        // sink went in found nothing to seek either.
        (playing, engine.pending_seek.lock().ok().and_then(|mut p| p.take()))
    };
    // What was actually asked of the host, so a backward seek in a
    // forward-only track re-opens the same thing (a cached track is never
    // forward-only). The same as `url` unless that was a `cache:` request.
    *engine.current_url.lock().map_err(|_| "lock")? = Some(stream_url);
    *engine.current_cookie.lock().map_err(|_| "lock")? = cookie;
    engine.forward_only.store(forward_only, Ordering::SeqCst);
    *engine.current_total.lock().map_err(|_| "lock")? = total;
    *engine.source_failed.lock().map_err(|_| "lock")? = Arc::clone(&failed);

    log_audio(
        app,
        "INFO",
        &format!(
            "load #{my_seq} playing (duration={:.0}s volume={:.2}{})",
            total.map(|d| d.as_secs_f64()).unwrap_or(0.0),
            engine.volume(),
            if forward_only { " forward-only" } else { "" }
        ),
    );
    if let Some(d) = total {
        emit_sec(app, "audio:duration", d.as_secs_f64(), token);
    }
    // Refresh the OS widget's metadata now that this song's length is known
    // (bughunt L5): audio_set_metadata usually ran before this point. Also
    // when the length is unknown: metadata set just before this load went
    // out with the previous song's length, which must not stay on the widget.
    engine.push_metadata();
    if playing {
        use tauri::Emitter;
        let _ = app.emit("audio:play", TokenPayload { token });
    }
    engine.set_nowplaying(playing);

    let (sink_arc, generation) = engine.inner_arc();
    spawn_position_timer(app.clone(), sink_arc, generation, my_gen, Arc::clone(&failed), clock, token, progress);
    if let Some(sec) = late_seek {
        // Planned like any seek: a backward one in a forward-only track
        // cannot be done in place (it would end the song), it re-opens.
        match plan_seek(total, forward_only, engine.track_pos(&sink), sec) {
            SeekPlan::InPlace(target) => seek_in_place(app, engine, sink, failed, target, token),
            SeekPlan::Reopen(target) => {
                let url = engine.current_url.lock().ok().and_then(|g| g.clone());
                let cookie = engine.current_cookie.lock().ok().and_then(|g| g.clone());
                if let Some(url) = url {
                    spawn_load(app, engine, (url, cookie, target.as_secs_f64(), None), playing);
                }
            }
            SeekPlan::Refuse => {}
        }
    }
    Ok(())
}

/// Marks a load finished, however it ends.
struct Settled<'a>(&'a AtomicU64, u64);

impl Drop for Settled<'_> {
    fn drop(&mut self) {
        self.0.fetch_max(self.1, Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn audio_play<R: Runtime>(app: AppHandle<R>, engine: State<'_, AudioEngine>) {
    let Ok(g) = engine.sink.lock() else { return };
    engine.want_play.store(true, Ordering::SeqCst);
    let requested = || engine.requested.lock().ok().and_then(|r| r.clone());
    let retry = match g.as_ref() {
        Some(s) if !s.empty() => {
            s.play();
            None
        }
        // The load honours this when its sink goes in.
        _ if engine.load_in_flight() => None,
        // The song played to its end (the last one in the queue): a used-up
        // sink plays nothing, so play said "playing" over silence (D1). A
        // browser starts the song again from the top; so does this.
        Some(_) => match requested() {
            Some((url, cookie, _, key)) => Some((url, cookie, 0.0, key)),
            None => return,
        },
        // The last load failed and nothing is loaded: play used to do nothing
        // at all here, so the song could only be started again by clicking it.
        None => match requested() {
            Some(track) => Some(track),
            None => return,
        },
    };
    drop(g);
    emit_bare(&app, "audio:play");
    // Outside the sink lock: set_nowplaying takes the controls lock.
    engine.set_nowplaying(true);
    if let Some(track) = retry {
        log_audio(&app, "INFO", &format!("play with nothing to play: loading {} again", track.0));
        spawn_load(&app, engine.inner(), track, true);
    }
}

#[tauri::command]
pub fn audio_pause<R: Runtime>(app: AppHandle<R>, engine: State<'_, AudioEngine>) {
    let acted = match engine.sink.lock() {
        Ok(g) => {
            engine.want_play.store(false, Ordering::SeqCst);
            match g.as_ref() {
                Some(s) => {
                    s.pause();
                    true
                }
                // Kept for the load in flight (see `want_play`).
                None => engine.load_in_flight(),
            }
        }
        Err(_) => false,
    };
    if acted {
        emit_bare(&app, "audio:pause");
        engine.set_nowplaying(false);
    }
}

#[tauri::command]
pub fn audio_stop(engine: State<'_, AudioEngine>) {
    // Stop outranks a load in flight, as a newer load would: stop pressed
    // while a song was on its way had no sink to stop, so the song started.
    // Settled at once, so play and pause see nothing loading.
    let seq = engine.claim_load();
    engine.settled_seq.fetch_max(seq, Ordering::SeqCst);
    // Bumping the generation also stops the active position timer.
    engine.generation.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut guard) = engine.sink.lock() {
        engine.want_play.store(false, Ordering::SeqCst);
        if let Ok(mut p) = engine.pending_seek.lock() {
            *p = None;
        }
        if let Some(sink) = guard.take() {
            sink.stop();
        }
    }
    engine.stop_download();
    if let Ok(mut u) = engine.current_url.lock() {
        *u = None;
    }
    // A stopped player has nothing for play to pick up again.
    if let Ok(mut r) = engine.requested.lock() {
        *r = None;
    }
    engine.forward_only.store(false, Ordering::SeqCst);
    if let Ok(mut d) = engine.current_total.lock() {
        *d = None;
    }
    engine.set_playback(MediaPlayback::Stopped);
}

#[tauri::command]
pub fn audio_seek<R: Runtime>(app: AppHandle<R>, engine: State<'_, AudioEngine>, sec: f64) {
    let total = engine.current_total.lock().ok().and_then(|g| *g);
    let forward_only = engine.forward_only.load(Ordering::SeqCst);
    let loaded = {
        let Ok(g) = engine.sink.lock() else { return };
        if engine.load_in_flight() {
            // A load is on its way, and whatever sink is in now (a re-open
            // that has not started yet leaves the old one) is about to go.
            // Dropping the seek started the song at 0:00 with the slider
            // snapping back (D2); the load starts where this asks instead.
            if let Ok(mut p) = engine.pending_seek.lock() {
                *p = Some(sec.max(0.0));
            }
            return;
        }
        g.as_ref().map(|s| (Arc::clone(s), engine.track_pos(s), !s.is_paused(), s.empty()))
    };
    let Some((sink, pos, playing, spent)) = loaded else { return };
    // A sink that has played its source to the end has nothing left to seek
    // in: rodio accepts the seek and does nothing. That is how "repeat one"
    // (a seek to 0 and a play, on `audio:ended`) restarted the song into
    // silence. Loading the track again is the only way back into it.
    let plan = if spent {
        Duration::try_from_secs_f64(sec.max(0.0)).map_or(SeekPlan::Refuse, SeekPlan::Reopen)
    } else {
        plan_seek(total, forward_only, pos, sec)
    };
    let target = match plan {
        SeekPlan::InPlace(target) => target,
        SeekPlan::Refuse => {
            // Refuse rather than restart the song from 0 (see seek_target).
            // The position timer's next tick puts the slider back where the
            // audio is.
            log_audio(
                &app,
                "WARN",
                &format!("refused a seek to {sec:.1}s: the decoder reports no duration for this track, or the target is out of range"),
            );
            return;
        }
        SeekPlan::Reopen(target) => {
            // A spent track re-opens what was asked for, cache key included,
            // so a song played from the auto cache comes from that copy again
            // (its `cache:` request is not something the stream path can fetch).
            // A forward-only track is always a streamed one: no cache key.
            let reopen = if spent {
                engine
                    .requested
                    .lock()
                    .ok()
                    .and_then(|r| r.clone())
                    .map(|(url, cookie, _, key)| (url, cookie, key))
            } else {
                let url = engine.current_url.lock().ok().and_then(|g| g.clone());
                let cookie = engine.current_cookie.lock().ok().and_then(|g| g.clone());
                url.map(|u| (u, cookie, None))
            };
            let Some((url, cookie, cache_key)) = reopen else { return };
            let why = if spent { "after the track ran out" } else { "back in a forward-only stream" };
            log_audio(&app, "INFO", &format!("seek to {sec:.1}s {why}: re-opening it there"));
            // A spent sink is not paused, but the player it belongs to has
            // stopped: it plays again only if play is pressed (repeat one does,
            // right after this seek), as a browser does after the end.
            let autoplay = if spent { engine.want_play.load(Ordering::SeqCst) } else { playing };
            spawn_load(&app, engine.inner(), (url, cookie, target.as_secs_f64(), cache_key), autoplay);
            return;
        }
    };
    let failed = engine.source_failed.lock().map(|f| Arc::clone(&f)).unwrap_or_default();
    let token = engine.installed_token.lock().ok().and_then(|t| *t);
    seek_in_place(&app, engine.inner(), sink, failed, target, token);
}

/// Hands a seek to the decoder, off the calling thread.
///
/// rodio's `try_seek` waits for the audio thread to carry the seek out, and
/// the decoder there waits on the host for any bytes it has not got: a Range
/// request, seconds on a slow link. `audio_seek` is a sync command, which
/// tauri runs on the main thread, so the whole window froze for that long
/// (D3). The seek now waits on a blocking thread of its own, and reports
/// back only if its sink is still the one loaded.
fn seek_in_place<R: Runtime>(
    app: &AppHandle<R>,
    engine: &AudioEngine,
    sink: Arc<Sink>,
    failed: Arc<AtomicBool>,
    target: Duration,
    token: Option<u64>,
) {
    engine.seek_generation.store(engine.generation.load(Ordering::SeqCst), Ordering::SeqCst);
    engine.seeks_running.fetch_add(1, Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let result = sink.try_seek(target);
        let engine = app.state::<AudioEngine>();
        engine.seeks_running.fetch_sub(1, Ordering::SeqCst);
        let current = engine
            .sink
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|s| Arc::ptr_eq(s, &sink)))
            .unwrap_or(false);
        if !current {
            return;
        }
        match result {
            Ok(()) => {
                emit_sec(&app, "audio:time", target.as_secs_f64(), token); // optimistic
                // The OS widget's scrubber runs on from the last position it
                // was sent, so it has to hear about a seek too. Playing or
                // not as the sink is NOW: a pause may have come in while the
                // seek waited on the host.
                engine.set_nowplaying(!sink.is_paused());
            }
            // A seek the decoder cannot service leaves the source unable to
            // read its next packet, which rodio reports as the end of the
            // track. Discarding this error is what turned a drag of the
            // slider into "play the next song"; surfacing it lets the
            // webview keep the song and retry it on web audio.
            Err(e) => {
                // Mark the source failed as well, so the position timer does
                // not call the resulting empty sink an end of track a tick later.
                failed.store(true, Ordering::SeqCst);
                let sec = target.as_secs_f64();
                log_audio(&app, "WARN", &format!("seek to {sec:.1}s failed: {e}"));
                emit_err_about(&app, RETRY_WEB_AUDIO, format!("seek failed: {e}"), token);
            }
        }
    });
}

#[tauri::command]
pub fn audio_set_volume(engine: State<'_, AudioEngine>, amplitude: f32) {
    // Stored as well as applied: rodio volume lives on the SINK, and the next
    // track gets a brand new one. rodio amplifies above 1.0, preserving party
    // mode.
    engine.set_volume(amplitude);
}

/// The equalizer (src/eq.rs): on or off and the five band gains in dB
/// (60 Hz, 230 Hz, 910 Hz, 3.6 kHz, 14 kHz), each held to -12..+12. The
/// engine adds its own pre-amp so a boost cannot clip. Desktop builds before
/// this command reject it as unknown; the webview ignores that.
#[tauri::command]
pub fn audio_set_eq(engine: State<'_, AudioEngine>, enabled: bool, bands: Vec<f32>) {
    engine.set_eq(crate::eq::EqSettings::from_command(enabled, &bands));
}

/// Repeat one (loop-one, or loop-all over a single song), from the webview.
/// On, the song playing goes back to the top by itself when it ends, from
/// what is already loaded, and no `audio:ended` is sent (src/repeat.rs).
/// Desktop builds before this command reject it as unknown; the webview then
/// repeats the old way, on `audio:ended`.
#[tauri::command]
pub fn audio_set_loop(engine: State<'_, AudioEngine>, one: bool) {
    engine.repeat_one.store(one, Ordering::SeqCst);
}

// --- OS media controls (souvlaki) -------------------------------------------

/// Initialize OS media controls and route their transport-button presses to the
/// webview as `audio:cmd` events. Call ONCE at app setup (main thread).
///
/// macOS uses Now Playing, Linux MPRIS, Windows SMTC. Windows is the awkward
/// one: SMTC is attached to a window, so souvlaki needs the HWND, and its
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
            // The souvlaki callback runs on its own thread, only emit to the
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
    if let Ok(mut m) = engine.nowplaying_meta.lock() {
        *m = Some((title, artist, album, artwork_url));
    }
    engine.push_metadata();
}

// --- Position timer + end detection -----------------------------------------

#[allow(clippy::too_many_arguments)]
fn spawn_position_timer<R: Runtime>(
    app: AppHandle<R>,
    sink: SharedSink,
    generation: Arc<AtomicU64>,
    my_gen: u64,
    failed: Arc<AtomicBool>,
    clock: Arc<crate::repeat::LoopClock>,
    token: Option<u64>,
    progress: Option<Arc<DownloadProgress>>,
) {
    tauri::async_runtime::spawn(async move {
        const TICK: Duration = Duration::from_millis(250);
        let mut interval = tokio::time::interval(TICK);
        // Stall watchdog. A sink can be un-paused and non-empty yet produce no
        // sound: the source is a blocking HTTP read, and if it starves, cpal
        // gets no samples and get_pos() freezes. It looks to the user like the
        // song simply won't play, with no error anywhere. Rather than sit
        // there, the song is opened again once and, if that stalls too,
        // reported so the webview can fall back to web audio. A song whose
        // download is still moving is buffering, not stalled (`judge_frozen`).
        let budgets = {
            use tauri::Manager;
            app.state::<AudioEngine>().play_budgets
        };
        let mut said_buffering = false;
        let mut last_pos = f64::NAN;
        let mut stalled_for: u32 = 0;
        // A seek holds the reports back for at most this long (25 s, the
        // budget a host gets to answer any request): one that never returns
        // (an output device that stopped pulling samples) must not switch
        // the watchdog off for good.
        const SEEK_TICKS: u32 = 100;
        let mut seeking_for: u32 = 0;

        loop {
            interval.tick().await;
            if generation.load(Ordering::SeqCst) != my_gen {
                break; // superseded by a newer load / stop
            }
            let seeking = {
                use tauri::Manager;
                let engine = app.state::<AudioEngine>();
                engine.seeks_running.load(Ordering::SeqCst) > 0
                    && engine.seek_generation.load(Ordering::SeqCst) == my_gen
            };
            let (pos, empty, paused) = {
                let g = match sink.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                match g.as_ref() {
                    Some(s) => (clock.track_pos(s.get_pos()).as_secs_f64(), s.empty(), s.is_paused()),
                    None => break,
                }
            };
            if seeking && !empty && seeking_for < SEEK_TICKS {
                // The position is the one being left, and a seek waiting on
                // the host is not a starved source (see `seeks_running`).
                seeking_for += 1;
                stalled_for = 0;
                last_pos = f64::NAN;
                continue;
            }
            if !seeking {
                seeking_for = 0;
            }
            emit_sec(&app, "audio:time", pos, token);
            if empty {
                // The player has stopped (D1): play or a seek from here
                // starts the song again, and only play makes it sound.
                {
                    use tauri::Manager;
                    let engine = app.state::<AudioEngine>();
                    // Not when a newer load has begun: it set want_play for
                    // itself (under this lock) before it bumped the generation.
                    if let Ok(_g) = sink.lock() {
                        if generation.load(Ordering::SeqCst) == my_gen && !engine.load_in_flight() {
                            engine.want_play.store(false, Ordering::SeqCst);
                        }
                    };
                }
                // An empty sink means the SOURCE ran out, which happens both
                // when the song finished and when the stream under it died ,
                // rodio cannot tell those apart, so the flag does. Saying
                // "ended" for a failure is what made the player skip to the
                // next song in the middle of this one.
                if failed.load(Ordering::SeqCst) {
                    log_audio(
                        &app,
                        "WARN",
                        &format!("the stream failed at {pos:.1}s: reporting an error, not the end"),
                    );
                    emit_err_about(&app, RETRY_WEB_AUDIO, format!("the stream stopped at {pos:.1}s"), token);
                } else {
                    {
                        use tauri::Emitter;
                        let _ = app.emit("audio:ended", TokenPayload { token });
                    }
                    // Tell the OS widget too (bughunt L5): a track that ran
                    // out on its own left it stuck on "Playing" forever,
                    // since only the explicit audio_stop command used to set
                    // Stopped. If the webview loads another track right
                    // after, that load's own set_nowplaying supersedes this;
                    // if this was the end of the queue, it now says so.
                    use tauri::Manager;
                    app.state::<AudioEngine>().set_playback(MediaPlayback::Stopped);
                }
                break;
            }

            if paused {
                stalled_for = 0; // paused on purpose is not a stall
            } else if pos == last_pos {
                stalled_for += 1;
                let download = progress.as_ref().map(|p| p.view());
                match judge_frozen(TICK * stalled_for, download, budgets) {
                    Frozen::Fine => {}
                    Frozen::Buffering => {
                        if !said_buffering {
                            said_buffering = true;
                            log_audio(
                                &app,
                                "INFO",
                                &format!("waiting at {pos:.1}s for the host to send more of the song"),
                            );
                        }
                    }
                    Frozen::Stalled => {
                        use tauri::Manager;
                        let engine = app.state::<AudioEngine>();
                        if retry_after_stall(&app, engine.inner(), pos, download) {
                            break;
                        }
                        log_audio(
                            &app,
                            "WARN",
                            &format!("playback stalled at {pos:.1}s, source starved, giving up"),
                        );
                        emit_stall(&app, format!("playback stalled at {pos:.1}s"), token);
                        break;
                    }
                }
            } else {
                stalled_for = 0;
                said_buffering = false;
            }
            last_pos = pos;
        }
    });
}

/// Opens a song that stalled while playing again, natively, where it
/// stopped: once per song the webview asked for. Returns whether it did.
///
/// Only a song whose download had not finished: a fresh request is what
/// helps a link that queued the old one. A song with every byte already
/// here (a cached copy, a finished download) would only stall again, and is
/// reported at once, as before. Nor while a newer load is on its way: that
/// one is what the listener wants now.
fn retry_after_stall<R: Runtime>(
    app: &AppHandle<R>,
    engine: &AudioEngine,
    pos: f64,
    download: Option<DownloadView>,
) -> bool {
    let downloading = download.is_some_and(|d| !d.complete);
    if !downloading || engine.load_in_flight() || engine.stall_retried.swap(true, Ordering::SeqCst) {
        return false;
    }
    let Some((url, cookie, _, cache_key)) = engine.requested.lock().ok().and_then(|r| r.clone()) else {
        return false;
    };
    log_audio(
        app,
        "WARN",
        &format!("playback stalled at {pos:.1}s waiting on the host; opening the song again here once"),
    );
    spawn_load(app, engine, (url, cookie, pos, cache_key), true);
    true
}

#[cfg(test)]
mod skip_repro;
#[cfg(test)]
mod fastfail;
#[cfg(test)]
mod stall_repro;
#[cfg(test)]
mod luka_repro;
#[cfg(test)]
mod one_request;
#[cfg(test)]
mod slow_start;
// Needs tauri's `test` feature, which is off on Windows (see Cargo.toml).
#[cfg(all(test, not(windows)))]
mod transport_repro;
// Same: drives `audio_load` on the mock app.
#[cfg(all(test, not(windows)))]
mod cache_play;
// Same: drives `audio_load` and `audio_set_eq` on the mock app.
#[cfg(all(test, not(windows)))]
mod eq_play;

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
    /// the next song at rodio's default 1.0, full blast. The volume set
    /// BEFORE anything is loaded was discarded entirely.
    #[test]
    fn volume_survives_track_changes() {
        let engine = AudioEngine::new_degraded();
        assert_eq!(engine.volume(), 1.0, "fresh engine should be unity gain");

        // Set with nothing playing, the old code dropped this on the floor.
        engine.set_volume(0.2);
        assert!((engine.volume() - 0.2).abs() < f32::EPSILON);

        // Whatever a later load builds its sink with, it reads this value.
        engine.set_volume(0.45);
        assert!((engine.volume() - 0.45).abs() < f32::EPSILON);
    }

    /// The equalizer is kept on the engine, not on a sink, so it holds from
    /// one song to the next; a fresh engine starts with it off.
    #[test]
    fn the_equalizer_survives_track_changes() {
        let engine = AudioEngine::new_degraded();
        assert!(!engine.eq().enabled);
        engine.set_eq(crate::eq::EqSettings::from_command(true, &[3.0, 0.0, 0.0, 0.0, -2.0]));
        engine.silence_current();
        assert_eq!(engine.eq(), crate::eq::EqSettings::from_command(true, &[3.0, 0.0, 0.0, 0.0, -2.0]));
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

    /// The webview's seconds come in unchecked, and a Duration cannot hold
    /// an absurd one: `from_secs_f64` panicked, and with `panic = abort` in
    /// release a single bad seek closed the app. Refused instead.
    #[test]
    fn an_absurd_seek_is_refused_not_a_crash() {
        let total = Some(Duration::from_secs(120));
        assert_eq!(plan_seek(total, false, Duration::ZERO, 1e300), SeekPlan::Refuse);
        assert_eq!(plan_seek(None, true, Duration::from_secs(5), f64::INFINITY), SeekPlan::Refuse);
        assert_eq!(seek_target(total, f64::NAN), Some(Duration::ZERO));
        assert_eq!(seek_target(total, -4.0), Some(Duration::ZERO));
    }

    #[test]
    fn the_only_load_in_flight_is_current() {
        let engine = AudioEngine::new_degraded();
        let seq = engine.claim_load();
        assert!(engine.is_current_load(seq));
    }

    /// A cached copy opens as a seekable decoder that knows the song's
    /// length. Runs everywhere, Windows included (no mock app needed).
    #[test]
    fn a_cached_file_opens_seekable_with_its_duration() {
        let dir = crate::cache::tests::TempDir::new("open-cached");
        let path = dir.0.join("song.bin");
        std::fs::write(&path, include_bytes!("../test-fixtures/tone-faststart.m4a")).expect("write");
        let (_decoder, total, failed) = open_cached(&path).expect("opens");
        let secs = total.map(|d| d.as_secs_f64()).unwrap_or(0.0);
        assert!((119.0..=121.0).contains(&secs), "duration {secs}");
        assert!(!failed.load(Ordering::SeqCst));
    }

    #[test]
    fn an_unreadable_cached_file_is_an_error_not_a_panic() {
        let dir = crate::cache::tests::TempDir::new("open-garbage");
        let garbage = dir.0.join("garbage.bin");
        std::fs::write(&garbage, [0u8; 4096]).expect("write");
        assert!(open_cached(&garbage).is_err());
        assert!(open_cached(&dir.0.join("missing.bin")).is_err());
    }

    #[test]
    fn only_http_urls_reach_the_streaming_path() {
        assert!(is_http_url("http://h/api/youtube/stream/a"));
        assert!(is_http_url("https://h/api/uploads/x/stream"));
        assert!(!is_http_url("cache:youtube:a"));
        assert!(!is_http_url("file:///etc/passwd"));
    }

    // bughunt L5: the OS Now Playing widget got Playing/Paused with no
    // position, so it had no scrubber. `nowplaying_state` is the pure
    // mapping `set_nowplaying` delegates to; tested directly since a real
    // souvlaki backend is unavailable on headless test machines.
    #[test]
    fn nowplaying_state_carries_position_when_playing() {
        let got = nowplaying_state(true, Some(Duration::from_secs(42)));
        assert_eq!(
            got,
            MediaPlayback::Playing { progress: Some(MediaPosition(Duration::from_secs(42))) }
        );
    }

    #[test]
    fn nowplaying_state_carries_position_when_paused() {
        let got = nowplaying_state(false, Some(Duration::from_millis(1500)));
        assert_eq!(
            got,
            MediaPlayback::Paused { progress: Some(MediaPosition(Duration::from_millis(1500))) }
        );
    }

    #[test]
    fn nowplaying_state_has_no_position_when_nothing_is_loaded() {
        assert_eq!(nowplaying_state(false, None), MediaPlayback::Paused { progress: None });
    }

    /// A Jamendo song's stream URL is Jamendo's own (absolute, third party).
    /// The session cookie is for the Ember server only: sending it with every
    /// song handed the user's pb_auth token to Jamendo's servers.
    #[test]
    fn the_session_goes_only_to_the_ember_server() {
        let server = tauri::Url::parse("https://ember.example.ts.net").unwrap();
        let cookie = || Some("pb_auth=secret".to_string());
        let on = |url: &str| session_cookie_for(url, Some(&server), cookie());
        assert_eq!(on("https://ember.example.ts.net/api/uploads/x/stream").as_deref(), Some("pb_auth=secret"));
        assert_eq!(on("https://EMBER.example.ts.net:443/api/youtube/stream/abc?prefetch=1").as_deref(), Some("pb_auth=secret"));
        assert_eq!(on("https://prod-1.storage.jamendo.com/?trackid=1&format=mp31"), None);
        assert_eq!(on("http://ember.example.ts.net/api/x"), None, "another scheme is another origin");
        assert_eq!(on("https://ember.example.ts.net:8443/api/x"), None, "another port is another origin");
        assert_eq!(on("https://ember.example.ts.net.evil.com/api/x"), None);
        assert_eq!(on("not a url"), None);
        assert_eq!(session_cookie_for("https://ember.example.ts.net/a", None, cookie()), None, "no known server, no cookie");
        assert_eq!(session_cookie_for("https://ember.example.ts.net/a", Some(&server), None), None);
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
