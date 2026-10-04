//! Luka, 2026-10-02, Windows desktop 0.7.15: "playback stalled at 1.1s",
//! then "native audio failed, falling back to web audio"; and, on another
//! song, "the song was still decoding after 25s".
//!
//! Both are a slow link read as a dead one. A remuxed song (ftyp, moov, mdat)
//! opens with three requests: the whole body, which the decoder leaves after
//! the moov to read the file's tail (a Range request), and, once the tail is
//! in, the rest of the body (a second Range request, from where the first
//! response stopped). On a slow link every new request waits behind whatever
//! is already on its way to the listener, so each costs seconds before its
//! first byte.
//!
//! - Decoding: the reader waiting on the tail was judged on the request budget
//!   (`is_stalled_during`), but the same wait also ran down the flat 25 s
//!   "still decoding" clock, so a slow head plus a slow tail answer ran out
//!   that clock while the host was answering everything.
//! - Playing: the song starts with the little the first response brought (a
//!   second or so of audio) and then waits on the third request. The
//!   playback watchdog called 6 s without the playhead moving a dead source,
//!   whatever the download was doing, and the webview swapped the whole
//!   session to web audio, which starts the download over.
//!
//! The hosts here answer every request honestly, after a delay chosen per
//! request, and send the body at a fixed rate.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::{http_client, judge_frozen, open_source, DownloadView, Frozen, LoadBudgets, PlayBudgets};

/// 120 s of AAC in a plain m4a (ftyp, moov, mdat): what a host with ffmpeg
/// keeps on disk, and what Luka's songs are.
const TRACK: &[u8] = include_bytes!("../../test-fixtures/tone-faststart.m4a");

/// `bytes=a-b` of a request, if it had one.
type Range = Option<(usize, Option<usize>)>;

/// What the host does with one request.
#[derive(Clone, Copy, Debug)]
enum Answer {
    /// Headers after this long, then the body at the host's rate.
    After(Duration),
    /// Headers at once, then nothing ever again: a connection that died.
    GoQuiet,
}

struct Host {
    url: String,
    log: Arc<Mutex<Vec<String>>>,
}

impl Host {
    fn log(&self) -> Vec<String> {
        self.log.lock().expect("log").clone()
    }
}

fn read_headers(stream: &TcpStream) -> Vec<String> {
    let mut reader = BufReader::new(stream.try_clone().expect("clone"));
    let mut lines = Vec::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
            break;
        }
        lines.push(line.trim().to_string());
    }
    lines
}

fn range_of(lines: &[String]) -> Range {
    let h = lines.iter().find(|l| l.to_lowercase().starts_with("range:"))?;
    let spec = h.split_once('=')?.1.trim();
    let (start, end) = spec.split_once('-')?;
    Some((start.parse().ok()?, end.parse().ok()))
}

/// Whether a request is for the middle of the body: neither the first request
/// nor the decoder's read of the tail. That is the request a song that has
/// started playing waits on.
fn is_middle(range: Range, total: usize) -> bool {
    matches!(range, Some((start, _)) if start > 0 && start < total / 2)
}

