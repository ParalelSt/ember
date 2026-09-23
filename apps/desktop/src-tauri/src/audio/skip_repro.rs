//! Song-skip investigation: how the native engine turns a stream failure, or
//! a seek, into "the track ended".
//!
//! These tests drive the SAME source chain `audio_load` builds (`HttpStream`
//! -> `StreamDownload` on temp storage -> `build_decoder` -> `Sink`)
//! against a local fake stream host, with no audio device: the test pulls
//! samples out of the sink's queue itself, the way the output mixer would,
//! and then reads `sink.empty()` - which is exactly the condition
//! `spawn_position_timer` turns into an `audio:ended` event, which
//! PlayerProvider's `onEnded` turns into "play the next song".
//!
//! These started as reproductions of the reported fault; each now asserts the
//! behaviour after the fix, against the engine's own `build_decoder` and
//! `seek_target`, so a regression in either shows up here.

use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{self, AtomicBool, AtomicUsize};
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
    /// The first (Range-less) response dies after `cut` bytes, the first
    /// `honest_ranges` Range requests are answered, and every Range request
    /// after those is refused with `range_status` and a JSON error body.
    ///
    /// That is a host that has stopped being able to serve this file: the
    /// stream route on a host whose yt-dlp cannot download answers a refill
    /// with the whole download -> 403 -> re-extract -> 403 cascade and ends in
    /// an error body. `honest_ranges` says how far it gets first: 0 refuses
    /// even the read the decoder makes while it is built.
    CutThenRangeFails { cut: usize, range_status: u16, honest_ranges: usize },
}

struct FakeHost {
    url: String,
    /// Every request the host saw ("no range", or its Range header).
    requests: Arc<Mutex<Vec<String>>>,
}

