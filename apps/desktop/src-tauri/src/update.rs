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

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::applog;
use std::path::PathBuf;

/// Check for an update, download and install it if one exists.
///
/// Runs in the background at startup. On success the new version applies on
/// the NEXT launch (Tauri stages the installer), so nothing is interrupted
/// mid-session.
pub async fn check_on_startup(app: AppHandle, log_path: Option<PathBuf>) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            applog::write_line(
                log_path.as_ref(),
                "WARN",
                &format!("updater unavailable: {e}"),
            );
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            applog::write_line(
                log_path.as_ref(),
                "INFO",
                &format!("update available: {version} — downloading"),
            );
            // No progress UI yet: this runs while the user is listening, and a
            // desktop shell update is a few MB.
            match update.download_and_install(|_chunk, _total| {}, || {}).await {
                Ok(()) => applog::write_line(
                    log_path.as_ref(),
                    "INFO",
                    &format!("update {version} installed — applies on next launch"),
                ),
                Err(e) => applog::write_line(
                    log_path.as_ref(),
                    "WARN",
                    &format!("update {version} failed to install: {e}"),
                ),
            }
        }
        Ok(None) => {
            applog::write_line(log_path.as_ref(), "INFO", "no update available");
        }
        Err(e) => {
            // Offline, server down, or a malformed feed. Not worth bothering
            // the user about.
            applog::write_line(
                log_path.as_ref(),
                "INFO",
                &format!("update check skipped: {e}"),
            );
        }
    }
}
