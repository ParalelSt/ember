//! The auto cache: names, LRU, caps, atomic writes, and the prefetch
//! download against a local fake host.

use super::*;
use std::io::{BufRead, BufReader};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::AtomicUsize;

// --- helpers --------------------------------------------------------------------

/// A fresh directory under the system temp dir, removed on drop.
pub(crate) struct TempDir(pub PathBuf);

impl TempDir {
    pub(crate) fn new(tag: &str) -> Self {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "ember-cache-test-{tag}-{}-{}-{}",
            std::process::id(),
            now_ms(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        Self(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn entry(key: &str, bytes: u64, last_used_ms: u64) -> Entry {
    Entry {
        key: key.into(),
        file: format!("{}.{DATA_EXT}", file_stem_for(key)),
        bytes,
        last_used_ms,
        added_ms: last_used_ms,
        mime: None,
        url: None,
    }
}

fn index_of(entries: &[Entry]) -> Index {
    let mut idx = Index::default();
    for e in entries {
        idx.insert(e.clone());
    }
    idx
}

fn files_in(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .expect("read dir")
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

/// One response the fake host sends.
#[derive(Clone)]
pub(crate) struct Reply {
    pub status: &'static str,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
    /// Content-Length to declare; `None` declares the body's real length.
    pub declared_len: Option<usize>,
    /// Wait before the headers.
    pub delay: Duration,
    /// Send half the body, then wait this long before the rest.
    pub pause_mid_body: Duration,
}

impl Reply {
    pub(crate) fn ok(body: Vec<u8>) -> Self {
        Self {
            status: "200 OK",
            headers: vec![("Content-Type", "audio/mp4".into())],
            body,
            declared_len: None,
            delay: Duration::ZERO,
            pause_mid_body: Duration::ZERO,
        }
    }
    fn status(status: &'static str) -> Self {
        Self { status, ..Self::ok(br#"{"error":"x"}"#.to_vec()) }
    }
    fn header(mut self, k: &'static str, v: &str) -> Self {
        self.headers.push((k, v.to_string()));
        self
    }
}

pub(crate) struct Host {
    pub base: String,
    pub requests: Arc<AtomicUsize>,
    pub paths: Arc<Mutex<Vec<String>>>,
}

/// Answers every request with `reply`, on its own thread per connection.
pub(crate) fn host(reply: Reply) -> Host {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let requests = Arc::new(AtomicUsize::new(0));
    let paths = Arc::new(Mutex::new(Vec::new()));
    let (count, seen) = (Arc::clone(&requests), Arc::clone(&paths));
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(stream) = conn else { continue };
            let reply = reply.clone();
            let (count, seen) = (Arc::clone(&count), Arc::clone(&seen));
            std::thread::spawn(move || serve(stream, reply, count, seen));
        }
    });
    Host { base: format!("http://{addr}"), requests, paths }
}

fn serve(mut stream: TcpStream, reply: Reply, count: Arc<AtomicUsize>, seen: Arc<Mutex<Vec<String>>>) {
    let mut reader = BufReader::new(stream.try_clone().expect("clone"));
    let mut first = String::new();
    let _ = reader.read_line(&mut first);
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
            break;
        }
    }
    count.fetch_add(1, Ordering::SeqCst);
    if let Some(path) = first.split_whitespace().nth(1) {
        seen.lock().expect("paths").push(path.to_string());
    }
    std::thread::sleep(reply.delay);
    let mut head = format!(
        "HTTP/1.1 {}\r\nContent-Length: {}\r\nConnection: close\r\n",
        reply.status,
        reply.declared_len.unwrap_or(reply.body.len())
    );
    for (k, v) in &reply.headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    let half = reply.body.len() / 2;
    let _ = stream.write_all(&reply.body[..half]);
    let _ = stream.flush();
    std::thread::sleep(reply.pause_mid_body);
    let _ = stream.write_all(&reply.body[half..]);
    let _ = stream.flush();
}

fn client() -> Client {
    crate::audio::http_client(None).expect("client")
}

fn song(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i % 251) as u8).collect()
}

