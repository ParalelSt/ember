//! Song-skip investigation: how the native engine turns a stream failure, or
//! a seek, into "the track ended".
//!
//! These tests drive the SAME source chain `audio_load` builds (`HttpStream`
//! -> `StreamDownload` on temp storage -> `rodio::Decoder::new` -> `Sink`)
//! against a local fake stream host, with no audio device: the test pulls
//! samples out of the sink's queue itself, the way the output mixer would,
//! and then reads `sink.empty()` - which is exactly the condition
//! `spawn_position_timer` turns into an `audio:ended` event, which
//! PlayerProvider's `onEnded` turns into "play the next song".
//!
//! Tests whose name ends in `_bug` reproduce the reported fault and pass
//! today; a fix flips them.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rodio::queue::SourcesQueueOutput;
use rodio::{Sink, Source};
use stream_download::http::HttpStream;
use stream_download::source::SourceStream;
use stream_download::storage::temp::TempStorageProvider;
use stream_download::{Settings, StreamDownload};

/// 120 s of AAC in a plain (moov-first, non-fragmented) m4a: what yt-dlp
/// leaves in MUSIC_DIR after its ffmpeg fixup, i.e. what a CACHED track looks
/// like to the engine.
const FASTSTART: &[u8] = include_bytes!("../../test-fixtures/tone-faststart.m4a");
/// The same audio as a FRAGMENTED mp4 (moof/mdat pairs, no sample table in
/// moov): what googlevideo serves, i.e. what the engine gets whenever the
/// stream route falls through to proxy mode because the download failed.
const DASH: &[u8] = include_bytes!("../../test-fixtures/tone-dash.m4a");
const FIXTURE_SECS: f64 = 120.0;

/// How the fake host answers.
#[derive(Clone, Copy, Debug)]
enum Behaviour {
    /// A healthy host: full body, Range answered with 206.
    Honest,
    /// The first (Range-less) response dies after `cut` bytes, and every Range
    /// request is refused with `range_status` and a JSON error body. That is
    /// the stream route on a host whose yt-dlp cannot download: the live proxy
    /// carries the first response, and the refill request runs the whole
    /// download -> 403 -> re-extract -> 403 cascade and ends in an error body.
    CutThenRangeFails { cut: usize, range_status: u16 },
}

struct FakeHost {
    url: String,
    /// Every request the host saw ("no range", or its Range header).
    requests: Arc<Mutex<Vec<String>>>,
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

fn range_of(lines: &[String]) -> Option<(usize, Option<usize>)> {
    let h = lines.iter().find(|l| l.to_lowercase().starts_with("range:"))?;
    let spec = h.splitn(2, '=').nth(1)?.trim().to_string();
    let mut it = spec.splitn(2, '-');
    let start = it.next()?.parse().ok()?;
    let end = it.next().and_then(|e| e.parse().ok());
    Some((start, end))
}

fn fake_host(body: &'static [u8], behaviour: Behaviour) -> FakeHost {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let requests = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&requests);
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut stream) = conn else { continue };
            let log = Arc::clone(&log);
            std::thread::spawn(move || {
                let headers = read_headers(&stream);
                let range = range_of(&headers);
                log.lock().expect("log").push(
                    headers
                        .iter()
                        .find(|l| l.to_lowercase().starts_with("range:"))
                        .cloned()
                        .unwrap_or_else(|| "no range".to_string()),
                );
                let total = body.len();
                match (behaviour, range) {
                    (Behaviour::Honest, Some((start, end))) => {
                        let end = end.unwrap_or(total - 1).min(total - 1);
                        let chunk = &body[start..=end];
                        let _ = write!(
                            stream,
                            "HTTP/1.1 206 Partial Content\r\nContent-Type: audio/mp4\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{total}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            chunk.len()
                        );
                        let _ = stream.write_all(chunk);
                    }
                    (Behaviour::CutThenRangeFails { range_status, .. }, Some(_)) => {
                        let msg = br#"{"error":"download failed: HTTP Error 403: Forbidden"}"#;
                        let _ = write!(
                            stream,
                            "HTTP/1.1 {range_status} Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            msg.len()
                        );
                        let _ = stream.write_all(msg);
                    }
                    (b, None) => {
                        let _ = write!(
                            stream,
                            "HTTP/1.1 200 OK\r\nContent-Type: audio/mp4\r\nAccept-Ranges: bytes\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n"
                        );
                        match b {
                            Behaviour::Honest => {
                                let _ = stream.write_all(body);
                            }
                            Behaviour::CutThenRangeFails { cut, .. } => {
                                // Trickle the bytes out so the decoder is built
                                // and the track is playing before the stream
                                // dies, the way a real one does.
                                for chunk in body[..cut].chunks(32 * 1024) {
                                    if stream.write_all(chunk).is_err() {
                                        return;
                                    }
                                    let _ = stream.flush();
                                    std::thread::sleep(Duration::from_millis(40));
                                }
                                std::thread::sleep(Duration::from_millis(200));
                                let _ = stream.shutdown(std::net::Shutdown::Both);
                            }
                        }
                    }
                }
                let _ = stream.flush();
            });
        }
    });
    FakeHost { url: format!("http://{addr}/api/youtube/stream/AAAAAAAAAAA"), requests }
}

