// Ember desktop: choosing the audio output device.
//
// Before this file the engine opened the system default output once, at
// launch, and played into that device's own mixer for the rest of the
// session. Plugging in headphones, picking a Bluetooth speaker or unplugging
// a USB DAC changed nothing: the app stayed on whatever was the default when
// it started, or went silent when that device disappeared.
//
// The design, in one paragraph: every song still plays into ONE mixer, but
// that mixer now belongs to this file (the "master" mixer) instead of to a
// device. A device stream gets a `Tap`, a never-ending source that pulls the
// master's samples on the device's behalf. Switching devices opens a stream
// on the new device with a new tap, hands the master over to that tap, and
// drops the old stream. The sinks never notice: they are connected to the
// master, which never changes, so the song's position, its volume, the
// equalizer and loudness normalization all carry across a switch untouched.
//
// A router thread owns the device side. A cpal stream is `!Send`, so it has
// to live on one thread for its whole life; the router is that thread, and
// everything else talks to it over a channel (see `OutputRouter`).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use rodio::mixer::{Mixer, MixerSource};
use rodio::{ChannelCount, SampleRate, Source};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::audio::AudioEngine;

/// What the webview gets back for a machine with no native audio at all (a
/// degraded engine) when it asks to switch.
const NO_OUTPUT: &str = "no audio output device on this machine";

/// What an unknown device id is refused with.
const NO_SUCH_DEVICE: &str = "no such output device";

/// The file the chosen device is kept in, inside the app config dir.
const FILE_NAME: &str = "audio-output.json";

/// The master format when the default device cannot tell us its own.
const FALLBACK_FORMAT: (ChannelCount, SampleRate) = (2, 48_000);

/// How long a caller waits on the router before giving up on it. Opening a
/// stream on a sleepy Bluetooth device can take a second or two; far longer
/// than that means the router thread is gone, and a command must not hang
/// the webview's promise forever.
const REPLY_TIMEOUT: Duration = Duration::from_secs(15);

// --- What the webview sees ---------------------------------------------------

/// One output device, as the webview lists it.
///
/// cpal 0.16 has no stable device id, so the id IS the name, with a
/// " (2)"-style suffix for a second device of the same name (two identical
/// USB headsets, say). The suffix follows enumeration order, which is stable
/// for as long as the same devices are plugged in; `name` carries the same
/// suffix so the list can tell the two apart as well.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// Everything the output picker needs: what exists, what is playing now, and
/// what the listener chose (`None` meaning "follow the system default").
///
/// `active` can name a device that is not in the enumeration: ALSA hides a
/// device another program holds open, and on Linux that includes ours. It is
/// added to `devices` in that case, so the picker can still highlight it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputsSnapshot {
    pub devices: Vec<OutputDevice>,
    pub active: Option<String>,
    pub preferred: Option<String>,
}

/// Gives each name an id, suffixing repeats (see `OutputDevice`), and marks
/// the default. When the default's name appears twice there is no way to
/// tell which of the two cpal meant, so the first one is marked.
pub(crate) fn label_devices(names: &[String], default_name: Option<&str>) -> Vec<OutputDevice> {
    let mut used: HashSet<String> = HashSet::new();
    let mut default_marked = false;
    names
        .iter()
        .map(|name| {
            let mut id = name.clone();
            let mut n = 2;
            while used.contains(&id) {
                id = format!("{name} ({n})");
                n += 1;
            }
            used.insert(id.clone());
            let is_default = !default_marked && Some(name.as_str()) == default_name;
            default_marked |= is_default;
            OutputDevice { id: id.clone(), name: id, is_default }
        })
        .collect()
}

/// ALSA PCMs that hand the audio to the desktop sound server, best first.
const SERVER_PCMS: [&str; 2] = ["pipewire", "pulse"];

/// ALSA's own default PCM, which cpal reports as the default device.
const ALSA_DEFAULT: &str = "default";

/// The device that stands for "the system default". cpal's ALSA default is
/// the "default" PCM, which is the sound card itself on a machine without
/// pipewire-alsa: playing there bypasses the output the desktop has chosen
/// and fails with "busy" while the sound server holds the card. A listed
/// sound-server PCM is the desktop's real default, so on ALSA (`alsa`) it
/// wins. Elsewhere the host's own default stands.
pub(crate) fn default_device_name<'a>(names: &'a [String], host_default: Option<&'a str>, alsa: bool) -> Option<&'a str> {
    if alsa {
        let server = SERVER_PCMS.iter().find_map(|pcm| names.iter().find(|n| n.as_str() == *pcm));
        if let Some(name) = server {
            return Some(name.as_str());
        }
    }
    host_default
}

