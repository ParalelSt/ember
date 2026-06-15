// Ember desktop shell — webview wrapper + native audio engine (Part 5).
//
// The main window is configured in tauri.conf.json to load the live Ember server
// URL (EMBER_APP_URL, default http://localhost:3000). The native audio engine
// (rodio + stream-download) is exposed over the `audio_*` invoke commands and
// emits `audio:*` events back to the webview.

mod audio;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine = audio::AudioEngine::new().expect("failed to init audio engine");
    tauri::Builder::default()
        .manage(engine)
        .setup(|app| {
            // Initialize OS media controls (macOS Now Playing / Linux MPRIS /
            // Windows SMTC). Non-fatal: playback still works without them, so a
            // failure is logged and swallowed rather than aborting startup.
            let handle = app.handle().clone();
            let state = app.state::<audio::AudioEngine>();
            if let Err(e) = audio::init_media_controls(&handle, state.inner()) {
                eprintln!("[ember] media controls unavailable: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio::audio_stop,
            audio::audio_load,
            audio::audio_play,
            audio::audio_pause,
            audio::audio_seek,
            audio::audio_set_volume,
            audio::audio_set_metadata,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ember desktop");
}
