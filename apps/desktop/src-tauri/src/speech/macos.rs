// macOS voice search: SFSpeechRecognizer fed from an AVAudioEngine input tap.
//
// One dedicated thread ("ember-speech") owns every ObjC object: `Retained<T>`
// is not Send, so nothing crosses threads except the Tauri AppHandle (inside
// `Session`) and plain Rust state. Commands reach the thread over a channel.
// The release profile aborts on panic, so every nil is an Err and every ObjC
// call that can raise runs inside `objc2::exception::catch`.
//
// The pure parts (error mapping, silence watchdog) sit outside `imp` so the
// unit tests run on every platform.

use std::time::{Duration, Instant};

use super::SpeechErrorKind;

/// Apple's request has no configurable silence timeout on macOS, so the
/// worker ends the utterance itself: shortly after the last partial, or
/// after a longer wait when nothing was heard at all.
const SILENCE_AFTER_SPEECH: Duration = Duration::from_millis(2500);
const SILENCE_BEFORE_SPEECH: Duration = Duration::from_secs(8);

/// After `endAudio` the task normally delivers its final result within a
/// second; if it goes quiet the last partial is used instead of waiting for
/// the web's 15 s cap.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const STOP_GRACE: Duration = Duration::from_secs(3);

/// Maps an NSError from the recognition task. `stopping` is true once we
/// asked the task to finish or cancel, when its "canceled" codes are ours.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn map_error(domain: &str, code: isize, stopping: bool) -> SpeechErrorKind {
    match (domain, code) {
        ("NSURLErrorDomain", _) => SpeechErrorKind::Network,
        ("kAFAssistantErrorDomain", 216) | ("kLSRErrorDomain", 301) if stopping => {
            SpeechErrorKind::Aborted
        }
        ("kAFAssistantErrorDomain", 1110) => SpeechErrorKind::NoSpeech,
        ("kAFAssistantErrorDomain", 203) => SpeechErrorKind::Network,
        ("kAFAssistantErrorDomain", 1101) => SpeechErrorKind::Unavailable,
        ("kLSRErrorDomain", 301) => SpeechErrorKind::Unavailable,
        _ => SpeechErrorKind::Unavailable,
    }
}

/// The silence watchdog's decision, kept pure so it can be tested.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn should_stop(now: Instant, last_partial: Option<Instant>, started: Instant) -> bool {
    match last_partial {
        Some(t) => now.saturating_duration_since(t) >= SILENCE_AFTER_SPEECH,
        None => now.saturating_duration_since(started) >= SILENCE_BEFORE_SPEECH,
    }
}

#[cfg(target_os = "macos")]
pub use imp::MacSpeech;

