// Tests for the output router, on a fake machine.
//
// `Mock` stands in for the machine's audio devices. Its "stream" is the test
// itself: opening a device records the tap it was given, and the test pulls
// samples from that tap the way a sound card would. So a test can play a
// known signal, move it from one device to another, and read exactly what
// each device got.

use super::*;
use rodio::buffer::SamplesBuffer;
use rodio::Sink;

/// A fresh directory under the system temp dir, removed when dropped (the
/// same approach as the theme and cache tests).
struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        static N: AtomicU64 = AtomicU64::new(0);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "ember-output-{tag}-{}-{nanos}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn dev(id: &str, is_default: bool) -> OutputDevice {
    OutputDevice { id: id.into(), name: id.into(), is_default }
}

// --- The fake machine --------------------------------------------------------

struct MockStream {
    device: String,
    tap: Arc<Mutex<Tap>>,
    on_lost: Option<OnLost>,
    open: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Default)]
struct MockState {
    devices: Vec<OutputDevice>,
    fail: HashSet<String>,
    streams: Vec<MockStream>,
    /// Opening the default tries every other device when it will not open,
    /// as `CpalBackend` does.
    fallback: bool,
}

/// Closes its stream when the router drops it.
struct MockHandle(Arc<std::sync::atomic::AtomicBool>);

impl Drop for MockHandle {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(Clone, Default)]
struct Mock(Arc<Mutex<MockState>>);

impl Mock {
    fn new(devices: &[(&str, bool)]) -> Self {
        let mock = Mock::default();
        mock.set_devices(devices);
        mock
    }

    fn set_devices(&self, devices: &[(&str, bool)]) {
        self.0.lock().unwrap().devices = devices.iter().map(|(id, d)| dev(id, *d)).collect();
    }

    fn fail_open(&self, id: &str) {
        self.0.lock().unwrap().fail.insert(id.into());
    }

    fn fall_back_like_cpal(&self) {
        self.0.lock().unwrap().fallback = true;
    }

    /// Takes `id` out of the list and has its stream report the loss, as
    /// cpal's error callback does.
    fn unplug(&self, id: &str) {
        let on_lost = {
            let mut state = self.0.lock().unwrap();
            state.devices.retain(|d| d.id != id);
            state
                .streams
                .iter_mut()
                .rev()
                .find(|s| s.device == id && s.open.load(Ordering::SeqCst))
                .and_then(|s| s.on_lost.take())
        };
        if let Some(mut f) = on_lost {
            f();
        }
    }

    /// The newest stream opened on `id`.
    fn tap_of(&self, id: &str) -> Arc<Mutex<Tap>> {
        let state = self.0.lock().unwrap();
        let s = state.streams.iter().rev().find(|s| s.device == id).expect("a stream on that device");
        Arc::clone(&s.tap)
    }

    /// What device `id` plays next: `n` samples pulled from its tap.
    fn pull(&self, id: &str, n: usize) -> Vec<f32> {
        let tap = self.tap_of(id);
        let mut tap = tap.lock().unwrap();
        let out: Vec<f32> = tap.by_ref().take(n).collect();
        assert_eq!(out.len(), n, "a tap must never end");
        out
    }

    fn is_open(&self, id: &str) -> bool {
        let state = self.0.lock().unwrap();
        state.streams.iter().any(|s| s.device == id && s.open.load(Ordering::SeqCst))
    }

    fn opens(&self) -> usize {
        self.0.lock().unwrap().streams.len()
    }
}

impl OutputBackend for Mock {
    fn devices(&self) -> Vec<OutputDevice> {
        self.0.lock().unwrap().devices.clone()
    }

    fn default_format(&self) -> Option<(ChannelCount, SampleRate)> {
        Some((2, 48_000))
    }

    fn open(&self, id: Option<&str>, tap: Tap, on_lost: OnLost) -> Result<(String, Box<dyn std::any::Any>), String> {
        let mut state = self.0.lock().unwrap();
        let target = match id {
            Some(id) => state.devices.iter().find(|d| d.id == id).map(|d| d.id.clone()),
            None => {
                let default = state.devices.iter().find(|d| d.is_default).or(state.devices.first());
                let mut candidates: Vec<&OutputDevice> = default.into_iter().collect();
                if state.fallback {
                    candidates.extend(state.devices.iter().filter(|d| Some(d.id.as_str()) != default.map(|d| d.id.as_str())));
                }
                candidates
                    .iter()
                    .find(|d| !state.fail.contains(&d.id))
                    .or(candidates.first())
                    .map(|d| d.id.clone())
            }
        }
        .ok_or_else(|| "mock: no such device".to_string())?;
        if state.fail.contains(&target) {
            return Err(format!("mock: {target} will not open"));
        }
        let open = Arc::new(std::sync::atomic::AtomicBool::new(true));
        state.streams.push(MockStream {
            device: target.clone(),
            tap: Arc::new(Mutex::new(tap)),
            on_lost: Some(on_lost),
            open: Arc::clone(&open),
        });
        Ok((target, Box::new(MockHandle(open))))
    }
}

