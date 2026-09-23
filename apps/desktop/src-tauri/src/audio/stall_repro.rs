//! "The song stopped arriving while decoding (nothing for 3s)".
//!
//! Reported from the Windows desktop app on 2026-09-22 and 2026-09-23 for
//! youtube:OuB-iWbGJqw, EOugbQC1r0s, TwFXwkKyGSQ and fLgidPGdi3w, with no
//! error on the host. See docs/reports/2026-09-22-stream-stall-nier.md.
//!
//! The load never got as far as playing: it failed while the DECODER was being
//! built. These tests serve the engine a body shaped like the real one (see
//! the fixture below) from a host that behaves like the real one: every
//! request costs a round trip before its first byte, the way a fresh
//! connection through the Tailscale Funnel the app talks to does.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::{
    http_client, open_source, open_source_retrying, plan_seek, sniff_fragmented, LoadBudgets,
    SeekPlan,
};

/// The old tone fixture in the same layout, with small (~20 KB) fragments.
const TONE_DASH: &[u8] = include_bytes!("../../test-fixtures/tone-dash.m4a");
/// 40 s of AAC at 160 kbps as a FRAGMENTED mp4 with a segment index and one
/// ~200 KB moof/mdat pair per 10 s: the layout googlevideo serves for itag 140
/// (ftyp, moov, sidx, then a moof/mdat pair per ~10 s, each mdat ~160 KB). It
/// is what the stream route proxies, and what a host without ffmpeg keeps in
/// its cache, because yt-dlp's m4a fixup is an ffmpeg remux. Made with ffmpeg
/// (`-movflags +frag_keyframe+empty_moov+default_base_moof+global_sidx
/// -frag_duration 10000000`), then the track length stamped into mvhd and
/// mdhd the way googlevideo's moov carries it (ffmpeg's empty moov says 0).
const FRAGMENTED: &[u8] = include_bytes!("../../test-fixtures/noise-dash-10s-fragments.m4a");
/// The same kind of audio after that remux: ftyp, moov, mdat.
const FASTSTART: &[u8] = include_bytes!("../../test-fixtures/tone-faststart.m4a");
/// moof/mdat pairs in FRAGMENTED.
const FRAGMENTS: usize = 4;

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

fn range_of(lines: &[String]) -> Option<(usize, Option<usize>)> {
    let h = lines
        .iter()
        .find(|l| l.to_lowercase().starts_with("range:"))?;
    let spec = h.split_once('=')?.1.trim();
    let (start, end) = spec.split_once('-')?;
    Some((start.parse().ok()?, end.parse().ok()))
}

/// A host that answers every request honestly (200, or 206 for a Range), after
/// `delay(n)` for the n-th request (0-based): the time a real one spends before
/// its first byte.
struct SlowHost {
    url: String,
    requests: Arc<AtomicUsize>,
    log: Arc<Mutex<Vec<String>>>,
}

fn slow_host(
    body: &'static [u8],
    delay: impl Fn(usize) -> Duration + Send + Sync + 'static,
) -> SlowHost {
    throttled_host(body, delay, None)
}

/// `slow_host`, with the body sent at no more than `bytes_per_sec`.
fn throttled_host(
    body: &'static [u8],
    delay: impl Fn(usize) -> Duration + Send + Sync + 'static,
    bytes_per_sec: Option<usize>,
) -> SlowHost {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let requests = Arc::new(AtomicUsize::new(0));
    let log = Arc::new(Mutex::new(Vec::new()));
    let (count, seen) = (Arc::clone(&requests), Arc::clone(&log));
    let delay = Arc::new(delay);
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut stream) = conn else { continue };
            let (count, seen, delay) = (Arc::clone(&count), Arc::clone(&seen), Arc::clone(&delay));
            std::thread::spawn(move || {
                let headers = read_headers(&stream);
                let n = count.fetch_add(1, Ordering::SeqCst);
                let range = range_of(&headers);
                seen.lock().expect("log").push(match range {
                    Some((s, e)) => format!("{s}-{}", e.map(|e| e.to_string()).unwrap_or_default()),
                    None => "whole".to_string(),
                });
                std::thread::sleep(delay(n));
                let total = body.len();
                let (status, start, end) = match range {
                    Some((s, e)) => (
                        "206 Partial Content",
                        s,
                        e.unwrap_or(total - 1).min(total - 1),
                    ),
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
                for part in chunk.chunks(16 * 1024) {
                    if stream.write_all(part).is_err() {
                        return;
                    }
                    if let Some(bps) = bytes_per_sec {
                        std::thread::sleep(Duration::from_secs_f64(part.len() as f64 / bps as f64));
                    }
                }
                let _ = stream.flush();
            });
        }
    });
    SlowHost {
        url: format!("http://{addr}/api/youtube/stream/EOugbQC1r0s"),
        requests,
        log,
    }
}