/// The source chain `audio_load` builds, minus the AppHandle: same client,
/// same storage, same `Decoder::new` (no byte length, no seekable flag), same
/// `Sink::append`. Returns the sink, the queue the mixer would pull from, and
/// the duration the engine would send to the webview.
async fn open_like_audio_load(
    url: &str,
) -> Result<(Sink, SourcesQueueOutput, Option<Duration>), String> {
    let client = super::http_client(None).expect("client");
    let stream = HttpStream::new(client, url.parse().expect("url"))
        .await
        .map_err(|e| e.to_string())?;
    let reader =
        StreamDownload::from_stream(stream, TempStorageProvider::default(), Settings::default())
            .await
            .map_err(|e| e.to_string())?;
    let decoder = tokio::task::spawn_blocking(move || rodio::Decoder::new(reader))
        .await
        .expect("join")
        .map_err(|e| e.to_string())?;
    let total = decoder.total_duration();
    let (sink, out) = Sink::new();
    sink.append(decoder);
    sink.play();
    Ok((sink, out, total))
}

/// What the play-through looked like from the position timer's point of view.
#[derive(Debug)]
struct Outcome {
    /// `sink.empty()`: the engine emits `audio:ended` here.
    ended: bool,
    /// The position the engine would report just before that.
    last_pos: f64,
}

/// Pull samples the way the output mixer does (faster than real time),
/// optionally asking the sink to seek to `to` once `at` seconds have played.
/// Stops when the sink runs empty or `wall` elapses.
fn drive(
    sink: &Sink,
    out: &mut SourcesQueueOutput,
    seek: Option<(f64, f64)>,
    wall: Duration,
) -> Outcome {
    let started = Instant::now();
    std::thread::scope(|scope| {
        let mut seeker = None;
        let mut asked = false;
        loop {
            if sink.empty() || started.elapsed() > wall {
                break;
            }
            for _ in 0..512 {
                let _ = out.next();
            }
            let pos = sink.get_pos().as_secs_f64();
            if let Some((at, to)) = seek {
                if !asked && pos >= at {
                    asked = true;
                    // Sink::try_seek blocks until the audio thread (this loop)
                    // services the order, so it has to come from another thread.
                    seeker = Some(scope.spawn(move || sink.try_seek(Duration::from_secs_f64(to))));
                }
            }
            if seeker.as_ref().is_some_and(|h| h.is_finished()) {
                let _ = seeker.take().expect("seeker").join();
            }
        }
        // Keep pulling until a seek still in flight comes back, so the scope
        // can close.
        while seeker.as_ref().is_some_and(|h| !h.is_finished()) {
            for _ in 0..512 {
                let _ = out.next();
            }
        }
    });
    // The position the engine's timer would report last: it reads get_pos()
    // on every tick and calls the track ended when the sink runs empty.
    Outcome { ended: sink.empty(), last_pos: sink.get_pos().as_secs_f64() }
}

/// Control: a healthy host and a cached-style file play to the end, and a
/// FORWARD seek inside one works. Without this, the failures below could just
/// mean the harness cannot play anything.
#[tokio::test(flavor = "multi_thread")]
async fn a_healthy_stream_plays_through_and_seeks_forward() {
    let host = fake_host(FASTSTART, Behaviour::Honest);
    let (sink, mut out, total) = open_like_audio_load(&host.url).await.expect("load");
    assert_eq!(total.map(|d| d.as_secs()), Some(120), "the fixture is a 120 s track");

    let o = tokio::task::block_in_place(|| {
        drive(&sink, &mut out, Some((5.0, 91.0)), Duration::from_secs(60))
    });

    assert!(o.ended, "playback should reach the end of the track");
    assert!(
        (o.last_pos - FIXTURE_SECS).abs() < 2.0,
        "it should end AT the end of the track, not before: {:.1}s",
        o.last_pos
    );
}