/// The order to try devices in when opening the system default: the
/// default, then the sound-server PCMs, then ALSA's "default", then the rest
/// as listed (a machine whose default will not open should still play
/// somewhere, and through the sound server before the bare hardware).
pub(crate) fn default_order(devices: &[OutputDevice]) -> Vec<usize> {
    let rank = |d: &OutputDevice| -> usize {
        if d.is_default {
            0
        } else if let Some(i) = SERVER_PCMS.iter().position(|p| *p == d.id) {
            1 + i
        } else if d.id == ALSA_DEFAULT {
            1 + SERVER_PCMS.len()
        } else {
            2 + SERVER_PCMS.len()
        }
    };
    let mut order: Vec<usize> = (0..devices.len()).collect();
    order.sort_by_key(|&i| rank(&devices[i]));
    order
}

/// Opens the first candidate that will open. When none does, the error
/// names every device and why, not just the first.
pub(crate) fn open_first<D, S>(
    candidates: Vec<(String, D)>,
    mut open: impl FnMut(D) -> Result<S, String>,
) -> Result<(String, S), String> {
    let mut errors = Vec::new();
    for (label, device) in candidates {
        match open(device) {
            Ok(stream) => return Ok((label, stream)),
            Err(e) => errors.push(format!("{label}: {e}")),
        }
    }
    if errors.is_empty() {
        Err("no output device to open".to_string())
    } else {
        Err(errors.join("; "))
    }
}

// --- The tap -----------------------------------------------------------------

/// The master mixer's output, shared by every tap.
type SharedMaster = Arc<Mutex<MixerSource>>;

/// A device stream's view of the master mixer.
///
/// Two rodio facts shape it. A `MixerSource` with nothing in it returns
/// `None`, and a device mixer DROPS any source that returns `None`: so a tap
/// that passed the master's `None` through would be thrown away the first
/// time nothing was playing, and the next song would be silent. A tap
/// therefore never ends; where the master has nothing, it plays silence.
///
/// Only the ACTIVE tap pulls from the master. During a switch two streams
/// are open for a moment, and if both pulled they would split the song
/// between them, each playing every other slice of it. An inactive tap plays
/// silence without touching the master, so the song is never consumed by a
/// device that is on its way out.
///
/// It pulls a whole frame (one sample per channel) at a time, under the
/// master's lock, and checks that it is the active tap under that same lock.
/// A hand-over can then only happen between frames: the master's own frame
/// counter stays in step with the frames it hands out, and left and right
/// cannot swap on the new device.
pub struct Tap {
    id: u64,
    master: SharedMaster,
    /// The id of the tap allowed to pull, shared with the router.
    active: Arc<AtomicU64>,
    channels: ChannelCount,
    sample_rate: SampleRate,
    /// The frame being played out, and how far into it.
    frame: Vec<f32>,
    at: usize,
}

impl Tap {
    fn new(id: u64, master: SharedMaster, active: Arc<AtomicU64>, channels: ChannelCount, sample_rate: SampleRate) -> Self {
        let frame = vec![0.0; usize::from(channels.max(1))];
        let at = frame.len();
        Self { id, master, active, channels, sample_rate, frame, at }
    }

    fn is_active(&self) -> bool {
        self.active.load(Ordering::SeqCst) == self.id
    }

    fn refill(&mut self) {
        self.at = 0;
        // Checked once without the lock, so a tap on its way out does not
        // contend with the live one for every frame, then again under it.
        if self.is_active() {
            let mut master = self.master.lock().unwrap_or_else(PoisonError::into_inner);
            if self.is_active() {
                // Every slot is asked for, `None` or not, so the master's
                // frame counter moves by exactly one frame.
                for slot in self.frame.iter_mut() {
                    *slot = master.next().unwrap_or(0.0);
                }
                return;
            }
        }
        self.frame.fill(0.0);
    }
}

impl Iterator for Tap {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.at >= self.frame.len() {
            self.refill();
        }
        let sample = self.frame[self.at];
        self.at += 1;
        Some(sample)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (usize::MAX, None)
    }
}

impl Source for Tap {
    fn current_span_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> ChannelCount {
        self.channels
    }