struct Load {
    took: Duration,
    outcome: Result<(Option<Duration>, bool), String>,
}

/// A real load's source stage, with the stall retry `audio_load` uses.
async fn load(url: &str) -> Load {
    let started = Instant::now();
    let outcome = open_source_retrying(
        http_client(None).expect("client"),
        url,
        LoadBudgets::DEFAULT,
        || true,
        |_| {},
    )
    .await
    .map(|o| (o.total, o.forward_only))
    .map_err(|e| e.message);
    let took = started.elapsed();
    // Let a cancelled download notice before the runtime is dropped (see
    // fastfail::settle).
    tokio::time::sleep(Duration::from_millis(300)).await;
    Load { took, outcome }
}

fn requests_for(host: &SlowHost) -> usize {
    host.requests.load(Ordering::SeqCst)
}

/// A modest link: 100 ms before each response's first byte, 400 KB/s after.
/// Fast enough that nothing here is slow for being big, slow enough that the
/// body is still arriving while the decoder is built, as it is on the host.
fn modest_host(body: &'static [u8]) -> SlowHost {
    throttled_host(body, |_| Duration::from_millis(100), Some(400_000))
}

// --- The cause --------------------------------------------------------------

/// A fragmented body opens from the one request already flowing. Before the
/// fix the decoder walked every moof up front, one Range request per fragment
/// (33 for EOugbQC1r0s over a 300 ms link, 16 s before the first note, see the
/// report), and every one of them was a round trip the 3 s stall budget could
/// catch.
#[tokio::test(flavor = "multi_thread")]
async fn a_fragmented_stream_opens_from_one_request() {
    let host = modest_host(FRAGMENTED);
    let got = load(&host.url).await;
    let (total, forward_only) = got.outcome.expect("load");
    assert!(forward_only, "a fragmented body is decoded forward-only");
    assert!(
        total.is_some_and(|t| (t.as_secs_f64() - 40.0).abs() < 1.0),
        "the segment index still gives the length: {total:?}"
    );
    assert_eq!(
        requests_for(&host),
        1,
        "requests: {:?}",
        host.log.lock().unwrap()
    );
}

/// The report itself. The host answers the first request at once and then
/// every further round trip takes 3.5 s, past the stall budget, which is what
/// a fresh connection through the Funnel can cost while the host is still
/// pushing out bodies the client already dropped. The old engine failed this
/// with exactly the reported message; nothing the song needs is behind a
/// second request now.
#[tokio::test(flavor = "multi_thread")]
async fn slow_round_trips_do_not_fail_a_fragmented_load() {
    let host = throttled_host(
        FRAGMENTED,
        |n| {
            if n == 0 {
                Duration::from_millis(50)
            } else {
                Duration::from_millis(3_500)
            }
        },
        Some(400_000),
    );
    let got = load(&host.url).await;
    assert!(
        got.outcome.is_ok(),
        "load failed after {:?}: {:?} (requests: {:?})",
        got.took,
        got.outcome,
        host.log.lock().unwrap()
    );
    assert!(got.took < Duration::from_secs(3), "took {:?}", got.took);
}

/// The remuxed (cached) layout keeps its seekable decoder, and is ready after
/// one short read of its tail instead of after the whole body: the default
/// 256 KB prefetch made that tail seek wait for the linear download to get
/// there (7.4 s for a 5.4 MB track at 1 MB/s; this 0.5 MB fixture at 100 KB/s
/// took about 5 s).
#[tokio::test(flavor = "multi_thread")]
async fn a_faststart_file_is_ready_without_waiting_for_the_whole_body() {
    let host = throttled_host(FASTSTART, |_| Duration::from_millis(100), Some(100_000));
    let got = load(&host.url).await;
    let (_, forward_only) = got.outcome.expect("load");
    assert!(!forward_only, "a remuxed file keeps the seekable decoder");
    assert!(
        got.took < Duration::from_millis(2_500),
        "took {:?} for a body that needs {:.1}s to arrive in full (requests: {:?})",
        got.took,
        FASTSTART.len() as f64 / 100_000.0,
        host.log.lock().unwrap()
    );
}

