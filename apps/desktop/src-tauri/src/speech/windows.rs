// Windows voice search: Windows.Media.SpeechRecognition, dictation grammar,
// continuous session.
//
// WinRT objects are agile, but the shape mirrors macOS for symmetry: one
// worker thread owns the recognizer and is driven by `Cmd`s; the event
// handlers only touch the shared `Session`. The dictation grammar is a cloud
// grammar, so it needs the "Online speech recognition" privacy setting, which
// shows up as a dedicated HRESULT mapped below.
//
// The pure parts (HRESULT and completion mapping) sit outside `imp` so the
// unit tests run on every platform.

use super::SpeechErrorKind;

/// SPERR_SPEECH_PRIVACY_POLICY_NOT_ACCEPTED: Settings, Privacy & security,
/// Speech, "Online speech recognition" is off.
const SPERR_PRIVACY_POLICY_NOT_ACCEPTED: i32 = 0x8004_5509_u32 as i32;
/// E_ACCESSDENIED: "Let desktop apps access your microphone" is off.
const E_ACCESSDENIED: i32 = 0x8007_0005_u32 as i32;

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(super) fn map_hresult(hr: i32) -> SpeechErrorKind {
    match hr {
        SPERR_PRIVACY_POLICY_NOT_ACCEPTED => SpeechErrorKind::SpeechSettingOff,
        E_ACCESSDENIED => SpeechErrorKind::PermissionDenied,
        _ => SpeechErrorKind::Unavailable,
    }
}

/// Plain copy of `SpeechRecognitionResultStatus`, so the mapping is testable
/// without WinRT.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(super) enum Completion {
    Success,
    TopicLanguageNotSupported,
    GrammarLanguageMismatch,
    GrammarCompilationFailure,
    AudioQualityFailure,
    UserCanceled,
    Unknown,
    TimeoutExceeded,
    PauseLimitExceeded,
    NetworkFailure,
    MicrophoneUnavailable,
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
impl Completion {
    pub(super) fn from_raw(v: i32) -> Self {
        match v {
            0 => Completion::Success,
            1 => Completion::TopicLanguageNotSupported,
            2 => Completion::GrammarLanguageMismatch,
            3 => Completion::GrammarCompilationFailure,
            4 => Completion::AudioQualityFailure,
            5 => Completion::UserCanceled,
            7 => Completion::TimeoutExceeded,
            8 => Completion::PauseLimitExceeded,
            9 => Completion::NetworkFailure,
            10 => Completion::MicrophoneUnavailable,
            _ => Completion::Unknown,
        }
    }
}

/// How a finished session ends for the web. `None` is a plain end (after
/// the final result, or with the last hypothesis promoted to one).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(super) fn map_completion(status: Completion, had_text: bool) -> Option<SpeechErrorKind> {
    match status {
        Completion::Success => None,
        Completion::TimeoutExceeded if had_text => None,
        Completion::TimeoutExceeded => Some(SpeechErrorKind::NoSpeech),
        Completion::NetworkFailure => Some(SpeechErrorKind::Network),
        Completion::MicrophoneUnavailable => Some(SpeechErrorKind::PermissionDenied),
        Completion::UserCanceled => Some(SpeechErrorKind::Aborted),
        Completion::Unknown
        | Completion::PauseLimitExceeded
        | Completion::AudioQualityFailure
        | Completion::TopicLanguageNotSupported
        | Completion::GrammarLanguageMismatch
        | Completion::GrammarCompilationFailure => Some(SpeechErrorKind::Unavailable),
    }
}

#[cfg(target_os = "windows")]
pub use imp::WinSpeech;

#[cfg(target_os = "windows")]
mod imp {
    use std::collections::VecDeque;
    use std::path::PathBuf;
    use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use tauri::AppHandle;
    use ::windows::core::HSTRING;
    use ::windows::Foundation::TypedEventHandler;
    use ::windows::Globalization::Language;
    use ::windows::Media::SpeechRecognition::{
        SpeechContinuousRecognitionCompletedEventArgs,
        SpeechContinuousRecognitionResultGeneratedEventArgs, SpeechContinuousRecognitionSession,
        SpeechRecognitionConfidence, SpeechRecognitionHypothesisGeneratedEventArgs,
        SpeechRecognitionResultStatus, SpeechRecognizer,
    };

