//! Desktop auto-update.
//!
//! The app asks the Ember server whether a newer build exists. The server
//! answers from the GitHub Release (it holds the token; the app never does)
//! and streams the installer back. Every update is signed with the updater
//! key, and Tauri refuses anything that doesn't verify against the pubkey
//! baked into tauri.conf.json — so a compromised server still can't push a
//! malicious build.
//!
//! Failures are deliberately quiet. A user who launched Ember wants music,
//! not a dialog about a failed update check: the server may be down, offline,
//! or mid-restart, and none of that should interrupt playback.
//!
//! Installing is not the same everywhere. On macOS and Linux it swaps the app
//! on disk and the running app carries on. On Windows it starts the installer
//! and quits the app on the spot (`std::process::exit` inside the plugin),
//! and the installer then starts Ember again. Doing that while a song played
//! cut the song off mid-way, so on Windows an update is downloaded and kept,
//! and installed at the start of the next launch, before any music.
//! Installing on quit instead would open Ember again right after the listener
//! closed it.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::applog;
use crate::audio::AudioEngine;

/// What to do with an update the server offers.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Step {
    /// Download and install at once: installing leaves the app running, and
    /// the new version applies on the next launch.
    DownloadAndInstall,
    /// Download and keep it, to install at the next launch.
    DownloadAndStage,
    /// Install the copy an earlier session downloaded. Quits the app.
    InstallStaged,
    /// The copy is here, but music is playing: leave it for the next launch.
    Wait,
}

/// `install_quits`: installing ends this process (Windows). `staged`: the
/// version an earlier session downloaded, if any. `playing`: music is
/// playing or about to.
pub(crate) fn plan(install_quits: bool, staged: Option<&str>, offered: &str, playing: bool) -> Step {
    if !install_quits {
        return Step::DownloadAndInstall;
    }
    match staged {
        Some(v) if v == offered && playing => Step::Wait,
        Some(v) if v == offered => Step::InstallStaged,
        _ => Step::DownloadAndStage,
    }
}

// --- The downloaded copy, kept between launches -----------------------------

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

/// The updater pubkey from tauri.conf.json.
fn pubkey(app: &AppHandle) -> Option<String> {
    app.config()
        .plugins
        .0
        .get("updater")?
        .get("pubkey")?
        .as_str()
        .map(str::to_string)
}

/// Check for an update and download it; install it now where that leaves the
/// app running, or at the next launch on Windows (see the module docs).
///
/// Runs in the background at startup.
pub async fn check_on_startup(app: AppHandle, log_path: Option<PathBuf>) {
    let log = |level: &str, msg: &str| applog::write_line(log_path.as_ref(), level, msg);
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            log("WARN", &format!("updater unavailable: {e}"));
            return;
        }
    };
    let dir = app.path().app_local_data_dir().ok().map(|d| d.join("update"));

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            log("INFO", "no update available");
            // The kept copy, if any, is what is running now.
            if let Some(dir) = &dir {
                clear(dir);
            }
            return;
        }
        Err(e) => {
            // Offline, server down, or a malformed feed. Not worth bothering
            // the user about.
            log("INFO", &format!("update check skipped: {e}"));
            return;
        }
    };
    let version = update.version.clone();
    let install_quits = cfg!(windows);
    if install_quits && dir.is_none() {
        // Nowhere to keep it, and installing now would quit mid-song.
        log("WARN", &format!("update {version} skipped: no app data folder"));
        return;
    }
    let staged = dir.as_deref().and_then(staged_version);
    let playing = app.state::<AudioEngine>().is_playing();
    let mut step = plan(install_quits, staged.as_deref(), &version, playing);

    if let (Step::InstallStaged, Some(dir)) = (&step, dir.as_deref()) {
        let checked = staged_bytes(dir).map_err(|e| e.to_string()).and_then(|bytes| {
            let key = pubkey(&app).ok_or("no updater pubkey")?;
            verify(&bytes, &update.signature, &key).map(|()| bytes)
        });
        match checked {
            Ok(bytes) => {
                log("INFO", &format!("installing update {version} downloaded earlier"));
                clear(dir);
                // On Windows this does not return: the installer takes over
                // and starts the new version.
                if let Err(e) = update.install(bytes) {
                    log("WARN", &format!("update {version} failed to install: {e}"));
                }
                return;
            }
            Err(e) => {
                log("WARN", &format!("kept update {version} unusable ({e}), downloading again"));
                clear(dir);
                step = Step::DownloadAndStage;
            }
        }
    }
    if step == Step::Wait {
        log("INFO", &format!("update {version} ready, music playing: installs next launch"));
        return;
    }

    log("INFO", &format!("update available: {version} — downloading"));
    // No progress UI yet: this runs while the user is listening, and a
    // desktop shell update is a few MB.
    let bytes = match update.download(|_chunk, _total| {}, || {}).await {
        Ok(b) => b,
        Err(e) => {
            log("WARN", &format!("update {version} failed to download: {e}"));
            return;
        }
    };
    if let (Step::DownloadAndStage, Some(dir)) = (&step, dir.as_deref()) {
        match stage(dir, &version, &bytes) {
            Ok(()) => log("INFO", &format!("update {version} downloaded, installs next launch")),
            Err(e) => log("WARN", &format!("update {version} could not be kept: {e}")),
        }
        return;
    }
    match update.install(bytes) {
        Ok(()) => log("INFO", &format!("update {version} installed — applies on next launch")),
        Err(e) => log("WARN", &format!("update {version} failed to install: {e}")),
    }
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

    /// The bug: on Windows the update installed (and quit the app) as soon as
    /// it downloaded, whatever was playing. Now it is only downloaded.
    #[test]
    fn on_windows_a_new_update_is_downloaded_not_installed() {
        assert_eq!(plan(true, None, "0.5.0", true), Step::DownloadAndStage);
        assert_eq!(plan(true, None, "0.5.0", false), Step::DownloadAndStage);
    }

    #[test]
    fn on_windows_the_kept_update_installs_at_the_next_launch() {
        assert_eq!(plan(true, Some("0.5.0"), "0.5.0", false), Step::InstallStaged);
    }

    #[test]
    fn on_windows_the_kept_update_waits_while_music_plays() {
        assert_eq!(plan(true, Some("0.5.0"), "0.5.0", true), Step::Wait);
    }

    #[test]
    fn an_older_kept_update_is_replaced_by_the_newer_one() {
        assert_eq!(plan(true, Some("0.5.0"), "0.5.1", false), Step::DownloadAndStage);
    }

    /// macOS and Linux keep what they did: install at once, which leaves the
    /// app running.
    #[test]
    fn elsewhere_the_update_installs_at_once() {
        assert_eq!(plan(false, None, "0.5.0", true), Step::DownloadAndInstall);
        assert_eq!(plan(false, Some("0.5.0"), "0.5.0", true), Step::DownloadAndInstall);
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
