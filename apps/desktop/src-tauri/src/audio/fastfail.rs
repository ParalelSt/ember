//! Failing fast on a song that will not load.
//!
//! The fault these came from: the host's yt-dlp went stale, its download 403'd,
//! the stream route fell through to proxying a live stream that could not
//! deliver either, and the desktop app then sat on the song for 25 seconds
//! before saying anything ("timed out decoding the track after 25s" in two real
//! bug reports, ten times in a week).
//!
//! The engine's fault in that sequence was ONE flat 25s budget spread over
//! connect + buffer + decode: it cannot tell a host that is still downloading
//! the song from a host that will never send a byte, so every dead source cost
//! the whole budget. The fix judges everything after the response headers on
//! PROGRESS instead (see `open_source`), so silence is caught in seconds while a
//! slow-but-moving download is left alone.
//!
//! These tests drive the real `open_source` against a local host that fails in
//! each of the ways the route can, and keep the old flat-budget shape around in
//! one test as the measurement of what it used to cost.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use stream_download::http::HttpStream;
use stream_download::storage::temp::TempStorageProvider;
use stream_download::{Settings, StreamDownload};

use super::{
    build_decoder, http_client, is_stalled, open_source, while_progressing, DownloadProgress,
    LoadBudgets, LoadStop,
};

/// 120 s of AAC in a plain m4a: a healthy body, so the only thing under test is
/// HOW the host delivers it.
const TRACK: &[u8] = include_bytes!("../../test-fixtures/tone-faststart.m4a");

/// How the fake host misbehaves.
#[derive(Clone, Copy, Debug)]
enum Behaviour {
    /// Accepts the connection and never answers: the stream route still inside
    /// a yt-dlp run, or a proxy fetch of its own that never returns.
    NeverAnswers,
    /// 200 with a Content-Length, `sent` bytes, then silence forever: the route
    /// proxying an upstream whose body stops mid-transfer. This is the shape
    /// that produced the 25s freeze in the field.
    AnswersThenStalls { sent: usize },
    /// The whole body, in small pieces with a gap between them: a weak link
    /// that IS delivering, and must not be cut off.
    SlowButProgressing { chunk: usize, gap_ms: u64 },
    /// A real error status, straight away: what the route now answers when a
    /// download fails and no live stream can stand in for it.
    Refuses(u16),
}

fn read_headers(stream: &TcpStream) -> Vec<String> {
    let mut reader = BufReader::new(stream.try_clone().expect("clone"));
    let mut lines = Vec::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        if line.trim().is_empty() {
            break;
        }
        lines.push(line.trim().to_string());
    }
    lines
}

fn fake_host(behaviour: Behaviour) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut stream) = conn else { continue };
            std::thread::spawn(move || {
                let _ = read_headers(&stream);
                let total = TRACK.len();
                let ok_headers = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: audio/mp4\r\nAccept-Ranges: bytes\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n"
                );
                match behaviour {
                    // Hold the connection open, saying nothing. The sleep just
                    // outlives any budget under test; the process ends with it.
                    Behaviour::NeverAnswers => std::thread::sleep(Duration::from_secs(300)),
                    Behaviour::Refuses(code) => {
                        let msg = br#"{"error":"This song could not be loaded right now."}"#;
                        let _ = write!(
                            stream,
                            "HTTP/1.1 {code} Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            msg.len()
                        );
                        let _ = stream.write_all(msg);
                    }
                    Behaviour::AnswersThenStalls { sent } => {
                        let _ = stream.write_all(ok_headers.as_bytes());
                        let _ = stream.write_all(&TRACK[..sent.min(total)]);
                        let _ = stream.flush();
                        std::thread::sleep(Duration::from_secs(300));
                    }
                    Behaviour::SlowButProgressing { chunk, gap_ms } => {
                        let _ = stream.write_all(ok_headers.as_bytes());
                        for part in TRACK.chunks(chunk) {
                            if stream.write_all(part).is_err() {
                                return;
                            }
                            let _ = stream.flush();
                            std::thread::sleep(Duration::from_millis(gap_ms));
                        }
                    }
                }
                let _ = stream.flush();
            });
        }
    });
    format!("http://{addr}/api/youtube/stream/AAAAAAAAAAA")
}

