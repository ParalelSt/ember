// Ember desktop shell.
//
// WS1 is a pure webview wrapper: the main window is configured in tauri.conf.json
// to load the live Ember server URL (EMBER_APP_URL, default http://localhost:3000).
// No IPC / Rust commands yet — native audio + media keys arrive in a later workstream.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Ember desktop");
}