    fn sample_rate(&self) -> SampleRate {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

// --- Devices -----------------------------------------------------------------

/// Called by a device stream when its device goes away.
pub type OnLost = Box<dyn FnMut() + Send>;

/// Everything the router needs from the machine's audio devices, behind a
/// trait so the tests can stand in a fake machine whose "device" is the test
/// itself pulling samples from the tap.
pub trait OutputBackend: Send + 'static {
    /// The output devices there are now, labelled (see `label_devices`).
    fn devices(&self) -> Vec<OutputDevice>;

    /// The system default device's own channel count and sample rate, if it
    /// can say. The master mixer runs at this, so the default path plays
    /// without a resampling step it did not have before.
    fn default_format(&self) -> Option<(ChannelCount, SampleRate)>;

    /// Opens a stream on `id` (`None` = the system default) that plays `tap`,
    /// calling `on_lost` if the device later goes away. Returns the id of the
    /// device it opened and a handle that keeps the stream alive; dropping
    /// the handle closes the stream. The handle never leaves the router
    /// thread, so it need not be `Send`.
    fn open(&self, id: Option<&str>, tap: Tap, on_lost: OnLost) -> Result<(String, Box<dyn std::any::Any>), String>;

    /// Something the last `open` wants in the app log (why it played where
    /// it did), taken once.
    fn take_note(&self) -> Option<String> {
        None
    }
}

/// The real machine. On Linux that is the sound server first, then ALSA
/// (see `server`); elsewhere cpal's own host already is the OS mixer.
pub fn system_backend() -> Box<dyn OutputBackend> {
    #[cfg(target_os = "linux")]
    {
        server::apply_stream_env();
        let server = pulse::PulseServer::load().map(|s| Box::new(s) as Box<dyn server::SoundServer>);
        Box::new(server::ServerFirst::new(server, Box::new(CpalBackend)))
    }
    #[cfg(not(target_os = "linux"))]
    {
        Box::new(CpalBackend)
    }
}

/// The real machine, through cpal (as re-exported by rodio).
pub struct CpalBackend;

impl CpalBackend {
    /// Each device with its label. A host is asked for afresh every time:
    /// it is cheap, and the default one may change while the app runs.
    fn enumerate() -> Vec<(OutputDevice, rodio::cpal::Device)> {
        use rodio::cpal::traits::{DeviceTrait, HostTrait};
        let host = rodio::cpal::default_host();
        let host_default = host.default_output_device().and_then(|d| d.name().ok());
        let devices: Vec<rodio::cpal::Device> = host.output_devices().map(|it| it.collect()).unwrap_or_default();
        let names: Vec<String> = devices
            .iter()
            .map(|d| d.name().unwrap_or_else(|_| "Unknown output".to_string()))
            .collect();
        let default_name = default_device_name(&names, host_default.as_deref(), cfg!(target_os = "linux"));
        label_devices(&names, default_name).into_iter().zip(devices).collect()
    }
}

impl OutputBackend for CpalBackend {
    fn devices(&self) -> Vec<OutputDevice> {
        Self::enumerate().into_iter().map(|(d, _)| d).collect()
    }

    fn default_format(&self) -> Option<(ChannelCount, SampleRate)> {
        use rodio::cpal::traits::{DeviceTrait, HostTrait};
        // On Linux the default is not always cpal's (see `default_device_name`).
        let listed = if cfg!(target_os = "linux") {
            Self::enumerate().into_iter().find(|(d, _)| d.is_default).map(|(_, dev)| dev)
        } else {
            None
        };
        let device = listed.or_else(|| rodio::cpal::default_host().default_output_device())?;
        let config = device.default_output_config().ok()?;
        Some((config.channels(), config.sample_rate().0))
    }