/// Serve `body[start..=end]` as a 206.
fn serve_range(stream: &mut TcpStream, body: &[u8], start: usize, end: Option<usize>) {
    let total = body.len();
    let end = end.unwrap_or(total - 1).min(total - 1);
    let chunk = &body[start..=end];
    let _ = write!(
        stream,
        "HTTP/1.1 206 Partial Content\r\nContent-Type: audio/mp4\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{total}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        chunk.len()
    );
    let _ = stream.write_all(chunk);
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
    // How many Range requests the host has already answered; past the
    // behaviour's allowance the upstream is gone and every refill fails.
    let ranges_served = Arc::new(AtomicUsize::new(0));
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut stream) = conn else { continue };
            let log = Arc::clone(&log);
            let ranges_served = Arc::clone(&ranges_served);
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
                        serve_range(&mut stream, body, start, end);
                    }
                    (
                        Behaviour::CutThenRangeFails { range_status, honest_ranges, .. },
                        Some((start, end)),
                    ) => {
                        if ranges_served.fetch_add(1, atomic::Ordering::SeqCst) < honest_ranges {
                            serve_range(&mut stream, body, start, end);
                        } else {
                            let msg = br#"{"error":"download failed: HTTP Error 403: Forbidden"}"#;
                            let _ = write!(
                                stream,
                                "HTTP/1.1 {range_status} Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                                msg.len()
                            );
                            let _ = stream.write_all(msg);
                        }
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
/// same storage, the engine's own `build_decoder` (byte length + seekable
/// flag), same `Sink::append`. Returns the sink, the queue the mixer would
/// pull from, and the duration the engine would send to the webview.
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
    let byte_len = reader.content_length();
    let decoder = tokio::task::spawn_blocking(move || super::build_decoder(reader, byte_len))
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
pub(super) struct Outcome {
    /// `sink.empty()`: the engine emits `audio:ended` here.
    pub(super) ended: bool,
    /// The position the engine would report just before that.
    pub(super) last_pos: f64,
}

/// Pull samples the way the output mixer does (faster than real time),
/// optionally asking the sink to seek to `to` once `at` seconds have played.
/// Stops when the sink runs empty or `wall` elapses.
pub(super) fn drive(
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

/// CAUSE 1, FIXED at the load boundary. A host that cannot answer a Range
/// request used to let the track start and then "end" a minute in, because
/// `StreamDownload`'s reader fails for good once its download task gives up,
/// rodio's symphonia decoder turns any read error into `None` (end of
/// source), the sink goes empty and `spawn_position_timer` emits
/// `audio:ended` - so the webview started the NEXT song part-way through this
/// one, with no error anywhere.
///
/// A seekable decoder reads the tail of the file while it is being built, so
/// the refusal now lands during the LOAD, where `audio_load` already emits
/// `audio:error`: the webview keeps the song and retries it on web audio
/// instead of skipping it. See
/// `a_source_that_dies_mid_song_is_reported_as_a_failure` for the case where
/// the source dies after playback has started.
#[tokio::test(flavor = "multi_thread")]
async fn a_host_that_cannot_serve_a_refill_fails_the_load_instead_of_skipping() {
    // Three quarters of the body arrives, then the connection drops and every
    // Range request is refused: the stream route's answer when its yt-dlp
    // download fails and the googlevideo refetch 403s.
    let host = fake_host(
        FASTSTART,
        Behaviour::CutThenRangeFails {
            cut: FASTSTART.len() * 3 / 4,
            range_status: 500,
            honest_ranges: 0,
        },
    );

    let outcome = open_like_audio_load(&host.url).await.map(|_| ());

    assert!(
        outcome.is_err(),
        "audio_load turns a load that cannot read the file into an audio:error for the webview"
    );
    let reqs = host.requests.lock().expect("requests").clone();
    assert!(
        reqs.iter().any(|r| r.to_lowercase().starts_with("range:")),
        "the engine tried to read the rest of the file with a Range request: {reqs:?}"
    );
}

/// The fixture in memory, with a switch that makes every read past `good`
/// bytes fail once it is armed: a `StreamDownload` whose download task has
/// given up (a truncated body, a refill that 403s, a sleeping laptop). The
/// switch is armed only after the decoder has been built, so the failure is a
/// mid-song death rather than a load that never worked.
struct DiesPastByte {
    data: &'static [u8],
    pos: u64,
    good: u64,
    armed: Arc<AtomicBool>,
}

impl Read for DiesPastByte {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let dead = self.armed.load(atomic::Ordering::SeqCst);
        if dead && self.pos >= self.good {
            return Err(io::Error::other("stream failed to download"));
        }
        let limit = if dead { self.good } else { self.data.len() as u64 };
        let end = (self.pos + buf.len() as u64).min(limit) as usize;
        let start = self.pos as usize;
        let n = end.saturating_sub(start);
        buf[..n].copy_from_slice(&self.data[start..end]);
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for DiesPastByte {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let len = self.data.len() as i64;
        let target = match pos {
            SeekFrom::Start(n) => n as i64,
            SeekFrom::End(n) => len + n,
            SeekFrom::Current(n) => self.pos as i64 + n,
        };
        if target < 0 {
            return Err(io::Error::other("seek before the start"));
        }
        self.pos = (target as u64).min(len as u64);
        Ok(self.pos)
    }
}

/// What the engine builds for a track, over a source that can be killed on
/// demand: the sink, the queue the mixer pulls from, the switch that kills
/// the stream, and the failure flag the position timer reads.
struct Killable {
    sink: Sink,
    out: SourcesQueueOutput,
    kill: Arc<AtomicBool>,
    failed: Arc<AtomicBool>,
}

fn killable_source(good_fraction: f64) -> Killable {
    let kill = Arc::new(AtomicBool::new(false));
    let failed = Arc::new(AtomicBool::new(false));
    let reader = super::FailFlagged {
        inner: DiesPastByte {
            data: FASTSTART,
            pos: 0,
            good: (FASTSTART.len() as f64 * good_fraction) as u64,
            armed: Arc::clone(&kill),
        },
        failed: Arc::clone(&failed),
    };
    let decoder = super::build_decoder(reader, Some(FASTSTART.len() as u64)).expect("decode");
    let (sink, out) = Sink::new();
    sink.append(decoder);
    sink.play();
    Killable { sink, out, kill, failed }
}

/// CAUSE 2a, FIXED. `audio_load` used to build the decoder with
/// `rodio::Decoder::new`, which leaves symphonia's media source NOT seekable
/// and with no byte length, so the demuxer could only move forward: a
/// backward seek left it pointing at bytes it could no longer read, the next
/// packet read failed and rodio reported end-of-source. Seeking to 0 is the
/// Previous button's "restart the current song" path (queueNav's
/// PREV_RESTART_AFTER_SEC) and loop-one's onEnded handler, so both of those
/// ended the song. With `build_decoder` the source is seekable and the track
/// really does restart.
#[tokio::test(flavor = "multi_thread")]
async fn seeking_back_to_the_start_restarts_the_track() {
    let host = fake_host(FASTSTART, Behaviour::Honest);
    let (sink, mut out, _) = open_like_audio_load(&host.url).await.expect("load");

    let o = tokio::task::block_in_place(|| {
        drive(&sink, &mut out, Some((60.0, 0.0)), Duration::from_secs(60))
    });

    assert!(
        (o.last_pos - FIXTURE_SECS).abs() < 2.0,
        "Previous-as-restart should replay the song and reach its end, not end it at {:.1}s",
        o.last_pos
    );
}

/// CAUSE 2b, FIXED. The same non-seekable decoder used to make a backward
/// seek of more than symphonia's read buffer end the song early: the audio
/// never rewound, but the position counter did, so the track ran out roughly
/// "seek distance" seconds before the slider said it should - a skip in the
/// middle of a song. A seekable source rewinds for real and plays on.
#[tokio::test(flavor = "multi_thread")]
async fn seeking_backwards_plays_on_to_the_end() {
    let host = fake_host(FASTSTART, Behaviour::Honest);
    let (sink, mut out, _) = open_like_audio_load(&host.url).await.expect("load");

    let o = tokio::task::block_in_place(|| {
        drive(&sink, &mut out, Some((60.0, 30.0)), Duration::from_secs(60))
    });

    assert!(
        (o.last_pos - FIXTURE_SECS).abs() < 2.0,
        "after seeking back 30 s the track should still reach {FIXTURE_SECS}s, not end at {:.1}s",
        o.last_pos
    );
}

/// CAUSE 2c, FIXED, the one that matches "I moved the slider to 1:31 and it
/// jumped to another song, every time": when the stream route proxies
/// googlevideo (which it does for every track the host's yt-dlp cannot
/// download) the body is a FRAGMENTED mp4 whose moov carries no sample count,
/// so the decoder reports a total duration of ZERO. rodio clamps every seek
/// target to that total, so a seek to 1:31 became a seek to 0 - which ended
/// the track. `audio_seek` now refuses such a seek instead of handing it over,
/// and the song keeps playing.
#[tokio::test(flavor = "multi_thread")]
async fn a_seek_in_a_proxied_fragmented_stream_is_refused_not_fatal() {
    let host = fake_host(DASH, Behaviour::Honest);
    let (sink, mut out, total) = open_like_audio_load(&host.url).await.expect("load");
    assert_eq!(
        total,
        Some(Duration::ZERO),
        "a fragmented mp4 reports no duration, so rodio would clamp every seek to 0"
    );
    assert_eq!(
        super::seek_target(total, 91.0),
        None,
        "the engine must refuse a seek it cannot service, rather than restart the song"
    );

    // What the engine does instead: nothing. The track plays on.
    let o = tokio::task::block_in_place(|| drive(&sink, &mut out, None, Duration::from_secs(60)));

    assert!(
        (o.last_pos - FIXTURE_SECS).abs() < 2.0,
        "the proxied track should keep playing to its end: {:.1}s",
        o.last_pos
    );
}

/// A seek in a track whose length the decoder DOES know is passed through
/// unchanged (and a negative one clamps to the start): the refusal above is
/// narrow, not a ban on seeking.
#[test]
fn a_seek_in_a_track_of_known_length_is_serviced() {
    assert_eq!(
        super::seek_target(Some(Duration::from_secs(120)), 91.0),
        Some(Duration::from_secs_f64(91.0))
    );
    assert_eq!(super::seek_target(Some(Duration::from_secs(120)), -3.0), Some(Duration::ZERO));
    // No total at all is not the same as a zero one: rodio clamps nothing, so
    // the demuxer gets the real target.
    assert_eq!(super::seek_target(None, 91.0), Some(Duration::from_secs_f64(91.0)));
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

/// CAUSE 2, FIXED. A stream that dies half way through a song used to be
/// indistinguishable from a song that finished: rodio turns the read error
/// into end-of-source, the sink goes empty, and the engine emitted
/// `audio:ended` - which the player answers by starting the NEXT song, with
/// no error, no toast and no breadcrumb. The reader now records that it
/// failed, which is what `spawn_position_timer` checks before it calls a
/// track finished.
#[test]
fn a_source_that_dies_mid_song_is_reported_as_a_failure() {
    let Killable { sink, mut out, kill, failed } = killable_source(0.75);

    // The stream dies now: everything past three quarters of the file is gone
    // for good, exactly as a failed StreamDownload behaves.
    kill.store(true, atomic::Ordering::SeqCst);
    let o = drive(&sink, &mut out, None, Duration::from_secs(30));

    assert!(o.ended, "the sink went empty part-way through the song");
    assert!(
        o.last_pos < FIXTURE_SECS - 20.0,
        "it stopped mid-song, at {:.1}s of {FIXTURE_SECS}s",
        o.last_pos
    );
    assert!(
        failed.load(atomic::Ordering::SeqCst),
        "the source is flagged as failed, so the engine emits audio:error instead of audio:ended"
    );
}

/// The other half of the same rule: a song that really finishes leaves no
/// failure behind, so the engine still emits `audio:ended` and the queue
/// advances as it always did.
#[test]
fn a_track_that_really_finishes_is_not_a_failure() {
    let Killable { sink, mut out, failed, .. } = killable_source(1.0);

    let o = drive(&sink, &mut out, None, Duration::from_secs(30));

    assert!(o.ended);
    assert!((o.last_pos - FIXTURE_SECS).abs() < 2.0, "it played to the end: {:.1}s", o.last_pos);
    assert!(!failed.load(atomic::Ordering::SeqCst), "nothing failed, so this is a real end of track");
}

/// Why the byte length matters, kept as a guard on the cause: build the very
/// same reader the old way (`Decoder::new`, no byte length, not seekable) and
/// the backward seek above still ends the track. If someone drops the byte
/// length from `build_decoder`, the fix is gone and this test says so.
#[tokio::test(flavor = "multi_thread")]
async fn a_decoder_built_without_the_byte_length_still_dies_on_a_backward_seek() {
    let host = fake_host(FASTSTART, Behaviour::Honest);
    let client = super::http_client(None).expect("client");
    let stream = HttpStream::new(client, host.url.parse().expect("url")).await.expect("connect");
    assert!(stream.content_length().is_some(), "the engine has a byte length to pass on");
    let reader =
        StreamDownload::from_stream(stream, TempStorageProvider::default(), Settings::default())
            .await
            .expect("buffer");
    let decoder = tokio::task::spawn_blocking(move || super::build_decoder(reader, None))
        .await
        .expect("join")
        .expect("decode");
    let (sink, mut out) = Sink::new();
    sink.append(decoder);
    sink.play();

    let o = tokio::task::block_in_place(|| {
        drive(&sink, &mut out, Some((60.0, 30.0)), Duration::from_secs(60))
    });

    assert!(o.ended);
    assert!(
        o.last_pos < FIXTURE_SECS - 10.0,
        "without the byte length the track ends early: {:.1}s",
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
/// Before the fix a 120 s track "ended" at 54.2 s, i.e. the player started the
/// next song there. Now either the load fails (the webview gets an
/// `audio:error` and keeps the song) or the track plays through: what must
/// never happen again is a silent end part-way in.
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn e2e_against_the_sandbox_route() {
    let url = std::env::var("SANDBOX_STREAM_URL").expect("SANDBOX_STREAM_URL");
    let Ok((sink, mut out, total)) = open_like_audio_load(&url).await else {
        eprintln!("E2E the load reported an error, which the webview answers with a retry");
        return;
    };
    let o = tokio::task::block_in_place(|| drive(&sink, &mut out, None, Duration::from_secs(90)));
    eprintln!("E2E total={total:?} ended={} last_pos={:.1}", o.ended, o.last_pos);
    assert!(
        o.last_pos > 110.0,
        "the track ended at {:.1}s of a 120s track with no error anywhere",
        o.last_pos
    );
}