// --- Resilience -------------------------------------------------------------

/// A host that answers, sends `sent` bytes and goes quiet on its first
/// request, and serves every later one in full.
fn stalls_once(body: &'static [u8], sent: usize) -> SlowHost {
    stalls_on(body, sent, 1)
}

/// The same, stalling on the first `times` requests.
fn stalls_on(body: &'static [u8], sent: usize, times: usize) -> SlowHost {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let requests = Arc::new(AtomicUsize::new(0));
    let log = Arc::new(Mutex::new(Vec::new()));
    let (count, seen) = (Arc::clone(&requests), Arc::clone(&log));
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut stream) = conn else { continue };
            let (count, seen) = (Arc::clone(&count), Arc::clone(&seen));
            std::thread::spawn(move || {
                let headers = read_headers(&stream);
                let n = count.fetch_add(1, Ordering::SeqCst);
                seen.lock()
                    .expect("log")
                    .push(format!("{:?}", range_of(&headers)));
                let total = body.len();
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: audio/mp4\r\nAccept-Ranges: bytes\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n"
                );
                if n < times {
                    let _ = stream.write_all(&body[..sent]);
                    let _ = stream.flush();
                    std::thread::sleep(Duration::from_secs(60));
                } else {
                    let _ = stream.write_all(body);
                    let _ = stream.flush();
                }
            });
        }
    });
    SlowHost {
        url: format!("http://{addr}/api/youtube/stream/EOugbQC1r0s"),
        requests,
        log,
    }
}

/// A stall used to end the load for good ("Couldn't load", and the listener
/// clicks again). One stall now gets one more try on a fresh request.
#[tokio::test(flavor = "multi_thread")]
async fn a_stall_is_retried_once_on_a_fresh_request() {
    let host = stalls_once(FRAGMENTED, 8 * 1024);
    let got = load(&host.url).await;
    assert!(got.outcome.is_ok(), "load failed: {:?}", got.outcome);
    assert_eq!(requests_for(&host), 2);
}

/// Only once: a host that stalls again is reported, still within seconds, with
/// both failures in the message.
#[tokio::test(flavor = "multi_thread")]
async fn a_second_stall_is_reported() {
    let host = stalls_on(FRAGMENTED, 8 * 1024, 2);
    let got = load(&host.url).await;
    let message = got.outcome.expect_err("two stalls fail the load");
    assert!(
        message.contains("stopped arriving") && message.contains("second attempt"),
        "{message}"
    );
    assert_eq!(requests_for(&host), 2);
    assert!(got.took < Duration::from_secs(9), "took {:?}", got.took);
}

/// A listener who has moved on does not pay for a retry.
#[tokio::test(flavor = "multi_thread")]
async fn a_superseded_load_is_not_retried() {
    let host = stalls_once(FRAGMENTED, 8 * 1024);
    let outcome = open_source_retrying(
        http_client(None).expect("client"),
        &host.url,
        LoadBudgets::DEFAULT,
        || false,
        |_| panic!("no retry for a load nobody wants"),
    )
    .await;
    assert!(outcome.is_err());
    assert_eq!(requests_for(&host), 1);
    tokio::time::sleep(Duration::from_millis(300)).await;
}

// --- Which bodies are fragmented --------------------------------------------

#[test]
fn fragmented_bodies_are_told_from_remuxed_ones() {
    assert_eq!(sniff_fragmented(FRAGMENTED), Some(true));
    assert_eq!(sniff_fragmented(TONE_DASH), Some(true));
    assert_eq!(sniff_fragmented(FASTSTART), Some(false));
    // Not an mp4 at all (a webm starts with the EBML magic): left alone.
    assert_eq!(
        sniff_fragmented(&[0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0, 0, 0]),
        Some(false)
    );
}

