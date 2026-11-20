//! Launch bookkeeping and update telemetry.
//!
//! This used to be the launch gate: before the window showed the server it
//! asked for a newer Ember and could hold the launch on an update dialog
//! (a countdown, and for a required update "Quit Ember"). Owner, 2026-11-14:
//! there are no required updates and no launch dialog. Every update is
//! optional and starts from a tap on the page's reminder or its Settings
//! card (apps/web/lib/update/apply.ts, src/update.rs). The app now opens
//! straight on the server.
//!
//! What is left:
//!  - `launch.json` notes the version that ran last, so the first launch
//!    after an update says "update.gate.done" (from, to).
//!  - The update telemetry ("update.*" events), kept on disk until the
//!    signed-in page picks it up (`update_gate_events`,
//!    apps/web/lib/desktopGateEvents.ts) and sends it to /api/native-log.
//!  - Helpers the page's update shares: the version compare, the feed and
//!    download clocks, and the macOS location check.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::applog;

/// The updater's own feed. Its download gets no such clock from the plugin
/// (see `download_unless_stalled`).
pub(crate) const FEED_TIMEOUT: Duration = Duration::from_secs(30);
/// How long the download may bring nothing before the update gives up on it.
/// The server itself waits up to a minute for GitHub to start answering.
pub(crate) const DOWNLOAD_STALL: Duration = Duration::from_secs(60);
/// Telemetry kept for the page to send, at most.
const MAX_EVENTS: usize = 50;

// --- Launch history -----------------------------------------------------------

/// What `launch.json` keeps. Files from the launch gate's time carry more
/// fields (the stage, crash counts); they are ignored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct LaunchHistory {
    /// The version that ran last, to notice an update went in.
    pub last_version: Option<String>,
}

/// The history to write at the start of this launch, and the version this
/// replaced when an update went in since last time.
pub fn on_launch(prev: &LaunchHistory, version: &str) -> (LaunchHistory, Option<String>) {
    let updated_from = prev
        .last_version
        .as_deref()
        .filter(|v| *v != version && is_newer(version, v))
        .map(str::to_string);
    (LaunchHistory { last_version: Some(version.to_string()) }, updated_from)
}

const HISTORY_FILE: &str = "launch.json";

