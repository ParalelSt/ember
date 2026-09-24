//! Luka's stalls, 2026-09-24: "the song stopped arriving while decoding
//! (nothing for 3s) (on a second attempt, after: ...)", right after
//! `ended, load (x2)`. See docs/reports/luka-2026-09-24.md.
//!
//! The other harnesses throttle each connection on its own, so two loads can
//! never get in each other's way there. A real listener has ONE link to the
//! host (here: the Tailscale Funnel), and every response shares it. This file
//! serves the engine through such a link: all bytes of all responses go out
//! through one queue at one rate, first come first served, and each response
//! may have only so many bytes in that queue at once (what a TCP window and
//! the buffers on the way hold). A new response therefore waits behind
//! whatever the other responses already have in the queue, which is what a
//! new request costs on a busy link.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use super::{http_client, open_source_retrying, LoadBudgets};

/// 120 s of AAC in a plain m4a (ftyp, moov, mdat): the layout the host keeps
/// on disk when yt-dlp's ffmpeg fixup ran, which is what both of Luka's songs
/// are (uV18CIbSXZo, 6:22, 6.2 MB; OmeUVcUuV10, 5:52, 5.7 MB).
const TRACK: &[u8] = include_bytes!("../../test-fixtures/tone-faststart.m4a");

/// How the shared link behaves.
#[derive(Clone, Copy, Debug)]
pub(crate) struct LinkShape {
    /// Bytes per second, for everything on the link together.
    pub rate: usize,
    /// Most bytes one response may have queued on the link at once.
    pub window: usize,
    /// From a request leaving the client to its response joining the queue.
    pub rtt: Duration,
}

/// One response's slot on the link.
struct Conn {
    /// Bytes this response has queued and not yet handed to the client.
    queued: Mutex<usize>,
    room: Condvar,
    /// The client closed it; nothing more is produced for it.
    dead: AtomicBool,
    to_client: Mutex<mpsc::Sender<Vec<u8>>>,
}

impl Conn {
    fn delivered(&self, n: usize) {
        let mut q = self.queued.lock().expect("queued");
        *q = q.saturating_sub(n);
        self.room.notify_all();
    }
}

struct Piece {
    conn: Arc<Conn>,
    bytes: Vec<u8>,
}

/// The link: one FIFO, drained at `rate`.
struct Link {
    queue: Mutex<VecDeque<Piece>>,
    ready: Condvar,
}

/// What the host saw, per request.
#[derive(Clone, Debug)]
pub(crate) struct Seen {
    pub range: String,
    /// When the request arrived, from the host's start.
    pub at: Duration,
    /// When its first byte reached the client.
    pub first_byte: Option<Duration>,
}

