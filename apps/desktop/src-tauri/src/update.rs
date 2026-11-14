//! Desktop updates, started by the person (owner, 2026-11-14).
//!
//! The page offers a newer Ember with its reminder pill and Settings' Updates
//! card (apps/web/lib/update/apply.ts). Nothing here runs by itself: there is
//! no background download and no launch dialog. A tap:
//!
//!  - while a song plays: `update_download` fetches the update now and keeps
//!    it; at the end of the song the page calls `update_install`;
//!  - with nothing playing: `update_install` at once (it downloads first when
//!    nothing is kept yet).
//!
//! `update_install` checks the kept copy against the release's signature
//! (the pubkey baked into tauri.conf.json, so a compromised server still
//! cannot push a build) and hands it to the installer. On Windows the
//! installer quits this process and starts the new version (passive mode,
//! a small progress window); on macOS and Linux it swaps the app on disk and
//! the app restarts itself. The page's note of the song to start once the
//! new version opens is kept in this folder too (`update_take_resume`): the
//! install ends the process sooner than the WebView writes its own storage.
//!
//! The server answers from the GitHub Release (it holds the token; the app
//! never does) and streams the installer back.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::applog;

// --- The downloaded copy -----------------------------

const STAGED_BYTES: &str = "pending.bin";
const STAGED_VERSION: &str = "pending.version";

/// Keeps `bytes` as `version`. The version file goes last, so it only ever
/// names a complete download.
pub(crate) fn stage(dir: &Path, version: &str, bytes: &[u8]) -> std::io::Result<()> {
    clear(dir);
    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join(STAGED_BYTES), bytes)?;
    std::fs::write(dir.join(STAGED_VERSION), version)
}

/// The version kept in `dir`, if any.
pub(crate) fn staged_version(dir: &Path) -> Option<String> {
    let v = std::fs::read_to_string(dir.join(STAGED_VERSION)).ok()?;
    let v = v.trim();
    (!v.is_empty() && dir.join(STAGED_BYTES).is_file()).then(|| v.to_string())
}

pub(crate) fn staged_bytes(dir: &Path) -> std::io::Result<Vec<u8>> {
    std::fs::read(dir.join(STAGED_BYTES))
}

pub(crate) fn clear(dir: &Path) {
    let _ = std::fs::remove_file(dir.join(STAGED_VERSION));
    let _ = std::fs::remove_file(dir.join(STAGED_BYTES));
}

/// Checks the kept copy against the release's signature, as the plugin's own
/// download does: the file sat on disk since, and the installer it holds may
/// run with admin rights.
pub(crate) fn verify(bytes: &[u8], signature: &str, pubkey: &str) -> Result<(), String> {
    let decode = |b64: &str| -> Result<String, String> {
        let raw = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| e.to_string())?;
        String::from_utf8(raw).map_err(|e| e.to_string())
    };
    let key = minisign_verify::PublicKey::decode(&decode(pubkey)?).map_err(|e| e.to_string())?;
    let sig = minisign_verify::Signature::decode(&decode(signature)?).map_err(|e| e.to_string())?;
    key.verify(bytes, &sig, true).map_err(|e| e.to_string())
}

/// Where the downloaded copy is kept.
pub(crate) fn update_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("update"))
}

/// The updater pubkey from tauri.conf.json.
pub(crate) fn pubkey(app: &AppHandle) -> Option<String> {
    app.config()
        .plugins
        .0
        .get("updater")?
        .get("pubkey")?
        .as_str()
        .map(str::to_string)
}

// --- The resume note --------------------------------------------------------

const RESUME_NOTE: &str = "resume.json";

/// Keeps the page's note (`{ index, trackId, at }`, at most 2000 bytes).
pub(crate) fn keep_resume(dir: &Path, note: &str) -> std::io::Result<()> {
    if note.is_empty() || note.len() > 2000 {
        return Ok(());
    }
    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join(RESUME_NOTE), note)
}

/// The note, once.
pub(crate) fn take_resume(dir: &Path) -> Option<String> {
    let note = std::fs::read_to_string(dir.join(RESUME_NOTE)).ok()?;
    let _ = std::fs::remove_file(dir.join(RESUME_NOTE));
    (!note.trim().is_empty()).then_some(note)
}

// --- The commands -----------------------------------------------------------

fn log_line(app: &AppHandle, level: &str, msg: &str) {
    let path = app.try_state::<applog::LogFile>().and_then(|f| f.0.lock().ok().and_then(|p| p.clone()));
    applog::write_line(path.as_ref(), level, msg);
}

fn event(app: &AppHandle, name: &str, data: serde_json::Value) {
    if let Some(gate) = app.try_state::<std::sync::Arc<crate::gate::Gate>>() {
        gate.event(name, data);
    }
}