/// Undecided until the bytes that decide it have arrived, and decided by the
/// head alone: a remuxed file is known once its moov and the mdat header after
/// it are in, without reading any audio.
#[test]
fn the_verdict_needs_only_the_head() {
    assert_eq!(sniff_fragmented(&[]), None);
    assert_eq!(
        sniff_fragmented(&FASTSTART[..64]),
        None,
        "the moov is not all there yet"
    );
    // ftyp (28) + moov (11103) + free (8) + the mdat header.
    assert_eq!(sniff_fragmented(&FASTSTART[..11_147]), Some(false));
    // ftyp (28) + moov (681): the moov's mvex already says it.
    assert_eq!(sniff_fragmented(&FRAGMENTED[..709]), Some(true));
}

// --- Seeking a forward-only track -------------------------------------------

/// A forward-only decoder cannot go back, so a backward seek re-opens the
/// track at the target; a forward one is still the decoder's to do, and a
/// seekable track is unchanged.
#[test]
fn backward_seeks_in_a_forward_only_track_reopen_it() {
    let total = Some(Duration::from_secs(337));
    let at = Duration::from_secs(120);
    assert_eq!(
        plan_seek(total, true, at, 30.0),
        SeekPlan::Reopen(Duration::from_secs(30))
    );
    assert_eq!(
        plan_seek(total, true, at, 0.0),
        SeekPlan::Reopen(Duration::ZERO)
    );
    assert_eq!(
        plan_seek(total, true, at, 200.0),
        SeekPlan::InPlace(Duration::from_secs(200))
    );
    assert_eq!(
        plan_seek(total, false, at, 30.0),
        SeekPlan::InPlace(Duration::from_secs(30))
    );
    // A zero length is still refused, forward-only or not (see seek_target).
    assert_eq!(
        plan_seek(Some(Duration::ZERO), true, at, 30.0),
        SeekPlan::Refuse
    );
}

/// Why a backward seek re-opens instead: handed to a forward-only decoder, it
/// is accepted and then the next packet cannot be read, which rodio reports as
/// the end of the track, i.e. the player would move on to the next song. A
/// forward seek in the same decoder is fine.
#[tokio::test(flavor = "multi_thread")]
async fn a_forward_only_decoder_can_seek_forward_but_not_back() {
    use super::skip_repro::drive;
    use rodio::Sink;

    let open = |host: SlowHost| async move {
        let o = open_source(
            http_client(None).expect("client"),
            &host.url,
            LoadBudgets::DEFAULT,
        )
        .await
        .map_err(|e| e.message)
        .expect("load");
        assert!(o.forward_only);
        let (sink, out) = Sink::new();
        sink.append(o.decoder);
        sink.play();
        (sink, out)
    };

    let (sink, mut out) = open(slow_host(FRAGMENTED, |_| Duration::ZERO)).await;
    let o = tokio::task::block_in_place(|| {
        drive(&sink, &mut out, Some((5.0, 30.0)), Duration::from_secs(60))
    });
    assert!(
        o.ended && o.last_pos > 38.0,
        "a forward seek plays on to the end: {:.1}s",
        o.last_pos
    );

    let (sink, mut out) = open(slow_host(FRAGMENTED, |_| Duration::ZERO)).await;
    let o = tokio::task::block_in_place(|| {
        drive(&sink, &mut out, Some((30.0, 5.0)), Duration::from_secs(60))
    });
    assert!(
        o.ended && o.last_pos < 35.0,
        "a backward seek ends the track: {:.1}s",
        o.last_pos
    );
}

/// Not a regression test: points the harness at a real body on disk and prints
/// what a load costs. `EMBER_STALL_FILE=/path/to/file.m4a cargo test --lib
/// stall_repro::measure -- --ignored --nocapture`, with optional
/// `EMBER_STALL_RTT_MS` (default 300) and `EMBER_STALL_BPS` (default 1000000).
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn measure() {
    let path = std::env::var("EMBER_STALL_FILE").expect("EMBER_STALL_FILE");
    let rtt: u64 = std::env::var("EMBER_STALL_RTT_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(300);
    let bps: usize = std::env::var("EMBER_STALL_BPS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1_000_000);
    let body: &'static [u8] = Box::leak(std::fs::read(&path).expect("read").into_boxed_slice());
    let host = throttled_host(body, move |_| Duration::from_millis(rtt), Some(bps));
    let got = load(&host.url).await;
    println!(
        "{path}: {:?} in {:?}, {} requests: {:?}",
        got.outcome,
        got.took,
        requests_for(&host),
        host.log.lock().unwrap()
    );
}
