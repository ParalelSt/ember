//! Luka, 2026-10-09 (Windows 10, web 0.7.25): "the host did not answer a
//! request for more of the song while decoding (nothing for 25s) (on a second
//! attempt, after: ...)" for youtube:bjXWk6j1bPM, a song not in his auto cache.
//!
//! The host keeps that song as yt-dlp's ffmpeg fixup leaves it, index first:
//! ftyp, moov (54 KB), free, then one mdat that runs to the end of the file
//! (4,964,812 bytes; read with a Range probe of the first 64 KB). Opening it
//! still took TWO requests. symphonia walks every top-level atom of a seekable
//! mp4, and it gets past a 4.9 MB mdat by seeking to the file's last 64 KB and
//! reading them, only to find nothing after the mdat. `StreamDownload` answers
//! that seek with a Range request and stops reading the first response while
//! it waits, so the answer queues behind everything already on its way through
//! the Funnel. On Luka's link that took longer than the 25 s request budget,
//! on both attempts.
//!
//! None of those bytes are needed: the demuxer skips them unread. So while the
//! decoder is being built, a jump into an mdat that ends the file is answered
//! without the host (`TailSkip`), and a song in this layout opens from the one
//! request a browser would make. A layout that really keeps something after
//! its mdat (the index at the end) still reads it from the host.

use std::io::{BufRead, BufReader, Cursor, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::luka_repro::{link_host, LinkShape};
use super::{http_client, open_source, open_source_retrying, sniff_layout, LoadBudgets, TailSkip};

/// 120 s of AAC laid out like bjXWk6j1bPM: ftyp, moov, free, mdat to the end.
const FASTSTART: &[u8] = include_bytes!("../../test-fixtures/tone-faststart.m4a");
/// The same audio with the index at the end (ffmpeg's default remux): ftyp,
/// free, mdat, moov. Its decoder cannot be built without the file's tail.
const MOOV_AT_END: &[u8] = include_bytes!("../../test-fixtures/tone-moov-at-end.m4a");
/// A googlevideo-style fragmented body: decoded forward-only, never sniffed
/// for a trailing mdat.
const FRAGMENTED: &[u8] = include_bytes!("../../test-fixtures/noise-dash-10s-fragments.m4a");

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
    let h = lines.iter().find(|l| l.to_lowercase().starts_with("range:"))?;
    let spec = h.split_once('=')?.1.trim();
    let (start, end) = spec.split_once('-')?;
    Some((start.parse().ok()?, end.parse().ok()))
}

/// A host that sends the whole body at `rate` bytes per second, and answers a
/// Range request (if at all) only when `answer_ranges` is set, at full speed.
/// Every request is logged as "whole" or "start-end".
struct Host {
    url: String,
    log: Arc<Mutex<Vec<String>>>,
}

fn host(body: &'static [u8], rate: usize, answer_ranges: bool) -> Host {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let log = Arc::new(Mutex::new(Vec::new()));
    let log2 = Arc::clone(&log);
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut stream) = conn else { continue };
            let log = Arc::clone(&log2);
            std::thread::spawn(move || {
                let range = range_of(&read_headers(&stream));
                let total = body.len();
                log.lock().expect("log").push(match range {
                    Some((a, b)) => format!("{a}-{}", b.map(|b| b.to_string()).unwrap_or_default()),
                    None => "whole".into(),
                });
                let (status, start, end, pace) = match range {
                    None => ("200 OK", 0, total - 1, true),
                    Some(_) if !answer_ranges => {
                        // Accepted, never answered: Luka's 25 s, without the wait.
                        std::thread::sleep(Duration::from_secs(60));
                        return;
                    }
                    Some((s, e)) => ("206 Partial Content", s, e.unwrap_or(total - 1).min(total - 1), false),
                };
                let range_header = if range.is_some() {
                    format!("Content-Range: bytes {start}-{end}/{total}\r\n")
                } else {
                    String::new()
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Type: audio/mp4\r\nAccept-Ranges: bytes\r\n{range_header}Content-Length: {}\r\nConnection: close\r\n\r\n",
                    end + 1 - start
                );
                for part in body[start..=end].chunks(16 * 1024) {
                    if stream.write_all(part).is_err() {
                        return;
                    }
                    if pace {
                        std::thread::sleep(Duration::from_secs_f64(part.len() as f64 / rate as f64));
                    }
                }
                let _ = stream.flush();
            });
        }
    });
    Host { url: format!("http://{addr}/api/youtube/stream/bjXWk6j1bPM"), log }
}