/// The updater's view of the newest release (its signature and download).
async fn fetch(app: &AppHandle) -> Result<tauri_plugin_updater::Update, String> {
    let updater = app
        .updater_builder()
        .timeout(crate::gate::FEED_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    updater.check().await.map_err(|e| e.to_string())?.ok_or_else(|| "no update to install".to_string())
}

/// Downloads `update` and keeps it, unless that version is kept already.
async fn download_and_keep(dir: &Path, update: &tauri_plugin_updater::Update) -> Result<(), String> {
    if plan(staged_version(dir).as_deref(), &update.version) == Step::AlreadyStaged {
        return Ok(());
    }
    let bytes = crate::gate::download_unless_stalled(crate::gate::DOWNLOAD_STALL, |_chunk, _total| {}, |on_chunk| async move {
        update.download(on_chunk, || {}).await.map_err(|e| e.to_string())
    })
    .await?;
    stage(dir, &update.version, &bytes).map_err(|e| e.to_string())
}

/// What to do with the update the feed offers.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Step {
    /// Download it and keep it.
    DownloadAndStage,
    /// That version is kept already.
    AlreadyStaged,
}

/// `staged`: the version kept already, if any.
pub(crate) fn plan(staged: Option<&str>, offered: &str) -> Step {
    match staged {
        Some(v) if v == offered => Step::AlreadyStaged,
        _ => Step::DownloadAndStage,
    }
}

/// The tap while a song plays: fetch the update now, keep it for
/// `update_install` at the end of the song. Never installs. The version.
#[tauri::command]
pub async fn update_download(app: AppHandle) -> Result<String, String> {
    let dir = update_dir(&app).ok_or("no app data folder")?;
    let update = fetch(&app).await?;
    log_line(&app, "INFO", &format!("update {}: downloading (tapped)", update.version));
    if let Err(e) = download_and_keep(&dir, &update).await {
        event(&app, "update.failed", serde_json::json!({ "stage": "download", "version": update.version, "error": e }));
        return Err(e);
    }
    event(&app, "update.ready", serde_json::json!({ "version": update.version }));
    Ok(update.version)
}

/// The tap with nothing playing, or the end of the song it waited for:
/// install (downloading first when nothing is kept). `resume`: the page's
/// note of the song to start once the new version opens. Ends the app; an
/// error comes back only when the update could not even start.
#[tauri::command]
pub async fn update_install(app: AppHandle, resume: Option<String>) -> Result<(), String> {
    if cfg!(target_os = "macos") && std::env::current_exe().is_ok_and(|exe| crate::gate::mac_location_problem(&exe)) {
        return Err("Ember runs from outside Applications: move it there to update".into());
    }
    let dir = update_dir(&app).ok_or("no app data folder")?;
    let update = fetch(&app).await?;
    if let Err(e) = download_and_keep(&dir, &update).await {
        event(&app, "update.failed", serde_json::json!({ "stage": "download", "version": update.version, "error": e }));
        return Err(e);
    }
    let bytes = staged_bytes(&dir).map_err(|e| e.to_string())?;
    let key = pubkey(&app).ok_or("no updater pubkey")?;
    if let Err(e) = verify(&bytes, &update.signature, &key) {
        clear(&dir);
        event(&app, "update.failed", serde_json::json!({ "stage": "verify", "version": update.version, "error": e }));
        return Err(format!("the update failed its signature check: {e}"));
    }
    if let Some(note) = resume.as_deref() {
        let _ = keep_resume(&dir, note);
    }
    event(&app, "update.install", serde_json::json!({ "version": update.version }));
    log_line(&app, "INFO", &format!("update {}: installing (tapped)", update.version));
    let version = update.version.clone();
    // The installers block (pkexec, the Windows installer): off the async
    // workers. On Windows this does not return: the installer quits Ember.
    let installed = tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|e| e.to_string())?;
    if let Err(e) = installed {
        let _ = take_resume(&dir);
        event(&app, "update.failed", serde_json::json!({ "stage": "install", "version": version, "error": e.to_string() }));
        return Err(e.to_string());
    }
    clear(&dir);
    app.restart();
}

/// The page's resume note, once: asked by the new version's page at start.
#[tauri::command]
pub fn update_take_resume(app: AppHandle) -> Option<String> {
    update_dir(&app).and_then(|d| take_resume(&d))
}

#[cfg(test)]
mod tests {
    use super::*;