pub(crate) struct LinkHost {
    pub url: String,
    pub seen: Arc<Mutex<Vec<Seen>>>,
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

fn range_of(lines: &[String]) -> Option<(usize, Option<usize>)> {
    let h = lines.iter().find(|l| l.to_lowercase().starts_with("range:"))?;
    let spec = h.split_once('=')?.1.trim();
    let (start, end) = spec.split_once('-')?;
    Some((start.parse().ok()?, end.parse().ok()))
}

/// A host that serves `body` (200, or 206 for a Range) through one shared link.
pub(crate) fn link_host(body: &'static [u8], shape: LinkShape) -> LinkHost {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let seen: Arc<Mutex<Vec<Seen>>> = Arc::new(Mutex::new(Vec::new()));
    let link = Arc::new(Link { queue: Mutex::new(VecDeque::new()), ready: Condvar::new() });
    let started = Instant::now();

    // The wire: FIFO over every response, at `rate`.
    {
        let link = Arc::clone(&link);
        std::thread::spawn(move || loop {
            let piece = {
                let mut q = link.queue.lock().expect("queue");
                loop {
                    if let Some(p) = q.pop_front() {
                        break p;
                    }
                    q = link.ready.wait(q).expect("queue");
                }
            };
            let secs = piece.bytes.len() as f64 / shape.rate as f64;
            std::thread::sleep(Duration::from_secs_f64(secs));
            let n = piece.bytes.len();
            // Bytes already on the wire when the client hung up still used it.
            if piece.conn.dead.load(Ordering::SeqCst)
                || piece.conn.to_client.lock().expect("tx").send(piece.bytes).is_err()
            {
                piece.conn.delivered(n);
            }
        });
    }

    let seen2 = Arc::clone(&seen);
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(stream) = conn else { continue };
            let (link, seen) = (Arc::clone(&link), Arc::clone(&seen2));
            std::thread::spawn(move || {
                let headers = read_headers(&stream);
                let range = range_of(&headers);
                let index = {
                    let mut s = seen.lock().expect("seen");
                    s.push(Seen {
                        range: match range {
                            Some((a, b)) => format!("{a}-{}", b.map(|b| b.to_string()).unwrap_or_default()),
                            None => "whole".into(),
                        },
                        at: started.elapsed(),
                        first_byte: None,
                    });
                    s.len() - 1
                };

                // The client end: hands delivered bytes to the socket, in order.
                let (tx, rx) = mpsc::channel::<Vec<u8>>();
                let conn = Arc::new(Conn {
                    queued: Mutex::new(0),
                    room: Condvar::new(),
                    dead: AtomicBool::new(false),
                    to_client: Mutex::new(tx),
                });
                {
                    let (conn, seen) = (Arc::clone(&conn), Arc::clone(&seen));
                    let mut out = stream.try_clone().expect("clone");
                    std::thread::spawn(move || {
                        let mut first = true;
                        for bytes in rx {
                            if bytes.is_empty() {
                                let _ = out.flush();
                                let _ = out.shutdown(std::net::Shutdown::Both);
                                break;
                            }
                            if first {
                                first = false;
                                if let Some(s) = seen.lock().expect("seen").get_mut(index) {
                                    s.first_byte = Some(started.elapsed());
                                }
                            }
                            let n = bytes.len();
                            let ok = out.write_all(&bytes).is_ok();
                            conn.delivered(n);
                            if !ok {
                                conn.dead.store(true, Ordering::SeqCst);
                                conn.room.notify_all();
                            }
                        }
                    });
                }

                std::thread::sleep(shape.rtt);
                let total = body.len();
                let (status, start, end) = match range {
                    Some((s, e)) => ("206 Partial Content", s, e.unwrap_or(total - 1).min(total - 1)),
                    None => ("200 OK", 0, total - 1),
                };
                let range_header = if range.is_some() {
                    format!("Content-Range: bytes {start}-{end}/{total}\r\n")
                } else {
                    String::new()
                };
                let head = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: audio/mp4\r\nAccept-Ranges: bytes\r\n{range_header}Content-Length: {}\r\nConnection: close\r\n\r\n",
                    end + 1 - start
                )
                .into_bytes();

                let enqueue = |bytes: Vec<u8>| -> bool {
                    let n = bytes.len();
                    {
                        let mut q = conn.queued.lock().expect("queued");
                        while *q > 0 && *q + n > shape.window && !conn.dead.load(Ordering::SeqCst) {
                            q = conn.room.wait(q).expect("queued");
                        }
                        if conn.dead.load(Ordering::SeqCst) {
                            return false;
                        }
                        *q += n;
                    }
                    link.queue.lock().expect("queue").push_back(Piece { conn: Arc::clone(&conn), bytes });
                    link.ready.notify_all();
                    true
                };
                if !enqueue(head) {
                    return;
                }
                for part in body[start..=end].chunks(16 * 1024) {
                    if !enqueue(part.to_vec()) {
                        return;
                    }
                }
                // End of body: close once everything before it is delivered.
                link.queue.lock().expect("queue").push_back(Piece { conn: Arc::clone(&conn), bytes: Vec::new() });
                link.ready.notify_all();
            });
        }
    });
    LinkHost { url: format!("http://{addr}/api/youtube/stream/uV18CIbSXZo"), seen }
}

/// What one load's source stage came to.
#[derive(Debug)]
pub(crate) struct LoadOutcome {
    pub ok: bool,
    pub message: Option<String>,
    pub took: Duration,
    /// Whether the engine would send this failure to the webview. On main every
    /// failure is sent, a superseded one included (bughunt P03).
    pub superseded: bool,
}