/// What the engine does today, and how long it took.
type Opened = Result<Option<Duration>, (String, &'static str)>;

async fn open_with(url: &str, budgets: LoadBudgets) -> (Duration, Opened) {
    let client = http_client(None).expect("client");
    let started = Instant::now();
    let outcome = open_source(client, url, budgets)
        .await
        .map(|o| o.total)
        .map_err(|e| (e.message, e.retry));
    (started.elapsed(), outcome)
}

/// The same, on the budgets a real load runs with.
async fn open(url: &str) -> (Duration, Opened) {
    open_with(url, LoadBudgets::DEFAULT).await
}

/// The engine BEFORE the fix: one flat budget spread over the three stages,
/// with nothing watching whether the source is actually delivering. Kept as the
/// measurement of what a dead source used to cost.
async fn open_with_one_flat_budget(url: &str) -> Duration {
    const FLAT_BUDGET: Duration = Duration::from_secs(25);
    let deadline = Instant::now() + FLAT_BUDGET;
    let remaining = || deadline.saturating_duration_since(Instant::now());
    let started = Instant::now();

    let client = http_client(None).expect("client");
    let stream =
        match tokio::time::timeout(remaining(), HttpStream::new(client, url.parse().expect("url")))
            .await
        {
            Ok(Ok(s)) => s,
            _ => return started.elapsed(),
        };
    let reader = match tokio::time::timeout(
        remaining(),
        StreamDownload::from_stream(stream, TempStorageProvider::default(), Settings::default()),
    )
    .await
    {
        Ok(Ok(r)) => r,
        _ => return started.elapsed(),
    };
    let byte_len = reader.content_length();
    // Abandoning this blocking read is what the old shape did; the token is
    // only kept so the test process can still exit (a blocking task stuck in a
    // read holds the tokio runtime open at shutdown). Taken after the clock, so
    // it cannot flatter the measurement.
    let download = reader.cancellation_token();
    let _ = tokio::time::timeout(
        remaining(),
        tokio::task::spawn_blocking(move || build_decoder(reader, byte_len)),
    )
    .await;
    let took = started.elapsed();
    download.cancel();
    took
}

// --- The timeout rules on their own -----------------------------------------

/// A download that has gone quiet is dead; one that finished is simply done.
#[test]
fn silence_only_counts_against_a_download_that_has_not_finished() {
    let grace = Duration::from_secs(3);
    assert!(is_stalled(Duration::from_secs(4), false, grace), "4s of nothing is a stall");
    assert!(!is_stalled(Duration::from_secs(1), false, grace), "a gap inside the grace is not");
    assert!(
        !is_stalled(Duration::from_secs(60), true, grace),
        "a body that has fully arrived is silent for a good reason"
    );
}

/// Every chunk pushes the deadline out, so a slow link is never cut off for
/// being slow — only for going quiet.
#[tokio::test(flavor = "multi_thread")]
async fn a_download_that_keeps_moving_is_left_alone() {
    let progress = std::sync::Arc::new(DownloadProgress::started_now());
    let ticker = std::sync::Arc::clone(&progress);
    // Chunks every 60ms for ~600ms: six times the 100ms grace in total, but
    // never a 100ms gap.
    tokio::spawn(async move {
        for _ in 0..10 {
            tokio::time::sleep(Duration::from_millis(60)).await;
            ticker.record(false);
        }
    });

    let out = while_progressing(
        tokio::time::sleep(Duration::from_millis(600)),
        &progress,
        Duration::from_millis(150),
        Duration::from_secs(5),
    )
    .await;
    assert!(out.is_ok(), "a progressing download must not be called stalled");
}

/// ...and one that stops is given up on at the grace, not at the backstop.
#[tokio::test(flavor = "multi_thread")]
async fn a_download_that_stops_is_given_up_on_at_the_grace() {
    let progress = DownloadProgress::started_now();
    let started = Instant::now();
    let out = while_progressing(
        std::future::pending::<()>(),
        &progress,
        Duration::from_millis(200),
        Duration::from_secs(30),
    )
    .await;
    assert_eq!(out.err(), Some(LoadStop::Stalled));
    assert!(started.elapsed() < Duration::from_secs(2), "{:?}", started.elapsed());
}

/// A source that never stops arriving but is far too slow still ends.
#[tokio::test(flavor = "multi_thread")]
async fn a_download_that_is_simply_too_slow_still_ends() {
    let progress = std::sync::Arc::new(DownloadProgress::started_now());
    let ticker = std::sync::Arc::clone(&progress);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(30)).await;
            ticker.record(false);
        }
    });
    let out = while_progressing(
        std::future::pending::<()>(),
        &progress,
        Duration::from_millis(200),
        Duration::from_millis(600),
    )
    .await;
    assert_eq!(out.err(), Some(LoadStop::TooSlow));
}

