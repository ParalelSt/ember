// Diagnostics for the packaged desktop app.
//
// A release Tauri app is a black box: the webview's console goes nowhere and
// Rust's stderr is invisible once launched from Finder. This writes both to a
// file the user can read, and mirrors them to stderr for `npm run dev`.
//
//   ~/Library/Logs/Ember/ember-desktop.log   (macOS)
//
// The webview side is wired up by an initialization script (see lib.rs) that
// forwards console.error / console.warn / unhandled errors + rejections, and
// logs the outcome of every fetch to the auth and API endpoints — which is what
// you actually need when a login fails inside the shell.

use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct LogFile(pub Mutex<Option<PathBuf>>);

impl Default for LogFile {
    fn default() -> Self {
        LogFile(Mutex::new(None))
    }
}

fn log_dir() -> Option<PathBuf> {
    // Windows has no $HOME — reading it returns None, which silently disabled
    // logging entirely on Windows (the one platform where you can't just run
    // the binary from a terminal to see stderr). Use the platform's own
    // convention on each OS.
    #[cfg(windows)]
    {
        let base = std::env::var_os("LOCALAPPDATA")
            .or_else(|| std::env::var_os("APPDATA"))
            .or_else(|| std::env::var_os("USERPROFILE"))?;
        let mut p = PathBuf::from(base);
        p.push("Ember");
        p.push("logs");
        Some(p)
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var_os("HOME")?;
        let mut p = PathBuf::from(home);
        #[cfg(target_os = "macos")]
        {
            p.push("Library");
            p.push("Logs");
            p.push("Ember");
        }
        #[cfg(not(target_os = "macos"))]
        {
            p.push(".local");
            p.push("share");
            p.push("ember");
            p.push("logs");
        }
        Some(p)
    }
}

/// Create the log file (truncating the previous run) and return its path.
pub fn init() -> Option<PathBuf> {
    let dir = log_dir()?;
    create_dir_all(&dir).ok()?;
    let path = dir.join("ember-desktop.log");
    // Fresh file each launch — otherwise it grows forever and old runs confuse.
    let _ = std::fs::write(&path, b"");
    Some(path)
}

pub fn write_line(path: Option<&PathBuf>, level: &str, msg: &str) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!("[{stamp}] {level} {msg}\n");
    eprint!("{line}");
    if let Some(p) = path {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(p) {
            let _ = f.write_all(line.as_bytes());
        }
    }
}

/// Called from the webview. Never fails loudly — logging must not break the app.
#[tauri::command]
pub fn log_event(state: tauri::State<'_, LogFile>, level: String, message: String) {
    let path = state.0.lock().ok().and_then(|g| g.clone());
    // Bound the message so a runaway loop can't fill the disk.
    let msg: String = message.chars().take(2000).collect();
    write_line(path.as_ref(), &level.to_uppercase(), &msg);
}

/// Where the log lives, so the UI/user can find it.
#[tauri::command]
pub fn log_path(state: tauri::State<'_, LogFile>) -> String {
    state
        .0
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}