pub fn load_history(dir: &Path) -> LaunchHistory {
    std::fs::read_to_string(dir.join(HISTORY_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn store_history(dir: &Path, h: &LaunchHistory) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let json = serde_json::to_string(h).map_err(std::io::Error::other)?;
    std::fs::write(dir.join(HISTORY_FILE), json)
}

/// Plain x.y.z, compared number by number. Anything unparseable is never
/// newer, so a malformed answer can never look like an update.
pub fn is_newer(candidate: &str, current: &str) -> bool {
    fn parse(v: &str) -> Option<[u64; 3]> {
        let v = v.trim().trim_start_matches('v');
        let mut it = v.split('.').map(|p| p.parse::<u64>().ok());
        let out = [it.next()??, it.next()??, it.next()??];
        it.next().is_none().then_some(out)
    }
    match (parse(candidate), parse(current)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

/// macOS cannot replace an app run from the disk image or from a
/// quarantined copy it moved aside (App Translocation): the update has
/// nowhere to go. Said before trying, so the dialog can say what to do.
pub fn mac_location_problem(exe: &Path) -> bool {
    let p = exe.to_string_lossy();
    p.starts_with("/Volumes/") || p.contains("/AppTranslocation/")
}

/// Runs `download` (the updater's own, handed the chunk callback to report
/// through) until it is done, or until nothing has arrived for `stall`.
///
/// The updater plugin puts no clock on its download, so a body that stopped
/// arriving (a dropped link, a laptop that slept) was waited on forever. Now
/// it fails, and the page's update says so (src/update.rs).
pub(crate) async fn download_unless_stalled<'a, T, Fut>(
    stall: Duration,
    mut on_chunk: impl FnMut(usize, Option<u64>) + Send + 'a,
    download: impl FnOnce(Box<dyn FnMut(usize, Option<u64>) + Send + 'a>) -> Fut,
) -> Result<T, String>
where
    Fut: std::future::Future<Output = Result<T, String>>,
{
    /// No limit on a download that keeps moving, however slowly.
    const NO_LIMIT: Duration = Duration::from_secs(24 * 60 * 60);
    let progress = Arc::new(crate::audio::DownloadProgress::started_now());
    let seen = Arc::clone(&progress);
    let fut = download(Box::new(move |chunk, total| {
        seen.record(false);
        on_chunk(chunk, total);
    }));
    match crate::audio::while_progressing(fut, &progress, stall, NO_LIMIT).await {
        Ok(out) => out,
        Err(_) => Err(format!("the update stopped arriving (nothing for {}s)", stall.as_secs())),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GateEvent {
    pub ts: u64,
    pub event: String,
    pub data: serde_json::Value,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

const EVENTS_FILE: &str = "gate-events.json";

/// Events are pushed from the app's tasks while the page takes the batch on
/// a command thread, and both are a read, a change and a write of the file:
/// unserialized, an event pushed in between was lost.
static EVENTS_LOCK: Mutex<()> = Mutex::new(());

/// Telemetry for the page to send once it is signed in. Kept on disk, so an
/// update that ends this process (the install) still reports.
pub fn push_event(dir: &Path, event: GateEvent) {
    let _held = EVENTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = read_events(dir);
    all.push(event);
    let skip = all.len().saturating_sub(MAX_EVENTS);
    let _ = std::fs::create_dir_all(dir);
    if let Ok(json) = serde_json::to_string(&all[skip..]) {
        let _ = std::fs::write(dir.join(EVENTS_FILE), json);
    }
}

fn read_events(dir: &Path) -> Vec<GateEvent> {
    std::fs::read_to_string(dir.join(EVENTS_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Everything kept, and forget it.
pub fn take_events(dir: &Path) -> Vec<GateEvent> {
    let _held = EVENTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let all = read_events(dir);
    let _ = std::fs::remove_file(dir.join(EVENTS_FILE));
    all
}

// --- Managed state ------------------------------------------------------------

/// Where the telemetry goes: the app's data folder, and the app log.
pub struct Gate {
    dir: Option<PathBuf>,
    log_path: Option<PathBuf>,
}

impl Gate {
    pub fn new(dir: Option<PathBuf>, log_path: Option<PathBuf>) -> Self {
        Gate { dir, log_path }
    }

    pub fn event(&self, event: &str, data: serde_json::Value) {
        applog::write_line(self.log_path.as_ref(), "INFO", &format!("{event} {data}"));
        if let Some(dir) = &self.dir {
            push_event(dir, GateEvent { ts: now_ms(), event: event.to_string(), data });
        }
    }
}

/// The update telemetry since it was last asked, for the signed-in page to
/// forward to /api/native-log (apps/web/lib/desktopGateEvents.ts).
#[tauri::command]
pub fn update_gate_events(gate: tauri::State<'_, Arc<Gate>>) -> Vec<GateEvent> {
    gate.dir.as_deref().map(take_events).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Instant;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ember-gate-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn notices_that_an_update_went_in() {
        let prev = LaunchHistory { last_version: Some("0.4.21".into()) };
        let (next, from) = on_launch(&prev, "0.4.22");
        assert_eq!(from.as_deref(), Some("0.4.21"));
        assert_eq!(next.last_version.as_deref(), Some("0.4.22"));
        assert_eq!(on_launch(&prev, "0.4.20").1, None, "a downgrade is not an update");
        assert_eq!(on_launch(&prev, "0.4.21").1, None, "the same version is not an update");
        assert_eq!(on_launch(&LaunchHistory::default(), "0.4.21").1, None, "a first launch is not an update");
    }

    #[test]
    fn the_history_survives_a_restart_and_a_bad_file_is_a_fresh_start() {
        let dir = scratch("history");
        assert_eq!(load_history(&dir), LaunchHistory::default());
        let h = LaunchHistory { last_version: Some("0.4.27".into()) };
        store_history(&dir, &h).unwrap();
        assert_eq!(load_history(&dir), h);
        std::fs::write(dir.join(HISTORY_FILE), "{broken").unwrap();
        assert_eq!(load_history(&dir), LaunchHistory::default());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A launch.json from the launch gate's time still says which version ran.
    #[test]
    fn an_old_history_file_still_reads() {
        let dir = scratch("history-old");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(HISTORY_FILE),
            r#"{"stage":"ready","failed_in_gate":0,"failed_after_gate":1,"last_version":"0.4.26"}"#,
        )
        .unwrap();
        assert_eq!(load_history(&dir).last_version.as_deref(), Some("0.4.26"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn versions_compare_by_number() {
        assert!(is_newer("0.4.10", "0.4.9"));
        assert!(is_newer("v1.0.0", "0.9.99"));
        assert!(!is_newer("0.4.9", "0.4.10"));
        assert!(!is_newer("0.4.9", "0.4.9"));
        assert!(!is_newer("0.4", "0.3.0"));
        assert!(!is_newer("0.5.0.1", "0.3.0"));
    }

    #[test]
    fn an_app_outside_applications_cannot_update_itself() {
        assert!(mac_location_problem(Path::new("/Volumes/Ember/Ember.app/Contents/MacOS/ember-desktop")));
        assert!(mac_location_problem(Path::new("/private/var/folders/x/T/AppTranslocation/ABC/d/Ember.app/Contents/MacOS/ember-desktop")));
        assert!(!mac_location_problem(Path::new("/Applications/Ember.app/Contents/MacOS/ember-desktop")));
        assert!(!mac_location_problem(Path::new("/Users/a/Applications/Ember.app/Contents/MacOS/ember-desktop")));
    }

    /// A download that stopped arriving was waited on forever, the dialog
    /// frozen on "Downloading". It now fails at the stall budget.
    #[tokio::test]
    async fn a_download_that_stops_arriving_fails_instead_of_waiting_forever() {
        let started = Instant::now();
        let out: Result<(), String> = download_unless_stalled(Duration::from_millis(300), |_, _| {}, |mut on_chunk| async move {
            on_chunk(1024, Some(4096));
            std::future::pending::<()>().await;
            Ok(())
        })
        .await;
        assert!(out.is_err(), "{out:?}");
        assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
    }

    /// A slow download that keeps arriving is never cut off, and every chunk
    /// still reaches the progress bar.
    #[tokio::test]
    async fn a_slow_download_that_keeps_arriving_is_waited_for() {
        let mut seen = 0usize;
        let out = download_unless_stalled(Duration::from_millis(300), |chunk, _| seen += chunk, |mut on_chunk| async move {
            for _ in 0..10 {
                tokio::time::sleep(Duration::from_millis(100)).await;
                on_chunk(1, None);
            }
            Ok(42)
        })
        .await;
        assert_eq!(out, Ok(42));
        assert_eq!(seen, 10);
    }

    #[test]
    fn events_are_kept_until_taken_and_capped() {
        let dir = scratch("events");
        for i in 0..(MAX_EVENTS + 5) {
            push_event(&dir, GateEvent { ts: i as u64, event: "update.gate.check".into(), data: json!({ "i": i }) });
        }
        let all = take_events(&dir);
        assert_eq!(all.len(), MAX_EVENTS);
        assert_eq!(all.last().unwrap().ts, (MAX_EVENTS + 4) as u64);
        assert!(take_events(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The gate pushes from its own task while the page takes the batch on a
    /// command thread: each is a read, a change and a write of one file, so an
    /// event that landed in between was lost.
    #[test]
    fn events_pushed_while_the_page_takes_them_are_not_lost() {
        let dir = scratch("events-race");
        let done = Arc::new(AtomicBool::new(false));
        let taker = {
            let (dir, done) = (dir.clone(), done.clone());
            std::thread::spawn(move || {
                let mut got = Vec::new();
                while !done.load(Ordering::SeqCst) {
                    got.extend(take_events(&dir));
                }
                got
            })
        };
        let pushers: Vec<_> = (0..4u64)
            .map(|t| {
                let dir = dir.clone();
                std::thread::spawn(move || {
                    for i in 0..10u64 {
                        push_event(&dir, GateEvent { ts: t * 100 + i, event: "update.gate.check".into(), data: json!({}) });
                    }
                })
            })
            .collect();
        for p in pushers {
            p.join().unwrap();
        }
        done.store(true, Ordering::SeqCst);
        let mut got = taker.join().unwrap();
        got.extend(take_events(&dir));
        let mut ts: Vec<u64> = got.iter().map(|e| e.ts).collect();
        ts.sort_unstable();
        ts.dedup();
        assert_eq!(ts.len(), 40, "every pushed event is taken exactly once");
        assert_eq!(got.len(), 40, "and none twice");
        let _ = std::fs::remove_dir_all(&dir);
    }

}
