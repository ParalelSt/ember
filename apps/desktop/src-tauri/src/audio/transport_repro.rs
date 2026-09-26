//! Play, pause, seek and error reports, through the REAL audio commands.
//!
//! The other test files drive the source chain. These call the commands the
//! webview invokes (`audio_load`, `audio_play`, `audio_pause`, `audio_seek`)
//! on tauri's mock app, against a local fake host, and read back the `audio:*`
//! events the webview would get. The engine plays into a mixer this file
//! drains itself, standing in for the sound card, as fast as it will go: a
//! two minute song plays through in seconds.
//!
//! Bughunt 2026-09-24, P02, P03, P07 and A8.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::test::{mock_app, MockRuntime};
use tauri::{App, AppHandle, Listener, Manager};

use super::{audio_load, audio_pause, audio_play, audio_seek, audio_stop, AudioEngine};

/// 120 s of AAC in a plain m4a: a cached song, decoded seekable.
const TRACK: &[u8] = include_bytes!("../../test-fixtures/tone-faststart.m4a");

/// What the fake host sends for one request.
#[derive(Clone, Copy, Debug)]
enum Answer {
    /// The song, in full.
    Song,
    /// A 200 with bytes no decoder can read: the engine calls this worth a
    /// retry on web audio.
    Garbage,
    /// A 502: the host could not get the song.
    Refuse,
}

struct Host {
    url: String,
    requests: Arc<AtomicUsize>,
}

/// Answers the n-th request (0-based) with `answers[n]`, or the last one past
/// the end, after `delay`: the time a real host spends before its first byte.
fn host(answers: &'static [Answer], delay: Duration) -> Host {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let requests = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&requests);
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut stream) = conn else { continue };
            let count = Arc::clone(&count);
            std::thread::spawn(move || {
                read_headers(&stream);
                let n = count.fetch_add(1, Ordering::SeqCst);
                std::thread::sleep(delay);
                let (status, body): (&str, &[u8]) = match answers[n.min(answers.len() - 1)] {
                    Answer::Song => ("200 OK", TRACK),
                    Answer::Garbage => ("200 OK", &[0u8; 4096]),
                    Answer::Refuse => ("502 Bad Gateway", br#"{"error":"download failed"}"#),
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Type: audio/mp4\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(body);
                let _ = stream.flush();
            });
        }
    });
    Host { url: format!("http://{addr}/api/youtube/stream/abc"), requests }
}

fn read_headers(stream: &TcpStream) {
    let mut reader = BufReader::new(stream.try_clone().expect("clone"));
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
            break;
        }
    }
}

/// A mock app with a managed engine, its sound card, and every event it sent.
struct Rig {
    app: App<MockRuntime>,
    events: Arc<Mutex<Vec<(String, String)>>>,
    stop: Arc<AtomicBool>,
}

impl Rig {
    fn new() -> Self {
        let (mixer, mut out) = rodio::mixer::mixer(2, 44_100);
        let stop = Arc::new(AtomicBool::new(false));
        let halt = Arc::clone(&stop);
        std::thread::spawn(move || {
            while !halt.load(Ordering::SeqCst) {
                // `None` is a mixer with nothing connected yet.
                if (0..4096).map(|_| out.next()).all(|s| s.is_none()) {
                    std::thread::sleep(Duration::from_millis(1));
                }
            }
        });
        let app = mock_app();
        app.manage(AudioEngine::with_output(mixer));
        let events = Arc::new(Mutex::new(Vec::new()));
        for name in ["audio:time", "audio:duration", "audio:play", "audio:pause", "audio:ended", "audio:error"] {
            let log = Arc::clone(&events);
            app.listen_any(name, move |e| {
                log.lock().expect("events").push((name.to_string(), e.payload().to_string()));
            });
        }
        Self { app, events, stop }
    }