fn router_on(mock: &Mock, trust_absence: bool) -> (Mixer, OutputRouter) {
    start(Box::new(mock.clone()), RouterConfig { poll: None, trust_absence }).expect("the router starts")
}

/// Records every snapshot the listener is told.
fn listen(router: &OutputRouter) -> Arc<Mutex<Vec<OutputsSnapshot>>> {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    router.set_listener(Box::new(move |s| sink.lock().unwrap().push(s)));
    seen
}

fn actives(seen: &Arc<Mutex<Vec<OutputsSnapshot>>>) -> Vec<Option<String>> {
    seen.lock().unwrap().iter().map(|s| s.active.clone()).collect()
}

// --- plan() ------------------------------------------------------------------

#[test]
fn plan_opens_the_preferred_device_when_it_is_present() {
    let devices = [dev("Speakers", true), dev("Headphones", false)];
    assert_eq!(
        plan(Some("Headphones"), Some("Speakers"), &devices, true),
        Plan::Open(Some("Headphones".into()))
    );
    assert_eq!(plan(Some("Headphones"), None, &devices, true), Plan::Open(Some("Headphones".into())));
}

#[test]
fn plan_keeps_the_preferred_device_when_it_is_already_playing() {
    let devices = [dev("Speakers", true), dev("Headphones", false)];
    assert_eq!(plan(Some("Headphones"), Some("Headphones"), &devices, true), Plan::Keep);
}

#[test]
fn plan_falls_back_to_the_default_when_the_preferred_device_is_missing() {
    let devices = [dev("Speakers", true)];
    // Nothing open yet.
    assert_eq!(plan(Some("Headphones"), None, &devices, true), Plan::Open(None));
    // Already on the default: stay.
    assert_eq!(plan(Some("Headphones"), Some("Speakers"), &devices, true), Plan::Keep);
    // Still on the preferred device, which the list no longer shows.
    assert_eq!(plan(Some("Headphones"), Some("Headphones"), &devices, true), Plan::Open(None));
}

#[test]
fn plan_moves_to_the_default_when_the_active_device_is_unplugged() {
    let devices = [dev("Speakers", true), dev("HDMI", false)];
    assert_eq!(plan(None, Some("USB DAC"), &devices, true), Plan::Open(None));
}

#[test]
fn plan_follows_a_changed_system_default() {
    let devices = [dev("Speakers", false), dev("AirPods", true)];
    assert_eq!(plan(None, Some("Speakers"), &devices, true), Plan::Open(None));
    // And stays once it is on it.
    assert_eq!(plan(None, Some("AirPods"), &devices, true), Plan::Keep);
}

#[test]
fn plan_with_no_default_marked_keeps_a_listed_device() {
    let devices = [dev("Speakers", false), dev("HDMI", false)];
    assert_eq!(plan(None, Some("HDMI"), &devices, true), Plan::Keep);
}

#[test]
fn plan_on_linux_keeps_an_active_device_the_list_hides() {
    // ALSA leaves out a device held open, ours included: its absence
    // proves nothing there.
    let devices = [dev("default", true), dev("pipewire", false)];
    assert_eq!(plan(None, Some("USB DAC"), &devices, false), Plan::Keep);
    assert_eq!(plan(Some("USB DAC"), Some("USB DAC"), &devices, false), Plan::Keep);
    // A preferred device that shows up is still taken.
    assert_eq!(
        plan(Some("pipewire"), Some("USB DAC"), &devices, false),
        Plan::Open(Some("pipewire".into()))
    );
}

#[test]
fn plan_with_an_empty_list_keeps_what_is_open() {
    assert_eq!(plan(None, Some("Speakers"), &[], true), Plan::Keep);
    assert_eq!(plan(Some("Headphones"), Some("Speakers"), &[], true), Plan::Keep);
    assert_eq!(plan(None, None, &[], true), Plan::Open(None));
    assert_eq!(plan(Some("Headphones"), None, &[], false), Plan::Open(None));
}

// --- Labels ------------------------------------------------------------------