/// `load_track`'s source stage for `n` loads of the same song, each started
/// `gap` after the one before, with the same newest-load-wins rule:
/// `ended`, then `load (x2)`, as the webview on main sends it.
pub(crate) async fn loads(url: &str, n: usize, gap: Duration) -> Vec<LoadOutcome> {
    let seq = Arc::new(AtomicU64::new(0));
    let mut tasks = Vec::new();
    for i in 0..n {
        if i > 0 {
            tokio::time::sleep(gap).await;
        }
        let my = seq.fetch_add(1, Ordering::SeqCst) + 1;
        let (seq, url) = (Arc::clone(&seq), url.to_string());
        tasks.push(tokio::spawn(async move {
            let started = Instant::now();
            let wanted = {
                let seq = Arc::clone(&seq);
                move || seq.load(Ordering::SeqCst) == my
            };
            let got = open_source_retrying(
                http_client(None).expect("client"),
                &url,
                LoadBudgets::DEFAULT,
                wanted,
                |_| {},
            )
            .await;
            let took = started.elapsed();
            let superseded = seq.load(Ordering::SeqCst) != my;
            // A superseded load that succeeded is dropped here, as load_track
            // drops it: that cancels its download.
            match got {
                Ok(_) => LoadOutcome { ok: true, message: None, took, superseded },
                Err(e) => LoadOutcome { ok: false, message: Some(e.message), took, superseded },
            }
        }));
    }
    let mut out = Vec::new();
    for t in tasks {
        out.push(t.await.expect("load task"));
    }
    // Let cancelled downloads notice before the runtime goes (fastfail::settle).
    tokio::time::sleep(Duration::from_millis(300)).await;
    out
}

fn env_num(name: &str, default: u64) -> u64 {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// Not a regression test: the scenario on a real body, with the link as a
/// knob. `EMBER_LINK_FILE=/path/song.m4a EMBER_LINK_LOADS=2 cargo test --lib
/// luka_repro::explore -- --ignored --nocapture`, optional `EMBER_LINK_BPS`
/// (default 500000), `EMBER_LINK_WINDOW` (default 1048576), `EMBER_LINK_RTT_MS`
/// (default 150), `EMBER_LINK_GAP_MS` (default 20).
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn explore() {
    let body: &'static [u8] = match std::env::var("EMBER_LINK_FILE") {
        Ok(p) => Box::leak(std::fs::read(&p).expect("read").into_boxed_slice()),
        Err(_) => TRACK,
    };
    let shape = LinkShape {
        rate: env_num("EMBER_LINK_BPS", 500_000) as usize,
        window: env_num("EMBER_LINK_WINDOW", 1024 * 1024) as usize,
        rtt: Duration::from_millis(env_num("EMBER_LINK_RTT_MS", 150)),
    };
    let n = env_num("EMBER_LINK_LOADS", 2) as usize;
    let gap = Duration::from_millis(env_num("EMBER_LINK_GAP_MS", 20));
    let host = link_host(body, shape);
    let out = loads(&host.url, n, gap).await;
    println!("{shape:?}, {n} load(s), {gap:?} apart, {} bytes", body.len());
    for (i, o) in out.iter().enumerate() {
        println!(
            "  load {}{}: {} after {:.1}s",
            i + 1,
            if o.superseded { " (superseded)" } else { "" },
            o.message.as_deref().unwrap_or("opened"),
            o.took.as_secs_f64()
        );
    }
    for s in host.seen.lock().unwrap().iter() {
        println!(
            "  request {:>20} at {:>6.2}s, first byte after {}",
            s.range,
            s.at.as_secs_f64(),
            s.first_byte
                .map(|f| format!("{:.2}s", (f - s.at).as_secs_f64()))
                .unwrap_or_else(|| "never".into())
        );
    }
}


// --- The regression tests ----------------------------------------------------

/// The song a load opens, or why it could not.
fn opened(o: &LoadOutcome) -> Result<(), String> {
    if o.ok {
        Ok(())
    } else {
        Err(o.message.clone().unwrap_or_default())
    }
}

