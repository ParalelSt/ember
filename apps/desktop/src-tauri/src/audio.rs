// Ember desktop — native audio engine (Part 5).
//
// Plays audio through `rodio` (symphonia decode). This first slice sets up the
// engine state and a `stop` command; streaming load/transport/seek/volume land in
// the following commits.
//
// Crate API notes (verified against current docs):
//   * rodio 0.21: `OutputStreamBuilder::open_default_stream()` returns an
//     `OutputStream` that must be kept alive; `.mixer()` -> `&Mixer`;
//     `Sink::connect_new(mixer)` builds a Sink. (0.22 renamed Sink->Player.)

use std::sync::{mpsc, Mutex};

use rodio::mixer::Mixer;
use rodio::{OutputStreamBuilder, Sink};
use tauri::State;

/// Native audio engine state, stored in Tauri managed state.
///
/// `rodio::OutputStream` (cpal `Stream`) is `!Send + !Sync`, so it cannot live in
/// Tauri's managed state directly. Instead we keep it alive on a dedicated parked
/// thread and store a cloned `Mixer` (which IS `Send + Sync + Clone`) here. New
/// `Sink`s are built from that mixer on demand.
pub struct AudioEngine {
    /// Output mixer cloned off the (thread-pinned) OutputStream. Used to build sinks
    /// (wired up in the load command in the next commit).
    #[allow(dead_code)]
    mixer: Mixer,
    /// Current playback sink. `None` when nothing is loaded.
    sink: Mutex<Option<Sink>>,
    /// Last loaded absolute stream URL (for diagnostics / future recovery).
    current_url: Mutex<Option<String>>,
}

impl AudioEngine {
    pub fn new() -> Result<Self, String> {
        // Open the output stream on a dedicated thread and keep it alive there
        // forever (the cpal Stream is !Send, so it must not cross threads). The
        // thread hands back a cloned Mixer, then parks holding the stream.
        let (tx, rx) = mpsc::channel::<Result<Mixer, String>>();
        std::thread::Builder::new()
            .name("ember-audio-output".into())
            .spawn(move || match OutputStreamBuilder::open_default_stream() {
                Ok(stream) => {
                    let _ = tx.send(Ok(stream.mixer().clone()));
                    // Keep `stream` alive for the lifetime of the process.
                    std::thread::park();
                    drop(stream);
                }
                Err(e) => {
                    let _ = tx.send(Err(e.to_string()));
                }
            })
            .map_err(|e| e.to_string())?;

        let mixer = rx
            .recv()
            .map_err(|_| "audio output thread exited".to_string())??;

        Ok(Self {
            mixer,
            sink: Mutex::new(None),
            current_url: Mutex::new(None),
        })
    }
}

#[tauri::command]
pub fn audio_stop(engine: State<'_, AudioEngine>) {
    if let Ok(mut guard) = engine.sink.lock() {
        if let Some(sink) = guard.take() {
            sink.stop();
        }
    }
    if let Ok(mut u) = engine.current_url.lock() {
        *u = None;
    }
}