#[test]
fn duplicate_names_get_a_numbered_suffix_and_the_first_default_is_marked() {
    let names: Vec<String> = ["Speakers", "USB Headset", "USB Headset", "USB Headset"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let labelled = label_devices(&names, Some("USB Headset"));
    let ids: Vec<&str> = labelled.iter().map(|d| d.id.as_str()).collect();
    assert_eq!(ids, ["Speakers", "USB Headset", "USB Headset (2)", "USB Headset (3)"]);
    assert_eq!(labelled.iter().filter(|d| d.is_default).count(), 1);
    assert!(labelled[1].is_default);
    assert_eq!(labelled[2].name, "USB Headset (2)");
}

#[test]
fn a_generated_suffix_never_collides_with_a_real_name() {
    let names: Vec<String> = ["A", "A (2)", "A"].iter().map(|s| s.to_string()).collect();
    let ids: Vec<String> = label_devices(&names, None).into_iter().map(|d| d.id).collect();
    assert_eq!(ids, ["A", "A (2)", "A (3)"]);
}

#[test]
fn the_snapshot_serializes_in_camel_case() {
    let snap = OutputsSnapshot {
        devices: vec![dev("Speakers", true)],
        active: Some("Speakers".into()),
        preferred: None,
    };
    let json = serde_json::to_value(&snap).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "devices": [{ "id": "Speakers", "name": "Speakers", "isDefault": true }],
            "active": "Speakers",
            "preferred": null
        })
    );
}

// --- The tap -------------------------------------------------------------------

/// Every sample value is its own index, so a repeat or a skip shows up as a
/// break in the count.
fn ramp(n: usize) -> Vec<f32> {
    (0..n).map(|i| i as f32).collect()
}

fn assert_counts_up(samples: &[f32], what: &str) {
    for w in samples.windows(2) {
        assert_eq!(w[1], w[0] + 1.0, "{what}: {} followed {}", w[1], w[0]);
    }
}

#[test]
fn switching_devices_keeps_the_song_where_it_was() {
    let mock = Mock::new(&[("A", true), ("B", false)]);
    let (mixer, router) = router_on(&mock, true);
    assert_eq!(router.list().unwrap().active.as_deref(), Some("A"));

    let sink = Sink::connect_new(&mixer);
    sink.append(SamplesBuffer::new(2, 48_000, ramp(200_000)));

    // rodio's queue treats the first short span of a new sink as mono, so
    // the check starts once the song is past it.
    let _warm_up = mock.pull("A", 4_096);
    let on_a = mock.pull("A", 4_800);
    assert_counts_up(&on_a, "device A");
    let pos_on_a = sink.get_pos();
    assert!(pos_on_a > Duration::ZERO, "the song advanced on A");

    let snap = router.set(Some("B".into())).expect("switches");
    assert_eq!(snap.active.as_deref(), Some("B"));
    assert_eq!(snap.preferred.as_deref(), Some("B"));

    // The old device plays silence and takes nothing from the song.
    let stale = mock.pull("A", 2_000);
    assert!(stale.iter().all(|s| *s == 0.0), "A still got sound after the switch");
    assert!(!mock.is_open("A"), "the old stream was closed");

    let on_b = mock.pull("B", 4_800);
    assert_eq!(on_b[0], on_a[on_a.len() - 1] + 1.0, "B carried on exactly where A stopped");
    assert_counts_up(&on_b, "device B");
    assert!(sink.get_pos() > pos_on_a, "the position kept advancing on B");
}

#[test]
fn a_tap_never_ends_and_picks_up_a_song_added_later() {
    let mock = Mock::new(&[("A", true)]);
    let (mixer, _router) = router_on(&mock, true);

    let silence = mock.pull("A", 10_000);
    assert!(silence.iter().all(|s| *s == 0.0));

    let sink = Sink::connect_new(&mixer);
    sink.append(SamplesBuffer::new(2, 48_000, vec![0.5f32; 48_000]));
    let sound = mock.pull("A", 8_192);
    assert!(sound.contains(&0.5), "the song reached the device");

    // Once the song has run out, silence again, and still no end.
    drop(sink);
    let _ = mock.pull("A", 100_000);
    let after = mock.pull("A", 4_096);
    assert!(after.iter().all(|s| *s == 0.0));
}

// --- Devices coming and going ----------------------------------------------