    fn open(&self, id: Option<&str>, tap: Tap, on_lost: OnLost) -> Result<(String, Box<dyn std::any::Any>), String> {
        use rodio::cpal::traits::{DeviceTrait, HostTrait};
        let mut listed = Self::enumerate();
        // The devices to try, in order. A named device is that device only:
        // the listener asked for it, and quietly playing somewhere else would
        // be a lie. The default is tried first and then every other device
        // (see `default_order`), as rodio's own `open_default_stream` does:
        // a machine whose default will not open should still make sound
        // somewhere.
        let candidates: Vec<(String, rodio::cpal::Device)> = match id {
            Some(id) => {
                let i = listed.iter().position(|(d, _)| d.id == id).ok_or_else(|| NO_SUCH_DEVICE.to_string())?;
                let (d, dev) = listed.swap_remove(i);
                vec![(d.id, dev)]
            }
            None => {
                let mut out = Vec::new();
                // A default the enumeration does not show (ALSA can hide a
                // busy one): open it anyway, under its own name.
                if !listed.iter().any(|(d, _)| d.is_default) {
                    if let Some(dev) = rodio::cpal::default_host().default_output_device() {
                        let name = dev.name().unwrap_or_else(|_| "Default output".to_string());
                        out.push((name, dev));
                    }
                }
                let order = default_order(&listed.iter().map(|(d, _)| d.clone()).collect::<Vec<_>>());
                let mut slots: Vec<Option<(OutputDevice, rodio::cpal::Device)>> = listed.into_iter().map(Some).collect();
                out.extend(order.into_iter().filter_map(|i| slots[i].take()).map(|(d, dev)| (d.id, dev)));
                out
            }
        };

        // Shared so the callback can be cloned, which rodio's fallback over
        // other stream configs needs. Only an unplug is passed on; anything
        // else a stream reports (an xrun, a backend hiccup) it recovers from.
        let on_lost = Arc::new(Mutex::new(on_lost));
        let callback = move |err: rodio::cpal::StreamError| match err {
            rodio::cpal::StreamError::DeviceNotAvailable => {
                let mut f = on_lost.lock().unwrap_or_else(PoisonError::into_inner);
                f();
            }
            other => eprintln!("[ember] audio stream error: {other}"),
        };

        let (label, mut stream) = open_first(candidates, |device| {
            rodio::OutputStreamBuilder::from_device(device)
                .map(|b| b.with_error_callback(callback.clone()))
                .and_then(|b| b.open_stream_or_fallback())
                .map_err(|e| e.to_string())
        })?;
        // A switch drops a stream on purpose; rodio would print a warning to
        // stderr for every one.
        stream.log_on_drop(false);
        stream.mixer().add(tap);
        Ok((label, Box::new(stream)))
    }
}

// --- Deciding where to play ----------------------------------------------------

/// What the router should do about the current device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Plan {
    /// Stay where we are.
    Keep,
    /// Open this device (`None` = the system default).
    Open(Option<String>),
}

/// Where to play, given the listener's choice, the device playing now and
/// the devices that exist.
///
/// A chosen device that is present wins. Otherwise the target is the system
/// default, which covers three different events with one rule: nothing is
/// open yet; the device we play on has vanished from the list (unplugged);
/// or the OS default is no longer the device we play on (the listener
/// changed it in the OS, or the chosen device went away while we played on
/// it and came back as something else).
///
/// `trust_absence` is false on Linux, where ALSA leaves a device out of the
/// list while a program holds it open, ours included: absence proves nothing
/// there, and only the stream's own error callback counts as an unplug.
///
/// An empty list is a failed enumeration far more often than a machine that
/// lost every output at once: keep what is open, if anything is.
pub(crate) fn plan(preferred: Option<&str>, active: Option<&str>, devices: &[OutputDevice], trust_absence: bool) -> Plan {
    if devices.is_empty() {
        return if active.is_some() { Plan::Keep } else { Plan::Open(None) };
    }
    if let Some(p) = preferred {
        if devices.iter().any(|d| d.id == p) {
            return if active == Some(p) { Plan::Keep } else { Plan::Open(Some(p.to_string())) };
        }
    }
    let Some(active) = active else {
        return Plan::Open(None);
    };
    if !devices.iter().any(|d| d.id == active) {
        return if trust_absence { Plan::Open(None) } else { Plan::Keep };
    }
    match devices.iter().find(|d| d.is_default) {
        Some(default) if default.id != active => Plan::Open(None),
        _ => Plan::Keep,
    }
}

// --- Remembering the choice -------------------------------------------------

#[derive(Serialize, Deserialize)]
struct StoredOutput {
    preferred: Option<String>,
}

/// The device the listener chose last time, or `None` for the system default.
/// A missing, unreadable or malformed file means the default too: a bad file
/// must never keep the app from making sound.
pub fn load_preferred(dir: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(dir.join(FILE_NAME)).ok()?;
    let stored: StoredOutput = serde_json::from_str(&raw).ok()?;
    stored.preferred.filter(|p| !p.is_empty())
}

/// Keeps the listener's choice for the next launch.
pub fn store_preferred(dir: &Path, preferred: Option<&str>) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let json = serde_json::to_string(&StoredOutput { preferred: preferred.map(str::to_string) })
        .map_err(std::io::Error::other)?;
    std::fs::write(dir.join(FILE_NAME), json)
}

// --- The router ----------------------------------------------------------------

/// Told the new state whenever the device playing changes, for any reason.
pub type Listener = Box<dyn Fn(OutputsSnapshot) + Send + Sync>;

