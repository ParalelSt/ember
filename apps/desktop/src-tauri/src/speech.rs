// Native voice search: `speech_*` commands and `speech:*` events.
//
// The webview's own Web Speech API is useless inside the shells (WebView2
// exposes the constructor but every session fails with `network`; WKWebView
// has none), so the search mic talks to the OS recognizer through here:
// SFSpeechRecognizer on macOS, Windows.Media.SpeechRecognition on Windows,
// and an honest "unavailable" everywhere else.
//
// Contract (shared with apps/web/lib/speech/tauriSpeech.ts, do not rename):
//   commands  speech_available() -> { available, onDevice }
//             speech_start(lang?) -> Result<(), { kind, detail }>
//             speech_stop(), speech_abort()
//   events    speech:partial { text }   full text so far
//             speech:final   { text }   at most once per start
//             speech:error   { kind, detail }
//             speech:end     {}         exactly once per start
//
// Everything here is pure or plain Rust; the ObjC / WinRT code lives in the
// platform modules and only talks to the web through `Session`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

// The pure parts of each platform module (error mapping, silence watchdog)
// are compiled into every test build, so `cargo test` on one OS covers the
// other's tables too. The FFI halves stay behind their own target cfg.
#[cfg(any(target_os = "macos", test))]
mod macos;
#[cfg(not(target_os = "macos"))]
mod unsupported;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpeechErrorKind {
    PermissionDenied,
    Unavailable,
    Network,
    // Windows only: the "Online speech recognition" privacy toggle is off.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    SpeechSettingOff,
    NoSpeech,
    Aborted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SpeechError {
    pub kind: SpeechErrorKind,
    pub detail: Option<String>,
}

impl SpeechError {
    pub fn new(kind: SpeechErrorKind, detail: impl Into<String>) -> Self {
        SpeechError { kind, detail: Some(detail.into()) }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Availability {
    pub available: bool,
    #[serde(rename = "onDevice")]
    pub on_device: bool,
}

const TAG_MAX_PARTS: usize = 8;

/// `^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$`, the same check the JS and Kotlin
/// sides use, without pulling in a regex crate for one pattern.
fn is_bcp47(tag: &str) -> bool {
    let mut parts = tag.split('-');
    let Some(lang) = parts.next() else { return false };
    if !(2..=3).contains(&lang.len()) || !lang.chars().all(|c| c.is_ascii_alphabetic()) {
        return false;
    }
    let mut count = 1;
    for p in parts {
        count += 1;
        if count > TAG_MAX_PARTS
            || !(2..=8).contains(&p.len())
            || !p.chars().all(|c| c.is_ascii_alphanumeric())
        {
            return false;
        }
    }
    true
}

/// macOS hands out `en_US` or `en_US@rg=gbzzzz`; the recognizers want `en-US`.
fn normalize_tag(raw: &str) -> String {
    let base = raw.split('@').next().unwrap_or("");
    base.trim().replace('_', "-")
}

/// BCP-47 pick: os locale first, then the page's hint, then en-US. Normalises `_` to `-`.
pub fn pick_locale(os: Option<&str>, requested: Option<&str>) -> String {
    [os, requested]
        .into_iter()
        .flatten()
        .map(normalize_tag)
        .find(|t| is_bcp47(t))
        .unwrap_or_else(|| "en-US".to_string())
}

/// Platform backends implement this; commands only talk to it.
pub trait SpeechBackend: Send + Sync + 'static {
    fn available(&self) -> Availability;
    fn start(&self, lang: String, app: AppHandle) -> Result<(), SpeechError>;
    fn stop(&self);
    fn abort(&self);
}

pub struct SpeechState(pub Box<dyn SpeechBackend>);

#[derive(Clone, Serialize)]
struct TextPayload<'a> {
    text: &'a str,
}

#[derive(Clone, Serialize)]
struct EmptyPayload {}

pub fn emit_partial(app: &AppHandle, text: &str) {
    use tauri::Emitter;
    let _ = app.emit("speech:partial", TextPayload { text });
}

pub fn emit_final(app: &AppHandle, text: &str) {
    use tauri::Emitter;
    let _ = app.emit("speech:final", TextPayload { text });
}

pub fn emit_error(app: &AppHandle, err: &SpeechError) {
    use tauri::Emitter;
    let _ = app.emit("speech:error", err);
}

pub fn emit_end(app: &AppHandle) {
    use tauri::Emitter;
    let _ = app.emit("speech:end", EmptyPayload {});
}

/// Tracks "end exactly once" for a session; backends hold one per start.
#[derive(Default)]
pub struct EndOnce(AtomicBool);

impl EndOnce {
    /// True for the one caller that ends the session.
    pub fn fire(&self) -> bool {
        !self.0.swap(true, Ordering::SeqCst)
    }

