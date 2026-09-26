//! The equalizer is in the engine's real pipeline: a song loaded through the
//! REAL `audio_load` command on tauri's mock app comes out of the mixer
//! quieter when `audio_set_eq` cuts every band, and unchanged when it is off.
//! (Not built on Windows, see Cargo.toml.)

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::test::{mock_app, MockRuntime};
use tauri::{App, Manager};

use super::{audio_load, audio_set_eq, AudioEngine};
use crate::cache::tests::{host, Reply};

/// 120 s of AAC in a plain m4a.
const TRACK: &[u8] = include_bytes!("../../test-fixtures/tone-faststart.m4a");
/// What each run listens to: one second of stereo at the mixer's rate.
const WANT: usize = 44_100 * 2;

struct Rig {
    app: App<MockRuntime>,
    heard: Arc<Mutex<Vec<f32>>>,
    stop: Arc<AtomicBool>,
}

impl Rig {
    /// An engine whose output is pulled here, the way a device would, and
    /// kept once the song has started (silence before it is not).
    fn new() -> Self {
        let (mixer, mut out) = rodio::mixer::mixer(2, 44_100);
        let stop = Arc::new(AtomicBool::new(false));
        let heard = Arc::new(Mutex::new(Vec::new()));
        let (halt, keep) = (Arc::clone(&stop), Arc::clone(&heard));
        std::thread::spawn(move || {
            let mut started = false;
            while !halt.load(Ordering::SeqCst) {
                let mut got = false;
                for _ in 0..4096 {
                    let Some(s) = out.next() else { continue };
                    got = true;
                    started |= s.abs() > 1e-4;
                    if started {
                        let mut h = keep.lock().expect("heard");
                        if h.len() < WANT {
                            h.push(s);
                        }
                    }
                }
                if !got {
                    std::thread::sleep(Duration::from_millis(1));
                }
            }
        });
        let app = mock_app();
        app.manage(AudioEngine::with_output(mixer));
        Self { app, heard, stop }
    }

    fn set_eq(&self, enabled: bool, bands: Vec<f32>) {
        audio_set_eq(self.app.state::<AudioEngine>(), enabled, bands);
    }

    /// Loads and plays the song, and returns the RMS of its first second.
    async fn play(&self, url: &str) -> f64 {
        let app = self.app.handle().clone();
        audio_load(app.clone(), app.state::<AudioEngine>(), url.to_string(), true, 0.0, None, None, None)
            .await
            .expect("the load command itself runs");
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            {
                let h = self.heard.lock().expect("heard");
                if h.len() >= WANT {
                    return (h.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / h.len() as f64).sqrt();
                }
            }
            assert!(Instant::now() < deadline, "the song never played");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}

impl Drop for Rig {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cut_on_every_band_quietens_the_song_and_off_leaves_it_alone() {
    let source = host(Reply::ok(TRACK.to_vec()));
    let url = format!("{}/api/youtube/stream/abc", source.base);

    let plain = Rig::new();
    let as_is = plain.play(&url).await;
    assert!(as_is > 0.001, "the song is audible: rms {as_is}");

    // Switched off, the settings do nothing.
    let off = Rig::new();
    off.set_eq(false, vec![-12.0; 5]);
    let rms_off = off.play(&url).await;
    assert!((rms_off / as_is - 1.0).abs() < 0.01, "off changed the level: {rms_off} vs {as_is}");

    let cut = Rig::new();
    cut.set_eq(true, vec![-12.0; 5]);
    let rms_cut = cut.play(&url).await;
    let db = 20.0 * (rms_cut / as_is).log10();
    assert!(db < -6.0, "every band cut by 12 dB left the song at {db:.1} dB");
}