    fn engine(&self) -> tauri::State<'_, AudioEngine> {
        self.app.state::<AudioEngine>()
    }

    async fn load(&self, url: &str, autoplay: bool) {
        load_on(self.app.handle().clone(), url.to_string(), autoplay).await;
    }

    fn play(&self) {
        audio_play(self.app.handle().clone(), self.engine());
    }

    fn pause(&self) {
        audio_pause(self.app.handle().clone(), self.engine());
    }

    fn seek(&self, sec: f64) {
        audio_seek(self.app.handle().clone(), self.engine(), sec);
    }

    /// Every event so far, oldest first.
    fn events(&self) -> Vec<(String, String)> {
        self.events.lock().expect("events").clone()
    }

    fn count(&self, name: &str) -> usize {
        self.events().iter().filter(|(n, _)| n == name).count()
    }

    /// The loaded sink: (has sound left, paused), or None when nothing is.
    fn sink(&self) -> Option<(bool, bool)> {
        let engine = self.engine();
        let g = engine.sink.lock().expect("sink");
        g.as_ref().map(|s| (!s.empty(), s.is_paused()))
    }

}

impl Rig {
    /// Waits up to `limit` for `done`, checking every 50 ms.
    async fn until(&self, limit: Duration, done: impl Fn(&Self) -> bool) -> bool {
        let started = Instant::now();
        while started.elapsed() < limit {
            if done(self) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        done(self)
    }
}

impl Drop for Rig {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// The webview's `invoke('audio_load', ...)`, run to completion. Takes the
/// handle rather than the rig so a test can run it as a task of its own.
async fn load_on(app: AppHandle<MockRuntime>, url: String, autoplay: bool) {
    audio_load(app.clone(), app.state::<AudioEngine>(), url, autoplay, 0.0, None, None, None)
        .await
        .expect("the load command itself runs");
}

// --- P03: a superseded load's failure ---------------------------------------

/// The listener clicks song A, which is slow to come, then song B, which plays.
/// Then A fails. Its failure belongs to nobody any more: before the fix it was
/// sent as `audio:error`, which the webview pins on the song now playing (B),
/// and this one (bytes no decoder can read) even carries "try web audio", so
/// the whole session swapped engines over a song nobody was waiting for.
#[tokio::test(flavor = "multi_thread")]
async fn a_superseded_loads_failure_is_not_blamed_on_the_song_now_playing() {
    let rig = Rig::new();
    let slow_broken = host(&[Answer::Garbage], Duration::from_millis(1_500));
    let good = host(&[Answer::Song], Duration::ZERO);

    let a = tokio::spawn(load_on(rig.app.handle().clone(), slow_broken.url.clone(), true));
    tokio::time::sleep(Duration::from_millis(300)).await;
    rig.load(&good.url, true).await;
    a.await.expect("load A");

    let errors: Vec<_> = rig.events().into_iter().filter(|(n, _)| n == "audio:error").collect();
    assert!(errors.is_empty(), "song B was blamed for song A: {errors:?}");
    let loaded = rig.engine().current_url.lock().expect("url").clone();
    assert_eq!(loaded, Some(good.url.clone()), "song B is still the loaded one");
}

/// The fix does not hide a failure that IS the current song's.
#[tokio::test(flavor = "multi_thread")]
async fn the_current_loads_failure_is_still_reported() {
    let rig = Rig::new();
    let broken = host(&[Answer::Garbage], Duration::ZERO);
    rig.load(&broken.url, true).await;
    assert_eq!(rig.count("audio:error"), 1, "events: {:?}", rig.events());
}

// --- P07: play and pause around a load ---------------------------------------

/// The last play or pause the webview was told about.
fn last_transport(events: &[(String, String)]) -> Option<String> {
    events
        .iter()
        .rev()
        .find(|(n, _)| n == "audio:play" || n == "audio:pause")
        .map(|(n, _)| n.clone())
}

/// Pause, pressed while the song is still on its way. There was no sink to
/// pause yet, so the press was dropped and the song started anyway, with the
/// player saying "playing" again.
#[tokio::test(flavor = "multi_thread")]
async fn a_pause_during_a_slow_load_is_kept() {
    let rig = Rig::new();
    let slow = host(&[Answer::Song], Duration::from_millis(1_500));
    let load = tokio::spawn(load_on(rig.app.handle().clone(), slow.url.clone(), true));
    tokio::time::sleep(Duration::from_millis(300)).await;
    rig.pause();
    load.await.expect("load");

    assert_eq!(rig.sink(), Some((true, true)), "the song is loaded, paused");
    assert_eq!(last_transport(&rig.events()).as_deref(), Some("audio:pause"));
}

/// And play after that pause, still during the load, plays.
#[tokio::test(flavor = "multi_thread")]
async fn play_after_a_pause_during_a_load_plays() {
    let rig = Rig::new();
    let slow = host(&[Answer::Song], Duration::from_millis(1_500));
    let load = tokio::spawn(load_on(rig.app.handle().clone(), slow.url.clone(), true));
    tokio::time::sleep(Duration::from_millis(300)).await;
    rig.pause();
    rig.play();
    load.await.expect("load");

    assert_eq!(rig.sink().map(|(_, paused)| paused), Some(false), "the song plays");
    assert_eq!(last_transport(&rig.events()).as_deref(), Some("audio:play"));
}

/// After a load failed there was nothing loaded, so play did nothing, and the
/// only way to hear the song was to find it and click it again. Play now
/// tries the song again.
#[tokio::test(flavor = "multi_thread")]
async fn play_after_a_failed_load_tries_the_song_again() {
    let rig = Rig::new();
    let flaky = host(&[Answer::Refuse, Answer::Song], Duration::ZERO);
    rig.load(&flaky.url, true).await;
    assert_eq!(rig.count("audio:error"), 1, "the first attempt fails");

    rig.play();

    let playing = rig
        .until(Duration::from_secs(10), |r| r.sink().is_some_and(|(_, paused)| !paused))
        .await;
    assert!(
        playing,
        "play after the failure did nothing: {} request(s) to the host",
        flaky.requests.load(Ordering::SeqCst)
    );
}

// --- P02: repeat one ---------------------------------------------------------

/// The latest position the engine reported after the `from`-th event.
fn latest_time_after(events: &[(String, String)], from: usize) -> f64 {
    events[from..]
        .iter()
        .filter(|(n, _)| n == "audio:time")
        .filter_map(|(_, p)| serde_json::from_str::<serde_json::Value>(p).ok()?["sec"].as_f64())
        .last()
        .unwrap_or(0.0)
}

/// With repeat one on, the webview answers `audio:ended` with a seek to 0 and
/// a play (PlayerProvider's onEnded). By then the sink has played its source
/// to the end, and rodio accepts a seek on an empty sink and does nothing, so
/// the song "restarted" into silence with the slider stuck at 0:00.
#[tokio::test(flavor = "multi_thread")]
async fn repeat_one_plays_the_song_again_after_it_ends() {
    let rig = Rig::new();
    let song = host(&[Answer::Song], Duration::ZERO);
    rig.load(&song.url, true).await;
    assert!(
        rig.until(Duration::from_secs(60), |r| r.count("audio:ended") == 1).await,
        "the song should play through first: {:?}",
        rig.events().last()
    );

    let mark = rig.events().len();
    rig.seek(0.0);
    rig.play();

    let again = rig.until(Duration::from_secs(20), |r| latest_time_after(&r.events(), mark) > 5.0).await;
    assert!(
        again,
        "the repeat never got past {:.1}s",
        latest_time_after(&rig.events(), mark)
    );
    assert!(
        rig.until(Duration::from_secs(60), |r| r.count("audio:ended") == 2).await,
        "the repeat should reach the end again"
    );
}

// --- A8: stop around a load --------------------------------------------------

/// Stop, pressed while the song is still on its way. Stop dropped the sink,
/// but there was none yet: the load went on, put its sink in and played the
/// song the listener had just stopped.
#[tokio::test(flavor = "multi_thread")]
async fn a_stop_during_a_slow_load_is_kept() {
    let rig = Rig::new();
    let slow = host(&[Answer::Song], Duration::from_millis(1_500));
    let load = tokio::spawn(load_on(rig.app.handle().clone(), slow.url.clone(), true));
    tokio::time::sleep(Duration::from_millis(300)).await;
    audio_stop(rig.engine());
    load.await.expect("load");

    assert_eq!(rig.sink(), None, "stop was pressed during the load, yet a sink went in");
    assert_eq!(rig.count("audio:play"), 0, "audio:play after stop: {:?}", rig.events());
    assert!(!rig.engine().load_in_flight(), "nothing is loading after a stop");
    assert_eq!(rig.engine().widget().playback, Some(souvlaki::MediaPlayback::Stopped), "the OS widget says stopped");
}

// --- Bughunt 2026-09-25

/// The loaded sink's position, or None when nothing is loaded.
fn sink_pos(rig: &Rig) -> Option<f64> {
    let engine = rig.engine();
    let g = engine.sink.lock().expect("sink");
    g.as_ref().map(|s| s.get_pos().as_secs_f64())
}

/// D1. The last song in the queue plays to its end, and the listener presses
/// play. A web browser starts the song again; the desktop engine played its
/// used-up sink, which does nothing, and said "playing" over the silence.
#[tokio::test(flavor = "multi_thread")]
async fn play_after_the_song_ran_out_plays_it_again() {
    let rig = Rig::new();
    let song = host(&[Answer::Song], Duration::ZERO);
    rig.load(&song.url, true).await;
    assert!(
        rig.until(Duration::from_secs(60), |r| r.count("audio:ended") == 1).await,
        "the song should play through first"
    );

    let mark = rig.events().len();
    rig.play();

    let again = rig.until(Duration::from_secs(20), |r| latest_time_after(&r.events(), mark) > 5.0).await;
    assert!(again, "play after the end stayed silent at {:.1}s", latest_time_after(&rig.events(), mark));
}

/// D1, repeat one after the fix: the webview's seek to 0 and play re-open the
/// song once, not twice (play must see the seek's load and leave it be).
#[tokio::test(flavor = "multi_thread")]
async fn repeat_one_reopens_the_song_once() {
    let rig = Rig::new();
    let song = host(&[Answer::Song], Duration::ZERO);
    rig.load(&song.url, true).await;
    assert!(rig.until(Duration::from_secs(60), |r| r.count("audio:ended") == 1).await);

    rig.seek(0.0);
    rig.play();
    let mark = rig.events().len();
    assert!(rig.until(Duration::from_secs(20), |r| latest_time_after(&r.events(), mark) > 5.0).await);
    let loads = rig.engine().load_seq.load(Ordering::SeqCst);
    assert_eq!(loads, 2, "one load, one re-open");
}

/// D1: at the end of the queue the engine has stopped. Dragging the slider
/// there moves it, as in a browser, but does not start the song by itself.
#[tokio::test(flavor = "multi_thread")]
async fn a_seek_after_the_song_ran_out_does_not_start_it() {
    let rig = Rig::new();
    let song = host(&[Answer::Song], Duration::ZERO);
    rig.load(&song.url, true).await;
    assert!(rig.until(Duration::from_secs(60), |r| r.count("audio:ended") == 1).await);

    rig.seek(30.0);
    let reloaded = rig
        .until(Duration::from_secs(10), |r| r.sink().is_some_and(|(sound_left, paused)| sound_left && paused))
        .await;
    assert!(reloaded, "the seek re-opens the song (paused, not played through): {:?}", rig.sink());
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(rig.sink().map(|(_, paused)| paused), Some(true), "it waits, paused, for play");
    let pos = sink_pos(&rig).unwrap_or(0.0);
    assert!((29.0..31.0).contains(&pos), "at the slider's spot: {pos:.1}");
}

/// D2. The listener clicks a song and, while it is still on its way, clicks
/// 1:00 on the progress bar (the bar is live: the catalog knows the length).
/// There was no sink to seek, the seek was dropped, and the song started at
/// 0:00 with the slider jumping back.
#[tokio::test(flavor = "multi_thread")]
async fn a_seek_during_a_slow_load_is_kept() {
    let rig = Rig::new();
    let slow = host(&[Answer::Song], Duration::from_millis(1_500));
    let load = tokio::spawn(load_on(rig.app.handle().clone(), slow.url.clone(), false));
    tokio::time::sleep(Duration::from_millis(300)).await;
    rig.seek(60.0);
    load.await.expect("load");

    let settled = rig.until(Duration::from_secs(5), |r| sink_pos(r).is_some_and(|p| p >= 59.0)).await;
    assert!(settled, "the song started at {:?}s, not at the 60s asked for", sink_pos(&rig));
}

/// A host for a song that is still arriving: the first response sends the
/// head of the file and then nothing more, the tail (what the decoder reads
/// while it is built) is answered at once, and any other Range request only
/// after `mid_delay`, the time a busy link takes to answer.
fn trickle_host(mid_delay: Duration) -> Host {
    trickle_host_with(mid_delay, false)
}

/// `trickle_host`, where the first Range request into the middle is answered
/// at once with a little of the song and then nothing more, and every later
/// one (the download reconnecting) not at all: a link that dropped while the
/// song was arriving.
fn stalling_host() -> Host {
    trickle_host_with(Duration::ZERO, true)
}

fn trickle_host_with(mid_delay: Duration, mid_stalls: bool) -> Host {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let requests = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&requests);
    let mids = Arc::new(AtomicUsize::new(0));
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut stream) = conn else { continue };
            let count = Arc::clone(&count);
            let mids = Arc::clone(&mids);
            std::thread::spawn(move || {
                let mut reader = BufReader::new(stream.try_clone().expect("clone"));
                let mut range = None;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
                        break;
                    }
                    let l = line.trim().to_lowercase();
                    if let Some(spec) = l.strip_prefix("range: bytes=") {
                        range = spec.split('-').next().and_then(|s| s.parse::<usize>().ok());
                    }
                }
                count.fetch_add(1, Ordering::SeqCst);
                let total = TRACK.len();
                match range {
                    None => {
                        let _ = write!(
                            stream,
                            "HTTP/1.1 200 OK\r\nContent-Type: audio/mp4\r\nAccept-Ranges: bytes\r\nContent-Length: {total}\r\n\r\n"
                        );
                        let _ = stream.write_all(&TRACK[..96 * 1024]);
                        let _ = stream.flush();
                        std::thread::sleep(Duration::from_secs(60));
                    }
                    Some(start) => {
                        let mid = start < total.saturating_sub(64 * 1024);
                        if mid {
                            std::thread::sleep(mid_delay);
                        }
                        if mid && mid_stalls {
                            if mids.fetch_add(1, Ordering::SeqCst) > 0 {
                                std::thread::sleep(Duration::from_secs(60));
                                return;
                            }
                            let _ = write!(
                                stream,
                                "HTTP/1.1 206 Partial Content\r\nContent-Type: audio/mp4\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {start}-{}/{total}\r\nContent-Length: {}\r\n\r\n",
                                total - 1,
                                total - start
                            );
                            let _ = stream.write_all(&TRACK[start..(start + 32 * 1024).min(total)]);
                            let _ = stream.flush();
                            std::thread::sleep(Duration::from_secs(60));
                            return;
                        }
                        let start = start.min(total);
                        let _ = write!(
                            stream,
                            "HTTP/1.1 206 Partial Content\r\nContent-Type: audio/mp4\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {start}-{}/{total}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            total - 1,
                            total - start
                        );
                        let _ = stream.write_all(&TRACK[start..]);
                        let _ = stream.flush();
                    }
                }
            });
        }
    });
    Host { url: format!("http://{addr}/api/youtube/stream/abc"), requests }
}