// --- Against a real (mis)behaving host --------------------------------------

/// THE REPORTED FAULT. A host that answers and then stops sending used to cost
/// the full 25s budget ("timed out decoding the track after 25s") before the
/// webview heard anything. It must now be reported in a couple of seconds.
#[tokio::test(flavor = "multi_thread")]
async fn a_host_that_goes_quiet_mid_body_is_reported_within_seconds() {
    // 8 KB is short of the 256 KB prefetch, so the stall lands while buffering.
    let url = fake_host(Behaviour::AnswersThenStalls { sent: 8 * 1024 });
    let (took, outcome) = open(&url).await;
    let (message, retry) = outcome.expect_err("a body that never arrives cannot open");

    assert!(took < Duration::from_secs(6), "gave up only after {took:?}: {message}");
    assert!(message.contains("stopped arriving"), "unhelpful message: {message}");
    assert_eq!(retry, super::RETRY_NONE, "the same host cannot do better for web audio");
}

/// The same, with enough sent to get past the prefetch so the stall lands in
/// the DECODER: this is the exact stage the field reports named.
#[tokio::test(flavor = "multi_thread")]
async fn a_host_that_goes_quiet_after_the_prefetch_is_reported_within_seconds() {
    let url = fake_host(Behaviour::AnswersThenStalls { sent: 300 * 1024 });
    let (took, outcome) = open(&url).await;
    let (message, _) = outcome.expect_err("half a file cannot open");
    assert!(took < Duration::from_secs(8), "gave up only after {took:?}: {message}");
}

/// What it used to cost, on the same host, so the improvement is measured and
/// not asserted from memory.
#[tokio::test(flavor = "multi_thread")]
async fn the_old_flat_budget_cost_the_full_twenty_five_seconds() {
    let url = fake_host(Behaviour::AnswersThenStalls { sent: 8 * 1024 });
    let took = open_with_one_flat_budget(&url).await;
    assert!(
        took > Duration::from_secs(20),
        "the flat budget should burn the lot; took {took:?}"
    );
}

/// A host that says no says it in words, at once, and the webview is told that
/// asking the same host again over web audio is pointless.
#[tokio::test(flavor = "multi_thread")]
async fn a_host_that_refuses_the_song_fails_at_once() {
    let url = fake_host(Behaviour::Refuses(502));
    let (took, outcome) = open(&url).await;
    let (message, retry) = outcome.expect_err("a 502 is not a song");

    assert!(took < Duration::from_secs(3), "took {took:?}");
    assert!(message.contains("refused"), "unhelpful message: {message}");
    assert_eq!(retry, super::RETRY_NONE);
}

/// A host that accepts the connection and then says nothing at all: the
/// connect budget is the one that stays LONG in production, because a first
/// play has the host running yt-dlp before it can send a byte and there is no
/// progress yet to judge it by. Driven here on a short one, so what is tested
/// is that the budget exists, ends the wait, and names the host.
#[tokio::test(flavor = "multi_thread")]
async fn a_host_that_answers_nothing_at_all_is_given_up_on_at_the_connect_budget() {
    let url = fake_host(Behaviour::NeverAnswers);
    let budgets = LoadBudgets {
        connect: Duration::from_millis(400),
        ..LoadBudgets::DEFAULT
    };
    let (took, outcome) = open_with(&url, budgets).await;
    let (message, retry) = outcome.expect_err("silence is not a song");

    assert!(took < Duration::from_secs(3), "took {took:?}");
    assert!(message.contains("sent nothing"), "unhelpful message: {message}");
    assert_eq!(retry, super::RETRY_NONE);
}

/// The guard that matters most: a link that is slow but delivering must still
/// play. 16 KB every 220 ms takes longer to open than the stall grace allows
/// for SILENCE, and none of the budgets may fire on it.
#[tokio::test(flavor = "multi_thread")]
async fn a_slow_but_progressing_download_still_plays() {
    let url = fake_host(Behaviour::SlowButProgressing { chunk: 16 * 1024, gap_ms: 220 });
    let (took, outcome) = open(&url).await;
    let total = outcome.expect("a slow download is still a download");

    assert_eq!(total.map(|d| d.as_secs()), Some(120), "the whole 120s track opened");
    assert!(
        took > Duration::from_secs(3),
        "the point of this test is that it took longer than the stall grace: {took:?}"
    );
}
