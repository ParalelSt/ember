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

use std::io::{Read, Seek};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
use stream_download::{Settings, StreamDownload, StreamPhase};
use tauri::{AppHandle, Runtime, State};

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
    /// The newest load that has finished, installed or failed. A load is in
    /// flight while this trails `load_seq`.
    settled_seq: AtomicU64,
    /// Play or pause, as the listener last asked. A load in flight has no
    /// sink to act on, so play and pause set this and the load honours it when
    /// its sink goes in, rather than the autoplay it was started with. Written
    /// and read under the `sink` lock.
    want_play: AtomicBool,
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
    /// What the decoder said the loaded track lasts. Read by `audio_seek`:
    /// rodio clamps every seek target to this figure, so a decoder that
    /// reports zero (a fragmented mp4, which is what the stream route proxies
    /// when its download failed) would turn every seek into a seek to 0.
    current_total: Mutex<Option<Duration>>,
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
            settled_seq: AtomicU64::new(0),
            want_play: AtomicBool::new(false),
            requested: Mutex::new(None),
            current_url: Mutex::new(None),
            current_cookie: Mutex::new(None),
            forward_only: AtomicBool::new(false),
            current_total: Mutex::new(None),
            source_failed: Mutex::new(Arc::new(AtomicBool::new(false))),
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
            settled_seq: AtomicU64::new(0),
            want_play: AtomicBool::new(false),
            requested: Mutex::new(None),
            current_url: Mutex::new(None),
            current_cookie: Mutex::new(None),
            forward_only: AtomicBool::new(false),
            current_total: Mutex::new(None),
            source_failed: Mutex::new(Arc::new(AtomicBool::new(false))),
            volume: Mutex::new(1.0),
            controls: Mutex::new(None),
        }
    }

    /// An engine that plays into `mixer` instead of a device: the tests pull
    /// its samples themselves, the way the output device would.
    #[cfg(test)]
    pub(crate) fn with_output(mixer: Mixer) -> Self {
        Self { mixer: Some(mixer), ..Self::new_degraded() }
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
        self.forward_only.store(false, Ordering::SeqCst);
        if let Ok(mut d) = self.current_total.lock() {
            *d = None;
        }
    }

    /// Whether this load is still the newest one. A load that lost the race
    /// must throw its work away rather than install a stale sink.
    pub fn is_current_load(&self, seq: u64) -> bool {
        self.load_seq.load(Ordering::SeqCst) == seq
    }

    /// Whether the newest load is still connecting, buffering or decoding.
    fn load_in_flight(&self) -> bool {
        self.settled_seq.load(Ordering::SeqCst) < self.load_seq.load(Ordering::SeqCst)
    }

    /// Shared handles for the position-polling task.
    fn inner_arc(&self) -> (Arc<Mutex<Option<Sink>>>, Arc<AtomicU64>) {
        (Arc::clone(&self.sink), Arc::clone(&self.generation))
    }
}

/// A load as it was asked for: url, cookie, start, cache key.
type Requested = (String, Option<String>, f64, Option<String>);

// --- Event payloads ---------------------------------------------------------

#[derive(Clone, Serialize)]
struct SecPayload {
    sec: f64,
}
/// Whether the webview should try this track again on web audio.
///
/// `WEB_AUDIO` is anything this engine could not do with bytes it did get (no
/// output device, a codec rodio lacks): a browser may well manage. `NONE` is
/// the host refusing or failing to deliver the song at all — the browser would
/// ask the same server for the same bytes and wait all over again, and the
/// swap costs the whole session its OS media keys. Reported so the webview can
/// tell the two apart instead of falling back on every error.
const RETRY_WEB_AUDIO: &str = "web-audio";
const RETRY_NONE: &str = "none";

#[derive(Clone, Serialize)]
struct ErrPayload {
    message: String,
    retry: &'static str,
}
/// An OS media-button press forwarded to the webview. `kind` is one of
/// play/pause/toggle/next/prev/seek; `sec` is set only for seek.
#[derive(Clone, Serialize)]
struct CmdPayload {
    kind: &'static str,
    sec: Option<f64>,
}