/// Short clocks, so a request the host never answers fails in a second.
const QUICK: LoadBudgets = LoadBudgets {
    connect: Duration::from_secs(1),
    stall: Duration::from_secs(3),
    progress: Duration::from_secs(25),
};

/// Every sample a decoder yields, read on a blocking thread (a streamed
/// decoder blocks on the download).
async fn samples<S: rodio::Source + Send + 'static>(source: S) -> Vec<f32> {
    tokio::task::spawn_blocking(move || source.collect::<Vec<f32>>())
        .await
        .expect("decode task")
}

/// The same body decoded from memory, seekable, as the reference.
fn reference(body: &'static [u8]) -> rodio::Decoder<Cursor<&'static [u8]>> {
    rodio::Decoder::builder()
        .with_data(Cursor::new(body))
        .with_byte_len(body.len() as u64)
        .with_seekable(true)
        .build()
        .expect("reference decoder")
}

// --- The report --------------------------------------------------------------

/// Luka's load, made certain: the host answers the first request and never
/// the Range request for the tail. The old engine sent that request while
/// building the decoder and failed with his exact words; the song must open
/// from the first request alone.
#[tokio::test(flavor = "multi_thread")]
async fn a_song_with_its_index_first_opens_without_asking_for_its_tail() {
    let host = host(FASTSTART, 400_000, false);
    let got = open_source_retrying(http_client(None).expect("client"), &host.url, QUICK, || true, |_| {}).await;
    let log = host.log.lock().expect("log").clone();
    match got {
        Ok(opened) => {
            assert!(!opened.forward_only, "a remuxed file keeps the seekable decoder");
            assert_eq!(opened.total.map(|t| t.as_secs()), Some(120));
        }
        Err(e) => panic!("{} (requests: {log:?})", e.message),
    }
    assert_eq!(log, vec!["whole".to_string()], "one request opens the song");
}

/// The same, on the kind of link the 2026-09-24 reports came from (one queue
/// for every response, scaled down so the request budget is 1 s): the old
/// engine's tail request waited behind the first response for longer than the
/// budget and the load failed twice, "on a second attempt" included.
#[tokio::test(flavor = "multi_thread")]
async fn on_a_slow_shared_link_the_song_opens_on_the_first_attempt() {
    let shape = LinkShape { rate: 60_000, window: 192 * 1024, rtt: Duration::from_millis(150) };
    let host = link_host(FASTSTART, shape);
    let retried = AtomicBool::new(false);
    let got = open_source_retrying(
        http_client(None).expect("client"),
        &host.url,
        QUICK,
        || true,
        |_| retried.store(true, Ordering::SeqCst),
    )
    .await;
    let seen: Vec<String> = host.seen.lock().expect("seen").iter().map(|s| s.range.clone()).collect();
    if let Err(e) = &got {
        panic!("{} (requests: {seen:?})", e.message);
    }
    assert!(!retried.load(Ordering::SeqCst), "no second attempt (requests: {seen:?})");
    assert_eq!(seen, vec!["whole".to_string()]);
}

/// What the answer without the host must not cost: the song decodes to the
/// same samples as the file in memory, and seeks forwards and backwards after
/// it opened (those go to the host as before) land on the same samples too.
#[tokio::test(flavor = "multi_thread")]
async fn the_song_sounds_the_same_and_still_seeks() {
    use rodio::Source;

    let host = host(FASTSTART, 2_000_000, true);
    let opened = open_source(http_client(None).expect("client"), &host.url, QUICK)
        .await
        .unwrap_or_else(|e| panic!("{}", e.message));
    let mut decoder = opened.decoder;
    let mut want = reference(FASTSTART);

    // Ten seconds from the start, then a seek forward past everything that
    // has arrived, then one backwards.
    let take = |d: &mut dyn Iterator<Item = f32>, n: usize| d.take(n).collect::<Vec<f32>>();
    let n = 44_100 * 2 * 10;
    let (got_head, decoder_back) = tokio::task::spawn_blocking(move || {
        let head = take(&mut decoder, n);
        (head, decoder)
    })
    .await
    .expect("decode");
    decoder = decoder_back;
    assert_eq!(got_head.len(), n);
    assert_eq!(got_head, take(&mut want, n), "the first ten seconds");

    for at in [100.0, 3.0] {
        let target = Duration::from_secs_f64(at);
        let (got, decoder_back) = tokio::task::spawn_blocking(move || {
            decoder.try_seek(target).expect("seek");
            let got = take(&mut decoder, 44_100 * 2);
            (got, decoder)
        })
        .await
        .expect("seek task");
        decoder = decoder_back;
        want.try_seek(target).expect("reference seek");
        assert_eq!(got, take(&mut want, 44_100 * 2), "a second of audio after a seek to {at}s");
    }
    (opened.stop)();
}

/// The whole song, end to end, is the file's audio: no byte the decoder was
/// given without the host ever reaches it.
#[tokio::test(flavor = "multi_thread")]
async fn every_sample_is_the_files_own() {
    let host = host(FASTSTART, 4_000_000, true);
    let opened = open_source(http_client(None).expect("client"), &host.url, QUICK)
        .await
        .unwrap_or_else(|e| panic!("{}", e.message));
    let got = samples(opened.decoder).await;
    let want = samples(reference(FASTSTART)).await;
    assert_eq!(got.len(), want.len());
    assert!(got == want, "the decoded song differs from the file's");
}

/// The index at the end is genuinely needed: that layout still asks the host
/// for the tail, and opens.
#[tokio::test(flavor = "multi_thread")]
async fn a_song_with_its_index_last_still_reads_its_tail() {
    let host = host(MOOV_AT_END, 2_000_000, true);
    let opened = open_source(http_client(None).expect("client"), &host.url, QUICK)
        .await
        .unwrap_or_else(|e| panic!("{}", e.message));
    assert_eq!(opened.total.map(|t| t.as_secs()), Some(120));
    let log = host.log.lock().expect("log").clone();
    assert_eq!(log.first().map(String::as_str), Some("whole"));
    assert!(log.len() >= 2 && log[1] != "whole", "the tail was asked for: {log:?}");
    (opened.stop)();
}

// --- The pieces --------------------------------------------------------------

#[test]
fn the_layout_says_when_the_mdat_ends_the_file() {
    let len = |b: &[u8]| Some(b.len() as u64);
    // ftyp 28 + moov 11103 + free 8 = 11139, and the mdat header is 8 more.
    let fast = sniff_layout(FASTSTART, len(FASTSTART)).expect("decided");
    assert!(!fast.fragmented);
    assert_eq!(fast.trailing_mdat, Some(11_147));
    // Decided from the head alone, as soon as the mdat header is in.
    let head = sniff_layout(&FASTSTART[..11_147], len(FASTSTART)).expect("decided");
    assert_eq!(head.trailing_mdat, Some(11_147));
    assert_eq!(sniff_layout(&FASTSTART[..11_000], len(FASTSTART)), None, "needs the mdat header");
    // A declared length the mdat does not reach: something follows it.
    let longer = sniff_layout(FASTSTART, Some(FASTSTART.len() as u64 + 1)).expect("decided");
    assert_eq!(longer.trailing_mdat, None);
    // No length, no claim.
    assert_eq!(sniff_layout(FASTSTART, None).expect("decided").trailing_mdat, None);
    // Index last: the mdat is followed by the moov.
    let last = sniff_layout(MOOV_AT_END, len(MOOV_AT_END)).expect("decided");
    assert!(!last.fragmented);
    assert_eq!(last.trailing_mdat, None);
    // Fragmented: never.
    let frag = sniff_layout(FRAGMENTED, len(FRAGMENTED)).expect("decided");
    assert!(frag.fragmented);
    assert_eq!(frag.trailing_mdat, None);
    // Not an mp4.
    let webm = sniff_layout(&[0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0, 0, 0], Some(10)).expect("decided");
    assert_eq!((webm.fragmented, webm.trailing_mdat), (false, None));
}

/// An mdat whose size field is 0 ("to the end of the file") ends the file by
/// definition.
#[test]
fn an_mdat_sized_to_the_end_ends_the_file() {
    let mut body = FASTSTART[..11_147].to_vec();
    body[11_139..11_143].copy_from_slice(&0u32.to_be_bytes());
    let layout = sniff_layout(&body, Some(FASTSTART.len() as u64)).expect("decided");
    assert_eq!(layout.trailing_mdat, Some(11_147));
}

/// A reader that records what reached it.
struct Recorder {
    inner: Cursor<&'static [u8]>,
    seeks: Arc<Mutex<Vec<u64>>>,
}

impl Read for Recorder {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.inner.read(buf)
    }
}

