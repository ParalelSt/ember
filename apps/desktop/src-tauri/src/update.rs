//! Desktop auto-update.
//!
//! The app asks the Ember server whether a newer build exists. The server
//! answers from the GitHub Release (it holds the token; the app never does)
//! and streams the installer back. Every update is signed with the updater
//! key, and Tauri refuses anything that doesn't verify against the pubkey
//! baked into tauri.conf.json, so a compromised server still can't push a
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
//! cut the song off mid-way.
//!
//! So this background check only ever downloads and keeps the update, on
//! every OS (owner decision D6). Installing happens in one place: the launch
//! dialog (src/gate.rs), at the start of a launch, before any music, with a
//! countdown and "Not now".

use std::path::{Path, PathBuf};

use base64::Engine as _;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::applog;

/// What to do with an update the server offers.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Step {
    /// Download it and keep it for the launch dialog.
    DownloadAndStage,
    /// That version is already downloaded: nothing to do until a launch.
    AlreadyStaged,
}

/// `staged`: the version an earlier session downloaded, if any.
pub(crate) fn plan(staged: Option<&str>, offered: &str) -> Step {
    match staged {
        Some(v) if v == offered => Step::AlreadyStaged,
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

/// Check for an update and download it, to be installed by the launch
/// dialog at the next launch (see the module docs).
///
/// Runs in the background after the launch gate, when the gate itself did not
/// already start a download.
pub async fn check_on_startup(app: AppHandle, log_path: Option<PathBuf>) {
    let log = |level: &str, msg: &str| applog::write_line(log_path.as_ref(), level, msg);
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            log("WARN", &format!("updater unavailable: {e}"));
            return;
        }
    };
    let Some(dir) = update_dir(&app) else {
        // Nowhere to keep it, and installing now could quit mid-song.
        log("WARN", "update check skipped: no app data folder");
        return;
    };

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            log("INFO", "no update available");
            // The kept copy, if any, is what is running now.
            clear(&dir);
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
    if plan(staged_version(&dir).as_deref(), &version) == Step::AlreadyStaged {
        log("INFO", &format!("update {version} already downloaded, the launch dialog installs it"));
        return;
    }

    log("INFO", &format!("update available: {version}, downloading"));
    // No progress UI: this runs while the user is listening, and a desktop
    // shell update is a few MB.
    let bytes = match update.download(|_chunk, _total| {}, || {}).await {
        Ok(b) => b,
        Err(e) => {
            log("WARN", &format!("update {version} failed to download: {e}"));
            return;
        }
    };
    match stage(&dir, &version, &bytes) {
        Ok(()) => log("INFO", &format!("update {version} downloaded, the launch dialog installs it")),
        Err(e) => log("WARN", &format!("update {version} could not be kept: {e}")),
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
    /// it downloaded, whatever was playing. Now the background check only
    /// downloads, on every OS (D6); the launch dialog installs.
    #[test]
    fn a_new_update_is_downloaded_and_kept_not_installed() {
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

    /// Nothing in the background path may install: installing quits the app
    /// on Windows and swaps it under a running copy elsewhere.
    #[test]
    fn the_background_path_never_installs() {
        let src = include_str!("update.rs");
        let body = &src[src.find("pub async fn check_on_startup").unwrap()..src.find("#[cfg(test)]").unwrap()];
        assert!(!body.contains(".install("), "check_on_startup must only download and stage");
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