    // A throwaway key made for these tests with `tauri signer generate`, and
    // its signature over PAYLOAD from `tauri signer sign`.
    const PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEJDNTE0RjI3NzcyNkQ1NkYKUldSdjFTWjNKMDlSdk5kTTRnV0diZVgyYk9HNUxUQVRzbGZkclVNZGlkbzNWVjRRdWY2aWxYUW8K";
    const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSdjFTWjNKMDlSdkoxQUtjc0lFcmFDOGhnZStYNVVlSFAweXRGa1Bidkw5T244VnBmc0EzWEc5ekdoeHhyMDN4czZPY1ppa1BScy9QV3R4dFQ4MEl6Zm56eEFsNm03dGcwPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkwMjA2MzA3CWZpbGU6cGF5bG9hZC5iaW4KdGdBanM0d3VZY2pXWjdnRlNaU1VuaENjbTd0cXJKbEo4UzhpMm5FNG5rVUlrUzV0M0l6SnhaQmZaMXZrbU40ZVo3SjVxRlljM2V0Kzkvakl2dWo2REE9PQo=";
    const PAYLOAD: &[u8] = b"ember test update payload";

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ember-update-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_new_update_is_downloaded_and_kept() {
        assert_eq!(plan(None, "0.5.0"), Step::DownloadAndStage);
    }

    #[test]
    fn an_update_already_kept_is_not_downloaded_again() {
        assert_eq!(plan(Some("0.5.0"), "0.5.0"), Step::AlreadyStaged);
    }

    #[test]
    fn an_older_kept_update_is_replaced_by_the_newer_one() {
        assert_eq!(plan(Some("0.5.0"), "0.5.1"), Step::DownloadAndStage);
    }

    fn body_of(name: &str) -> &'static str {
        let src = include_str!("update.rs");
        let start = src.find(&format!("pub async fn {name}")).or_else(|| src.find(&format!("pub fn {name}"))).unwrap();
        let rest = &src[start..];
        &rest[..rest[1..].find("\n#[").map(|i| i + 1).unwrap_or(rest.len())]
    }

    /// A download the page asked for while a song plays only fetches and
    /// keeps: installing quits the app on Windows, which cut songs off.
    #[test]
    fn the_download_command_never_installs() {
        let body = body_of("update_download");
        assert!(body.contains("download_and_keep"));
        assert!(!body.contains(".install("), "update_download must not install");
        assert!(!body.contains("restart"), "update_download must not restart");
    }

    /// The install checks the signature before handing the bytes over, and
    /// keeps the page's resume note first.
    #[test]
    fn the_install_command_verifies_and_keeps_the_note_first() {
        let body = body_of("update_install");
        let verify_at = body.find("verify(&bytes").unwrap();
        let note_at = body.find("keep_resume").unwrap();
        let install_at = body.find("update.install(bytes)").unwrap();
        assert!(verify_at < install_at && note_at < install_at);
    }

    /// The feed and the download run on clocks: a stalled one held its task
    /// (and its buffer) forever.
    #[test]
    fn the_feed_and_the_download_have_time_limits() {
        let src = include_str!("update.rs");
        assert!(src.contains(".timeout(crate::gate::FEED_TIMEOUT)"));
        assert!(src.contains("download_unless_stalled(crate::gate::DOWNLOAD_STALL"));
    }

    /// Nothing in the app checks or downloads by itself any more.
    #[test]
    fn nothing_runs_in_the_background() {
        let gone = ["check_on", "_startup"].concat();
        assert!(!include_str!("update.rs").contains(&gone));
        assert!(!include_str!("lib.rs").contains(&gone));
    }

    #[test]
    fn the_resume_note_is_kept_and_handed_over_once() {
        let dir = scratch("resume");
        assert_eq!(take_resume(&dir), None);
        keep_resume(&dir, r#"{"index":2,"trackId":"youtube:b","at":1}"#).unwrap();
        assert_eq!(take_resume(&dir).as_deref(), Some(r#"{"index":2,"trackId":"youtube:b","at":1}"#));
        assert_eq!(take_resume(&dir), None);
        keep_resume(&dir, &"x".repeat(3000)).unwrap();
        assert_eq!(take_resume(&dir), None, "an oversized note is not kept");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_kept_update_survives_until_cleared() {
        let dir = scratch("keep");
        assert_eq!(staged_version(&dir), None);
        stage(&dir, "0.5.0", PAYLOAD).expect("stage");
        assert_eq!(staged_version(&dir).as_deref(), Some("0.5.0"));
        assert_eq!(staged_bytes(&dir).expect("bytes"), PAYLOAD);
        clear(&dir);
        assert_eq!(staged_version(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A version file without its download (a crash mid-write) is no update.
    #[test]
    fn a_version_without_its_bytes_is_not_an_update() {
        let dir = scratch("half");
        std::fs::create_dir_all(&dir).expect("dir");
        std::fs::write(dir.join(STAGED_VERSION), "0.5.0").expect("write");
        assert_eq!(staged_version(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_kept_update_must_still_match_its_signature() {
        assert_eq!(verify(PAYLOAD, SIGNATURE, PUBKEY), Ok(()));
        let mut tampered = PAYLOAD.to_vec();
        tampered[0] ^= 1;
        assert!(verify(&tampered, SIGNATURE, PUBKEY).is_err());
        assert!(verify(PAYLOAD, "bm90IGEgc2lnbmF0dXJl", PUBKEY).is_err());
    }
}