// --- file names -----------------------------------------------------------------

#[test]
fn file_names_are_stable_across_runs_and_versions() {
    // Pinned: a change here orphans every cached song on every desktop.
    assert_eq!(fnv1a64(b""), 0xcbf2_9ce4_8422_2325);
    assert_eq!(fnv1a64(b"a"), 0xaf63_dc4c_8601_ec8c);
    assert_eq!(file_stem_for("youtube:abc"), format!("youtube_abc-{:016x}", fnv1a64(b"youtube:abc")));
    assert_eq!(file_stem_for("youtube:abc"), file_stem_for("youtube:abc"));
}

#[test]
fn file_names_are_sanitised() {
    for hostile in ["../../etc/passwd", "C:\\Windows\\x", "upload:a/b\\c", "..", "a\0b", "späß:ü"] {
        let stem = file_stem_for(hostile);
        assert!(
            stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "{hostile:?} -> {stem:?}"
        );
        assert!(!stem.contains(".."));
    }
}

#[test]
fn ids_that_sanitise_alike_still_get_their_own_file() {
    assert_ne!(file_stem_for("youtube:a"), file_stem_for("youtube_a"));
    assert_ne!(file_stem_for("upload:a/b"), file_stem_for("upload:a:b"));
}

#[test]
fn long_ids_get_bounded_names() {
    let long = "youtube:".to_string() + &"x".repeat(400);
    assert!(file_stem_for(&long).len() <= MAX_STEM_LEN + 17);
}

#[test]
fn the_prefetch_marker_is_stripped_from_the_stored_url() {
    assert_eq!(strip_prefetch_marker("http://h/api/youtube/stream/a?prefetch=1"), "http://h/api/youtube/stream/a");
    assert_eq!(strip_prefetch_marker("http://h/s?x=1&prefetch=1"), "http://h/s?x=1");
    assert_eq!(strip_prefetch_marker("http://h/s?prefetch=1&x=1"), "http://h/s?x=1");
    assert_eq!(strip_prefetch_marker("http://h/s"), "http://h/s");
}

// --- LRU and caps (pure) --------------------------------------------------------

#[test]
fn lru_order_is_least_recently_used_first_then_by_id() {
    let idx = index_of(&[entry("c", 1, 30), entry("a", 1, 10), entry("b", 1, 10), entry("d", 1, 20)]);
    let order: Vec<&str> = idx.lru_order(&[]).iter().map(|e| e.key.as_str()).collect();
    assert_eq!(order, ["a", "b", "d", "c"]);
}

#[test]
fn touching_moves_a_song_to_the_back_of_the_line() {
    let mut idx = index_of(&[entry("a", 1, 10), entry("b", 1, 20)]);
    assert!(idx.touch("a", 30));
    assert!(!idx.touch("missing", 30));
    let order: Vec<&str> = idx.lru_order(&[]).iter().map(|e| e.key.as_str()).collect();
    assert_eq!(order, ["b", "a"]);
    // A clock that steps back never makes a song look older than it is.
    idx.touch("a", 5);
    assert_eq!(idx.get("a").map(|e| e.last_used_ms), Some(30));
}

#[test]
fn eviction_frees_bytes_oldest_first() {
    let idx = index_of(&[entry("a", 40, 1), entry("b", 40, 2), entry("c", 40, 3)]);
    // 120 on disk, cap 150: 50 more needs 20 freed, so one song, the oldest.
    assert_eq!(idx.eviction_plan("new", 50, &[], 150, 100), Some(vec!["a".into()]));
    // 100 more needs 70 freed: two.
    assert_eq!(idx.eviction_plan("new", 100, &[], 150, 100), Some(vec!["a".into(), "b".into()]));
    // Fits already: nothing.
    assert_eq!(idx.eviction_plan("new", 30, &[], 150, 100), Some(vec![]));
}