#[cfg(target_os = "macos")]
mod imp {
    use std::collections::VecDeque;
    use std::panic::AssertUnwindSafe;
    use std::path::PathBuf;
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2::AnyThread;
    use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};
    use objc2_avf_audio::{AVAudioEngine, AVAudioInputNode, AVAudioPCMBuffer, AVAudioTime};
    use objc2_foundation::{NSBundle, NSError, NSLocale, NSString};
    use objc2_speech::{
        SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionResult,
        SFSpeechRecognitionTask, SFSpeechRecognitionTaskHint, SFSpeechRecognizer,
        SFSpeechRecognizerAuthorizationStatus,
    };
    use tauri::AppHandle;

    use super::super::{
        log, pick_locale, Availability, Session, SpeechBackend, SpeechError, SpeechErrorKind,
        StartGate, START_WAIT,
    };
    use super::{map_error, should_stop, STOP_GRACE};

    const TICK: Duration = Duration::from_millis(250);
    /// The user is reading a system dialog; give them time.
    const PROMPT_WAIT: Duration = Duration::from_secs(60);

    enum Cmd {
        Start { lang: String, app: AppHandle, gate: Arc<StartGate> },
        Stop,
        Abort,
        Available { reply: Sender<Availability> },
    }

    pub struct MacSpeech {
        tx: Mutex<Option<Sender<Cmd>>>,
        log: Option<PathBuf>,
    }

    impl MacSpeech {
        pub fn new(log: Option<PathBuf>) -> Self {
            MacSpeech { tx: Mutex::new(None), log }
        }

        /// Sends to the worker, spawning it on first use (and again if it
        /// ever went away, which only happens if its channel broke).
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
            let spawned = std::thread::Builder::new()
                .name("ember-speech".into())
                .spawn(move || worker(rx, log));
            if spawned.is_err() {
                log_line(&self.log, "WARN", "could not start the speech thread");
                *guard = None;
                return false;
            }
            let ok = tx.send(cmd).is_ok();
            *guard = Some(tx);
            ok
        }
    }

    impl SpeechBackend for MacSpeech {
        fn available(&self) -> Availability {
            let (reply, rx) = mpsc::channel();
            if !self.send(Cmd::Available { reply }) {
                return Availability::default();
            }
            rx.recv_timeout(Duration::from_secs(3)).unwrap_or_default()
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

    fn log_line(path: &Option<PathBuf>, level: &str, msg: &str) {
        log(path.as_ref(), level, msg);
    }

    /// Runs an ObjC call that may raise; an exception becomes `Unavailable`.
    fn objc<R>(what: &str, f: impl FnOnce() -> R) -> Result<R, SpeechError> {
        objc2::exception::catch(AssertUnwindSafe(f)).map_err(|e| {
            let why = match e {
                Some(e) => format!("{e:?}"),
                None => "unknown exception".to_string(),
            };
            SpeechError::new(SpeechErrorKind::Unavailable, format!("{what}: {why}"))
        })
    }

    /// State the result handler (main queue) and the tap (audio thread)
    /// share with the worker.
    #[derive(Default)]
    struct Shared {
        last_partial_at: Mutex<Option<Instant>>,
        stopping: AtomicBool,
        aborting: AtomicBool,
    }

    type ResultHandler = RcBlock<dyn Fn(*mut SFSpeechRecognitionResult, *mut NSError)>;
    type TapBlock = RcBlock<dyn Fn(NonNull<AVAudioPCMBuffer>, NonNull<AVAudioTime>)>;

    struct Active {
        session: Arc<Session>,
        shared: Arc<Shared>,
        engine: Retained<AVAudioEngine>,
        input: Retained<AVAudioInputNode>,
        request: Retained<SFSpeechAudioBufferRecognitionRequest>,
        task: Retained<SFSpeechRecognitionTask>,
        // Kept alive for the task's lifetime; the framework holds copies too.
        _recognizer: Retained<SFSpeechRecognizer>,
        _handler: ResultHandler,
        _tap: TapBlock,
        started: Instant,
        stop_requested: Option<Instant>,
        audio_running: bool,
    }

    impl Active {
        fn stop_audio(&mut self) {
            if !self.audio_running {
                return;
            }
            self.audio_running = false;
            let _ = objc("stop audio", || unsafe {
                self.engine.stop();
                self.input.removeTapOnBus(0);
            });
        }

        /// Stop capturing; the task then delivers its final result.
        fn request_stop(&mut self) {
            if self.stop_requested.is_some() {
                return;
            }
            self.shared.stopping.store(true, Ordering::SeqCst);
            self.stop_audio();
            let _ = objc("end audio", || unsafe { self.request.endAudio() });
            self.stop_requested = Some(Instant::now());
        }

        fn teardown(mut self, cancel: bool) {
            self.shared.stopping.store(true, Ordering::SeqCst);
            self.stop_audio();
            if cancel {
                let _ = objc("cancel task", || unsafe { self.task.cancel() });
            }
        }
    }

    fn worker(rx: Receiver<Cmd>, log: Option<PathBuf>) {
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
                    // A start while listening replaces the old session. It
                    // ends silently: a late `end` would close the new one in
                    // the web, since events carry no session id.
                    if let Some(a) = active.take() {
                        a.session.close_silently();
                        a.teardown(true);
                    }
                    let session = Arc::new(Session::new(app));
                    active = start(&rx, &mut queue, &lang, &session, &gate, &log);
                    // Whatever happened, the command must not wait any longer.
                    gate.resolve(Ok(()));
                }
                Some(Cmd::Stop) => {
                    if let Some(a) = active.as_mut() {
                        a.request_stop();
                    }
                }
                Some(Cmd::Abort) => {
                    if let Some(a) = active.take() {
                        a.shared.aborting.store(true, Ordering::SeqCst);
                        a.session.end();
                        a.teardown(true);
                    }
                }
                Some(Cmd::Available { reply }) => {
                    let _ = reply.send(availability());
                }
                None => {}
            }
            housekeeping(&mut active, &log);
        }
    }

    fn housekeeping(active: &mut Option<Active>, log: &Option<PathBuf>) {
        let Some(a) = active.as_mut() else { return };
        let now = Instant::now();
        if a.session.ended() {
            if let Some(a) = active.take() {
                a.teardown(false);
            }
            return;
        }
        if let Some(t) = a.stop_requested {
            if now.saturating_duration_since(t) >= STOP_GRACE {
                log_line(log, "WARN", "no final result after stop; using the last partial");
                a.session.finish_with_last_or(SpeechError::new(
                    SpeechErrorKind::NoSpeech,
                    "no result after stop",
                ));
                if let Some(a) = active.take() {
                    a.teardown(true);
                }
            }
            return;
        }
        let last = a.shared.last_partial_at.lock().ok().and_then(|g| *g);
        if should_stop(now, last, a.started) {
            a.request_stop();
        }
    }

    enum Wait<T> {
        Got(T),
        TimedOut,
        /// A stop, abort or new start arrived while a dialog was up.
        Interrupted,
    }

    /// Waits for a permission callback while still honouring commands, so a
    /// second mic tap during the dialog stops the session instead of queueing
    /// behind it.
    fn wait_prompt<T>(
        answer: &Receiver<T>,
        rx: &Receiver<Cmd>,
        queue: &mut VecDeque<Cmd>,
    ) -> Wait<T> {
        let deadline = Instant::now() + PROMPT_WAIT;
        loop {
            match answer.recv_timeout(Duration::from_millis(100)) {
                Ok(v) => return Wait::Got(v),
                Err(RecvTimeoutError::Disconnected) => return Wait::TimedOut,
                Err(RecvTimeoutError::Timeout) => {}
            }
            while let Ok(cmd) = rx.try_recv() {
                match cmd {
                    Cmd::Available { reply } => {
                        let _ = reply.send(availability());
                    }
                    Cmd::Stop | Cmd::Abort => return Wait::Interrupted,
                    start @ Cmd::Start { .. } => {
                        queue.push_back(start);
                        return Wait::Interrupted;
                    }
                }
            }
            if Instant::now() >= deadline {
                return Wait::TimedOut;
            }
        }
    }

    fn has_usage_key(key: &str) -> bool {
        objc("Info.plist", || {
            NSBundle::mainBundle()
                .objectForInfoDictionaryKey(&NSString::from_str(key))
                .is_some()
        })
        .unwrap_or(false)
    }

    /// TCC kills the process outright (no exception to catch) when an app
    /// without these strings asks for speech or the mic, e.g. a bare
    /// `cargo run` binary outside the bundle. Check before touching either.
    fn usage_strings_present() -> Result<(), SpeechError> {
        for key in ["NSSpeechRecognitionUsageDescription", "NSMicrophoneUsageDescription"] {
            if !has_usage_key(key) {
                return Err(SpeechError::new(
                    SpeechErrorKind::Unavailable,
                    format!("{key} missing from Info.plist"),
                ));
            }
        }
        Ok(())
    }

    fn os_locale() -> Option<String> {
        objc("current locale", || NSLocale::currentLocale().localeIdentifier().to_string()).ok()
    }

    fn make_recognizer(tag: &str) -> Option<Retained<SFSpeechRecognizer>> {
        let with_locale = |t: &str| {
            objc("recognizer", || unsafe {
                let locale = NSLocale::localeWithLocaleIdentifier(&NSString::from_str(t));
                SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &locale)
            })
            .ok()
            .flatten()
        };
        with_locale(tag)
            .or_else(|| {
                objc("recognizer", || unsafe { SFSpeechRecognizer::init(SFSpeechRecognizer::alloc()) })
                    .ok()
                    .flatten()
            })
            .or_else(|| with_locale("en-US"))
    }

    fn availability() -> Availability {
        if usage_strings_present().is_err() {
            return Availability::default();
        }
        let status = objc("auth status", || unsafe { SFSpeechRecognizer::authorizationStatus() })
            .unwrap_or(SFSpeechRecognizerAuthorizationStatus::Denied);
        if status == SFSpeechRecognizerAuthorizationStatus::Denied
            || status == SFSpeechRecognizerAuthorizationStatus::Restricted
        {
            return Availability::default();
        }
        let tag = pick_locale(os_locale().as_deref(), None);
        let Some(rec) = make_recognizer(&tag) else { return Availability::default() };
        objc("availability", || unsafe {
            Availability { available: rec.isAvailable(), on_device: rec.supportsOnDeviceRecognition() }
        })
        .unwrap_or_default()
    }

    fn speech_permission(
        rx: &Receiver<Cmd>,
        queue: &mut VecDeque<Cmd>,
        gate: &StartGate,
    ) -> Result<(), Option<SpeechError>> {
        let status = objc("auth status", || unsafe { SFSpeechRecognizer::authorizationStatus() })?;
        let status = if status == SFSpeechRecognizerAuthorizationStatus::NotDetermined {
            // Answer the invoke now: the web gives it 2 s and the dialog can
            // take much longer. The outcome follows as events.
            gate.resolve(Ok(()));
            let (tx, answer) = mpsc::channel();
            let block = RcBlock::new(move |s: SFSpeechRecognizerAuthorizationStatus| {
                let _ = tx.send(s);
            });
            objc("request speech auth", || unsafe {
                SFSpeechRecognizer::requestAuthorization(&block)
            })?;
            match wait_prompt(&answer, rx, queue) {
                Wait::Got(s) => s,
                Wait::TimedOut => {
                    return Err(Some(SpeechError::new(
                        SpeechErrorKind::PermissionDenied,
                        "speech recognition prompt not answered",
                    )))
                }
                Wait::Interrupted => return Err(None),
            }
        } else {
            status
        };
        if status == SFSpeechRecognizerAuthorizationStatus::Authorized {
            Ok(())
        } else {
            Err(Some(SpeechError::new(
                SpeechErrorKind::PermissionDenied,
                format!("speech recognition not authorized ({})", status.0),
            )))
        }
    }

    fn mic_permission(
        rx: &Receiver<Cmd>,
        queue: &mut VecDeque<Cmd>,
        gate: &StartGate,
    ) -> Result<(), Option<SpeechError>> {
        // Without this check a denied mic makes the engine deliver silence
        // and the user just sees nothing happen.
        let Some(media) = (unsafe { AVMediaTypeAudio }) else {
            return Err(Some(SpeechError::new(SpeechErrorKind::Unavailable, "no AVMediaTypeAudio")));
        };
        let status = objc("mic status", || unsafe {
            AVCaptureDevice::authorizationStatusForMediaType(media)
        })?;
        let granted = if status == AVAuthorizationStatus::NotDetermined {
            gate.resolve(Ok(()));
            let (tx, answer) = mpsc::channel();
            let block = RcBlock::new(move |ok: Bool| {
                let _ = tx.send(ok.as_bool());
            });
            objc("request mic access", || unsafe {
                AVCaptureDevice::requestAccessForMediaType_completionHandler(media, &block)
            })?;
            match wait_prompt(&answer, rx, queue) {
                Wait::Got(ok) => ok,
                Wait::TimedOut => false,
                Wait::Interrupted => return Err(None),
            }
        } else {
            status == AVAuthorizationStatus::Authorized
        };
        if granted {
            Ok(())
        } else {
            Err(Some(SpeechError::new(SpeechErrorKind::PermissionDenied, "microphone not authorized")))
        }
    }

    /// Runs the start sequence. On failure the error goes to the command if
    /// it is still waiting, otherwise out as `speech:error` + `speech:end`.
    fn start(
        rx: &Receiver<Cmd>,
        queue: &mut VecDeque<Cmd>,
        requested: &str,
        session: &Arc<Session>,
        gate: &StartGate,
        log: &Option<PathBuf>,
    ) -> Option<Active> {
        let fail = |err: SpeechError| {
            log_line(log, "WARN", &format!("start failed: {:?} {}", err.kind, err.detail.as_deref().unwrap_or("")));
            gate.fail(session, err);
        };

        if let Err(e) = usage_strings_present() {
            fail(e);
            return None;
        }
        for step in [speech_permission, mic_permission] {
            match step(rx, queue, gate) {
                Ok(()) => {}
                Err(Some(e)) => {
                    fail(e);
                    return None;
                }
                Err(None) => {
                    log_line(log, "INFO", "interrupted while a permission dialog was open");
                    // A newer start replaces this session silently (see the
                    // worker); a stop or abort ends it normally.
                    if matches!(queue.back(), Some(Cmd::Start { .. })) {
                        session.close_silently();
                    } else {
                        session.end();
                    }
                    return None;
                }
            }
        }

        let hint = if requested.is_empty() { None } else { Some(requested) };
        let tag = pick_locale(os_locale().as_deref(), hint);
        let Some(recognizer) = make_recognizer(&tag) else {
            fail(SpeechError::new(SpeechErrorKind::Unavailable, format!("no recognizer for {tag}")));
            return None;
        };
        let ready = objc("recognizer state", || unsafe {
            (recognizer.isAvailable(), recognizer.supportsOnDeviceRecognition())
        });
        let on_device = match ready {
            Ok((true, on_device)) => on_device,
            Ok((false, _)) => {
                fail(SpeechError::new(SpeechErrorKind::Unavailable, "recognizer not available"));
                return None;
            }
            Err(e) => {
                fail(e);
                return None;
            }
        };

        let request = match objc("request", || unsafe {
            let r = SFSpeechAudioBufferRecognitionRequest::new();
            r.setShouldReportPartialResults(true);
            // On-device where Apple has the model, otherwise its server
            // (which needs the network). Forcing on-device would make the
            // mic dead on Macs without the language model.
            r.setRequiresOnDeviceRecognition(on_device);
            r.setTaskHint(SFSpeechRecognitionTaskHint::Search);
            r
        }) {
            Ok(r) => r,
            Err(e) => {
                fail(e);
                return None;
            }
        };

        let engine_parts = objc("input node", || unsafe {
            let engine = AVAudioEngine::new();
            let input = engine.inputNode();
            let format = input.outputFormatForBus(0);
            (engine, input, format)
        });
        let (engine, input, format) = match engine_parts {
            Ok(p) => p,
            Err(e) => {
                fail(e);
                return None;
            }
        };
        let (channels, rate) =
            objc("input format", || unsafe { (format.channelCount(), format.sampleRate()) })
                .unwrap_or((0, 0.0));
        if channels == 0 || rate <= 0.0 {
            fail(SpeechError::new(SpeechErrorKind::Unavailable, "no microphone"));
            return None;
        }

        let tap_request = request.clone();
        let tap: TapBlock = RcBlock::new(
            move |buffer: NonNull<AVAudioPCMBuffer>, _when: NonNull<AVAudioTime>| unsafe {
                tap_request.appendAudioPCMBuffer(buffer.as_ref());
            },
        );
        let started = objc("start engine", || unsafe {
            input.installTapOnBus_bufferSize_format_block(0, 1024, Some(&format), RcBlock::as_ptr(&tap));
            engine.prepare();
            engine.startAndReturnError()
        });
        match started {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                let _ = objc("remove tap", || unsafe { input.removeTapOnBus(0) });
                fail(SpeechError::new(
                    SpeechErrorKind::Unavailable,
                    format!("audio engine: {}", err.localizedDescription()),
                ));
                return None;
            }
            Err(e) => {
                let _ = objc("remove tap", || unsafe { input.removeTapOnBus(0) });
                fail(e);
                return None;
            }
        }

        let shared = Arc::new(Shared::default());
        let handler = result_handler(session.clone(), shared.clone(), log.clone());
        let task = match objc("recognition task", || unsafe {
            recognizer.recognitionTaskWithRequest_resultHandler(&request, &handler)
        }) {
            Ok(t) => t,
            Err(e) => {
                let _ = objc("stop audio", || unsafe {
                    engine.stop();
                    input.removeTapOnBus(0);
                });
                fail(e);
                return None;
            }
        };

        log_line(log, "INFO", &format!("listening lang={tag} onDevice={on_device}"));
        gate.resolve(Ok(()));
        Some(Active {
            session: session.clone(),
            shared,
            engine,
            input,
            request,
            task,
            _recognizer: recognizer,
            _handler: handler,
            _tap: tap,
            started: Instant::now(),
            stop_requested: None,
            audio_running: true,
        })
    }

    /// Called on the recognizer's queue (the main queue by default) with a
    /// result, an error, or both.
    fn result_handler(
        session: Arc<Session>,
        shared: Arc<Shared>,
        log: Option<PathBuf>,
    ) -> ResultHandler {
        RcBlock::new(move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
            if session.ended() {
                return;
            }
            // SAFETY: the framework passes either nil or a valid object for
            // the duration of the call.
            if let Some(result) = unsafe { result.as_ref() } {
                let read = objc("read result", || unsafe {
                    (result.bestTranscription().formattedString().to_string(), result.isFinal())
                });
                match read {
                    Ok((text, true)) => {
                        if text.trim().is_empty() {
                            session.finish_with_last_or(SpeechError::new(
                                SpeechErrorKind::NoSpeech,
                                "empty final result",
                            ));
                        } else {
                            session.finish(&text);
                        }
                        return;
                    }
                    Ok((text, false)) => {
                        if !text.trim().is_empty() {
                            if let Ok(mut t) = shared.last_partial_at.lock() {
                                *t = Some(Instant::now());
                            }
                        }
                        session.partial(&text);
                    }
                    Err(e) => {
                        session.fail(&e);
                        return;
                    }
                }
            }
            if let Some(err) = unsafe { error.as_ref() } {
                if shared.aborting.load(Ordering::SeqCst) {
                    session.end();
                    return;
                }
                let (domain, code, desc) = objc("read error", || {
                    (err.domain().to_string(), err.code(), err.localizedDescription().to_string())
                })
                .unwrap_or_else(|_| (String::from("unknown"), 0, String::new()));
                let kind = map_error(&domain, code, shared.stopping.load(Ordering::SeqCst));
                let e = SpeechError::new(kind, format!("{domain} {code}: {desc}"));
                log_line(&log, "INFO", &format!("recognizer error {:?} ({domain} {code}: {desc})", kind));
                match kind {
                    // Apple often reports "no speech" or a cancel after
                    // perfectly good partials; those partials are the answer.
                    SpeechErrorKind::NoSpeech | SpeechErrorKind::Aborted => {
                        session.finish_with_last_or(e)
                    }
                    _ => session.fail(&e),
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_error_rows() {
        use SpeechErrorKind::*;
        let rows: &[(&str, isize, bool, SpeechErrorKind)] = &[
            ("NSURLErrorDomain", -1009, false, Network),
            ("NSURLErrorDomain", -1001, true, Network),
            ("kAFAssistantErrorDomain", 1110, false, NoSpeech),
            ("kAFAssistantErrorDomain", 1101, false, Unavailable),
            ("kAFAssistantErrorDomain", 203, false, Network),
            ("kAFAssistantErrorDomain", 216, true, Aborted),
            ("kAFAssistantErrorDomain", 216, false, Unavailable),
            ("kLSRErrorDomain", 301, true, Aborted),
            ("kLSRErrorDomain", 301, false, Unavailable),
            ("kLSRErrorDomain", 102, false, Unavailable),
            ("SomethingElse", 1, false, Unavailable),
        ];
        for (domain, code, stopping, want) in rows {
            assert_eq!(map_error(domain, *code, *stopping), *want, "{domain} {code} {stopping}");
        }
    }

    #[test]
    fn watchdog_waits_longer_before_any_speech() {
        let t0 = Instant::now();
        assert!(!should_stop(t0 + Duration::from_secs(7), None, t0));
        assert!(should_stop(t0 + Duration::from_secs(8), None, t0));
    }

    #[test]
    fn watchdog_stops_shortly_after_the_last_partial() {
        let t0 = Instant::now();
        let heard = t0 + Duration::from_secs(1);
        assert!(!should_stop(heard + Duration::from_millis(2400), Some(heard), t0));
        assert!(should_stop(heard + Duration::from_millis(2500), Some(heard), t0));
        // A partial resets the clock even long after the start.
        let late = t0 + Duration::from_secs(20);
        assert!(!should_stop(late + Duration::from_secs(1), Some(late), t0));
    }
}