    use super::super::{
        log as write_log, pick_locale, Availability, Session, SpeechBackend, SpeechError, SpeechErrorKind,
        AvailabilityCache, StartGate, AVAILABLE_WAIT, PROBE_WAIT, START_WAIT,
    };
    use super::{map_completion, map_hresult, Completion};

    const TICK: Duration = Duration::from_millis(250);
    const INITIAL_SILENCE: Duration = Duration::from_secs(8);
    const END_SILENCE: Duration = Duration::from_millis(2500);
    /// After StopAsync the session normally completes within a second; if it
    /// goes quiet the last hypothesis is used instead of waiting for the
    /// web's 15 s cap.
    const STOP_GRACE: Duration = Duration::from_secs(3);

    impl From<::windows::core::Error> for SpeechError {
        fn from(e: ::windows::core::Error) -> Self {
            let hr = e.code().0;
            let msg = e.message();
            let detail = if msg.is_empty() {
                format!("hresult {hr:#x}")
            } else {
                format!("hresult {hr:#x}: {msg}")
            };
            SpeechError { kind: map_hresult(hr), detail: Some(detail) }
        }
    }

    enum Cmd {
        Start { lang: String, app: AppHandle, gate: Arc<StartGate> },
        Stop,
        Abort,
        Available { reply: Sender<Availability> },
    }

    pub struct WinSpeech {
        tx: Mutex<Option<Sender<Cmd>>>,
        log: Option<PathBuf>,
        cache: AvailabilityCache,
    }

    impl WinSpeech {
        pub fn new(log: Option<PathBuf>) -> Self {
            WinSpeech { tx: Mutex::new(None), log, cache: AvailabilityCache::default() }
        }

        /// Sends to the worker, spawning it on first use (and again if its
        /// channel ever broke).
        fn send(&self, cmd: Cmd) -> bool {
            let Ok(mut guard) = self.tx.lock() else { return false };
            let cmd = match guard.as_ref() {
                Some(tx) => match tx.send(cmd) {
                    Ok(()) => return true,
                    Err(mpsc::SendError(cmd)) => cmd,
                },
                None => cmd,
            };
            let (tx, rx) = mpsc::channel();
            let log = self.log.clone();
            let cache = self.cache.clone();
            let spawned = std::thread::Builder::new()
                .name("ember-speech".into())
                .spawn(move || worker(rx, log, cache));
            if spawned.is_err() {
                write_log(self.log.as_ref(), "WARN", "could not start the speech thread");
                *guard = None;
                return false;
            }
            let ok = tx.send(cmd).is_ok();
            *guard = Some(tx);
            ok
        }
    }

    impl WinSpeech {
        /// Asks the worker, falling back to its last answer when it is busy.
        fn ask(&self, wait: Duration) -> Availability {
            let (reply, rx) = mpsc::channel();
            if !self.send(Cmd::Available { reply }) {
                return Availability::default();
            }
            rx.recv_timeout(wait)
                .ok()
                .or_else(|| self.cache.get())
                .unwrap_or_default()
        }
    }

    impl SpeechBackend for WinSpeech {
        fn available(&self) -> Availability {
            self.ask(AVAILABLE_WAIT)
        }

        fn probe(&self) -> Availability {
            self.ask(PROBE_WAIT)
        }

        fn start(&self, lang: String, app: AppHandle) -> Result<(), SpeechError> {
            let gate = Arc::new(StartGate::default());
            if !self.send(Cmd::Start { lang, app, gate: gate.clone() }) {
                return Err(SpeechError::new(
                    SpeechErrorKind::Unavailable,
                    "speech thread not running",
                ));
            }
            gate.wait(START_WAIT)
        }

        fn stop(&self) {
            self.send(Cmd::Stop);
        }

        fn abort(&self) {
            self.send(Cmd::Abort);
        }
    }

    struct Active {
        session: Arc<Session>,
        recognizer: SpeechRecognizer,
        continuous: SpeechContinuousRecognitionSession,
        hypothesis_token: i64,
        result_token: i64,
        completed_token: i64,
        stop_requested: Option<Instant>,
    }

    impl Active {
        fn request_stop(&mut self) {
            if self.stop_requested.is_some() {
                return;
            }
            self.stop_requested = Some(Instant::now());
            // Not joined: the session delivers the pending result and then
            // Completed on its own; the grace timer covers a silent failure.
            let _ = self.continuous.StopAsync();
        }