impl Seek for Recorder {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let at = self.inner.seek(pos)?;
        self.seeks.lock().expect("seeks").push(at);
        Ok(at)
    }
}

fn recorder() -> (Recorder, Arc<Mutex<Vec<u64>>>) {
    let seeks = Arc::new(Mutex::new(Vec::new()));
    (Recorder { inner: Cursor::new(FASTSTART), seeks: Arc::clone(&seeks) }, seeks)
}

#[test]
fn while_building_a_jump_into_the_trailing_mdat_never_reaches_the_reader() {
    let (inner, seeks) = recorder();
    let len = FASTSTART.len() as u64;
    let mut r = TailSkip::new(inner, Some((11_147, len)), 0);

    let mut head = vec![0u8; 16 * 1024];
    r.read_exact(&mut head).expect("head");
    assert_eq!(&head[..], &FASTSTART[..16 * 1024]);

    // symphonia's skip: relative, to 64 KB before the end, then read to EOF.
    let tail = len - 64 * 1024;
    assert_eq!(r.seek(SeekFrom::Current((tail - 16 * 1024) as i64)).expect("seek"), tail);
    let mut rest = Vec::new();
    r.read_to_end(&mut rest).expect("tail");
    assert_eq!(rest.len(), 64 * 1024);
    assert!(seeks.lock().expect("seeks").is_empty(), "the reader never moved");
    assert_eq!(r.stream_position().expect("pos"), len);

    // Back to the start: a real seek, real bytes.
    assert_eq!(r.seek(SeekFrom::Start(0)).expect("rewind"), 0);
    let mut again = vec![0u8; 64];
    r.read_exact(&mut again).expect("read");
    assert_eq!(&again[..], &FASTSTART[..64]);
    assert_eq!(*seeks.lock().expect("seeks"), vec![0]);
}