#[test]
fn an_unplugged_device_falls_back_to_the_default_and_comes_back_when_replugged() {
    let mock = Mock::new(&[("Speakers", true), ("Headphones", false)]);
    let (_mixer, router) = router_on(&mock, true);
    let seen = listen(&router);

    router.set(Some("Headphones".into())).expect("switches");
    assert_eq!(actives(&seen), [Some("Headphones".to_string())]);

    mock.unplug("Headphones");
    // A round trip: the router has handled the loss once this returns.
    let snap = router.list().unwrap();
    assert_eq!(snap.active.as_deref(), Some("Speakers"));
    assert_eq!(snap.preferred.as_deref(), Some("Headphones"), "the choice outlives the unplug");
    assert_eq!(actives(&seen), [Some("Headphones".to_string()), Some("Speakers".to_string())]);
    assert!(!snap.devices.iter().any(|d| d.id == "Headphones"));

    mock.set_devices(&[("Speakers", true), ("Headphones", false)]);
    router.tick_now();
    assert_eq!(router.list().unwrap().active.as_deref(), Some("Headphones"));
    assert_eq!(actives(&seen).last().cloned().flatten().as_deref(), Some("Headphones"));
}

#[test]
fn a_loss_reported_by_an_old_stream_is_ignored() {
    let mock = Mock::new(&[("Speakers", true), ("Headphones", false)]);
    let (_mixer, router) = router_on(&mock, true);
    router.set(Some("Headphones".into())).unwrap();
    let seen = listen(&router);
    // The first stream (on Speakers) is closed; its callback firing now must
    // not move playback.
    let old = {
        let mut state = mock.0.lock().unwrap();
        state.streams[0].on_lost.take()
    };
    old.expect("the first stream's callback")();
    assert_eq!(router.list().unwrap().active.as_deref(), Some("Headphones"));
    assert!(seen.lock().unwrap().is_empty());
}

#[test]
fn a_changed_system_default_is_followed_on_the_next_poll() {
    let mock = Mock::new(&[("Speakers", true), ("AirPods", false)]);
    let (_mixer, router) = router_on(&mock, true);
    let seen = listen(&router);
    mock.set_devices(&[("Speakers", false), ("AirPods", true)]);
    router.tick_now();
    assert_eq!(actives(&seen), [Some("AirPods".to_string())]);
    // Nothing changed since: the next poll leaves it be.
    let opens = mock.opens();
    router.tick_now();
    assert_eq!(mock.opens(), opens);
}

#[test]
fn a_poll_does_not_retry_a_device_that_will_not_open_until_the_list_changes() {
    let mock = Mock::new(&[("Speakers", true), ("AirPods", false)]);
    let (_mixer, router) = router_on(&mock, true);
    mock.fail_open("AirPods");
    mock.set_devices(&[("Speakers", false), ("AirPods", true)]);
    router.tick_now();
    router.tick_now();
    router.tick_now();
    assert_eq!(router.list().unwrap().active.as_deref(), Some("Speakers"), "kept what it had");
    assert_eq!(mock.opens(), 1, "no stream was opened after the start");
}

/// The real backend opens another device when the default will not open,
/// usually the one already playing. A poll that lands back there must not
/// tear down and rebuild that stream every 2 s (a dropout each time) for as
/// long as the default stays dead, and must still follow the default once
/// it moves to a device that works.
#[test]
fn a_default_that_will_not_open_does_not_reopen_the_playing_device_every_poll() {
    let mock = Mock::new(&[("Speakers", true), ("AirPods", false), ("Monitor", false)]);
    mock.fall_back_like_cpal();
    let (_mixer, router) = router_on(&mock, true);
    mock.fail_open("AirPods");
    mock.set_devices(&[("Speakers", false), ("AirPods", true), ("Monitor", false)]);
    router.tick_now();
    let opens = mock.opens();
    router.tick_now();
    router.tick_now();
    router.tick_now();
    assert_eq!(router.list().unwrap().active.as_deref(), Some("Speakers"), "kept what it had");
    assert_eq!(mock.opens(), opens, "the playing device was reopened on every poll");

    // The OS default moves on to a device that does open: followed.
    mock.set_devices(&[("Speakers", false), ("AirPods", false), ("Monitor", true)]);
    router.tick_now();
    assert_eq!(router.list().unwrap().active.as_deref(), Some("Monitor"));
}

#[test]
fn on_linux_a_hidden_active_device_is_kept_and_still_listed() {
    let mock = Mock::new(&[("default", true), ("USB DAC", false)]);
    let (_mixer, router) = router_on(&mock, false);
    router.set(Some("USB DAC".into())).unwrap();
    // ALSA now hides it because we hold it.
    mock.set_devices(&[("default", true)]);
    router.tick_now();
    let snap = router.list().unwrap();
    assert_eq!(snap.active.as_deref(), Some("USB DAC"));
    assert!(snap.devices.iter().any(|d| d.id == "USB DAC"), "still offered to the picker");
    // And picking it again is not "no such device".
    assert!(router.set(Some("USB DAC".into())).is_ok());
}

// --- The listener's choice -------------------------------------------------