/// Where the router writes its log lines: `(level, message)`.
pub type Logger = Box<dyn Fn(&str, &str) + Send + Sync>;

/// How the router watches for devices coming and going.
#[derive(Debug, Clone, Copy)]
pub struct RouterConfig {
    /// How often to look at the device list, or `None` never to poll.
    pub poll: Option<Duration>,
    /// Whether a device missing from the list is gone (see `plan`).
    pub trust_absence: bool,
}

impl RouterConfig {
    /// macOS and Windows list every device reliably and cheaply: poll every
    /// 2 s, which catches a re-plugged favourite and a changed OS default.
    /// Linux (ALSA) hides busy devices, so a poll there would read our own
    /// device as unplugged; it relies on the stream's error callback and on
    /// the webview asking.
    pub fn for_this_os() -> Self {
        if cfg!(any(target_os = "macos", windows)) {
            Self { poll: Some(Duration::from_secs(2)), trust_absence: true }
        } else {
            Self { poll: None, trust_absence: false }
        }
    }
}

enum Cmd {
    /// The snapshot, after catching up with any change in the devices.
    List(mpsc::Sender<OutputsSnapshot>),
    /// The listener picked a device (`None` = the system default).
    Set(Option<String>, mpsc::Sender<Result<OutputsSnapshot, String>>),
    /// The stored choice, at launch: taken as the preference whether or not
    /// that device is plugged in right now, so it is used when it appears.
    Prefer(Option<String>),
    /// The stream playing tap N lost its device.
    Lost(u64),
    /// Look at the devices now. The reply, if any, is sent once done.
    Tick(Option<mpsc::Sender<()>>),
    Shutdown,
}

/// State the router thread shares with the handles.
#[derive(Default)]
struct Shared {
    listener: Mutex<Option<Listener>>,
    store_dir: Mutex<Option<PathBuf>>,
    logger: Mutex<Option<Logger>>,
    /// Lines logged before there was a logger (the launch open happens
    /// before the app log is wired up), handed to it when it comes.
    early: Mutex<Vec<(String, String)>>,
}

/// Sends `Shutdown` when the last handle goes. The router thread keeps a
/// sender of its own (for the streams' unplug callbacks), so the channel
/// alone would never tell it that nobody is left to ask it anything.
struct Owner(mpsc::Sender<Cmd>);

impl Drop for Owner {
    fn drop(&mut self) {
        let _ = self.0.send(Cmd::Shutdown);
    }
}

/// A handle on the router thread. Cheap to clone, `Send + Sync`: it holds a
/// channel and shared state, never a stream. Every call that waits blocks
/// the calling thread on the router, so the Tauri commands make them from a
/// blocking task.
#[derive(Clone)]
pub struct OutputRouter {
    tx: mpsc::Sender<Cmd>,
    shared: Arc<Shared>,
    _owner: Arc<Owner>,
}

impl OutputRouter {
    fn ask<T>(&self, make: impl FnOnce(mpsc::Sender<T>) -> Cmd) -> Result<T, String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx.send(make(reply_tx)).map_err(|_| "the audio output thread has stopped".to_string())?;
        reply_rx
            .recv_timeout(REPLY_TIMEOUT)
            .map_err(|_| "the audio output thread did not answer".to_string())
    }

    /// The devices, the one playing and the one chosen.
    pub fn list(&self) -> Result<OutputsSnapshot, String> {
        self.ask(Cmd::List)
    }

    /// Plays on `id` from now on (`None` = follow the system default) and
    /// remembers it. An unknown id, or a device that will not open, is an
    /// error that changes nothing: the old device keeps playing and the old
    /// choice stays stored.
    pub fn set(&self, id: Option<String>) -> Result<OutputsSnapshot, String> {
        self.ask(|reply| Cmd::Set(id, reply))?
    }

    /// The choice stored last session, applied without waiting.
    pub fn prefer(&self, id: Option<String>) {
        let _ = self.tx.send(Cmd::Prefer(id));
    }

    /// Where the choice is written (see `store_preferred`).
    pub fn set_store_dir(&self, dir: PathBuf) {
        *self.shared.store_dir.lock().unwrap_or_else(PoisonError::into_inner) = Some(dir);
    }

    /// Told about every change of the device playing.
    pub fn set_listener(&self, listener: Listener) {
        *self.shared.listener.lock().unwrap_or_else(PoisonError::into_inner) = Some(listener);
    }

    /// Where the router's log lines go (stderr until this is set).
    pub fn set_logger(&self, logger: Logger) {
        let mut slot = self.shared.logger.lock().unwrap_or_else(PoisonError::into_inner);
        let early = std::mem::take(&mut *self.shared.early.lock().unwrap_or_else(PoisonError::into_inner));
        for (level, msg) in early {
            logger(&level, &msg);
        }
        *slot = Some(logger);
    }

    /// One poll, now, and returns once it is done: tests drive the router
    /// with this instead of waiting out the poll interval.
    #[cfg(test)]
    pub(crate) fn tick_now(&self) {
        let _ = self.ask(|reply| Cmd::Tick(Some(reply)));
    }
}