#[test]
fn eviction_respects_the_file_cap() {
    let idx = index_of(&[entry("a", 1, 1), entry("b", 1, 2), entry("c", 1, 3)]);
    assert_eq!(idx.eviction_plan("new", 1, &[], 1_000, 3), Some(vec!["a".into()]));
    assert_eq!(idx.eviction_plan("new", 1, &[], 1_000, 4), Some(vec![]));
}

#[test]
fn eviction_never_takes_the_keep_list() {
    let idx = index_of(&[entry("playing", 40, 1), entry("b", 40, 2), entry("c", 40, 3)]);
    assert_eq!(
        idx.eviction_plan("new", 50, &["playing"], 150, 100),
        Some(vec!["b".into()]),
        "the oldest song is the one playing, so the next oldest goes"
    );
}

#[test]
fn a_song_that_cannot_fit_evicts_nothing() {
    let idx = index_of(&[entry("playing", 100, 1), entry("b", 20, 2)]);
    assert_eq!(idx.eviction_plan("new", 60, &["playing"], 150, 100), None);
    assert_eq!(idx.eviction_plan("new", 151, &[], 150, 100), None, "bigger than the whole cache");
}

#[test]
fn replacing_a_song_counts_its_old_copy_as_free() {
    let idx = index_of(&[entry("a", 100, 1), entry("b", 40, 2)]);
    assert_eq!(idx.eviction_plan("a", 100, &["a"], 150, 2), Some(vec![]));
}

#[test]
fn over_cap_trims_to_both_caps() {
    let idx = index_of(&[entry("a", 50, 1), entry("b", 50, 2), entry("c", 50, 3)]);
    assert_eq!(idx.over_cap(&[], 100, 100), vec!["a".to_string()]);
    assert_eq!(idx.over_cap(&[], 1_000, 1), vec!["a".to_string(), "b".to_string()]);
    assert!(idx.over_cap(&[], 1_000, 100).is_empty());
}

#[test]
fn two_ids_never_share_a_file() {
    let mut idx = index_of(&[entry("a", 1, 1)]);
    let mut clash = entry("b", 1, 2);
    clash.file = entry("a", 1, 1).file;
    idx.insert(clash);
    assert_eq!(idx.keys(), vec!["b".to_string()]);
}

// --- status mapping -------------------------------------------------------------

#[test]
fn statuses_map_to_the_policy_results() {
    assert_eq!(classify_status(200, None), None);
    assert_eq!(classify_status(206, None), None);
    assert_eq!(classify_status(410, None), Some(PrefetchOutcome::Gone));
    assert_eq!(
        classify_status(429, Some("7")),
        Some(PrefetchOutcome::RetryAfter { status: 429, seconds: Some(7) })
    );
    assert_eq!(
        classify_status(503, Some(" 30 ")),
        Some(PrefetchOutcome::RetryAfter { status: 503, seconds: Some(30) })
    );
    assert_eq!(
        classify_status(503, Some("Wed, 21 Oct 2026 07:28:00 GMT")),
        Some(PrefetchOutcome::RetryAfter { status: 503, seconds: None })
    );
    assert_eq!(classify_status(503, None), Some(PrefetchOutcome::RetryAfter { status: 503, seconds: None }));
    assert!(matches!(classify_status(500, None), Some(PrefetchOutcome::Failed { .. })));
    assert!(matches!(classify_status(404, None), Some(PrefetchOutcome::Failed { .. })));
}