    pub fn fired(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// One listening session as seen from the web: every event a backend sends
/// goes through here so nothing arrives after `end` and `end` is sent once,
/// whichever of the recognizer callback, the watchdog or an abort gets there
/// first.
pub struct Session {
    app: AppHandle,
    end: EndOnce,
    last_text: Mutex<String>,
}

impl Session {
    pub fn new(app: AppHandle) -> Self {
        Session { app, end: EndOnce::default(), last_text: Mutex::new(String::new()) }
    }

    pub fn ended(&self) -> bool {
        self.end.fired()
    }

    pub fn partial(&self, text: &str) {
        if self.end.fired() || text.trim().is_empty() {
            return;
        }
        if let Ok(mut last) = self.last_text.lock() {
            last.clear();
            last.push_str(text);
        }
        emit_partial(&self.app, text);
    }

    /// The last partial, for recognizers that report "no match" or a cancel
    /// after perfectly good partials.
    pub fn last_text(&self) -> String {
        self.last_text.lock().map(|t| t.clone()).unwrap_or_default()
    }

    pub fn finish(&self, text: &str) {
        if self.end.fire() {
            if !text.trim().is_empty() {
                emit_final(&self.app, text);
            }
            emit_end(&self.app);
        }
    }

    /// Ends with the error unless it is our own cancel, which stays quiet.
    pub fn fail(&self, err: &SpeechError) {
        if self.end.fire() {
            if err.kind != SpeechErrorKind::Aborted {
                emit_error(&self.app, err);
            }
            emit_end(&self.app);
        }
    }

    /// Ends with the last partial as the result when there is one: used for
    /// a stop, a silence cut-off and "no match after partials".
    pub fn finish_with_last_or(&self, err: SpeechError) {
        let last = self.last_text();
        if last.trim().is_empty() {
            self.fail(&err);
        } else {
            self.finish(&last);
        }
    }

    pub fn end(&self) {
        if self.end.fire() {
            emit_end(&self.app);
        }
    }

    /// Marks the session over without telling the web (it already got the
    /// failure as the `speech_start` rejection, or a newer start replaced it).
    pub fn close_silently(&self) {
        self.end.fire();
    }
}

enum GateState {
    Waiting,
    Done(Result<(), SpeechError>),
    Taken,
    Abandoned,
}

/// Hands the outcome of a start from the backend's worker thread back to the
/// `speech_start` command. The JS side races the invoke against 2 s, so the
/// command never waits longer than `START_WAIT`; once it has given up (or once
/// the worker said Ok and then went on to show a permission prompt), later
/// failures travel as `speech:error` + `speech:end` instead. The gate makes
/// sure every failure is reported exactly one of those two ways.
pub struct StartGate {
    state: Mutex<GateState>,
    cv: Condvar,
}

pub const START_WAIT: Duration = Duration::from_millis(1500);

impl Default for StartGate {
    fn default() -> Self {
        StartGate { state: Mutex::new(GateState::Waiting), cv: Condvar::new() }
    }
}

impl StartGate {
    /// True when the command will return this result to the web.
    pub fn resolve(&self, result: Result<(), SpeechError>) -> bool {
        let Ok(mut st) = self.state.lock() else { return false };
        if matches!(*st, GateState::Waiting) {
            *st = GateState::Done(result);
            self.cv.notify_all();
            true
        } else {
            false
        }
    }

    /// Reports a start failure through the command if it is still waiting,
    /// otherwise through the session's events.
    pub fn fail(&self, session: &Session, err: SpeechError) {
        if self.resolve(Err(err.clone())) {
            session.close_silently();
        } else {
            session.fail(&err);
        }
    }

    /// Waits for the worker; on timeout reports Ok, because the worker will
    /// still send its outcome as events.
    pub fn wait(&self, timeout: Duration) -> Result<(), SpeechError> {
        let Ok(guard) = self.state.lock() else {
            return Err(SpeechError::new(SpeechErrorKind::Unavailable, "speech gate poisoned"));
        };
        let Ok((mut st, _)) =
            self.cv.wait_timeout_while(guard, timeout, |s| matches!(s, GateState::Waiting))
        else {
            return Err(SpeechError::new(SpeechErrorKind::Unavailable, "speech gate poisoned"));
        };
        match std::mem::replace(&mut *st, GateState::Taken) {
            GateState::Done(r) => r,
            GateState::Waiting => {
                *st = GateState::Abandoned;
                Ok(())
            }
            other => {
                *st = other;
                Ok(())
            }
        }
    }
}

/// Speech lines in the app log, so a bug report says what the recognizer did.
pub fn log(path: Option<&PathBuf>, level: &str, msg: &str) {
    crate::applog::write_line(path, level, &format!("speech: {msg}"));
}

#[tauri::command(async)]
pub fn speech_available(app: AppHandle) -> Availability {
    match app.try_state::<SpeechState>() {
        Some(state) => state.0.available(),
        None => Availability::default(),
    }
}

// `async` keeps these off the main thread: a start waits on the worker, and
// the macOS result handlers are delivered on the main queue.
#[tauri::command(async)]
pub fn speech_start(
    app: AppHandle,
    state: State<'_, SpeechState>,
    lang: Option<String>,
) -> Result<(), SpeechError> {
    state.0.start(lang.unwrap_or_default(), app)
}

#[tauri::command]
pub fn speech_stop(state: State<'_, SpeechState>) {
    state.0.stop();
}

#[tauri::command]
pub fn speech_abort(state: State<'_, SpeechState>) {
    state.0.abort();
}

pub fn new_backend(log: Option<&Path>) -> SpeechState {
    let log = log.map(Path::to_path_buf);
    #[cfg(target_os = "macos")]
    {
        SpeechState(Box::new(macos::MacSpeech::new(log)))
    }
    #[cfg(target_os = "windows")]
    {
        // Filled in by the Windows backend.
        let _ = log;
        SpeechState(Box::new(unsupported::Unsupported))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = log;
        SpeechState(Box::new(unsupported::Unsupported))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_locale_prefers_os_then_hint_then_default() {
        assert_eq!(pick_locale(Some("en_GB"), Some("de-DE")), "en-GB");
        assert_eq!(pick_locale(Some("en_US@rg=gbzzzz"), None), "en-US");
        assert_eq!(pick_locale(Some("not a locale"), Some("de-DE")), "de-DE");
        assert_eq!(pick_locale(Some(""), Some("fr_CA")), "fr-CA");
        assert_eq!(pick_locale(None, Some("x")), "en-US");
        assert_eq!(pick_locale(None, None), "en-US");
        assert_eq!(pick_locale(Some("zh-Hant-TW"), None), "zh-Hant-TW");
        assert_eq!(pick_locale(Some("english"), Some("e")), "en-US");
    }

    #[test]
    fn error_kinds_serialize_to_the_js_strings() {
        let rows = [
            (SpeechErrorKind::PermissionDenied, "\"permission-denied\""),
            (SpeechErrorKind::Unavailable, "\"unavailable\""),
            (SpeechErrorKind::Network, "\"network\""),
            (SpeechErrorKind::SpeechSettingOff, "\"speech-setting-off\""),
            (SpeechErrorKind::NoSpeech, "\"no-speech\""),
            (SpeechErrorKind::Aborted, "\"aborted\""),
        ];
        for (kind, json) in rows {
            assert_eq!(serde_json::to_string(&kind).unwrap(), json);
        }
    }

    #[test]
    fn speech_error_and_availability_json_shapes() {
        let e = SpeechError { kind: SpeechErrorKind::Network, detail: None };
        assert_eq!(serde_json::to_string(&e).unwrap(), r#"{"kind":"network","detail":null}"#);
        let e = SpeechError::new(SpeechErrorKind::Unavailable, "x");
        assert_eq!(serde_json::to_string(&e).unwrap(), r#"{"kind":"unavailable","detail":"x"}"#);
        let a = Availability { available: true, on_device: false };
        assert_eq!(serde_json::to_string(&a).unwrap(), r#"{"available":true,"onDevice":false}"#);
    }

    #[test]
    fn end_once_fires_once() {
        let e = EndOnce::default();
        assert!(!e.fired());
        assert!(e.fire());
        assert!(!e.fire());
        assert!(e.fired());
    }

    #[test]
    fn gate_returns_the_worker_result_when_in_time() {
        let g = std::sync::Arc::new(StartGate::default());
        let g2 = g.clone();
        let t = std::thread::spawn(move || {
            g2.resolve(Err(SpeechError::new(SpeechErrorKind::PermissionDenied, "denied")))
        });
        let r = g.wait(Duration::from_secs(5));
        assert!(t.join().unwrap());
        assert_eq!(r.unwrap_err().kind, SpeechErrorKind::PermissionDenied);
        // Already taken: a late second answer is not delivered twice.
        assert!(!g.resolve(Ok(())));
    }

    #[test]
    fn gate_times_out_as_ok_and_refuses_late_results() {
        let g = StartGate::default();
        assert_eq!(g.wait(Duration::from_millis(10)), Ok(()));
        assert!(!g.resolve(Err(SpeechError::new(SpeechErrorKind::Unavailable, "late"))));
    }

    #[test]
    fn gate_ok_then_later_failure_is_not_delivered_through_it() {
        let g = StartGate::default();
        assert!(g.resolve(Ok(())));
        assert!(!g.resolve(Err(SpeechError::new(SpeechErrorKind::Unavailable, "x"))));
        assert_eq!(g.wait(Duration::from_millis(10)), Ok(()));
    }
}