/// CAUSE 1. A stream that dies mid-song is indistinguishable from a song that
/// finished: `StreamDownload`'s reader fails for good once its download task
/// gives up, rodio's symphonia decoder turns any read error into `None` (end
/// of source), the sink goes empty, and `spawn_position_timer` emits
/// `audio:ended` - so the webview starts the NEXT song part-way through this
/// one, with no error anywhere.
#[tokio::test(flavor = "multi_thread")]
async fn a_dead_stream_ends_the_track_instead_of_erroring_bug() {
    // Three quarters of the body arrives (so the track is decoding and
    // playing), then the connection drops and the refill Range request is
    // refused: the stream route's answer when its yt-dlp download fails and
    // the googlevideo refetch 403s.
    let host = fake_host(
        FASTSTART,
        Behaviour::CutThenRangeFails { cut: FASTSTART.len() * 3 / 4, range_status: 500 },
    );
    let (sink, mut out, _) = open_like_audio_load(&host.url).await.expect("load");

    let o = tokio::task::block_in_place(|| drive(&sink, &mut out, None, Duration::from_secs(60)));

    assert!(o.ended, "the sink went empty: the engine emits audio:ended here");
    assert!(
        o.last_pos < FIXTURE_SECS - 20.0,
        "BUG: the track 'ended' at {:.1}s of a {FIXTURE_SECS}s song (and the first 90s were \
         already on disk), which the player treats as 'song finished' and answers by starting \
         the next one",
        o.last_pos
    );
    let reqs = host.requests.lock().expect("requests").clone();
    assert!(
        reqs.iter().any(|r| r.to_lowercase().starts_with("range:")),
        "the engine tried to refill the missing bytes with a Range request: {reqs:?}"
    );
}

/// CAUSE 2a. `audio_load` builds the decoder with `rodio::Decoder::new`,
/// which leaves symphonia's media source NOT seekable and with no byte
/// length, so the demuxer can only move forward. A backward seek leaves it
/// pointing at bytes it can no longer read: the next packet read fails and
/// rodio reports end-of-source. Seeking to 0 is the Previous button's
/// "restart the current song" path (queueNav's PREV_RESTART_AFTER_SEC) and
/// loop-one's onEnded handler, so both of those end the song instead.
#[tokio::test(flavor = "multi_thread")]
async fn seeking_back_to_the_start_ends_the_track_bug() {
    let host = fake_host(FASTSTART, Behaviour::Honest);
    let (sink, mut out, _) = open_like_audio_load(&host.url).await.expect("load");

    let o = tokio::task::block_in_place(|| {
        drive(&sink, &mut out, Some((60.0, 0.0)), Duration::from_secs(60))
    });

    assert!(o.ended, "the sink went empty right after the seek");
    assert!(
        o.last_pos < 5.0,
        "BUG: a seek back to the start ended the track at {:.1}s; the engine emits audio:ended \
         and the player starts the NEXT song",
        o.last_pos
    );
}

/// CAUSE 2b. The same non-seekable decoder makes a backward seek of more than
/// symphonia's read buffer end the song early: the audio never rewinds, but
/// the position counter does, so the track runs out roughly "seek distance"
/// seconds before the slider says it should - a skip in the middle of a song.
#[tokio::test(flavor = "multi_thread")]
async fn seeking_backwards_ends_the_song_early_bug() {
    let host = fake_host(FASTSTART, Behaviour::Honest);
    let (sink, mut out, _) = open_like_audio_load(&host.url).await.expect("load");

    let o = tokio::task::block_in_place(|| {
        drive(&sink, &mut out, Some((60.0, 30.0)), Duration::from_secs(60))
    });

    assert!(o.ended);
    assert!(
        o.last_pos < FIXTURE_SECS - 10.0,
        "BUG: after seeking back 30 s the track ended at {:.1}s instead of {FIXTURE_SECS}s",
        o.last_pos
    );
}