#[test]
fn outcomes_serialise_the_way_the_adapter_reads_them() {
    let json = |o: PrefetchOutcome| serde_json::to_string(&o).expect("json");
    assert_eq!(json(PrefetchOutcome::Done { bytes: 5 }), r#"{"kind":"done","bytes":5}"#);
    assert_eq!(
        json(PrefetchOutcome::RetryAfter { status: 503, seconds: None }),
        r#"{"kind":"retry-after","status":503,"seconds":null}"#
    );
    assert_eq!(json(PrefetchOutcome::Gone), r#"{"kind":"gone"}"#);
    assert_eq!(json(PrefetchOutcome::Failed { message: "x".into() }), r#"{"kind":"failed","message":"x"}"#);
    assert_eq!(json(PrefetchOutcome::Busy), r#"{"kind":"busy"}"#);
    assert_eq!(json(PrefetchOutcome::Cancelled), r#"{"kind":"cancelled"}"#);
    let stats = CacheStats { bytes: 1, count: 2, cap: 3, max_files: 4 };
    assert_eq!(
        serde_json::to_string(&stats).expect("json"),
        r#"{"bytes":1,"count":2,"cap":3,"maxFiles":4}"#
    );
}

// --- the directory --------------------------------------------------------------

#[test]
fn opening_cleans_part_files_orphans_and_stale_entries() {
    let dir = TempDir::new("open");
    let good = entry("youtube:good", 4, 1);
    let missing = entry("youtube:missing", 4, 2);
    let wrong_size = entry("youtube:short", 4, 3);
    fs::write(dir.0.join(&good.file), b"abcd").expect("write");
    fs::write(dir.0.join(&wrong_size.file), b"ab").expect("write");
    fs::write(dir.0.join("half-written.part"), b"xx").expect("write");
    fs::write(dir.0.join("orphan-0000.bin"), b"xx").expect("write");
    let idx = index_of(&[good.clone(), missing, wrong_size]);
    write_index(&dir.0, &idx).expect("index");

    let cache = AudioCache::open(dir.0.clone()).expect("open");

    assert_eq!(cache.keys(), vec!["youtube:good".to_string()]);
    assert_eq!(files_in(&dir.0), vec![INDEX_FILE.to_string(), good.file.clone()]);
}

#[test]
fn a_hand_written_index_cannot_point_outside_the_cache() {
    let dir = TempDir::new("escape");
    let outside = dir.0.join("outside.txt");
    fs::write(&outside, b"keep me").expect("write");
    let root = dir.0.join("cache");
    fs::create_dir_all(&root).expect("root");
    let mut evil = entry("youtube:x", 7, 1);
    evil.file = "../outside.txt".into();
    write_index(&root, &index_of(&[evil])).expect("index");

    let cache = AudioCache::open(root).expect("open");
    assert!(cache.keys().is_empty());
    assert!(outside.is_file(), "a file outside the cache dir was touched");
}

#[test]
fn a_corrupt_index_starts_empty() {
    let dir = TempDir::new("corrupt");
    fs::write(dir.0.join(INDEX_FILE), b"{not json").expect("write");
    fs::write(dir.0.join("youtube_a-0000000000000000.bin"), b"x").expect("write");
    let cache = AudioCache::open(dir.0.clone()).expect("open");
    assert!(cache.keys().is_empty());
    assert_eq!(files_in(&dir.0), vec![INDEX_FILE.to_string()], "orphans went with it");
}

#[test]
fn the_index_round_trips_and_touch_persists() {
    let dir = TempDir::new("roundtrip");
    let a = entry("youtube:a", 3, 10);
    fs::write(dir.0.join(&a.file), b"abc").expect("write");
    write_index(&dir.0, &index_of(&[a])).expect("index");

    let cache = AudioCache::open(dir.0.clone()).expect("open");
    cache.touch_at("youtube:a", 99);
    drop(cache);

    let again = AudioCache::open(dir.0.clone()).expect("reopen");
    let idx = relock(&again.index);
    assert_eq!(idx.get("youtube:a").map(|e| (e.bytes, e.last_used_ms)), Some((3, 99)));
}

#[test]
fn opening_trims_to_smaller_caps() {
    let dir = TempDir::new("trim");
    let (a, b) = (entry("a", 3, 1), entry("b", 3, 2));
    fs::write(dir.0.join(&a.file), b"abc").expect("write");
    fs::write(dir.0.join(&b.file), b"abc").expect("write");
    write_index(&dir.0, &index_of(&[a, b])).expect("index");
    let cache = AudioCache::open_with(dir.0.clone(), 1_000, 1).expect("open");
    assert_eq!(cache.keys(), vec!["b".to_string()]);
}

#[test]
fn evict_clear_path_and_stats() {
    let dir = TempDir::new("ops");
    let (a, b) = (entry("youtube:a", 3, 1), entry("youtube:b", 2, 2));
    fs::write(dir.0.join(&a.file), b"abc").expect("write");
    fs::write(dir.0.join(&b.file), b"ab").expect("write");
    write_index(&dir.0, &index_of(&[a.clone(), b])).expect("index");
    let cache = AudioCache::open_with(dir.0.clone(), 1_000, 10).expect("open");

    assert_eq!(cache.stats(), CacheStats { bytes: 5, count: 2, cap: 1_000, max_files: 10 });
    assert_eq!(cache.path_for("youtube:a"), Some(dir.0.join(&a.file)));
    assert_eq!(cache.path_for("youtube:nope"), None);

    cache.evict(&["youtube:a".into()]).expect("evict");
    assert!(!dir.0.join(&a.file).exists());
    assert_eq!(cache.keys(), vec!["youtube:b".to_string()]);

    cache.clear().expect("clear");
    assert_eq!(cache.stats().count, 0);
    assert_eq!(files_in(&dir.0), vec![INDEX_FILE.to_string()]);
}

#[test]
fn a_file_deleted_by_hand_is_forgotten() {
    let dir = TempDir::new("gone");
    let a = entry("youtube:a", 3, 1);
    fs::write(dir.0.join(&a.file), b"abc").expect("write");
    write_index(&dir.0, &index_of(std::slice::from_ref(&a))).expect("index");
    let cache = AudioCache::open(dir.0.clone()).expect("open");
    fs::remove_file(dir.0.join(&a.file)).expect("rm");
    assert_eq!(cache.path_for("youtube:a"), None);
    assert!(cache.keys().is_empty());
}

#[test]
fn an_unavailable_cache_says_why_and_stores_nothing() {
    let cache = AudioCache::unavailable("no cache directory".into());
    assert!(cache.root().is_err());
    assert!(cache.evict(&[]).is_err());
    assert_eq!(cache.path_for("youtube:a"), None);
}

// --- prefetch -------------------------------------------------------------------

#[tokio::test]
async fn a_prefetch_lands_whole_under_its_key() {
    let dir = TempDir::new("pf-done");
    let body = song(64 * 1024);
    let host = host(Reply::ok(body.clone()));
    let cache = AudioCache::open(dir.0.clone()).expect("open");
    let url = format!("{}/api/youtube/stream/a?prefetch=1", host.base);

    let out = cache.prefetch(client(), &url, "youtube:a").await;

    assert_eq!(out, PrefetchOutcome::Done { bytes: body.len() as u64 });
    assert_eq!(
        host.paths.lock().expect("paths").as_slice(),
        ["/api/youtube/stream/a?prefetch=1".to_string()],
        "the host sees the low-priority marker"
    );
    let path = cache.path_for("youtube:a").expect("cached");
    assert_eq!(fs::read(&path).expect("read"), body);
    assert!(files_in(&dir.0).iter().all(|f| !f.ends_with(".part")), "no temp file left");
    assert_eq!(cache.source_url("youtube:a"), Some(format!("{}/api/youtube/stream/a", host.base)));
    let idx = relock(&cache.index);
    assert_eq!(idx.get("youtube:a").and_then(|e| e.mime.clone()).as_deref(), Some("audio/mp4"));
}

#[tokio::test]
async fn a_cached_song_is_not_downloaded_again() {
    let dir = TempDir::new("pf-again");
    let host = host(Reply::ok(song(1024)));
    let cache = AudioCache::open(dir.0.clone()).expect("open");
    let url = format!("{}/s", host.base);
    cache.prefetch(client(), &url, "youtube:a").await;
    let out = cache.prefetch(client(), &url, "youtube:a").await;
    assert_eq!(out, PrefetchOutcome::Done { bytes: 1024 });
    assert_eq!(host.requests.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn busy_and_limited_answers_carry_retry_after() {
    let dir = TempDir::new("pf-retry");
    let cache = AudioCache::open(dir.0.clone()).expect("open");

    let limited = host(Reply::status("429 Too Many Requests").header("Retry-After", "7"));
    let out = cache.prefetch(client(), &format!("{}/s", limited.base), "youtube:a").await;
    assert_eq!(out, PrefetchOutcome::RetryAfter { status: 429, seconds: Some(7) });

    let busy = host(Reply::status("503 Service Unavailable").header("Retry-After", "30"));
    let out = cache.prefetch(client(), &format!("{}/s", busy.base), "youtube:a").await;
    assert_eq!(out, PrefetchOutcome::RetryAfter { status: 503, seconds: Some(30) });

    let gone = host(Reply::status("410 Gone"));
    assert_eq!(cache.prefetch(client(), &format!("{}/s", gone.base), "youtube:a").await, PrefetchOutcome::Gone);

    let broken = host(Reply::status("500 Internal Server Error"));
    let out = cache.prefetch(client(), &format!("{}/s", broken.base), "youtube:a").await;
    assert!(matches!(out, PrefetchOutcome::Failed { .. }), "{out:?}");

    assert!(cache.keys().is_empty(), "nothing is stored for a refusal");
    assert_eq!(files_in(&dir.0), vec![INDEX_FILE.to_string()]);
}

#[tokio::test]
async fn a_truncated_download_leaves_nothing_behind() {
    let dir = TempDir::new("pf-trunc");
    let host = host(Reply { declared_len: Some(10_000), ..Reply::ok(song(4_000)) });
    let cache = AudioCache::open(dir.0.clone()).expect("open");

    let out = cache.prefetch(client(), &format!("{}/s", host.base), "youtube:a").await;

    assert!(matches!(out, PrefetchOutcome::Failed { .. }), "{out:?}");
    assert!(cache.keys().is_empty());
    assert_eq!(files_in(&dir.0), vec![INDEX_FILE.to_string()], "no .part, no .bin");
}

#[tokio::test]
async fn a_song_bigger_than_the_cache_is_refused_before_it_downloads() {
    let dir = TempDir::new("pf-big");
    let host = host(Reply::ok(song(2_000)));
    let cache = AudioCache::open_with(dir.0.clone(), 1_000, 10).expect("open");
    let out = cache.prefetch(client(), &format!("{}/s", host.base), "youtube:a").await;
    assert!(matches!(out, PrefetchOutcome::Failed { .. }), "{out:?}");
    assert_eq!(files_in(&dir.0), vec![INDEX_FILE.to_string()]);
}

#[tokio::test]
async fn a_second_prefetch_at_once_is_busy() {
    let dir = TempDir::new("pf-busy");
    let host = host(Reply { delay: Duration::from_millis(600), ..Reply::ok(song(1024)) });
    let cache = Arc::new(AudioCache::open(dir.0.clone()).expect("open"));
    let url = format!("{}/s", host.base);

    let first = {
        let (cache, url) = (Arc::clone(&cache), url.clone());
        tokio::spawn(async move { cache.prefetch(client(), &url, "youtube:a").await })
    };
    tokio::time::sleep(Duration::from_millis(150)).await;
    let second = cache.prefetch(client(), &url, "youtube:b").await;

    assert_eq!(second, PrefetchOutcome::Busy);
    assert_eq!(first.await.expect("first"), PrefetchOutcome::Done { bytes: 1024 });
}

#[tokio::test]
async fn cancel_stops_the_download_and_cleans_up() {
    let dir = TempDir::new("pf-cancel");
    let host = host(Reply { pause_mid_body: Duration::from_secs(3), ..Reply::ok(song(64 * 1024)) });
    let cache = Arc::new(AudioCache::open(dir.0.clone()).expect("open"));
    let url = format!("{}/s", host.base);

    let run = {
        let (cache, url) = (Arc::clone(&cache), url.clone());
        tokio::spawn(async move { cache.prefetch(client(), &url, "youtube:a").await })
    };
    tokio::time::sleep(Duration::from_millis(400)).await;
    let started = std::time::Instant::now();
    cache.cancel();
    let out = run.await.expect("run");

    assert_eq!(out, PrefetchOutcome::Cancelled);
    assert!(started.elapsed() < Duration::from_secs(2), "cancel waited for the body");
    assert!(cache.keys().is_empty());
    assert_eq!(files_in(&dir.0), vec![INDEX_FILE.to_string()]);
}

#[tokio::test]
async fn a_new_song_evicts_the_least_recently_used_one() {
    let dir = TempDir::new("pf-lru");
    let host = host(Reply::ok(song(400)));
    // Room for two 400-byte songs.
    let cache = AudioCache::open_with(dir.0.clone(), 1_000, 100).expect("open");
    let url = format!("{}/s", host.base);
    cache.prefetch(client(), &url, "youtube:a").await;
    cache.prefetch(client(), &url, "youtube:b").await;
    // a was played after b was cached, so b is now the older one.
    cache.touch_at("youtube:a", now_ms() + 60_000);

    let out = cache.prefetch(client(), &url, "youtube:c").await;

    assert_eq!(out, PrefetchOutcome::Done { bytes: 400 });
    assert_eq!(cache.keys(), vec!["youtube:a".to_string(), "youtube:c".to_string()]);
    assert_eq!(cache.stats().bytes, 800);
}

#[tokio::test]
async fn the_file_cap_holds() {
    let dir = TempDir::new("pf-files");
    let host = host(Reply::ok(song(10)));
    let cache = AudioCache::open_with(dir.0.clone(), 1_000_000, 2).expect("open");
    let url = format!("{}/s", host.base);
    for (i, key) in ["youtube:a", "youtube:b", "youtube:c"].into_iter().enumerate() {
        cache.prefetch(client(), &url, key).await;
        cache.touch_at(key, now_ms() + 1_000 * i as u64);
    }
    assert_eq!(cache.keys(), vec!["youtube:b".to_string(), "youtube:c".to_string()]);
    assert_eq!(files_in(&dir.0).len(), 3, "two songs and the index");
}

#[tokio::test]
async fn the_song_playing_is_never_evicted_for_a_prefetch() {
    let dir = TempDir::new("pf-playing");
    let host = host(Reply::ok(song(400)));
    let cache = AudioCache::open_with(dir.0.clone(), 1_000, 100).expect("open");
    let url = format!("{}/s", host.base);
    cache.prefetch(client(), &url, "youtube:old").await;
    cache.prefetch(client(), &url, "youtube:b").await;
    cache.set_playing(Some("youtube:old".into()));

    cache.prefetch(client(), &url, "youtube:c").await;

    assert_eq!(cache.keys(), vec!["youtube:c".to_string(), "youtube:old".to_string()]);
}

#[tokio::test]
async fn only_http_urls_and_sane_keys_are_accepted() {
    let dir = TempDir::new("pf-guard");
    let cache = AudioCache::open(dir.0.clone()).expect("open");
    let out = cache.prefetch(client(), "file:///etc/passwd", "youtube:a").await;
    assert!(matches!(out, PrefetchOutcome::Failed { .. }));
    let out = cache.prefetch(client(), "http://127.0.0.1:9/s", "").await;
    assert!(matches!(out, PrefetchOutcome::Failed { .. }));
}
