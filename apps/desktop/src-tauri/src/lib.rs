// Ember desktop shell — webview wrapper + native audio engine (Part 5).
//
// The main window is configured in tauri.conf.json to load the live Ember server
// URL (EMBER_APP_URL, default http://localhost:3000). The native audio engine
// (rodio + stream-download) is exposed over the `audio_*` invoke commands and
// emits `audio:*` events back to the webview.

mod audio;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine = audio::AudioEngine::new().expect("failed to init audio engine");
    tauri::Builder::default()
        .manage(engine)
        .invoke_handler(tauri::generate_handler![audio::audio_stop])
        .run(tauri::generate_context!())
        .expect("error while running Ember desktop");
}