/// Serves `body` at `bytes_per_sec`, answering the n-th request (0-based) as
/// `answer(n, range)` says.
fn host(
    body: &'static [u8],
    bytes_per_sec: usize,
    answer: impl Fn(usize, Range) -> Answer + Send + Sync + 'static,
) -> Host {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let count = Arc::new(AtomicUsize::new(0));
    let log = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&log);
    let answer = Arc::new(answer);
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut stream) = conn else { continue };
            let (count, seen, answer) = (Arc::clone(&count), Arc::clone(&seen), Arc::clone(&answer));
            std::thread::spawn(move || {
                let headers = read_headers(&stream);
                let n = count.fetch_add(1, Ordering::SeqCst);
                let range = range_of(&headers);
                seen.lock().expect("log").push(match range {
                    Some((s, e)) => format!("{s}-{}", e.map(|e| e.to_string()).unwrap_or_default()),
                    None => "whole".to_string(),
                });
                let total = body.len();
                let how = answer(n, range);
                if let Answer::After(delay) = how {
                    std::thread::sleep(delay);
                }
                let (status, start, end) = match range {
                    Some((s, e)) => ("206 Partial Content", s, e.unwrap_or(total - 1).min(total - 1)),
                    None => ("200 OK", 0, total - 1),
                };
                let chunk = &body[start..=end];
                let range_header = if range.is_some() {
                    format!("Content-Range: bytes {start}-{end}/{total}\r\n")
                } else {
                    String::new()
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Type: audio/mp4\r\nAccept-Ranges: bytes\r\n{range_header}Content-Length: {}\r\nConnection: close\r\n\r\n",
                    chunk.len()
                );
                let _ = stream.flush();
                if let Answer::GoQuiet = how {
                    std::thread::sleep(Duration::from_secs(120));
                    return;
                }
                // About ten pieces a second, so a slow rate is a trickle and
                // not long silences between big pieces.
                for part in chunk.chunks((bytes_per_sec / 10).clamp(256, 16 * 1024)) {
                    if stream.write_all(part).is_err() {
                        return;
                    }
                    std::thread::sleep(Duration::from_secs_f64(part.len() as f64 / bytes_per_sec as f64));
                }
                let _ = stream.flush();
            });
        }
    });
    Host { url: format!("http://{addr}/api/youtube/stream/n0u4a7k8sqw"), log }
}

// --- Decoding ----------------------------------------------------------------