/// D3. A seek past what has arrived makes the engine ask the host for those
/// bytes, and `audio_seek` waited for the answer. It is a plain (sync) tauri
/// command, which runs on the app's main thread: the whole window froze for
/// as long as the host took, seconds on a slow link.
#[tokio::test(flavor = "multi_thread")]
async fn a_seek_does_not_wait_for_the_host() {
    let rig = Rig::new();
    let song = trickle_host(Duration::from_secs(3));
    rig.load(&song.url, false).await;
    assert!(rig.sink().is_some(), "loaded: {:?}", rig.events());

    let app = rig.app.handle().clone();
    let started = Instant::now();
    let call = tokio::task::spawn_blocking(move || {
        audio_seek(app.clone(), app.state::<AudioEngine>(), 100.0);
    });
    let _ = tokio::time::timeout(Duration::from_secs(15), call).await;
    let took = started.elapsed();
    assert!(took < Duration::from_millis(500), "audio_seek held its caller for {took:?}");

    // And the seek still happens, once the bytes are there.
    let moved = rig.until(Duration::from_secs(10), |r| sink_pos(r).is_some_and(|p| p >= 99.0)).await;
    assert!(moved, "the seek never landed: {:?}", sink_pos(&rig));
}

/// D5. Every report about a load's playback carries the webview's tag for
/// that load, so the webview can drop one that was already on its way when
/// it loaded the next song: the old song's playhead (or its end) used to be
/// taken for the new one's.
#[tokio::test(flavor = "multi_thread")]
async fn reports_carry_the_tag_of_the_load_they_are_about() {
    let rig = Rig::new();
    let song = host(&[Answer::Song], Duration::ZERO);
    let app = rig.app.handle().clone();
    audio_load(app.clone(), app.state::<AudioEngine>(), song.url.clone(), true, 0.0, None, None, Some(7))
        .await
        .expect("load");
    assert!(rig.until(Duration::from_secs(60), |r| r.count("audio:ended") == 1).await);

    let events = rig.events();
    let about = |name: &str| -> Vec<Option<u64>> {
        events
            .iter()
            .filter(|(n, _)| n == name)
            .map(|(_, p)| serde_json::from_str::<serde_json::Value>(p).ok().and_then(|v| v["token"].as_u64()))
            .collect()
    };
    let times = about("audio:time");
    assert!(!times.is_empty() && times.iter().all(|t| *t == Some(7)), "audio:time tags: {times:?}");
    assert_eq!(about("audio:ended"), vec![Some(7)]);
}