fn emit_sec<R: Runtime>(app: &AppHandle<R>, event: &str, sec: f64) {
    use tauri::Emitter;
    let _ = app.emit(event, SecPayload { sec });
}
fn emit_bare<R: Runtime>(app: &AppHandle<R>, event: &str) {
    use tauri::Emitter;
    let _ = app.emit(event, ());
}
/// Write a line into the app log from the audio engine.
///
/// Playback faults here are intermittent and timing-dependent — the kind that
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
    use tauri::Emitter;
    let _ = app.emit("audio:error", ErrPayload { message, retry });
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
pub(crate) fn sniff_fragmented(head: &[u8]) -> Option<bool> {
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
    loop {
        let (size, kind, header) = atom_at(pos)?;
        if pos == 0 && &kind != b"ftyp" {
            return Some(false);
        }
        if size < header as u64 {
            // Zero ("to the end") or a corrupt size: nothing after it to find.
            return Some(false);
        }
        match &kind {
            b"moof" | b"sidx" => return Some(true),
            b"mdat" => return Some(false),
            b"moov" => {
                // An mvex (movie extends) child is what declares fragments.
                let end = pos.checked_add(usize::try_from(size).ok()?)?;
                let body = head.get(pos + header..end)?;
                let mut child = 0usize;
                while let Some(h) = body.get(child..child + 8) {
                    if &h[4..8] == b"mvex" {
                        return Some(true);
                    }
                    let len = u32::from_be_bytes([h[0], h[1], h[2], h[3]]) as usize;
                    if len < 8 {
                        break;
                    }
                    child += len;
                }
            }
            _ => {}
        }
        pos = pos.checked_add(usize::try_from(size).ok()?)?;
    }
}