#[test]
fn a_short_jump_and_any_jump_after_the_build_go_to_the_reader() {
    let (inner, seeks) = recorder();
    let len = FASTSTART.len() as u64;
    let mut r = TailSkip::new(inner, Some((11_147, len)), 0);

    // Into the mdat, but near what has been read: the first samples, which
    // the decoder does read while it is built.
    r.seek(SeekFrom::Start(11_147)).expect("seek");
    let mut b = [0u8; 8];
    r.read_exact(&mut b).expect("read");
    assert_eq!(&b, &FASTSTART[11_147..11_155]);

    // Built: from here every seek is the reader's, the far ones too.
    r.finish_building();
    let far = len - 1000;
    r.seek(SeekFrom::Start(far)).expect("seek");
    r.read_exact(&mut b).expect("read");
    assert_eq!(&b, &FASTSTART[far as usize..far as usize + 8]);
    assert_eq!(*seeks.lock().expect("seeks"), vec![11_147, far]);
}

#[test]
fn a_build_that_ends_inside_the_skipped_tail_reads_real_bytes_after() {
    let (inner, seeks) = recorder();
    let len = FASTSTART.len() as u64;
    let mut r = TailSkip::new(inner, Some((11_147, len)), 0);
    let at = len - 4096;
    r.seek(SeekFrom::Start(at)).expect("seek");
    r.finish_building();
    let mut b = [0u8; 16];
    r.read_exact(&mut b).expect("read");
    assert_eq!(&b, &FASTSTART[at as usize..at as usize + 16], "real bytes, not the stand-ins");
    assert_eq!(*seeks.lock().expect("seeks"), vec![at]);
}

#[test]
fn without_a_trailing_mdat_every_seek_goes_to_the_reader() {
    let (inner, seeks) = recorder();
    let len = FASTSTART.len() as u64;
    let mut r = TailSkip::new(inner, None, 0);
    r.seek(SeekFrom::Start(len - 64 * 1024)).expect("seek");
    assert_eq!(*seeks.lock().expect("seeks"), vec![len - 64 * 1024]);
}