/// How the requests went, for a failure message.
fn requests(host: &LinkHost) -> String {
    host.seen
        .lock()
        .expect("seen")
        .iter()
        .map(|s| {
            format!(
                "{} first byte after {}",
                s.range,
                s.first_byte
                    .map(|f| format!("{:.1}s", (f - s.at).as_secs_f64()))
                    .unwrap_or_else(|| "never".into())
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// 80 KB/s shared, 192 KB in flight per response: a link on which ONE load of
/// this song opens (see the control below), and two at once did not.
const BUSY: LinkShape = LinkShape {
    rate: 80_000,
    window: 192 * 1024,
    rtt: Duration::from_millis(150),
};

/// 60 KB/s: on this one even a single load used to fail.
const SLOWER: LinkShape = LinkShape {
    rate: 60_000,
    window: 192 * 1024,
    rtt: Duration::from_millis(150),
};

/// Luka's reports: `ended`, `load (x2)`, then "the song stopped arriving while
/// decoding (nothing for 3s) (on a second attempt, after: ...)". Two loads of
/// the same remuxed song share the link. Each one's decoder needs one more
/// request (the last 64 KB of the file), and that response queues behind
/// everything both loads already have in flight: more than 3 s of nothing,
/// which the engine called a dead source, twice, since the retry repeats the
/// same requests. The listener's song has to open.
#[tokio::test(flavor = "multi_thread")]
async fn ended_then_two_loads_on_a_shared_link_still_open_the_song() {
    let host = link_host(TRACK, BUSY);
    let out = loads(&host.url, 2, Duration::from_millis(20)).await;
    let current = out.last().expect("two loads");
    assert!(!current.superseded);
    assert_eq!(opened(current), Ok(()), "requests: {}", requests(&host));
}

/// The control: the same link with ONE load, which is what the webview sends
/// once bughunt P01 is in. This opened before the engine fix too.
#[tokio::test(flavor = "multi_thread")]
async fn one_load_on_the_same_link_opens_the_song() {
    let host = link_host(TRACK, BUSY);
    let out = loads(&host.url, 1, Duration::ZERO).await;
    assert_eq!(opened(&out[0]), Ok(()), "requests: {}", requests(&host));
}

/// P01 alone is not enough on a slower link: the request for the tail waits
/// behind the load's OWN first response, and a single load stalled the same
/// way.
#[tokio::test(flavor = "multi_thread")]
async fn one_load_on_a_slower_link_opens_the_song() {
    let host = link_host(TRACK, SLOWER);
    let out = loads(&host.url, 1, Duration::ZERO).await;
    assert_eq!(opened(&out[0]), Ok(()), "requests: {}", requests(&host));
}

/// What the fix must not cost: a host that answers the first request and then
/// never answers the one for the tail is still given up on, at the connect
/// budget (short here), and says which wait it was.
#[tokio::test(flavor = "multi_thread")]
async fn a_request_for_the_tail_that_is_never_answered_still_fails() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut stream) = conn else { continue };
            std::thread::spawn(move || {
                let headers = read_headers(&stream);
                if range_of(&headers).is_none() {
                    // The head of the song (ftyp, moov, the mdat header and
                    // some audio), then nothing more on this response.
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: audio/mp4\r\nAccept-Ranges: bytes\r\nContent-Length: {}\r\n\r\n",
                        TRACK.len()
                    );
                    let _ = stream.write_all(&TRACK[..64 * 1024]);
                    let _ = stream.flush();
                }
                // A Range request is accepted and never answered.
                std::thread::sleep(Duration::from_secs(60));
            });
        }
    });
    let url = format!("http://{addr}/api/youtube/stream/uV18CIbSXZo");
    let budgets = LoadBudgets { connect: Duration::from_secs(1), ..LoadBudgets::DEFAULT };
    let started = Instant::now();
    let got = open_source_retrying(http_client(None).expect("client"), &url, budgets, || true, |_| {}).await;
    let took = started.elapsed();
    tokio::time::sleep(Duration::from_millis(300)).await;

    let message = got.err().expect("an unanswered request is not a song").message;
    assert!(message.contains("did not answer"), "{message}");
    assert!(took < Duration::from_secs(8), "took {took:?}");
}

/// The rule itself: silence while blocked in a seek is judged on the request
/// budget, from the later of the seek and the last chunk; every other silence
/// on the stall budget, as before.
#[test]
fn a_seek_waiting_on_the_host_gets_the_request_budget() {
    use super::is_stalled_during;
    let (grace, request) = (Duration::from_secs(3), Duration::from_secs(25));
    let s = Duration::from_secs;
    assert!(is_stalled_during(s(4), None, false, grace, request), "reading: 4 s of nothing is a stall");
    assert!(!is_stalled_during(s(4), Some(s(4)), false, grace, request), "a seek may wait for its answer");
    assert!(is_stalled_during(s(26), Some(s(26)), false, grace, request), "but not forever");
    assert!(
        !is_stalled_during(s(40), Some(s(10)), false, grace, request),
        "the seek's own wait counts, not the silence before it"
    );
    assert!(!is_stalled_during(s(60), Some(s(60)), true, grace, request), "a finished body never stalls");
}