#[test]
fn an_unknown_device_is_refused_and_nothing_changes() {
    let dir = TempDir::new("unknown");
    let mock = Mock::new(&[("Speakers", true), ("Headphones", false)]);
    let (_mixer, router) = router_on(&mock, true);
    router.set_store_dir(dir.0.clone());
    router.set(Some("Headphones".into())).unwrap();

    let err = router.set(Some("Nope".into())).unwrap_err();
    assert_eq!(err, "no such output device");
    let snap = router.list().unwrap();
    assert_eq!(snap.active.as_deref(), Some("Headphones"));
    assert_eq!(snap.preferred.as_deref(), Some("Headphones"));
    assert_eq!(load_preferred(&dir.0).as_deref(), Some("Headphones"));
}

#[test]
fn a_device_that_will_not_open_is_an_error_and_playback_stays() {
    let dir = TempDir::new("fails");
    let mock = Mock::new(&[("Speakers", true), ("HDMI", false)]);
    let (_mixer, router) = router_on(&mock, true);
    router.set_store_dir(dir.0.clone());
    let seen = listen(&router);
    mock.fail_open("HDMI");

    assert!(router.set(Some("HDMI".into())).is_err());
    let snap = router.list().unwrap();
    assert_eq!(snap.active.as_deref(), Some("Speakers"));
    assert_eq!(snap.preferred, None);
    assert!(mock.is_open("Speakers"), "the old stream is still playing");
    assert!(seen.lock().unwrap().is_empty());
    assert!(!dir.0.join(FILE_NAME).exists(), "a failed choice is not remembered");
}