        fn teardown(self, cancel: bool) {
            let _ = self.recognizer.RemoveHypothesisGenerated(self.hypothesis_token);
            let _ = self.continuous.RemoveResultGenerated(self.result_token);
            let _ = self.continuous.RemoveCompleted(self.completed_token);
            if cancel {
                // Fails when the session already stopped; nothing to do then.
                let _ = self.continuous.CancelAsync().and_then(|a| a.join());
            }
            let _ = self.recognizer.Close();
        }
    }

    fn worker(rx: Receiver<Cmd>, log: Option<PathBuf>, cache: AvailabilityCache) {
        let mut active: Option<Active> = None;
        let mut queue: VecDeque<Cmd> = VecDeque::new();
        loop {
            let cmd = match queue.pop_front() {
                Some(c) => Some(c),
                None => match rx.recv_timeout(TICK) {
                    Ok(c) => Some(c),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => {
                        if let Some(a) = active.take() {
                            a.session.end();
                            a.teardown(true);
                        }
                        return;
                    }
                },
            };
            match cmd {
                Some(Cmd::Start { lang, app, gate }) => {
                    // A start while listening replaces the old session
                    // silently: a late `end` would close the new one in the
                    // web, since events carry no session id.
                    if let Some(a) = active.take() {
                        a.session.close_silently();
                        a.teardown(true);
                    }
                    let session = Arc::new(Session::new(app));
                    active = match start(&lang, &session, &log) {
                        Ok(a) => {
                            gate.resolve(Ok(()));
                            Some(a)
                        }
                        Err(e) => {
                            write_log(log.as_ref(),
                                "WARN",
                                &format!(
                                    "start failed: {:?} {}",
                                    e.kind,
                                    e.detail.as_deref().unwrap_or("")
                                ),
                            );
                            gate.fail(&session, e);
                            None
                        }
                    };
                }
                Some(Cmd::Stop) => {
                    if let Some(a) = active.as_mut() {
                        a.request_stop();
                    }
                }
                Some(Cmd::Abort) => {
                    if let Some(a) = active.take() {
                        a.session.end();
                        a.teardown(true);
                    }
                }
                Some(Cmd::Available { reply }) => {
                    let a = cache.get().unwrap_or_else(|| {
                        let a = availability(&log);
                        cache.set(a);
                        a
                    });
                    let _ = reply.send(a);
                }
                None => {}
            }
            housekeeping(&mut active, &log);
        }
    }

    fn housekeeping(active: &mut Option<Active>, log: &Option<PathBuf>) {
        let Some(a) = active.as_ref() else { return };
        if a.session.ended() {
            // A final result ends the web session but a continuous session
            // keeps the mic open until cancelled.
            if let Some(a) = active.take() {
                a.teardown(true);
            }
            return;
        }
        if let Some(t) = a.stop_requested {
            if t.elapsed() >= STOP_GRACE {
                write_log(log.as_ref(), "WARN", "no completion after stop; using the last hypothesis");
                a.session.finish_with_last_or(SpeechError::new(
                    SpeechErrorKind::NoSpeech,
                    "no result after stop",
                ));
                if let Some(a) = active.take() {
                    a.teardown(true);
                }
            }
        }
    }

    fn system_tag() -> Option<String> {
        SpeechRecognizer::SystemSpeechLanguage()
            .and_then(|l| l.LanguageTag())
            .map(|t| t.to_string_lossy())
            .ok()
    }