/// CAUSE 2c, the one that matches "I moved the slider to 1:31 and it jumped
/// to another song, every time": when the stream route proxies googlevideo
/// (which it does for every track the host's yt-dlp cannot download) the body
/// is a FRAGMENTED mp4 whose moov carries no sample count, so the decoder
/// reports a total duration of ZERO. rodio clamps every seek target to that
/// total, so a seek to 1:31 becomes a seek to 0 - and on a non-seekable
/// source that ends the track on the spot.
#[tokio::test(flavor = "multi_thread")]
async fn any_seek_in_a_proxied_fragmented_stream_ends_the_track_bug() {
    let host = fake_host(DASH, Behaviour::Honest);
    let (sink, mut out, total) = open_like_audio_load(&host.url).await.expect("load");
    assert_eq!(
        total,
        Some(Duration::ZERO),
        "a fragmented mp4 reports no duration, so rodio clamps every seek to 0"
    );

    let o = tokio::task::block_in_place(|| {
        drive(&sink, &mut out, Some((20.0, 91.0)), Duration::from_secs(60))
    });

    assert!(o.ended, "the sink went empty right after the seek");
    assert!(
        o.last_pos < FIXTURE_SECS - 10.0,
        "BUG: seeking to 1:31 in a proxied stream ended the track at {:.1}s; the engine emits \
         audio:ended and the player starts another song",
        o.last_pos
    );
}

/// The same fragmented stream plays fine as long as nobody seeks, which is
/// why this only bites people who touch the slider.
#[tokio::test(flavor = "multi_thread")]
async fn a_proxied_fragmented_stream_plays_through_when_left_alone() {
    let host = fake_host(DASH, Behaviour::Honest);
    let (sink, mut out, _) = open_like_audio_load(&host.url).await.expect("load");

    let o = tokio::task::block_in_place(|| drive(&sink, &mut out, None, Duration::from_secs(60)));

    assert!(o.ended);
    assert!((o.last_pos - FIXTURE_SECS).abs() < 2.0, "it should play to the end: {:.1}s", o.last_pos);
}

/// The shape of the fix, as evidence rather than a change: handing the
/// decoder the byte length `HttpStream::content_length()` already knows makes
/// the source seekable, and then the same backward seek that ends the track
/// above plays through to the end.
#[tokio::test(flavor = "multi_thread")]
async fn a_seekable_decoder_survives_the_same_backward_seek() {
    let host = fake_host(FASTSTART, Behaviour::Honest);
    let client = super::http_client(None).expect("client");
    let stream = HttpStream::new(client, host.url.parse().expect("url")).await.expect("connect");
    let len = stream.content_length().expect("content length");
    let reader =
        StreamDownload::from_stream(stream, TempStorageProvider::default(), Settings::default())
            .await
            .expect("buffer");
    let decoder = tokio::task::spawn_blocking(move || {
        rodio::Decoder::builder().with_data(reader).with_byte_len(len).with_seekable(true).build()
    })
    .await
    .expect("join")
    .expect("decode");
    let (sink, mut out) = Sink::new();
    sink.append(decoder);
    sink.play();

    let o = tokio::task::block_in_place(|| {
        drive(&sink, &mut out, Some((60.0, 30.0)), Duration::from_secs(60))
    });

    assert!(
        (o.last_pos - FIXTURE_SECS).abs() < 2.0,
        "a seekable decoder should still finish the track: {:.1}s",
        o.last_pos
    );
}


/// The same thing against the REAL stream route instead of a fake host.
/// Ignored by default: it needs a sandbox app (see tests/README.md, plus
/// tests/stream-range.test.mjs for the server-side half) with a fake player
/// whose downloads fail and a googlevideo stand-in that cuts the body and
/// 403s Range requests. Run with:
///
///   SANDBOX_STREAM_URL=http://127.0.0.1:3018/api/youtube/stream/eeeeeeeeeee \
///     cargo test --lib e2e_against -- --ignored --nocapture
///
/// Observed: a 120 s track "ended" at 54.2 s, i.e. the player would start the
/// next song there.
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn e2e_against_the_sandbox_route() {
    let url = std::env::var("SANDBOX_STREAM_URL").expect("SANDBOX_STREAM_URL");
    let (sink, mut out, total) = open_like_audio_load(&url).await.expect("load");
    let o = tokio::task::block_in_place(|| drive(&sink, &mut out, None, Duration::from_secs(90)));
    eprintln!("E2E total={total:?} ended={} last_pos={:.1}", o.ended, o.last_pos);
    assert!(o.ended);
    assert!(o.last_pos < 110.0, "ended at {:.1}s of a 120s track", o.last_pos);
}
