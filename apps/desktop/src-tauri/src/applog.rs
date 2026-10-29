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
// logs the outcome of every fetch to the auth and API endpoints, which is what
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
    // Windows has no $HOME, reading it returns None, which silently disabled
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
    // Fresh file each launch, otherwise it grows forever and old runs confuse.
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

/// Called from the webview. Never fails loudly, logging must not break the app.
#[tauri::command]
pub fn log_event(state: tauri::State<'_, LogFile>, level: String, message: String) {
    let path = state.0.lock().ok().and_then(|g| g.clone());
    // Bound the message so a runaway loop can't fill the disk.
    let msg: String = message.chars().take(2000).collect();
    write_line(path.as_ref(), &level.to_uppercase(), &msg);
}

/// The tail of the log file, for attaching to a bug report.
///
/// The desktop log holds what the WebView cannot see (audio engine, media
/// controls, updater, the window's real URL), which is exactly what is missing
/// from a report filed from inside the shell. Capped at 500 lines: the IPC
/// response crosses into the WebView and ends up in a Discord attachment, and
/// the useful part of a log is always its end.
///
/// Async, with the file work on a blocking thread: a sync command runs on the
/// main thread, and the log of a long session is big.
#[tauri::command]
pub async fn log_tail(state: tauri::State<'_, LogFile>, lines: usize) -> Result<String, String> {
    let Some(path) = state.0.lock().ok().and_then(|g| g.clone()) else {
        return Ok(String::new());
    };
    Ok(tauri::async_runtime::spawn_blocking(move || tail_of(&path, lines)).await.unwrap_or_default())
}

/// Most of the file `tail_of` reads: 500 lines of up to 2000 characters
/// (see `log_event`), with room to spare.
const MAX_TAIL_BYTES: u64 = 4 * 1024 * 1024;
/// How much `tail_of` reads at a time, walking back from the end.
const TAIL_BLOCK: u64 = 64 * 1024;

/// The last `lines` lines of the file at `path` (1 to 500), read from the end
/// back only as far as they go.
fn tail_of(path: &std::path::Path, lines: usize) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let want = lines.clamp(1, 500);
    // A missing or unreadable log is not an error worth surfacing: the caller
    // attaches nothing and the report still goes out.
    let Ok(mut file) = std::fs::File::open(path) else { return String::new() };
    let Ok(len) = file.metadata().map(|m| m.len()) else { return String::new() };
    let floor = len.saturating_sub(MAX_TAIL_BYTES);
    let mut start = len;
    let mut buf: Vec<u8> = Vec::new();
    // One newline more than the lines wanted, so the first one is whole.
    while start > floor && buf.iter().filter(|b| **b == b'\n').count() <= want {
        let from = start.saturating_sub(TAIL_BLOCK).max(floor);
        let mut block = vec![0u8; (start - from) as usize];
        if file.seek(SeekFrom::Start(from)).is_err() || file.read_exact(&mut block).is_err() {
            return String::new();
        }
        block.extend_from_slice(&buf);
        buf = block;
        start = from;
    }
    let text = String::from_utf8_lossy(&buf);
    let mut all: Vec<&str> = text.lines().collect();
    // Read from part way into a line: that line is not whole.
    if start > 0 && !all.is_empty() {
        all.remove(0);
    }
    all[all.len().saturating_sub(want)..].join("\n")
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

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ember-applog-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dir");
        dir
    }

    #[test]
    fn the_tail_is_the_last_lines_in_order() {
        let dir = scratch("order");
        let path = dir.join("ember-desktop.log");
        let body: String = (1..=600).map(|i| format!("line {i}\n")).collect();
        std::fs::write(&path, body).expect("write");
        let tail = tail_of(&path, 3);
        assert_eq!(tail, "line 598\nline 599\nline 600");
        assert_eq!(tail_of(&path, 10_000).lines().count(), 500, "capped at 500 lines");
        assert_eq!(tail_of(&path, 0), "line 600", "at least one line");
        assert_eq!(tail_of(&dir.join("missing.log"), 5), "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The log is only cleared at launch, and a long session (a line for
    /// every /api fetch) makes it big. The whole file used to be read, on the
    /// main thread, to return its last 200 lines; only the end is read now.
    /// Shown here by a start that is not text at all, which made the old
    /// whole-file read fail and the report go out with no log.
    #[test]
    fn only_the_end_of_a_long_log_is_read() {
        let dir = scratch("long");
        let path = dir.join("ember-desktop.log");
        let mut body = vec![0xffu8; 4 * 1024 * 1024];
        body.push(b'\n');
        for i in 1..=300 {
            body.extend_from_slice(format!("[1] INFO line {i}\n").as_bytes());
        }
        std::fs::write(&path, body).expect("write");
        let tail = tail_of(&path, 200);
        assert_eq!(tail.lines().count(), 200);
        assert!(tail.starts_with("[1] INFO line 101\n"), "{}", &tail[..40.min(tail.len())]);
        assert!(tail.ends_with("[1] INFO line 300"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