#[test]
fn a_successful_choice_is_remembered_and_null_goes_back_to_the_default() {
    let dir = TempDir::new("remember");
    let mock = Mock::new(&[("Speakers", true), ("Headphones", false)]);
    let (_mixer, router) = router_on(&mock, true);
    router.set_store_dir(dir.0.clone());
    let seen = listen(&router);

    router.set(Some("Headphones".into())).unwrap();
    assert_eq!(load_preferred(&dir.0).as_deref(), Some("Headphones"));

    let snap = router.set(None).unwrap();
    assert_eq!(snap.active.as_deref(), Some("Speakers"));
    assert_eq!(snap.preferred, None);
    assert_eq!(load_preferred(&dir.0), None);
    assert_eq!(std::fs::read_to_string(dir.0.join(FILE_NAME)).unwrap(), r#"{"preferred":null}"#);
    assert_eq!(actives(&seen), [Some("Headphones".to_string()), Some("Speakers".to_string())]);
}

#[test]
fn the_stored_choice_is_applied_at_launch_when_present_and_waited_for_when_not() {
    let mock = Mock::new(&[("Speakers", true), ("Headphones", false)]);
    let (_mixer, router) = router_on(&mock, true);
    router.prefer(Some("Headphones".into()));
    assert_eq!(router.list().unwrap().active.as_deref(), Some("Headphones"));

    let mock = Mock::new(&[("Speakers", true)]);
    let (_mixer, router) = router_on(&mock, true);
    router.prefer(Some("Headphones".into()));
    let snap = router.list().unwrap();
    assert_eq!(snap.active.as_deref(), Some("Speakers"));
    assert_eq!(snap.preferred.as_deref(), Some("Headphones"));
    mock.set_devices(&[("Speakers", true), ("Headphones", false)]);
    router.tick_now();
    assert_eq!(router.list().unwrap().active.as_deref(), Some("Headphones"));
}

#[test]
fn no_device_at_all_fails_the_start() {
    let mock = Mock::new(&[]);
    assert!(start(Box::new(mock), RouterConfig { poll: None, trust_absence: true }).is_err());
}

// --- Persistence ---------------------------------------------------------------

#[test]
fn the_choice_round_trips_through_the_file() {
    let dir = TempDir::new("roundtrip");
    let nested = dir.0.join("app.ember.desktop");
    store_preferred(&nested, Some("USB Headset (2)")).unwrap();
    assert_eq!(load_preferred(&nested).as_deref(), Some("USB Headset (2)"));
    assert_eq!(
        std::fs::read_to_string(nested.join(FILE_NAME)).unwrap(),
        r#"{"preferred":"USB Headset (2)"}"#
    );
    store_preferred(&nested, None).unwrap();
    assert_eq!(load_preferred(&nested), None);
}

#[test]
fn a_missing_file_means_the_default() {
    let dir = TempDir::new("missing");
    assert_eq!(load_preferred(&dir.0), None);
}

#[test]
fn a_corrupt_file_means_the_default() {
    let dir = TempDir::new("corrupt");
    for junk in ["", "not json", "[]", r#"{"preferred":42}"#, r#"{"preferred":""}"#] {
        std::fs::write(dir.0.join(FILE_NAME), junk).unwrap();
        assert_eq!(load_preferred(&dir.0), None, "{junk:?} should read as the default");
    }
}

// --- Commands --------------------------------------------------------------------

#[tokio::test]
async fn an_engine_without_a_router_lists_nothing_and_refuses_to_switch() {
    for engine in [AudioEngine::new_degraded(), AudioEngine::with_output(rodio::mixer::mixer(2, 48_000).0)] {
        let router = engine.outputs().cloned();
        assert_eq!(list_outputs(router.clone()).await, Ok(OutputsSnapshot::default()));
        assert_eq!(
            set_output(router, Some("Speakers".into())).await,
            Err("no audio output device on this machine".to_string())
        );
    }
}

#[tokio::test]
async fn the_commands_reach_the_router() {
    let mock = Mock::new(&[("Speakers", true), ("Headphones", false)]);
    let (_mixer, router) = router_on(&mock, true);
    let snap = set_output(Some(router.clone()), Some("Headphones".into())).await.unwrap();
    assert_eq!(snap.active.as_deref(), Some("Headphones"));
    let snap = list_outputs(Some(router)).await.unwrap();
    assert_eq!(snap.devices.len(), 2);
}

#[test]
fn the_commands_are_registered_and_allowed() {
    let acl = include_str!("../../permissions/app-commands.toml");
    assert!(acl.contains("\"audio_outputs\""));
    assert!(acl.contains("\"audio_set_output\""));
    let lib = include_str!("../lib.rs");
    assert!(lib.contains("output::audio_outputs"));
    assert!(lib.contains("output::audio_set_output"));
    assert!(lib.contains("\"audio:outputs\""));
}

// --- Linux: the sound server first ------------------------------------------------
//
// A Debian user's .deb played on the laptop speaker while every other app
// used their Bluetooth headphones, and Ember never showed in the volume
// mixer: cpal's ALSA "default" there is the sound card itself, not PipeWire
// or PulseAudio. `ServerFirst` puts a sound server stream in front of ALSA.

use super::server::{stream_env, ServerFirst, SoundServer, SERVER_ID};

/// How the router runs on Linux (see `RouterConfig::for_this_os`).
const LINUX: RouterConfig = RouterConfig { poll: None, trust_absence: false };

/// A sound server that is up or down. A stream on it is the test pulling
/// from the tap, as with `Mock`.
#[derive(Clone, Default)]
struct FakeServer {
    down: Arc<std::sync::atomic::AtomicBool>,
    taps: Arc<Mutex<Vec<Arc<Mutex<Tap>>>>>,
    lost: Arc<Mutex<Vec<OnLost>>>,
}

impl FakeServer {
    fn down() -> Self {
        let s = FakeServer::default();
        s.down.store(true, Ordering::SeqCst);
        s
    }

    fn pull(&self, n: usize) -> Vec<f32> {
        let tap = Arc::clone(self.taps.lock().unwrap().last().expect("a server stream"));
        let mut tap = tap.lock().unwrap();
        tap.by_ref().take(n).collect()
    }

    fn opens(&self) -> usize {
        self.taps.lock().unwrap().len()
    }

    /// The server went away under the stream (a crash, a restart).
    fn drop_out(&self) {
        self.down.store(true, Ordering::SeqCst);
        let lost = self.lost.lock().unwrap().pop();
        if let Some(mut f) = lost {
            f();
        }
    }
}

impl SoundServer for FakeServer {
    fn open(&self, tap: Tap, on_lost: OnLost) -> Result<Box<dyn std::any::Any>, (String, Tap, OnLost)> {
        if self.down.load(Ordering::SeqCst) {
            return Err(("Connection refused".to_string(), tap, on_lost));
        }
        self.taps.lock().unwrap().push(Arc::new(Mutex::new(tap)));
        self.lost.lock().unwrap().push(on_lost);
        Ok(Box::new(()))
    }
}

fn server_first(server: Option<&FakeServer>, alsa: &Mock) -> ServerFirst {
    let server = match server {
        Some(s) => Ok(Box::new(s.clone()) as Box<dyn SoundServer>),
        None => Err("libpulse-simple.so.0: cannot open shared object file".to_string()),
    };
    ServerFirst::new(server, Box::new(alsa.clone()))
}

#[test]
fn the_sound_server_is_listed_first_as_the_default() {
    let alsa = Mock::new(&[("default", true), ("HDA Intel PCH", false)]);
    let server = FakeServer::default();
    let backend = server_first(Some(&server), &alsa);
    assert_eq!(
        backend.devices(),
        vec![dev(SERVER_ID, true), dev("default", false), dev("HDA Intel PCH", false)]
    );
}

#[test]
fn without_a_sound_server_library_the_alsa_list_is_unchanged() {
    let alsa = Mock::new(&[("default", true), ("HDA Intel PCH", false)]);
    let backend = server_first(None, &alsa);
    assert_eq!(backend.devices(), vec![dev("default", true), dev("HDA Intel PCH", false)]);
}

#[test]
fn the_system_default_plays_through_the_sound_server() {
    let alsa = Mock::new(&[("default", true), ("HDA Intel PCH", false)]);
    let server = FakeServer::default();
    let (mixer, router) = start(Box::new(server_first(Some(&server), &alsa)), LINUX).unwrap();
    let snap = router.list().unwrap();
    assert_eq!(snap.active.as_deref(), Some(SERVER_ID));
    assert_eq!(alsa.opens(), 0, "no ALSA device is touched while the sound server plays");
    // And the music reaches it.
    let sink = Sink::connect_new(&mixer);
    sink.append(SamplesBuffer::new(2, 48_000, ramp(20_000)));
    let _warm_up = server.pull(4_096);
    assert_counts_up(&server.pull(4_800), "the sound server stream");
}

#[test]
fn a_sound_server_that_is_down_falls_back_to_alsa_with_the_same_tap() {
    let alsa = Mock::new(&[("default", true), ("HDA Intel PCH", false)]);
    let server = FakeServer::down();
    let (mixer, router) = start(Box::new(server_first(Some(&server), &alsa)), LINUX).unwrap();
    assert_eq!(router.list().unwrap().active.as_deref(), Some("default"));
    let sink = Sink::connect_new(&mixer);
    sink.append(SamplesBuffer::new(2, 48_000, ramp(20_000)));
    let _warm_up = alsa.pull("default", 4_096);
    assert_counts_up(&alsa.pull("default", 4_800), "the ALSA fallback");
}

#[test]
fn an_explicit_alsa_choice_still_works_and_back_to_the_server() {
    let alsa = Mock::new(&[("default", true), ("HDA Intel PCH", false)]);
    let server = FakeServer::default();
    let (_mixer, router) = start(Box::new(server_first(Some(&server), &alsa)), LINUX).unwrap();
    let snap = router.set(Some("HDA Intel PCH".into())).unwrap();
    assert_eq!(snap.active.as_deref(), Some("HDA Intel PCH"));
    assert_eq!(snap.preferred.as_deref(), Some("HDA Intel PCH"));
    let snap = router.set(None).unwrap();
    assert_eq!(snap.active.as_deref(), Some(SERVER_ID));
    let snap = router.set(Some(SERVER_ID.into())).unwrap();
    assert_eq!(snap.active.as_deref(), Some(SERVER_ID));
    assert_eq!(server.opens(), 2, "picking the server it already plays on does not reopen it");
}

#[test]
fn a_dropped_sound_server_connection_moves_to_alsa() {
    let alsa = Mock::new(&[("default", true)]);
    let server = FakeServer::default();
    let (_mixer, router) = start(Box::new(server_first(Some(&server), &alsa)), LINUX).unwrap();
    let seen = listen(&router);
    server.drop_out();
    router.tick_now();
    assert_eq!(actives(&seen).last().cloned().flatten().as_deref(), Some("default"));
}

#[test]
fn why_the_sound_server_was_skipped_reaches_the_app_log() {
    let alsa = Mock::new(&[("default", true)]);
    let (_mixer, router) = start(Box::new(server_first(None, &alsa)), LINUX).unwrap();
    let lines: Arc<Mutex<Vec<String>>> = Arc::default();
    let sink = Arc::clone(&lines);
    // Set after the launch open, as lib.rs does: what happened before is kept.
    router.set_logger(Box::new(move |level, msg| sink.lock().unwrap().push(format!("{level} {msg}"))));
    let lines = lines.lock().unwrap().clone();
    assert!(lines.iter().any(|l| l.contains("libpulse-simple.so.0")), "{lines:?}");
    assert!(lines.iter().any(|l| l.contains("playing on default")), "{lines:?}");
}

#[test]
fn the_stream_is_named_for_the_volume_mixer() {
    let env = stream_env(|_| None);
    let get = |k: &str| env.iter().find(|(name, _)| *name == k).map(|(_, v)| v.clone());
    let pulse = get("PULSE_PROP").expect("PULSE_PROP");
    assert!(pulse.contains("application.name='Ember'"), "{pulse}");
    assert!(pulse.contains("media.role='music'"), "{pulse}");
    assert!(pulse.contains("application.icon_name='ember-desktop'"), "{pulse}");
    let pw: serde_json::Value = serde_json::from_str(&get("PIPEWIRE_PROPS").expect("PIPEWIRE_PROPS")).unwrap();
    assert_eq!(pw["application.name"], "Ember");
    assert_eq!(pw["media.role"], "Music");
    assert_eq!(pw["application.icon-name"], "ember-desktop");
}

#[test]
fn stream_names_never_overwrite_what_the_user_set() {
    let env = stream_env(|k| (k == "PULSE_PROP").then(|| "media.role='game'".to_string()));
    assert!(env.iter().all(|(k, _)| *k != "PULSE_PROP"), "{env:?}");
    assert!(env.iter().any(|(k, _)| *k == "PIPEWIRE_PROPS"));
}

// --- Linux: which ALSA device is "the default" ----------------------------------
//
// The same user's next launch: "native audio failed, falling back to web
// audio". The log said `no audio output (The requested device is no longer
// available...)`, which is cpal's EBUSY: ALSA's "default" was the sound card,
// the sound server was holding it, and the error named only that first
// device. A sound-server PCM never reports busy, so it goes first.

fn names(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn on_alsa_a_sound_server_pcm_is_the_default() {
    let all = names(&["default", "pipewire", "pulse", "HDA Intel PCH"]);
    assert_eq!(default_device_name(&all, Some("default"), true), Some("pipewire"));
    let no_pipewire = names(&["default", "pulse", "HDA Intel PCH"]);
    assert_eq!(default_device_name(&no_pipewire, Some("default"), true), Some("pulse"));
    let bare = names(&["default", "HDA Intel PCH"]);
    assert_eq!(default_device_name(&bare, Some("default"), true), Some("default"));
}

#[test]
fn elsewhere_the_host_default_stands() {
    let mac = names(&["MacBook Pro Speakers", "pulse"]);
    assert_eq!(default_device_name(&mac, Some("MacBook Pro Speakers"), false), Some("MacBook Pro Speakers"));
}

#[test]
fn the_default_is_tried_first_then_the_sound_server_then_the_hardware() {
    let ids = |order: Vec<usize>, devices: &[OutputDevice]| -> Vec<String> {
        order.into_iter().map(|i| devices[i].id.clone()).collect()
    };
    let linux = [
        dev("default", false),
        dev("pipewire", true),
        dev("pulse", false),
        dev("jack", false),
        dev("HDA Intel PCH", false),
        dev("USB DAC", false),
    ];
    assert_eq!(ids(default_order(&linux), &linux), ["pipewire", "pulse", "default", "jack", "HDA Intel PCH", "USB DAC"]);
    let mac = [dev("A", false), dev("B", true), dev("C", false)];
    assert_eq!(ids(default_order(&mac), &mac), ["B", "A", "C"]);
    let none_marked = [dev("A", false), dev("B", false)];
    assert_eq!(ids(default_order(&none_marked), &none_marked), ["A", "B"]);
}

#[test]
fn the_first_device_that_opens_wins() {
    let mut tried = Vec::new();
    let got = open_first(
        vec![("default".to_string(), 1), ("pulse".to_string(), 2), ("HDA Intel PCH".to_string(), 3)],
        |d| {
            tried.push(d);
            if d == 1 { Err("busy".to_string()) } else { Ok(d * 10) }
        },
    );
    assert_eq!(got, Ok(("pulse".to_string(), 20)));
    assert_eq!(tried, [1, 2], "nothing is opened after a success");
}

#[test]
fn when_nothing_opens_every_reason_is_reported() {
    let got: Result<(String, ()), String> = open_first(
        vec![("default".to_string(), ()), ("HDA Intel PCH".to_string(), ())],
        |_| Err("The requested device is no longer available".to_string()),
    );
    let err = got.unwrap_err();
    assert!(err.contains("default: The requested device"), "{err}");
    assert!(err.contains("HDA Intel PCH: The requested device"), "{err}");
    assert_eq!(open_first::<(), ()>(Vec::new(), |_| Ok(())).unwrap_err(), "no output device to open");
}

/// cpal 0.16.0 sized the device list through a shared reference, so a release
/// build read it as empty and CoreAudio wrote the device ids to address 0x4:
/// the app crashed at launch on every Mac. Listing devices on a real machine
/// must just work (vendor/cpal carries the fix). Run with `--release` to catch
/// it, since the bad read only shows up optimized.
#[test]
fn listing_output_devices_does_not_crash() {
    use rodio::cpal::traits::{DeviceTrait, HostTrait};
    let host = rodio::cpal::default_host();
    let names: Vec<String> = host
        .output_devices()
        .map(|it| it.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default();
    // Build machines may have no sound card; the point is reaching this line.
    let _ = (names, host.default_output_device());
}