/// Reads the head of `reader` until `sniff_fragmented` can decide, then puts
/// the reader back at the start. Reads only forwards, so it never asks the
/// host for anything but the bytes already on their way.
fn is_fragmented_stream<R: Read + Seek>(reader: &mut R) -> std::io::Result<bool> {
    /// A moov for a long remuxed track is ~130 KB; past this, give up and
    /// treat the body the way every body used to be treated.
    const MAX_HEAD: usize = 2 * 1024 * 1024;
    let mut head = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    let verdict = loop {
        if let Some(v) = sniff_fragmented(&head) {
            break v;
        }
        if head.len() >= MAX_HEAD {
            break false;
        }
        let n = reader.read(&mut chunk)?;
        if n == 0 {
            break false;
        }
        head.extend_from_slice(&chunk[..n]);
    };
    reader.seek(std::io::SeekFrom::Start(0))?;
    Ok(verdict)
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
/// other body keeps the seekable decoder, whose walk costs one short read.
pub(crate) fn open_decoder<R: Read + Seek + Send + Sync + 'static>(
    mut reader: R,
    byte_len: Option<u64>,
) -> Result<(rodio::Decoder<R>, bool), rodio::decoder::DecoderError> {
    // A sniff that fails leaves the reader wherever it stopped; the build
    // below then reports the same failure the old path would have.
    let fragmented = byte_len.is_some() && is_fragmented_stream(&mut reader).unwrap_or(false);
    let len = if fragmented { None } else { byte_len };
    build_decoder(reader, len).map(|d| (d, fragmented))
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
/// Headers mean the bytes exist — a file on disk, or a live stream already
/// flowing — so a gap this long is a source that has stopped, not a slow one.
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
    /// Starts the clock now — call it when the headers land, so the first
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
/// Gives up the moment the source has been quiet for `grace` — which is the
/// difference between a song that will not load and one that is merely slow —
/// and, for a source that IS delivering but far too slowly to be worth
/// waiting on, at `hard`.
pub(crate) async fn while_progressing<F: std::future::Future>(
    fut: F,
    progress: &DownloadProgress,
    grace: Duration,
    hard: Duration,
) -> Result<F::Output, LoadStop> {
    tokio::pin!(fut);
    let deadline = tokio::time::Instant::now() + hard;
    let mut tick = tokio::time::interval(Duration::from_millis(100));
    loop {
        tokio::select! {
            out = &mut fut => return Ok(out),
            _ = tick.tick() => {
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
    Some(Duration::from_secs_f64(sec.max(0.0)))
}

/// The reader a load decodes from: a temp-file-backed HTTP download that
/// remembers whether it ever failed.
type StreamReader = FailFlagged<SeekWatched<StreamDownload<TempStorageProvider>>>;

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
        ..host_error(match stop {
            LoadStop::Stalled => format!(
                "the song stopped arriving while {stage} (nothing for {}s)",
                budgets.stall.as_secs()
            ),
            LoadStop::TooSlow => {
                format!("the song was still {stage} after {}s", budgets.progress.as_secs())
            }
            LoadStop::Unanswered => format!(
                "the host did not answer a request for more of the song while {stage} (nothing for {}s)",
                budgets.connect.as_secs()
            ),
        })
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
        // Say "stopped arriving", not "unrecognized format" — a misleading
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
    Ok(OpenedSource { decoder, total, failed, forward_only })
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
pub async fn audio_load<R: Runtime>(
    app: AppHandle<R>,
    engine: State<'_, AudioEngine>,
    url: String,
    autoplay: bool,
    start_at: f64,
    cookie: Option<String>,
    cache_key: Option<String>,
) -> Result<(), String> {
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
    let my_seq = engine.claim_load();
    let _settled = Settled(&engine.settled_seq, my_seq);
    engine.silence_current();
    if let Ok(_sink) = engine.sink.lock() {
        engine.want_play.store(autoplay, Ordering::SeqCst);
    }
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
    type Playable = (Box<dyn rodio::Source + Send>, Option<Duration>, Arc<AtomicBool>, bool);
    let opened: Result<Playable, OpenError> = match from_cache {
        Some((decoder, total, failed)) => Ok((Box::new(decoder), total, failed, false)),
        None if !is_http_url(&stream_url) => Err(OpenError {
            message: "the song is not in the cache and has no stream URL".into(),
            retry: RETRY_NONE,
            stalled: false,
        }),
        None => {
            let client = http_client(cookie.as_deref())?;
            open_source_retrying(
                client,
                &stream_url,
                LoadBudgets::DEFAULT,
                || engine.is_current_load(my_seq),
                |first| log_audio(app, "WARN", &format!("load #{my_seq} {first}; trying once more")),
            )
            .await
            .map(|o| {
                let OpenedSource { decoder, total, failed, forward_only } = o;
                let source: Box<dyn rodio::Source + Send> = Box::new(decoder);
                (source, total, failed, forward_only)
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
            emit_err(app, e.retry, e.message);
            return Ok(());
        }
    };
    let (decoder, total, failed, forward_only) = opened;

    // Someone asked for a different track while this one was downloading —
    // discard it silently rather than yanking playback back.
    if !engine.is_current_load(my_seq) {
        log_audio(app, "INFO", &format!("load #{my_seq} superseded, discarded"));
        return Ok(());
    }

    // Fix 1: bump the generation BEFORE storing the new sink so that the
    // previous position-timer can never observe the new sink under the old
    // generation number.
    let my_gen = engine.generation.fetch_add(1, Ordering::SeqCst) + 1;

    let sink = engine.new_sink()?;
    sink.append(decoder);
    if start_at > 1.0 {
        // Same guard as audio_seek: a decoder that reports no length would
        // clamp this to 0, so resuming a proxied track just starts it over.
        if let Some(target) = seek_target(total, start_at) {
            let _ = sink.try_seek(target);
        }
    }
    // Play or pause as the listener wants NOW: a pause pressed while this
    // load was on its way used to be dropped (there was no sink to pause),
    // and the song started anyway.
    let playing = {
        let mut slot = engine.sink.lock().map_err(|_| "lock")?;
        let playing = engine.want_play.load(Ordering::SeqCst);
        if playing {
            sink.play();
        } else {
            sink.pause();
        }
        *slot = Some(sink);
        playing
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
        emit_sec(app, "audio:duration", d.as_secs_f64());
    }
    if playing {
        emit_bare(app, "audio:play");
    }
    engine.set_nowplaying(playing);

    let (sink_arc, generation) = engine.inner_arc();
    spawn_position_timer(app.clone(), sink_arc, generation, my_gen, failed);
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
    let retry = match g.as_ref() {
        Some(s) => {
            s.play();
            None
        }
        // The load honours this when its sink goes in.
        None if engine.load_in_flight() => None,
        // The last load failed and nothing is loaded: play used to do nothing
        // at all here, so the song could only be started again by clicking it.
        None => match engine.requested.lock().ok().and_then(|r| r.clone()) {
            Some(track) => Some(track),
            None => return,
        },
    };
    drop(g);
    emit_bare(&app, "audio:play");
    // Outside the sink lock: set_nowplaying takes the controls lock.
    engine.set_nowplaying(true);
    if let Some((url, cookie, start_at, cache_key)) = retry {
        log_audio(&app, "INFO", &format!("play with nothing loaded: loading {url} again"));
        // Off this thread, as in audio_seek.
        tauri::async_runtime::spawn(async move {
            use tauri::Manager;
            let engine = app.state::<AudioEngine>();
            let _ = load_track(&app, engine.inner(), url, true, start_at, cookie, cache_key).await;
        });
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
    // A stopped player has nothing for play to pick up again.
    if let Ok(mut r) = engine.requested.lock() {
        *r = None;
    }
    engine.forward_only.store(false, Ordering::SeqCst);
    if let Ok(mut d) = engine.current_total.lock() {
        *d = None;
    }
}

#[tauri::command]
pub fn audio_seek<R: Runtime>(app: AppHandle<R>, engine: State<'_, AudioEngine>, sec: f64) {
    let total = engine.current_total.lock().ok().and_then(|g| *g);
    let forward_only = engine.forward_only.load(Ordering::SeqCst);
    let (pos, playing, spent) = engine
        .sink
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| (s.get_pos(), !s.is_paused(), s.empty())))
        .unwrap_or((Duration::ZERO, false, false));
    // A sink that has played its source to the end has nothing left to seek
    // in: rodio accepts the seek and does nothing. That is how "repeat one"
    // (a seek to 0 and a play, on `audio:ended`) restarted the song into
    // silence. Loading the track again is the only way back into it.
    let plan = if spent {
        SeekPlan::Reopen(Duration::from_secs_f64(sec.max(0.0)))
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
                &format!("refused a seek to {sec:.1}s: the decoder reports no duration for this track"),
            );
            return;
        }
        SeekPlan::Reopen(target) => {
            let url = engine.current_url.lock().ok().and_then(|g| g.clone());
            let cookie = engine.current_cookie.lock().ok().and_then(|g| g.clone());
            let Some(url) = url else { return };
            let why = if spent { "after the track ran out" } else { "back in a forward-only stream" };
            log_audio(&app, "INFO", &format!("seek to {sec:.1}s {why}: re-opening it there"));
            // Off this thread: a load takes a round trip, and a sync command
            // runs on the main thread.
            tauri::async_runtime::spawn(async move {
                use tauri::Manager;
                let engine = app.state::<AudioEngine>();
                // No cache key: only a streamed track is ever forward-only.
                let _ = load_track(&app, engine.inner(), url, playing, target.as_secs_f64(), cookie, None)
                    .await;
            });
            return;
        }
    };
    let mut error = None;
    if let Ok(g) = engine.sink.lock() {
        if let Some(s) = g.as_ref() {
            match s.try_seek(target) {
                // A seek the decoder cannot service leaves the source unable to
                // read its next packet, which rodio reports as the end of the
                // track. Discarding this error is what turned a drag of the
                // slider into "play the next song"; surfacing it lets the
                // webview keep the song and retry it on web audio.
                Err(e) => error = Some(e.to_string()),
                Ok(()) => emit_sec(&app, "audio:time", target.as_secs_f64()), // optimistic
            }
        }
    }
    if let Some(message) = error {
        // Mark the source failed as well, so the position timer does not call
        // the resulting empty sink an end of track a tick later.
        if let Ok(f) = engine.source_failed.lock() {
            f.store(true, Ordering::SeqCst);
        }
        log_audio(&app, "WARN", &format!("seek to {sec:.1}s failed: {message}"));
        emit_err(&app, RETRY_WEB_AUDIO, format!("seek failed: {message}"));
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

fn spawn_position_timer<R: Runtime>(
    app: AppHandle<R>,
    sink: Arc<Mutex<Option<Sink>>>,
    generation: Arc<AtomicU64>,
    my_gen: u64,
    failed: Arc<AtomicBool>,
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
                    emit_err(&app, RETRY_WEB_AUDIO, format!("the stream stopped at {pos:.1}s"));
                } else {
                    emit_bare(&app, "audio:ended");
                }
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
                    emit_err(&app, RETRY_WEB_AUDIO, format!("playback stalled at {pos:.1}s"));
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
mod skip_repro;
#[cfg(test)]
mod fastfail;
#[cfg(test)]
mod stall_repro;
#[cfg(test)]
mod luka_repro;
// Needs tauri's `test` feature, which is off on Windows (see Cargo.toml).
#[cfg(all(test, not(windows)))]
mod transport_repro;
// Same: drives `audio_load` on the mock app.
#[cfg(all(test, not(windows)))]
mod cache_play;

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