/// A webview that sends no tag (every web build before this one) gets
/// reports without one, which it reads as before.
#[tokio::test(flavor = "multi_thread")]
async fn an_untagged_load_reports_untagged() {
    let rig = Rig::new();
    let song = host(&[Answer::Song], Duration::ZERO);
    rig.load(&song.url, true).await;
    assert!(rig.until(Duration::from_secs(5), |r| r.count("audio:time") > 0).await);
    let tagged = rig.events().iter().filter(|(_, p)| p.contains("token")).count();
    assert_eq!(tagged, 0, "{:?}", rig.events());
}

/// D2, the other half: a second seek right after one that re-opens the song
/// (here, after its end) goes to that load, not to the sink it replaces.
/// It used to start a second re-open of its own.
#[tokio::test(flavor = "multi_thread")]
async fn a_seek_right_after_a_reopen_joins_it() {
    let rig = Rig::new();
    let song = host(&[Answer::Song], Duration::ZERO);
    rig.load(&song.url, false).await;
    rig.play();
    assert!(rig.until(Duration::from_secs(60), |r| r.count("audio:ended") == 1).await);

    rig.seek(10.0);
    rig.seek(50.0);
    let landed = rig
        .until(Duration::from_secs(10), |r| sink_pos(r).is_some_and(|p| (49.0..51.0).contains(&p)))
        .await;
    assert!(landed, "the song is at {:?}, not the second seek's 50s", sink_pos(&rig));
    assert_eq!(rig.engine().load_seq.load(Ordering::SeqCst), 2, "one load, one re-open");
}