/// Starts the router thread, opens the system default output on it, and
/// returns the master mixer every sink plays into. Err when no output device
/// at all could be opened, which is the caller's cue for a degraded engine.
pub fn start(backend: Box<dyn OutputBackend>, config: RouterConfig) -> Result<(Mixer, OutputRouter), String> {
    let (tx, rx) = mpsc::channel::<Cmd>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<Mixer, String>>();
    let shared = Arc::new(Shared::default());
    let own_tx = tx.clone();
    let thread_shared = Arc::clone(&shared);
    std::thread::Builder::new()
        .name("ember-audio-output".into())
        .spawn(move || {
            // At least stereo: a mono default (a headset in call mode) would
            // otherwise fold every song to mono for the whole session, even
            // after a switch to a stereo device.
            let (channels, sample_rate) = backend
                .default_format()
                .map(|(c, r)| (c.max(2), r))
                .unwrap_or(FALLBACK_FORMAT);
            let (mixer, source) = rodio::mixer::mixer(channels, sample_rate);
            let mut router = Router {
                backend,
                master: Arc::new(Mutex::new(source)),
                channels,
                sample_rate,
                active_tap: Arc::new(AtomicU64::new(0)),
                last_tap: 0,
                stream: None,
                active: None,
                preferred: None,
                tx: own_tx,
                shared: thread_shared,
                config,
                backoff: Backoff::default(),
            };
            let devices = router.backend.devices();
            if let Err(e) = router.open(None, &devices) {
                let _ = ready_tx.send(Err(e));
                return;
            }
            let _ = ready_tx.send(Ok(mixer));
            router.run(rx);
        })
        .map_err(|e| e.to_string())?;
    let mixer = ready_rx.recv().map_err(|_| "audio output thread exited".to_string())??;
    let owner = Arc::new(Owner(tx.clone()));
    Ok((mixer, OutputRouter { tx, shared, _owner: owner }))
}

/// Targets a poll failed to open, for the device list it saw. A device that
/// will not open is not retried every 2 s (with a log line each time) until
/// something about the devices changes, which includes the OS default moving.
#[derive(Default)]
struct Backoff {
    devices: Vec<(String, bool)>,
    targets: Vec<Option<String>>,
}

impl Backoff {
    fn ids(devices: &[OutputDevice]) -> Vec<(String, bool)> {
        devices.iter().map(|d| (d.id.clone(), d.is_default)).collect()
    }

    fn holds(&self, target: &Option<String>, devices: &[OutputDevice]) -> bool {
        self.devices == Self::ids(devices) && self.targets.contains(target)
    }

    fn record(&mut self, target: Option<String>, devices: &[OutputDevice]) {
        let ids = Self::ids(devices);
        if self.devices != ids {
            *self = Self { devices: ids, targets: Vec::new() };
        }
        self.targets.push(target);
    }
}

/// The router thread's own state. Lives only on that thread.
struct Router {
    backend: Box<dyn OutputBackend>,
    master: SharedMaster,
    channels: ChannelCount,
    sample_rate: SampleRate,
    /// The id of the tap allowed to pull from the master.
    active_tap: Arc<AtomicU64>,
    /// The last tap id handed out; the live stream's tap has this id.
    last_tap: u64,
    /// Keeps the live stream open.
    stream: Option<Box<dyn std::any::Any>>,
    /// The device playing now.
    active: Option<String>,
    /// The listener's choice, `None` for the system default.
    preferred: Option<String>,
    /// For the streams' unplug callbacks.
    tx: mpsc::Sender<Cmd>,
    shared: Arc<Shared>,
    config: RouterConfig,
    backoff: Backoff,
}

