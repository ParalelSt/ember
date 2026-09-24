//! The engine plays a song from the auto cache when it has one.
//!
//! Through the REAL `audio_load` command on tauri's mock app (so this module
//! is not built on Windows, see Cargo.toml), with the cache managed beside
//! the engine the way lib.rs does it, and a local fake host that counts what
//! it is asked for.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::test::{mock_app, MockRuntime};
use tauri::{App, Listener, Manager};

use super::{audio_load, audio_play, audio_seek, AudioEngine};
use crate::cache::tests::{host, Host, Reply, TempDir};
use crate::cache::{AudioCache, PrefetchOutcome};

/// 120 s of AAC in a plain m4a.
const TRACK: &[u8] = include_bytes!("../../test-fixtures/tone-faststart.m4a");
const KEY: &str = "youtube:abc";

struct Rig {
    app: App<MockRuntime>,
    events: Arc<Mutex<Vec<(String, String)>>>,
    stop: Arc<AtomicBool>,
    _dir: TempDir,
}

impl Rig {
    fn new() -> Self {
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
        let dir = TempDir::new("engine");
        let app = mock_app();
        app.manage(AudioEngine::with_output(mixer));
        app.manage(AudioCache::open(dir.0.join("audio-cache")).expect("cache"));
        let events = Arc::new(Mutex::new(Vec::new()));
        for name in ["audio:duration", "audio:play", "audio:error", "audio:ended"] {
            let log = Arc::clone(&events);
            app.listen_any(name, move |e| {
                log.lock().expect("events").push((name.to_string(), e.payload().to_string()));
            });
        }
        Self { app, events, stop, _dir: dir }
    }

    fn cache(&self) -> tauri::State<'_, AudioCache> {
        self.app.state::<AudioCache>()
    }

    /// Puts the song in the cache the way the web side does: a prefetch.
    async fn seed(&self, source: &Host) {
        let client = crate::audio::http_client(None).expect("client");
        let url = format!("{}/api/youtube/stream/abc?prefetch=1", source.base);
        let out = self.cache().prefetch(client, &url, KEY).await;
        assert_eq!(out, PrefetchOutcome::Done { bytes: TRACK.len() as u64 });
    }

    async fn load(&self, url: &str) {
        let app = self.app.handle().clone();
        audio_load(app.clone(), app.state::<AudioEngine>(), url.to_string(), true, 0.0, None, Some(KEY.into()))
            .await
            .expect("the load command itself runs");
    }

    fn count(&self, name: &str) -> usize {
        self.events.lock().expect("events").iter().filter(|(n, _)| n == name).count()
    }

    /// Sound left to play, and not paused.
    fn playing(&self) -> bool {
        let engine = self.app.state::<AudioEngine>();
        let g = engine.sink.lock().expect("sink");
        g.as_ref().is_some_and(|s| !s.empty() && !s.is_paused())
    }
}

impl Drop for Rig {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

fn song_host() -> Host {
    host(Reply::ok(TRACK.to_vec()))
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cached_song_plays_without_asking_the_host() {
    let rig = Rig::new();
    let source = song_host();
    rig.seed(&source).await;
    let before = rig.cache().stats();
    // The song's own stream URL is a host that must not be asked at all.
    let player_host = host(Reply::ok(b"not audio".to_vec()));

    rig.load(&format!("{}/api/youtube/stream/abc", player_host.base)).await;

    assert!(rig.playing(), "the cached song is not playing");
    assert_eq!(player_host.requests.load(Ordering::SeqCst), 0, "the host was asked for a cached song");
    assert_eq!(rig.count("audio:error"), 0);
    assert_eq!(rig.count("audio:duration"), 1, "the duration comes from the cached file");
    assert_eq!(rig.cache().stats(), before, "playing it keeps it cached");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cache_request_with_no_url_plays_the_cached_file() {
    let rig = Rig::new();
    let source = song_host();
    rig.seed(&source).await;

    rig.load(&format!("cache:{KEY}")).await;

    assert!(rig.playing());
    assert_eq!(source.requests.load(Ordering::SeqCst), 1, "only the prefetch reached the host");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unreadable_cached_copy_is_deleted_and_the_song_streams() {
    let rig = Rig::new();
    let source = song_host();
    rig.seed(&source).await;
    // Same length, so the index still believes it; no decoder can read it.
    let path = rig.cache().path_for(KEY).expect("cached");
    std::fs::write(&path, vec![0u8; TRACK.len()]).expect("corrupt");

    rig.load(&format!("{}/api/youtube/stream/abc", source.base)).await;

    assert!(rig.playing(), "the song did not stream after the bad copy");
    // The prefetch was one request; streaming makes more (the decoder reads
    // the tail with a request of its own).
    assert!(source.requests.load(Ordering::SeqCst) > 1, "the song was not streamed after the bad copy");
    assert!(rig.cache().path_for(KEY).is_none(), "the bad copy is still cached");
    assert!(!path.exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unreadable_copy_behind_a_cache_request_streams_from_where_it_came_from() {
    let rig = Rig::new();
    let source = song_host();
    rig.seed(&source).await;
    let path = rig.cache().path_for(KEY).expect("cached");
    std::fs::write(&path, vec![0u8; TRACK.len()]).expect("corrupt");

    rig.load(&format!("cache:{KEY}")).await;

    assert!(rig.playing());
    assert!(source.requests.load(Ordering::SeqCst) > 1, "it did not stream from the stored source URL");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cache_request_for_a_song_that_is_not_cached_fails_cleanly() {
    let rig = Rig::new();

    rig.load(&format!("cache:{KEY}")).await;

    assert!(!rig.playing());
    let errors = rig.events.lock().expect("events").clone();
    let error = errors.iter().find(|(n, _)| n == "audio:error").expect("an audio:error");
    assert!(error.1.contains(r#""retry":"none""#), "{error:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn without_a_cache_key_the_song_streams_as_before() {
    let rig = Rig::new();
    let source = song_host();
    rig.seed(&source).await;
    let app = rig.app.handle().clone();

    audio_load(
        app.clone(),
        app.state::<AudioEngine>(),
        format!("{}/api/youtube/stream/abc", source.base),
        true,
        0.0,
        None,
        None,
    )
    .await
    .expect("load");

    assert!(rig.playing());
    assert!(source.requests.load(Ordering::SeqCst) > 1, "an old web build streams even when cached");
}

/// Repeat one on a song from the auto cache (P02 on top of the cache): the
/// webview answers `audio:ended` with a seek to 0 and a play. The spent sink
/// re-opens the track, and that must be the cached copy again: its `cache:`
/// request is nothing the stream path can fetch.
#[tokio::test(flavor = "multi_thread")]
async fn repeat_one_on_a_cached_song_plays_the_cached_copy_again() {
    let rig = Rig::new();
    let source = song_host();
    rig.seed(&source).await;
    rig.load(&format!("cache:{KEY}")).await;

    let started = std::time::Instant::now();
    while rig.count("audio:ended") == 0 && started.elapsed() < Duration::from_secs(60) {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(rig.count("audio:ended"), 1, "the song should play through first");

    let app = rig.app.handle().clone();
    audio_seek(app.clone(), app.state::<AudioEngine>(), 0.0);
    audio_play(app.clone(), app.state::<AudioEngine>());

    let started = std::time::Instant::now();
    while !rig.playing() && started.elapsed() < Duration::from_secs(10) {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(rig.playing(), "the repeat did not play: {:?}", rig.events.lock().expect("events"));
    assert_eq!(rig.count("audio:error"), 0);
    assert_eq!(source.requests.load(Ordering::SeqCst), 1, "only the prefetch reached the host");
}