/// "The song was still decoding after 25s", scaled down: a 2 s decode clock,
/// and a host that takes 2.5 s to start answering each request after the
/// first, the tail read included. The reader waiting on that answer is within
/// its request budget (6 s here) the whole time, and the host answers it: the
/// load must open, not fail on the decode clock.
#[tokio::test(flavor = "multi_thread")]
async fn waiting_on_the_tail_does_not_run_out_the_decode_clock() {
    let host = host(TRACK, 200_000, |n, _| {
        Answer::After(if n == 0 { Duration::from_millis(50) } else { Duration::from_millis(2_500) })
    });
    let budgets = LoadBudgets {
        connect: Duration::from_secs(6),
        stall: Duration::from_secs(1),
        progress: Duration::from_secs(2),
    };
    let started = Instant::now();
    let outcome = open_source(http_client(None).expect("client"), &host.url, budgets).await;
    let took = started.elapsed();
    match outcome {
        Ok(o) => {
            assert!(!o.forward_only, "a remuxed file keeps the seekable decoder");
            (o.stop)();
        }
        Err(e) => panic!("load failed after {took:?}: {} (requests: {:?})", e.message, host.log()),
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
}

/// A host that keeps answering but far too slowly is still given up on: the
/// clock only stops while a request is waiting, not while bytes trickle.
#[tokio::test(flavor = "multi_thread")]
async fn a_body_that_only_trickles_still_runs_out_the_decode_clock() {
    // ~1.5 KB/s: the moov alone takes far longer than the 1.5 s clock.
    let host = host(TRACK, 1_500, |_, _| Answer::After(Duration::from_millis(20)));
    let budgets = LoadBudgets {
        connect: Duration::from_secs(6),
        stall: Duration::from_secs(1),
        progress: Duration::from_millis(1_500),
    };
    let started = Instant::now();
    let outcome = open_source(http_client(None).expect("client"), &host.url, budgets).await;
    let took = started.elapsed();
    let message = match outcome {
        Ok(_) => panic!("a trickle opened (requests: {:?})", host.log()),
        Err(e) => e.message,
    };
    assert!(message.contains("still"), "{message}");
    assert!(took < Duration::from_secs(5), "took {took:?}");
    tokio::time::sleep(Duration::from_millis(300)).await;
}

// --- Playing -------------------------------------------------------------------

fn secs(s: f64) -> Duration {
    Duration::from_secs_f64(s)
}

/// A download still under way, last heard from `quiet` ago.
fn downloading(quiet: f64) -> Option<DownloadView> {
    Some(DownloadView { quiet: secs(quiet), seek_wait: None, complete: false, request_grace: secs(25.0) })
}

#[test]
fn a_short_freeze_is_nothing() {
    let b = PlayBudgets::DEFAULT;
    assert_eq!(judge_frozen(secs(5.75), None, b), Frozen::Fine);
    assert_eq!(judge_frozen(secs(5.75), downloading(30.0), b), Frozen::Fine);
}

/// The report's case: stopped for 6 s while the rest of the song is on its
/// way. Before, that was "playback stalled".
#[test]
fn a_freeze_while_the_download_moves_is_buffering() {
    let b = PlayBudgets::DEFAULT;
    assert_eq!(judge_frozen(secs(6.0), downloading(0.5), b), Frozen::Buffering);
    // A new request queuing on a slow link: nothing has come for 15 s yet.
    assert_eq!(judge_frozen(secs(15.0), downloading(15.0), b), Frozen::Buffering);
}

#[test]
fn a_download_that_went_quiet_is_a_stall() {
    let b = PlayBudgets::DEFAULT;
    assert_eq!(judge_frozen(secs(20.5), downloading(20.5), b), Frozen::Stalled);
}

/// The reader waiting on a request it made gets the request budget, as it
/// does while the song is being opened (`is_stalled_during`).
#[test]
fn a_reader_waiting_on_a_request_gets_the_request_budget() {
    let b = PlayBudgets::DEFAULT;
    let waiting = |wait: f64| {
        Some(DownloadView { quiet: secs(wait), seek_wait: Some(secs(wait)), complete: false, request_grace: secs(25.0) })
    };
    assert_eq!(judge_frozen(secs(22.0), waiting(22.0), b), Frozen::Buffering);
    assert_eq!(judge_frozen(secs(25.5), waiting(25.5), b), Frozen::Stalled);
}

/// Bytes that keep coming but never enough to move the song: given up on,
/// at the buffering cap.
#[test]
fn a_link_too_slow_to_play_from_is_a_stall() {
    let b = PlayBudgets::DEFAULT;
    assert_eq!(judge_frozen(secs(29.75), downloading(0.2), b), Frozen::Buffering);
    assert_eq!(judge_frozen(secs(30.0), downloading(0.2), b), Frozen::Stalled);
}

/// Every byte is here (a cached copy, a finished download): nothing is on
/// its way to wait for, so the old 6 s rule stands.
#[test]
fn a_song_with_nothing_left_to_download_keeps_the_old_rule() {
    let b = PlayBudgets::DEFAULT;
    assert_eq!(judge_frozen(secs(6.0), None, b), Frozen::Stalled);
    let done = Some(DownloadView { quiet: secs(0.1), seek_wait: None, complete: true, request_grace: secs(25.0) });
    assert_eq!(judge_frozen(secs(6.0), done, b), Frozen::Stalled);
}

// Needs tauri's `test` feature, which is off on Windows (see Cargo.toml).
#[cfg(not(windows))]
mod playing {
    use std::sync::atomic::AtomicBool;

    use tauri::test::{mock_app, MockRuntime};
    use tauri::{App, Listener, Manager};

    use super::*;
    use crate::audio::{audio_load, AudioEngine};

    /// A mock app with an engine, a sound card that pulls samples as fast as
    /// the engine gives them, and every event sent.
    struct Rig {
        app: App<MockRuntime>,
        events: Arc<Mutex<Vec<(String, String)>>>,
        stop: Arc<AtomicBool>,
    }

    impl Rig {
        fn new(engine: impl FnOnce(rodio::mixer::Mixer) -> AudioEngine) -> Self {
            let (mixer, mut out) = rodio::mixer::mixer(2, 44_100);
            let stop = Arc::new(AtomicBool::new(false));
            let halt = Arc::clone(&stop);
            std::thread::spawn(move || {
                while !halt.load(Ordering::SeqCst) {
                    if (0..4096).map(|_| out.next()).all(|s| s.is_none()) {
                        std::thread::sleep(Duration::from_millis(1));
                    }
                }
            });
            let app = mock_app();
            app.manage(engine(mixer));
            let events = Arc::new(Mutex::new(Vec::new()));
            for name in ["audio:play", "audio:ended", "audio:error"] {
                let log = Arc::clone(&events);
                app.listen_any(name, move |e| {
                    log.lock().expect("events").push((name.to_string(), e.payload().to_string()));
                });
            }
            Self { app, events, stop }
        }

        async fn load(&self, url: &str) {
            let app = self.app.handle().clone();
            audio_load(app.clone(), app.state::<AudioEngine>(), url.to_string(), true, 0.0, None, None, Some(1))
                .await
                .expect("the load command itself runs");
        }

        fn events(&self) -> Vec<(String, String)> {
            self.events.lock().expect("events").clone()
        }

        fn count(&self, name: &str) -> usize {
            self.events().iter().filter(|(n, _)| n == name).count()
        }

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

    /// The report: the song starts on what the first response brought, then
    /// waits 7 s for the rest of the body to start arriving, past the old 6 s
    /// watchdog. The host answers; the song must play to its end on the
    /// native engine, with no error and so no switch to web audio.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_song_waiting_on_a_slow_answer_keeps_playing_natively() {
        let total = TRACK.len();
        let host = host(TRACK, 400_000, move |_, range| {
            Answer::After(if is_middle(range, total) { Duration::from_secs(7) } else { Duration::from_millis(50) })
        });
        let rig = Rig::new(AudioEngine::with_output);
        rig.load(&host.url).await;

        let ended = rig.until(Duration::from_secs(25), |r| r.count("audio:ended") + r.count("audio:error") > 0).await;
        assert!(ended, "nothing happened (requests: {:?})", host.log());
        assert_eq!(rig.count("audio:error"), 0, "events: {:?} (requests: {:?})", rig.events(), host.log());
        assert_eq!(rig.count("audio:ended"), 1, "events: {:?}", rig.events());
    }

    /// The watchdog on short clocks: a second's freeze is looked at, two
    /// seconds of silence is a dead download.
    const SHORT: PlayBudgets = PlayBudgets {
        frozen: Duration::from_secs(1),
        quiet: Duration::from_secs(2),
        buffering: Duration::from_secs(8),
    };

    /// A song whose download really died: the engine opens it again itself,
    /// once, where it stopped, and only when that dies too does the webview
    /// hear of it, told that the native retry is done.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_dead_download_is_opened_again_once_then_reported() {
        let total = TRACK.len();
        let host = host(TRACK, 400_000, move |_, range| {
            if is_middle(range, total) { Answer::GoQuiet } else { Answer::After(Duration::from_millis(50)) }
        });
        let rig = Rig::new(|m| AudioEngine::with_output(m).with_play_budgets(SHORT));
        rig.load(&host.url).await;

        let failed = rig.until(Duration::from_secs(30), |r| r.count("audio:error") > 0).await;
        assert!(failed, "no error (events: {:?}, requests: {:?})", rig.events(), host.log());
        // Let anything still on its way arrive before counting.
        tokio::time::sleep(Duration::from_secs(1)).await;

        let errors: Vec<_> = rig.events().into_iter().filter(|(n, _)| n == "audio:error").collect();
        assert_eq!(errors.len(), 1, "events: {:?}", rig.events());
        let payload = &errors[0].1;
        assert!(payload.contains("playback stalled"), "{payload}");
        assert!(payload.contains("\"retried\":true"), "the webview must not retry again: {payload}");
        assert!(payload.contains("\"token\":1"), "{payload}");
        let log = host.log();
        assert_eq!(
            log.iter().filter(|r| *r == "whole").count(),
            2,
            "the song is opened twice, the second time by the engine: {log:?}"
        );
        assert_eq!(rig.count("audio:ended"), 0, "a dead song is not a finished one: {:?}", rig.events());
    }

    /// The retry is per song: a new song the webview asks for gets its own.
    #[tokio::test(flavor = "multi_thread")]
    async fn each_song_gets_its_own_retry() {
        let total = TRACK.len();
        let host = host(TRACK, 400_000, move |_, range| {
            if is_middle(range, total) { Answer::GoQuiet } else { Answer::After(Duration::from_millis(50)) }
        });
        let rig = Rig::new(|m| AudioEngine::with_output(m).with_play_budgets(SHORT));
        rig.load(&host.url).await;
        assert!(rig.until(Duration::from_secs(30), |r| r.count("audio:error") == 1).await, "{:?}", rig.events());

        rig.load(&host.url).await;
        assert!(rig.until(Duration::from_secs(30), |r| r.count("audio:error") == 2).await, "{:?}", rig.events());
        let log = host.log();
        assert_eq!(log.iter().filter(|r| *r == "whole").count(), 4, "two opens per song: {log:?}");
    }
}