impl Router {
    fn run(&mut self, rx: mpsc::Receiver<Cmd>) {
        let mut next_poll = self.config.poll.map(|p| Instant::now() + p);
        loop {
            let cmd = match next_poll {
                Some(at) => match rx.recv_timeout(at.saturating_duration_since(Instant::now())) {
                    Ok(cmd) => cmd,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        next_poll = self.config.poll.map(|p| Instant::now() + p);
                        Cmd::Tick(None)
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                },
                None => match rx.recv() {
                    Ok(cmd) => cmd,
                    Err(_) => break,
                },
            };
            match cmd {
                Cmd::List(reply) => {
                    // Asking is also a chance to catch up, which on Linux
                    // (no polling) is how a re-plugged favourite comes back.
                    let devices = self.backend.devices();
                    let active = self.active.clone();
                    self.follow(&devices, active, true);
                    let _ = reply.send(self.snapshot(&devices));
                }
                Cmd::Set(id, reply) => {
                    let _ = reply.send(self.choose(id));
                }
                Cmd::Prefer(id) => {
                    self.preferred = id.filter(|p| !p.is_empty());
                    let devices = self.backend.devices();
                    let active = self.active.clone();
                    self.follow(&devices, active, false);
                }
                Cmd::Lost(tap) => self.lost(tap),
                Cmd::Tick(reply) => {
                    let devices = self.backend.devices();
                    let active = self.active.clone();
                    self.follow(&devices, active, true);
                    if let Some(reply) = reply {
                        let _ = reply.send(());
                    }
                }
                Cmd::Shutdown => break,
            }
        }
    }

    fn log(&self, level: &str, msg: &str) {
        let logger = self.shared.logger.lock().unwrap_or_else(PoisonError::into_inner);
        let line = format!("output: {msg}");
        match logger.as_ref() {
            Some(log) => log(level, &line),
            None => {
                eprintln!("[ember] {line}");
                let mut early = self.shared.early.lock().unwrap_or_else(PoisonError::into_inner);
                if early.len() < 50 {
                    early.push((level.to_string(), line));
                }
            }
        }
    }

    fn snapshot(&self, devices: &[OutputDevice]) -> OutputsSnapshot {
        let mut devices = devices.to_vec();
        if let Some(active) = &self.active {
            if !devices.iter().any(|d| &d.id == active) {
                devices.push(OutputDevice { id: active.clone(), name: active.clone(), is_default: false });
            }
        }
        OutputsSnapshot { devices, active: self.active.clone(), preferred: self.preferred.clone() }
    }

    /// Opens `target` with a fresh tap, hands the master to it, and only then
    /// closes the old stream, so the song never has nowhere to go.
    fn open(&mut self, target: Option<&str>, devices: &[OutputDevice]) -> Result<(), String> {
        let id = self.last_tap + 1;
        let tap = Tap::new(id, Arc::clone(&self.master), Arc::clone(&self.active_tap), self.channels, self.sample_rate);
        let tx = self.tx.clone();
        let on_lost: OnLost = Box::new(move || {
            let _ = tx.send(Cmd::Lost(id));
        });
        let opened = self.backend.open(target, tap, on_lost);
        if let Some(note) = self.backend.take_note() {
            self.log("WARN", &note);
        }
        let (opened, stream) = opened?;
        self.last_tap = id;
        self.active_tap.store(id, Ordering::SeqCst);
        drop(self.stream.replace(stream));
        self.backoff = Backoff::default();
        let changed = self.active.as_deref() != Some(opened.as_str());
        self.active = Some(opened);
        if changed {
            self.log("INFO", &format!("playing on {}", self.active.as_deref().unwrap_or("?")));
            let snapshot = self.snapshot(devices);
            let listener = self.shared.listener.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some(listener) = listener.as_ref() {
                listener(snapshot);
            }
        }
        Ok(())
    }

    /// Moves to wherever `plan` says. When the chosen device will not open,
    /// the default is the fallback (if that is somewhere else); when nothing
    /// opens, the current stream stays, and the failure is logged.
    /// `polled` failures are remembered, so a poll does not retry the same
    /// dead device every 2 s.
    fn follow(&mut self, devices: &[OutputDevice], active: Option<String>, polled: bool) {
        let trust = self.config.trust_absence;
        let Plan::Open(target) = plan(self.preferred.as_deref(), active.as_deref(), devices, trust) else {
            return;
        };
        if self.try_open(target.clone(), devices, polled) || target.is_none() {
            return;
        }
        if plan(None, active.as_deref(), devices, trust) == Plan::Open(None) {
            self.try_open(None, devices, polled);
        }
    }