/// D8. The song playing stops arriving (the link dropped) and the listener
/// skips to the next one. The audio thread was still blocked reading the
/// old song's stream, which waits for bytes as long as its download keeps
/// retrying, and every sink shares that thread: the next song stayed silent
/// until the watchdog gave up on it too and the app swapped to web audio.
#[tokio::test(flavor = "multi_thread")]
async fn the_next_song_plays_when_the_one_before_starved() {
    let rig = Rig::new();
    let dead = stalling_host();
    rig.load(&dead.url, true).await;
    // Plays what arrived, then blocks in a read that is never answered.
    assert!(rig.until(Duration::from_secs(10), |r| latest_time_after(&r.events(), 0) > 5.0).await);
    tokio::time::sleep(Duration::from_millis(500)).await;

    let good = host(&[Answer::Song], Duration::ZERO);
    let mark = rig.events().len();
    rig.load(&good.url, true).await;

    let plays = rig.until(Duration::from_secs(5), |r| latest_time_after(&r.events(), mark) > 5.0).await;
    assert!(plays, "the next song is stuck at {:.1}s", latest_time_after(&rig.events(), mark));
}

/// D9. A load meant to stay paused (the song restored at launch) or to
/// resume part way in built a sink that was already playing, and paused or
/// seeked it only afterwards: the start of the song leaked out in between,
/// a click at launch, and on a busy machine whole seconds of it.
#[tokio::test(flavor = "multi_thread")]
async fn a_paused_load_makes_no_sound() {
    let (mixer, mut out) = rodio::mixer::mixer(2, 44_100);
    let heard = Arc::new(AtomicUsize::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    {
        let heard = Arc::clone(&heard);
        let stop = Arc::clone(&stop);
        std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                let mut any = false;
                for _ in 0..4096 {
                    match out.next() {
                        Some(s) if s.abs() > 1e-4 => {
                            heard.fetch_add(1, Ordering::SeqCst);
                            any = true;
                        }
                        Some(_) => any = true,
                        None => {}
                    }
                }
                if !any {
                    std::thread::sleep(Duration::from_millis(1));
                }
            }
        });
    }
    let app = mock_app();
    app.manage(AudioEngine::with_output(mixer));
    let song = host(&[Answer::Song], Duration::ZERO);
    for start_at in [0.0, 60.0] {
        audio_load(app.handle().clone(), app.state::<AudioEngine>(), song.url.clone(), false, start_at, None, None, None)
            .await
            .expect("load");
    }
    tokio::time::sleep(Duration::from_millis(200)).await;
    stop.store(true, Ordering::SeqCst);
    assert_eq!(heard.load(Ordering::SeqCst), 0, "samples heard from loads meant to stay paused");
}

/// Review of D3: the OS widget heard about a seek with the play state from
/// when the seek began. Pause pressed while the seek waited on the host left
/// the widget saying "Playing" over a paused song.
#[tokio::test(flavor = "multi_thread")]
async fn a_pause_during_a_slow_seek_leaves_the_widget_paused() {
    let rig = Rig::new();
    let song = trickle_host(Duration::from_secs(2));
    rig.load(&song.url, true).await;
    rig.seek(100.0);
    tokio::time::sleep(Duration::from_millis(300)).await;
    rig.pause();
    assert!(rig.until(Duration::from_secs(10), |r| sink_pos(r).is_some_and(|p| p >= 99.0)).await, "the seek lands");
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(
        matches!(rig.engine().widget().playback, Some(souvlaki::MediaPlayback::Paused { .. })),
        "widget: {:?}",
        rig.engine().widget().playback
    );
}