    /// A recognizer for `tag` when Windows has a dictation (topic) language
    /// for it, else the system speech language.
    fn make_recognizer(tag: &str, log: &Option<PathBuf>) -> ::windows::core::Result<SpeechRecognizer> {
        let supported = SpeechRecognizer::SupportedTopicLanguages()
            .map(|langs| {
                langs.into_iter().any(|l| {
                    l.LanguageTag()
                        .map(|t| t.to_string_lossy().eq_ignore_ascii_case(tag))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);
        if supported {
            let language = Language::CreateLanguage(&HSTRING::from(tag))?;
            write_log(log.as_ref(), "INFO", &format!("recognizer language {tag}"));
            SpeechRecognizer::Create(&language)
        } else {
            write_log(log.as_ref(),
                "INFO",
                &format!("no dictation language for {tag}; using the system speech language"),
            );
            SpeechRecognizer::new()
        }
    }

    fn compile(recognizer: &SpeechRecognizer) -> Result<(), SpeechError> {
        let result = recognizer.CompileConstraintsAsync()?.join()?;
        let status = result.Status()?;
        if status == SpeechRecognitionResultStatus::Success {
            Ok(())
        } else {
            Err(SpeechError::new(
                SpeechErrorKind::Unavailable,
                format!("grammar compile: {:?}", Completion::from_raw(status.0)),
            ))
        }
    }

    /// Tried once and cached. Dictation is a cloud grammar, so `onDevice` is
    /// always false on Windows.
    fn availability(log: &Option<PathBuf>) -> Availability {
        let outcome = SpeechRecognizer::new()
            .map_err(SpeechError::from)
            .and_then(|r| {
                let out = compile(&r);
                let _ = r.Close();
                out
            });
        match outcome {
            Ok(()) => Availability { available: true, on_device: false },
            Err(e) => {
                write_log(log.as_ref(),
                    "INFO",
                    &format!("not available: {:?} {}", e.kind, e.detail.as_deref().unwrap_or("")),
                );
                Availability::default()
            }
        }
    }

    fn start(requested: &str, session: &Arc<Session>, log: &Option<PathBuf>) -> Result<Active, SpeechError> {
        let hint = if requested.is_empty() { None } else { Some(requested) };
        let tag = pick_locale(system_tag().as_deref(), hint);
        let recognizer = make_recognizer(&tag, log)?;

        let prepared = (|| -> Result<SpeechContinuousRecognitionSession, SpeechError> {
            let timeouts = recognizer.Timeouts()?;
            timeouts.SetInitialSilenceTimeout(INITIAL_SILENCE.into())?;
            timeouts.SetEndSilenceTimeout(END_SILENCE.into())?;
            let continuous = recognizer.ContinuousRecognitionSession()?;
            continuous.SetAutoStopSilenceTimeout(END_SILENCE.into())?;
            compile(&recognizer)?;
            Ok(continuous)
        })();
        let continuous = match prepared {
            Ok(c) => c,
            Err(e) => {
                let _ = recognizer.Close();
                return Err(e);
            }
        };

        let s = session.clone();
        let hypothesis_token = recognizer.HypothesisGenerated(&TypedEventHandler::<
            SpeechRecognizer,
            SpeechRecognitionHypothesisGeneratedEventArgs,
        >::new(move |_, args| {
            if let Some(args) = args.as_ref() {
                if let Ok(text) = args.Hypothesis().and_then(|h| h.Text()) {
                    s.partial(&text.to_string_lossy());
                }
            }
            Ok(())
        }));
        let s = session.clone();
        let result_token = continuous.ResultGenerated(&TypedEventHandler::<
            SpeechContinuousRecognitionSession,
            SpeechContinuousRecognitionResultGeneratedEventArgs,
        >::new(move |_, args| {
            let Some(args) = args.as_ref() else { return Ok(()) };
            let Ok(result) = args.Result() else { return Ok(()) };
            let rejected = result
                .Confidence()
                .map(|c| c == SpeechRecognitionConfidence::Rejected)
                .unwrap_or(true);
            let text = result.Text().map(|t| t.to_string_lossy()).unwrap_or_default();
            if rejected || text.trim().is_empty() {
                s.fail(&SpeechError::new(SpeechErrorKind::NoSpeech, "result rejected"));
            } else {
                s.finish(&text);
            }
            Ok(())
        }));
        let s = session.clone();
        let completed_log = log.clone();
        let completed_token = continuous.Completed(&TypedEventHandler::<
            SpeechContinuousRecognitionSession,
            SpeechContinuousRecognitionCompletedEventArgs,
        >::new(move |_, args| {
            let status = args
                .as_ref()
                .and_then(|a| a.Status().ok())
                .map(|st| Completion::from_raw(st.0))
                .unwrap_or(Completion::Unknown);
            if !s.ended() {
                write_log(completed_log.as_ref(), "INFO", &format!("session completed: {status:?}"));
            }
            let last = s.last_text();
            match map_completion(status, !last.trim().is_empty()) {
                None if last.trim().is_empty() => s.end(),
                None => s.finish(&last),
                Some(SpeechErrorKind::Aborted) => s.end(),
                Some(kind) => s.fail(&SpeechError::new(kind, format!("{status:?}"))),
            }
            Ok(())
        }));

        let tokens = match (hypothesis_token, result_token, completed_token) {
            (Ok(h), Ok(r), Ok(c)) => (h, r, c),
            (h, r, c) => {
                if let Ok(h) = h {
                    let _ = recognizer.RemoveHypothesisGenerated(h);
                }
                if let Ok(r) = r {
                    let _ = continuous.RemoveResultGenerated(r);
                }
                if let Ok(c) = c {
                    let _ = continuous.RemoveCompleted(c);
                }
                let _ = recognizer.Close();
                return Err(SpeechError::new(SpeechErrorKind::Unavailable, "could not attach handlers"));
            }
        };
        let active = Active {
            session: session.clone(),
            recognizer,
            continuous,
            hypothesis_token: tokens.0,
            result_token: tokens.1,
            completed_token: tokens.2,
            stop_requested: None,
        };

        if let Err(e) = active.continuous.StartAsync().and_then(|a| a.join()) {
            active.teardown(false);
            return Err(SpeechError::from(e));
        }
        write_log(log.as_ref(), "INFO", &format!("listening lang={tag}"));
        Ok(active)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_hresult_rows() {
        assert_eq!(map_hresult(0x8004_5509_u32 as i32), SpeechErrorKind::SpeechSettingOff);
        assert_eq!(map_hresult(0x8007_0005_u32 as i32), SpeechErrorKind::PermissionDenied);
        assert_eq!(map_hresult(0x8004_55A0_u32 as i32), SpeechErrorKind::Unavailable);
        assert_eq!(map_hresult(0x8000_4005_u32 as i32), SpeechErrorKind::Unavailable);
        assert_eq!(map_hresult(0), SpeechErrorKind::Unavailable);
    }

    #[test]
    fn completion_from_raw_matches_the_winrt_values() {
        let rows = [
            (0, Completion::Success),
            (1, Completion::TopicLanguageNotSupported),
            (2, Completion::GrammarLanguageMismatch),
            (3, Completion::GrammarCompilationFailure),
            (4, Completion::AudioQualityFailure),
            (5, Completion::UserCanceled),
            (6, Completion::Unknown),
            (7, Completion::TimeoutExceeded),
            (8, Completion::PauseLimitExceeded),
            (9, Completion::NetworkFailure),
            (10, Completion::MicrophoneUnavailable),
            (99, Completion::Unknown),
        ];
        for (raw, want) in rows {
            assert_eq!(Completion::from_raw(raw), want, "{raw}");
        }
    }

    #[test]
    fn map_completion_rows() {
        use SpeechErrorKind::*;
        assert_eq!(map_completion(Completion::Success, false), None);
        assert_eq!(map_completion(Completion::Success, true), None);
        assert_eq!(map_completion(Completion::TimeoutExceeded, true), None);
        assert_eq!(map_completion(Completion::TimeoutExceeded, false), Some(NoSpeech));
        assert_eq!(map_completion(Completion::NetworkFailure, false), Some(Network));
        assert_eq!(map_completion(Completion::MicrophoneUnavailable, false), Some(PermissionDenied));
        assert_eq!(map_completion(Completion::UserCanceled, true), Some(Aborted));
        for s in [
            Completion::Unknown,
            Completion::PauseLimitExceeded,
            Completion::AudioQualityFailure,
            Completion::TopicLanguageNotSupported,
            Completion::GrammarLanguageMismatch,
            Completion::GrammarCompilationFailure,
        ] {
            assert_eq!(map_completion(s, false), Some(Unavailable), "{s:?}");
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_error_becomes_speech_error() {
        use super::super::SpeechError;
        let e = ::windows::core::Error::from_hresult(::windows::core::HRESULT(0x8004_5509_u32 as i32));
        let s = SpeechError::from(e);
        assert_eq!(s.kind, SpeechErrorKind::SpeechSettingOff);
        assert!(s.detail.unwrap_or_default().starts_with("hresult 0x80045509"));
        let e = ::windows::core::Error::from_hresult(::windows::core::HRESULT(0x8007_0005_u32 as i32));
        assert_eq!(SpeechError::from(e).kind, SpeechErrorKind::PermissionDenied);
    }
}