    fn try_open(&mut self, target: Option<String>, devices: &[OutputDevice], polled: bool) -> bool {
        if polled && self.backoff.holds(&target, devices) {
            return false;
        }
        match self.open(target.as_deref(), devices) {
            Ok(()) => {
                // The backend falls back to another device when the default
                // will not open, usually the one already playing. Counted as
                // a failed open of the default, or every poll would rebuild
                // that stream (a dropout every 2 s) while the default is dead.
                if polled && target.is_none() {
                    if let Some(default) = devices.iter().find(|d| d.is_default) {
                        if self.active.as_deref() != Some(default.id.as_str()) {
                            self.log("WARN", &format!("could not open the system default ({}); playing on {}", default.id, self.active.as_deref().unwrap_or("?")));
                            self.backoff.record(None, devices);
                        }
                    }
                }
                true
            }
            Err(e) => {
                let what = target.as_deref().unwrap_or("the system default");
                self.log("WARN", &format!("could not open {what}: {e}"));
                if polled {
                    self.backoff.record(target, devices);
                }
                false
            }
        }
    }

    /// The device under the live stream went away: play on the chosen device
    /// if it is still here, else the default. A loss reported by a stream
    /// already replaced is old news and ignored.
    fn lost(&mut self, tap: u64) {
        if tap != self.last_tap {
            return;
        }
        let gone = self.active.clone();
        self.log("WARN", &format!("{} went away", gone.as_deref().unwrap_or("the output device")));
        // The list may still show it for a moment; it is gone all the same.
        let devices: Vec<OutputDevice> =
            self.backend.devices().into_iter().filter(|d| Some(&d.id) != gone.as_ref()).collect();
        self.follow(&devices, None, false);
    }

    /// The listener's pick (see `OutputRouter::set`).
    fn choose(&mut self, id: Option<String>) -> Result<OutputsSnapshot, String> {
        let devices = self.backend.devices();
        match id.filter(|i| !i.is_empty()) {
            Some(id) => {
                // The device playing now is always a valid pick, listed or
                // not (ALSA may be hiding it because we hold it).
                let playing = self.active.as_deref() == Some(id.as_str());
                if !playing && !devices.iter().any(|d| d.id == id) {
                    return Err(NO_SUCH_DEVICE.to_string());
                }
                if !playing {
                    self.open(Some(&id), &devices)?;
                }
                self.preferred = Some(id);
            }
            None => {
                let active = self.active.clone();
                if plan(None, active.as_deref(), &devices, self.config.trust_absence) == Plan::Open(None) {
                    self.open(None, &devices)?;
                }
                self.preferred = None;
            }
        }
        let dir = self.shared.store_dir.lock().unwrap_or_else(PoisonError::into_inner).clone();
        if let Some(dir) = dir {
            if let Err(e) = store_preferred(&dir, self.preferred.as_deref()) {
                self.log("WARN", &format!("could not remember the output device: {e}"));
            }
        }
        Ok(self.snapshot(&devices))
    }
}

// --- Commands ----------------------------------------------------------------

/// The snapshot for an engine that may have no router (a degraded engine, or
/// the tests' engine): that is an empty one, not an error, so the picker can
/// simply show nothing to pick.
pub(crate) async fn list_outputs(router: Option<OutputRouter>) -> Result<OutputsSnapshot, String> {
    let Some(router) = router else {
        return Ok(OutputsSnapshot::default());
    };
    tauri::async_runtime::spawn_blocking(move || router.list()).await.map_err(|e| e.to_string())?
}

/// `audio_set_output`, for an engine that may have no router.
pub(crate) async fn set_output(router: Option<OutputRouter>, id: Option<String>) -> Result<OutputsSnapshot, String> {
    let Some(router) = router else {
        return Err(NO_OUTPUT.to_string());
    };
    tauri::async_runtime::spawn_blocking(move || router.set(id)).await.map_err(|e| e.to_string())?
}

/// The output devices, the one playing and the one chosen. Async, and the
/// work runs on a blocking thread: enumerating devices can take a while on
/// some machines, and a sync command would run it on the main thread.
#[tauri::command]
pub async fn audio_outputs(engine: State<'_, AudioEngine>) -> Result<OutputsSnapshot, String> {
    list_outputs(engine.outputs().cloned()).await
}

/// Plays on the device `id` from now on, or follows the system default when
/// `id` is null, and remembers the choice for the next launch. The song
/// carries on from where it was. An unknown id is refused with "no such
/// output device"; a device that will not open is refused with the reason;
/// either way nothing changes.
#[tauri::command]
pub async fn audio_set_output(engine: State<'_, AudioEngine>, id: Option<String>) -> Result<OutputsSnapshot, String> {
    set_output(engine.outputs().cloned(), id).await
}

mod server;

#[cfg(unix)]
mod pulse;

#[cfg(test)]
mod tests;
