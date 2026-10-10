//! The launch gate: "update on launch".
//!
//! Before the audio engine, media controls or the server page exist, the
//! shell asks the server once whether a newer Ember is out
//! (GET /api/app/update, apps/web/app/api/app/update). The window meanwhile
//! shows the bundled `offline/gate.html` on the theme's colour.
//!
//!  - No answer within the budget (1.5 s), no update, or any error: the app
//!    opens as it always did. Offline never blocks a launch.
//!  - An update: a dialog over the dimmed window with "Not now" and
//!    "Update now". It downloads (or uses the copy an earlier session kept,
//!    src/update.rs), then counts down "Restarting in 7s" and installs.
//!  - "Not now" opens the app at once; the download carries on and is kept,
//!    and the next launch asks again (owner decisions D1, D2).
//!  - A required update (release-notes markers, D3/D7) has the same dialog
//!    with a reason, and "Quit Ember" in place of "Not now".
//!
//! Installing is the one disruptive moment (on Windows the installer quits
//! the app and starts the new one), so it only happens while this window is
//! the focused one: if the person alt-tabs to a game, the dialog gives up and
//! opens the app instead (same as "Not now"); a required update just waits.
//!
//! Every decision is in `Machine::handle`, a plain state machine with no I/O,
//! so each case is tested on its own. `run` drives it: the HTTP check, the
//! download, the countdown ticks, focus changes and the buttons.
//!
//! The launch history (`launch.json`) counts launches that never got going:
//! two that died after the gate make the next one a "recovery" launch (a
//! longer budget, "Ember didn't start properly last time"), and two that died
//! inside the gate make the next one skip it, so a broken gate can never keep
//! the app shut.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Url};
use tokio::sync::mpsc;

use crate::applog;

/// Seconds of "Restarting in 7s" before installing (owner decision D1).
pub const COUNTDOWN_S: u32 = 7;
/// How long the check may take before the app opens anyway.
pub const CHECK_BUDGET: Duration = Duration::from_millis(1500);
/// The same, after launches that never got going: worth waiting for a fix.
pub const RECOVERY_BUDGET: Duration = Duration::from_secs(8);
/// "Couldn't update" stays this long, then the app opens.
pub const FAILED_LINGER: Duration = Duration::from_secs(2);
/// The updater's own feed and download, once the person has seen the dialog.
const FEED_TIMEOUT: Duration = Duration::from_secs(30);
/// Telemetry kept for the page to send, at most.
const MAX_EVENTS: usize = 50;

// --- Launch history -----------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Stage {
    /// The process started; the gate has not finished.
    Starting,
    /// The gate let the app in; the audio engine and the page are loading.
    Gated,
    /// The page loaded after the gate: this launch worked.
    Ready,
    /// Quit on purpose (or handed over to the installer) before Ready. Not a
    /// failure, not a success.
    #[default]
    Clean,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct LaunchHistory {
    pub stage: Stage,
    /// Launches in a row that died inside the gate.
    pub failed_in_gate: u32,
    /// Launches in a row that died after the gate, before the page loaded.
    pub failed_after_gate: u32,
    /// The version that ran last, to notice an update went in.
    pub last_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchMode {
    Normal,
    /// The last launches died after the gate: a fix is worth waiting for.
    Recovery,
    /// The last launches died inside the gate: open without it this time.
    SkipGate,
}

/// The history to write at the start of this launch, how to run the gate,
/// and the version this replaced when an update went in since last time.
pub fn on_launch(prev: &LaunchHistory, version: &str) -> (LaunchHistory, LaunchMode, Option<String>) {
    let (in_gate, after_gate) = match prev.stage {
        Stage::Starting => (prev.failed_in_gate + 1, prev.failed_after_gate),
        Stage::Gated => (prev.failed_in_gate, prev.failed_after_gate + 1),
        Stage::Ready => (0, 0),
        Stage::Clean => (prev.failed_in_gate, prev.failed_after_gate),
    };
    let mode = if in_gate >= 2 {
        LaunchMode::SkipGate
    } else if after_gate >= 2 {
        LaunchMode::Recovery
    } else {
        LaunchMode::Normal
    };
    let updated_from = prev
        .last_version
        .as_deref()
        .filter(|v| *v != version && is_newer(version, v))
        .map(str::to_string);
    let next = LaunchHistory {
        stage: Stage::Starting,
        failed_in_gate: in_gate,
        failed_after_gate: after_gate,
        last_version: Some(version.to_string()),
    };
    (next, mode, updated_from)
}

/// The history after this launch reached `stage`.
pub fn reached(prev: &LaunchHistory, stage: Stage) -> LaunchHistory {
    let mut h = prev.clone();
    h.stage = stage;
    match stage {
        // Past the gate: the gate is not what kills it.
        Stage::Gated => h.failed_in_gate = 0,
        Stage::Ready => {
            h.failed_in_gate = 0;
            h.failed_after_gate = 0;
        }
        Stage::Starting | Stage::Clean => {}
    }
    h
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

// --- The check ------------------------------------------------------------

/// What the server offered, as far as the gate cares.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Offer {
    pub version: String,
    pub mandatory: bool,
    /// "min-version" | "flagged".
    pub reason: Option<String>,
    /// The server can only point at a download (a .deb or .rpm it has no
    /// signature for).
    pub download_page: bool,
    /// Where the person gets it by hand: the download page, or the fallback
    /// when installing a .deb or .rpm fails.
    pub url: Option<String>,
}

#[derive(Deserialize)]
struct WireAnswer {
    update: Option<WireOffer>,
}

#[derive(Deserialize)]
struct WireOffer {
    version: String,
    #[serde(default)]
    mandatory: bool,
    reason: Option<String>,
    action: String,
    url: Option<String>,
}

/// The server's answer as an offer, or None for anything that is not a
/// usable newer version.
pub fn parse_answer(body: &str, current: &str) -> Option<Offer> {
    let answer: WireAnswer = serde_json::from_str(body).ok()?;
    let o = answer.update?;
    if !is_newer(&o.version, current) {
        return None;
    }
    let download_page = o.action == "download-page";
    if !download_page && o.action != "install" {
        return None;
    }
    let url = o.url.filter(|u| crate::external::openable(u).is_some());
    if download_page && url.is_none() {
        return None;
    }
    Some(Offer { version: o.version, mandatory: o.mandatory, reason: o.reason, download_page, url })
}

/// How the app was installed, the way the server and Tauri's updater name it.
pub fn install_kind() -> &'static str {
    use tauri::utils::config::BundleType;
    match tauri::utils::platform::bundle_type() {
        Some(BundleType::Deb) => "deb",
        Some(BundleType::Rpm) => "rpm",
        Some(BundleType::AppImage) => "appimage",
        Some(BundleType::Msi) => "msi",
        Some(BundleType::Nsis) => "nsis",
        Some(BundleType::App) | Some(BundleType::Dmg) => "app",
        _ => "unknown",
    }
}

/// Installing these asks for the person's password (pkexec on Linux).
pub fn install_asks_password(kind: &str) -> bool {
    matches!(kind, "deb" | "rpm")
}

pub fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// GET {server}/api/app/update for this shell.
pub fn check_url(server: &Url, version: &str, install: &str) -> Option<Url> {
    let mut url = server.join("/api/app/update").ok()?;
    url.query_pairs_mut()
        .append_pair("platform", platform())
        .append_pair("version", version)
        .append_pair("arch", std::env::consts::ARCH)
        .append_pair("install", install)
        .append_pair("launch", "1");
    Some(url)
}

/// What the check came to, for the telemetry line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckResult {
    None,
    Update,
    Timeout,
    Error,
}

impl CheckResult {
    fn as_str(self) -> &'static str {
        match self {
            CheckResult::None => "none",
            CheckResult::Update => "update",
            CheckResult::Timeout => "timeout",
            CheckResult::Error => "error",
        }
    }
}

/// One GET, no retry, bounded by `budget` from start to body.
pub async fn quick_check(url: &Url, current: &str, budget: Duration) -> (Option<Offer>, CheckResult) {
    let Some(client) = crate::connect::probe_client(budget) else {
        return (None, CheckResult::Error);
    };
    let fetch = async {
        let res = client.get(url.as_str()).send().await?;
        if !res.status().is_success() {
            return Ok::<_, stream_download::http::reqwest::Error>(None);
        }
        Ok(Some(res.text().await?))
    };
    match tokio::time::timeout(budget, fetch).await {
        Err(_) => (None, CheckResult::Timeout),
        Ok(Err(e)) if e.is_timeout() => (None, CheckResult::Timeout),
        Ok(Err(_)) => (None, CheckResult::Error),
        Ok(Ok(None)) => (None, CheckResult::None),
        Ok(Ok(Some(body))) => match parse_answer(&body, current) {
            Some(o) => (Some(o), CheckResult::Update),
            None => (None, CheckResult::None),
        },
    }
}

// --- The state machine ------------------------------------------------------

/// What the dialog shows. Serialized to the page as `{ phase, ... }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "phase", rename_all = "kebab-case")]
pub enum Phase {
    /// Asking the server: the splash, no dialog.
    Checking,
    Downloading { percent: Option<u8> },
    /// `held`: a required update waiting for the window to be focused again.
    Countdown { seconds: u32, held: bool },
    /// The point of no return.
    Installing,
    /// The person updates by hand (a .deb or .rpm that could not install).
    Manual { url: Option<String> },
    /// "Couldn't update": the app opens in a moment.
    Failed,
    /// The app is open (or quitting).
    Done,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Input {
    Checked { offer: Option<Offer>, staged: bool },
    Progress(Option<u8>),
    Downloaded,
    DownloadFailed,
    Tick,
    Focus(bool),
    NotNow,
    UpdateNow,
    Quit,
    InstallFailed,
    FailedTimeout,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    EnterApp,
    StartDownload,
    Install,
    Quit,
    OpenUrl(String),
    /// Send FailedTimeout after FAILED_LINGER.
    Linger,
    Event(&'static str, serde_json::Value),
}

#[derive(Debug, Clone)]
pub struct Machine {
    pub phase: Phase,
    pub offer: Option<Offer>,
    pub recovery: bool,
    pub focused: bool,
    /// "Update now" pressed during the download: install as soon as it is
    /// in, no countdown (the person already said yes).
    pub update_now: bool,
    /// Installing a .deb or .rpm: a failure falls back to the download page.
    pub manual_fallback: bool,
}

impl Machine {
    pub fn new(recovery: bool, focused: bool, manual_fallback: bool) -> Self {
        Machine { phase: Phase::Checking, offer: None, recovery, focused, update_now: false, manual_fallback }
    }

    pub fn mandatory(&self) -> bool {
        self.offer.as_ref().is_some_and(|o| o.mandatory)
    }

    fn version(&self) -> String {
        self.offer.as_ref().map(|o| o.version.clone()).unwrap_or_default()
    }

    /// The dialog is up and the person can leave it.
    fn cancellable(&self) -> bool {
        !self.mandatory()
            && matches!(self.phase, Phase::Downloading { .. } | Phase::Countdown { .. } | Phase::Manual { .. } | Phase::Failed)
    }

    fn stage_name(&self) -> &'static str {
        match self.phase {
            Phase::Downloading { .. } => "download",
            Phase::Countdown { .. } => "countdown",
            Phase::Manual { .. } => "manual",
            Phase::Failed => "failed",
            _ => "other",
        }
    }

    fn enter(&mut self, why: &'static str, focus_lost: bool) -> Vec<Effect> {
        let stage = self.stage_name();
        self.phase = Phase::Done;
        vec![
            Effect::Event("update.gate.cancel", json!({ "stage": stage, "why": why, "focusLost": focus_lost, "version": self.version() })),
            Effect::EnterApp,
        ]
    }

    fn install(&mut self) -> Vec<Effect> {
        self.phase = Phase::Installing;
        vec![Effect::Event("update.gate.install", json!({ "version": self.version() })), Effect::Install]
    }

    fn countdown(&self) -> Phase {
        Phase::Countdown { seconds: COUNTDOWN_S, held: !self.focused && self.mandatory() }
    }

    pub fn handle(&mut self, input: Input) -> Vec<Effect> {
        match (input, self.phase.clone()) {
            (Input::Checked { offer: None, .. }, Phase::Checking) => {
                self.phase = Phase::Done;
                vec![Effect::EnterApp]
            }
            (Input::Checked { offer: Some(offer), staged }, Phase::Checking) => {
                let shown = Effect::Event(
                    "update.gate.shown",
                    json!({ "version": offer.version, "mandatory": offer.mandatory, "staged": staged, "recovery": self.recovery }),
                );
                let manual = offer.download_page;
                let url = offer.url.clone();
                self.offer = Some(offer);
                if manual {
                    self.phase = Phase::Manual { url };
                    vec![shown]
                } else if staged {
                    self.phase = self.countdown();
                    vec![shown]
                } else {
                    self.phase = Phase::Downloading { percent: None };
                    vec![shown, Effect::StartDownload]
                }
            }
            (Input::Progress(p), Phase::Downloading { .. }) => {
                self.phase = Phase::Downloading { percent: p.map(|p| p.min(100)) };
                vec![]
            }
            (Input::Downloaded, Phase::Downloading { .. }) => {
                if self.update_now {
                    self.install()
                } else {
                    self.phase = self.countdown();
                    vec![]
                }
            }
            (Input::DownloadFailed, Phase::Downloading { .. }) => {
                self.phase = Phase::Failed;
                vec![Effect::Event("update.gate.failed", json!({ "stage": "download", "version": self.version() })), Effect::Linger]
            }
            (Input::Tick, Phase::Countdown { seconds, .. }) => {
                if !self.focused {
                    if self.mandatory() {
                        // Waits for the person to come back, then counts the
                        // whole countdown again.
                        self.phase = Phase::Countdown { seconds: COUNTDOWN_S, held: true };
                        return vec![];
                    }
                    return self.enter("unfocused", true);
                }
                if seconds <= 1 {
                    self.install()
                } else {
                    self.phase = Phase::Countdown { seconds: seconds - 1, held: false };
                    vec![]
                }
            }
            (Input::Focus(focused), phase) => {
                self.focused = focused;
                if focused {
                    if let Phase::Countdown { held: true, .. } = phase {
                        self.phase = Phase::Countdown { seconds: COUNTDOWN_S, held: false };
                    }
                    return vec![];
                }
                if self.cancellable() {
                    return self.enter("unfocused", true);
                }
                if let Phase::Countdown { .. } = phase {
                    self.phase = Phase::Countdown { seconds: COUNTDOWN_S, held: true };
                }
                vec![]
            }
            (Input::NotNow, _) if self.cancellable() => self.enter("not-now", false),
            (Input::UpdateNow, Phase::Downloading { .. }) => {
                self.update_now = true;
                vec![]
            }
            (Input::UpdateNow, Phase::Countdown { .. }) => self.install(),
            (Input::UpdateNow, Phase::Manual { url: Some(url) }) => {
                let mut effects = vec![Effect::OpenUrl(url)];
                if !self.mandatory() {
                    self.phase = Phase::Done;
                    effects.push(Effect::EnterApp);
                }
                effects
            }
            (Input::Quit, phase) if self.mandatory() && !matches!(phase, Phase::Installing | Phase::Done) => {
                self.phase = Phase::Done;
                vec![Effect::Event("update.gate.quit", json!({ "version": self.version() })), Effect::Quit]
            }
            (Input::InstallFailed, Phase::Installing) => {
                let url = self.offer.as_ref().and_then(|o| o.url.clone());
                if self.manual_fallback && url.is_some() {
                    self.phase = Phase::Manual { url };
                    vec![Effect::Event("update.gate.failed", json!({ "stage": "install", "fallback": "manual", "version": self.version() }))]
                } else {
                    self.phase = Phase::Failed;
                    vec![Effect::Event("update.gate.failed", json!({ "stage": "install", "version": self.version() })), Effect::Linger]
                }
            }
            (Input::FailedTimeout, Phase::Failed) => {
                self.phase = Phase::Done;
                vec![Effect::EnterApp]
            }
            _ => vec![],
        }
    }
}

// --- What the page sees -----------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    #[serde(flatten)]
    pub phase: Phase,
    pub version: Option<String>,
    pub mandatory: bool,
    pub reason: Option<String>,
    pub recovery: bool,
    pub update_now: bool,
    /// Installing will ask for the person's password (.deb, .rpm).
    pub asks_password: bool,
    /// The theme's background, for the splash.
    pub background: Option<String>,
}

impl View {
    pub fn of(m: &Machine, asks_password: bool, background: Option<String>) -> View {
        View {
            phase: m.phase.clone(),
            version: m.offer.as_ref().map(|o| o.version.clone()),
            mandatory: m.mandatory(),
            reason: m.offer.as_ref().and_then(|o| o.reason.clone()),
            recovery: m.recovery,
            update_now: m.update_now,
            asks_password,
            background,
        }
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

/// Telemetry for the page to send once it is signed in. Kept on disk, so a
/// launch that ends in an install (the process goes away) still reports.
pub fn push_event(dir: &Path, event: GateEvent) {
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
    let all = read_events(dir);
    let _ = std::fs::remove_file(dir.join(EVENTS_FILE));
    all
}

// --- The live gate ------------------------------------------------------------

/// Managed state: what the page shows, and the way the buttons and focus
/// changes reach the running gate.
pub struct Gate {
    view: Mutex<Option<View>>,
    tx: Mutex<Option<mpsc::UnboundedSender<Input>>>,
    /// Where launch.json and the telemetry live.
    dir: Option<PathBuf>,
    history: Mutex<LaunchHistory>,
    entered: AtomicBool,
    started: AtomicBool,
    page_seen: AtomicBool,
    ready: AtomicBool,
    /// The gate started a download: the background check need not.
    pub downloading: AtomicBool,
    log_path: Option<PathBuf>,
}

impl Gate {
    pub fn new(dir: Option<PathBuf>, history: LaunchHistory, log_path: Option<PathBuf>) -> Self {
        Gate {
            view: Mutex::new(None),
            tx: Mutex::new(None),
            dir,
            history: Mutex::new(history),
            entered: AtomicBool::new(false),
            started: AtomicBool::new(false),
            page_seen: AtomicBool::new(false),
            ready: AtomicBool::new(false),
            downloading: AtomicBool::new(false),
            log_path,
        }
    }

    fn send(&self, input: Input) {
        if let Some(tx) = self.tx.lock().ok().and_then(|g| g.clone()) {
            let _ = tx.send(input);
        }
    }

    pub fn focus(&self, focused: bool) {
        self.send(Input::Focus(focused));
    }

    pub fn event(&self, event: &str, data: serde_json::Value) {
        applog::write_line(self.log_path.as_ref(), "INFO", &format!("{event} {data}"));
        if let Some(dir) = &self.dir {
            push_event(dir, GateEvent { ts: now_ms(), event: event.to_string(), data });
        }
    }

    pub fn mark(&self, stage: Stage) {
        let Ok(mut h) = self.history.lock() else { return };
        *h = reached(&h, stage);
        if let Some(dir) = &self.dir {
            if let Err(e) = store_history(dir, &h) {
                applog::write_line(self.log_path.as_ref(), "WARN", &format!("launch history not written: {e}"));
            }
        }
    }

    /// True the first time only: the app is entered once.
    pub fn take_entry(&self) -> bool {
        !self.entered.swap(true, Ordering::SeqCst)
    }

    pub fn entered(&self) -> bool {
        self.entered.load(Ordering::SeqCst)
    }

    /// A page finished loading. The first one after the app was entered,
    /// once the audio engine is up too, means this launch worked.
    pub fn page_loaded(&self) {
        if !self.entered() {
            return;
        }
        self.page_seen.store(true, Ordering::SeqCst);
        self.maybe_ready();
    }

    /// `start_app` finished: the audio engine and media controls are up.
    pub fn app_started(&self) {
        self.started.store(true, Ordering::SeqCst);
        self.maybe_ready();
    }

    fn maybe_ready(&self) {
        if self.started.load(Ordering::SeqCst) && self.page_seen.load(Ordering::SeqCst) && !self.ready.swap(true, Ordering::SeqCst) {
            self.mark(Stage::Ready);
        }
    }

    pub fn history(&self) -> LaunchHistory {
        self.history.lock().map(|h| h.clone()).unwrap_or_default()
    }

    fn set_view(&self, app: &AppHandle, view: View) {
        if let Ok(mut v) = self.view.lock() {
            *v = Some(view.clone());
        }
        let _ = app.emit("gate:state", view);
    }
}

#[tauri::command]
pub fn gate_state(gate: tauri::State<'_, Arc<Gate>>) -> Option<View> {
    gate.view.lock().ok().and_then(|v| v.clone())
}

#[tauri::command]
pub fn gate_not_now(gate: tauri::State<'_, Arc<Gate>>) {
    gate.send(Input::NotNow);
}

#[tauri::command]
pub fn gate_update_now(gate: tauri::State<'_, Arc<Gate>>) {
    gate.send(Input::UpdateNow);
}

#[tauri::command]
pub fn gate_quit(gate: tauri::State<'_, Arc<Gate>>) {
    gate.send(Input::Quit);
}

/// The gate's telemetry since it was last asked, for the signed-in page to
/// forward to /api/native-log (apps/web/lib/desktopGateEvents.ts).
#[tauri::command]
pub fn update_gate_events(gate: tauri::State<'_, Arc<Gate>>) -> Vec<GateEvent> {
    gate.dir.as_deref().map(take_events).unwrap_or_default()
}

/// What `run` needs from the rest of the app.
pub struct GateRun {
    pub server: Url,
    pub version: String,
    pub recovery: bool,
    pub background: Option<String>,
    /// Opens the app: the audio engine, the server page, the rest.
    pub enter_app: Arc<dyn Fn() + Send + Sync>,
}

/// Runs the gate to its end. Spawned from `setup`.
pub async fn run(app: AppHandle, gate: Arc<Gate>, opts: GateRun) {
    use tauri_plugin_updater::UpdaterExt;

    let (tx, mut rx) = mpsc::unbounded_channel::<Input>();
    if let Ok(mut slot) = gate.tx.lock() {
        *slot = Some(tx.clone());
    }
    let kind = install_kind();
    let asks_password = install_asks_password(kind);
    let budget = if opts.recovery { RECOVERY_BUDGET } else { CHECK_BUDGET };
    if opts.recovery {
        gate.event("update.gate.recovery", json!({ "budgetMs": budget.as_millis() as u64 }));
    }

    let started = Instant::now();
    let (offer, result) = match check_url(&opts.server, &opts.version, kind) {
        Some(url) => quick_check(&url, &opts.version, budget).await,
        None => (None, CheckResult::Error),
    };
    gate.event(
        "update.gate.check",
        json!({ "ms": started.elapsed().as_millis() as u64, "result": result.as_str(), "install": kind }),
    );

    let dir = crate::update::update_dir(&app);
    let staged = match (&offer, dir.as_deref()) {
        (Some(o), Some(d)) => crate::update::staged_version(d).as_deref() == Some(o.version.as_str()),
        _ => false,
    };
    let focused = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    let mut machine = Machine::new(opts.recovery, focused, asks_password);
    let mut effects = machine.handle(Input::Checked { offer, staged });

    // The updater's own view of the release (its signature and download
    // URL), fetched once the dialog is up.
    let update: Arc<tokio::sync::Mutex<Option<tauri_plugin_updater::Update>>> = Arc::new(tokio::sync::Mutex::new(None));
    let mut ticker = tokio::time::interval(Duration::from_secs(1));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    ticker.tick().await;
    let mut was_counting = false;

    loop {
        for effect in std::mem::take(&mut effects) {
            match effect {
                Effect::EnterApp => {
                    if gate.take_entry() {
                        (opts.enter_app)();
                    }
                }
                Effect::Event(name, data) => gate.event(name, data),
                Effect::Linger => {
                    let tx = tx.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(FAILED_LINGER).await;
                        let _ = tx.send(Input::FailedTimeout);
                    });
                }
                Effect::OpenUrl(url) => {
                    if let Err(e) = crate::external::open_external(url) {
                        gate.event("update.gate.failed", json!({ "stage": "open-page", "error": e }));
                    }
                }
                Effect::Quit => {
                    gate.mark(Stage::Clean);
                    app.exit(0);
                }
                Effect::StartDownload => {
                    gate.downloading.store(true, Ordering::SeqCst);
                    let (app, tx, update, gate, dir) = (app.clone(), tx.clone(), update.clone(), gate.clone(), dir.clone());
                    tauri::async_runtime::spawn(async move {
                        let ok = download(&app, &tx, &update, dir.as_deref()).await;
                        if let Err(e) = &ok {
                            gate.event("update.gate.failed", json!({ "stage": "download", "error": e }));
                        }
                        let _ = tx.send(if ok.is_ok() { Input::Downloaded } else { Input::DownloadFailed });
                    });
                }
                Effect::Install => {
                    let (app, tx, update, gate, dir) = (app.clone(), tx.clone(), update.clone(), gate.clone(), dir.clone());
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = install(&app, &gate, &update, dir.as_deref()).await {
                            gate.event("update.gate.failed", json!({ "stage": "install", "error": e }));
                            let _ = tx.send(Input::InstallFailed);
                        }
                    });
                }
            }
        }
        gate.set_view(&app, View::of(&machine, asks_password, opts.background.clone()));
        if machine.phase == Phase::Done {
            break;
        }
        // A countdown starts on a fresh second, so "Restarting in 7s" is
        // shown for a whole second.
        let counting = matches!(machine.phase, Phase::Countdown { .. });
        if counting && !was_counting {
            ticker.reset();
        }
        was_counting = counting;
        let input = tokio::select! {
            Some(input) = rx.recv() => input,
            _ = ticker.tick() => Input::Tick,
        };
        effects = machine.handle(input);
    }
    // Done: the app is open (a download the person left carries on and is
    // kept by its own task) or it is quitting.
    if let Ok(mut slot) = gate.tx.lock() {
        *slot = None;
    }

    /// The updater's feed and the download, kept on disk as it lands so
    /// "Not now" does not lose it.
    async fn download(
        app: &AppHandle,
        tx: &mpsc::UnboundedSender<Input>,
        slot: &tokio::sync::Mutex<Option<tauri_plugin_updater::Update>>,
        dir: Option<&Path>,
    ) -> Result<(), String> {
        let update = fetch_update(app, slot).await?;
        let mut done: u64 = 0;
        let mut shown: Option<u8> = None;
        let bytes = update
            .download(
                |chunk, total| {
                    done += chunk as u64;
                    let pct = total.filter(|t| *t > 0).map(|t| ((done * 100) / t).min(100) as u8);
                    if pct != shown {
                        shown = pct;
                        let _ = tx.send(Input::Progress(pct));
                    }
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
        let dir = dir.ok_or("no app data folder")?;
        crate::update::stage(dir, &update.version, &bytes).map_err(|e| e.to_string())
    }

    async fn fetch_update(
        app: &AppHandle,
        slot: &tokio::sync::Mutex<Option<tauri_plugin_updater::Update>>,
    ) -> Result<tauri_plugin_updater::Update, String> {
        let mut slot = slot.lock().await;
        if let Some(u) = slot.as_ref() {
            return Ok(u.clone());
        }
        let updater = app.updater_builder().timeout(FEED_TIMEOUT).build().map_err(|e| e.to_string())?;
        let update = updater.check().await.map_err(|e| e.to_string())?.ok_or("the update feed has no update")?;
        *slot = Some(update.clone());
        Ok(update)
    }

    /// Verifies the kept copy against the release's signature and hands it
    /// to the installer. On Windows the installer quits this process and
    /// starts the new version; elsewhere this restarts the app.
    async fn install(
        app: &AppHandle,
        gate: &Gate,
        slot: &tokio::sync::Mutex<Option<tauri_plugin_updater::Update>>,
        dir: Option<&Path>,
    ) -> Result<(), String> {
        let update = fetch_update(app, slot).await?;
        let dir = dir.ok_or("no app data folder")?;
        if crate::update::staged_version(dir).as_deref() != Some(update.version.as_str()) {
            return Err(format!("no kept copy of {}", update.version));
        }
        let bytes = crate::update::staged_bytes(dir).map_err(|e| e.to_string())?;
        let key = crate::update::pubkey(app).ok_or("no updater pubkey")?;
        if let Err(e) = crate::update::verify(&bytes, &update.signature, &key) {
            crate::update::clear(dir);
            return Err(format!("kept copy failed its signature check: {e}"));
        }
        // Handing over is not a crash, whatever happens to the process next.
        gate.mark(Stage::Clean);
        let dir_owned = dir.to_path_buf();
        // pkexec and the installers block: off the async workers.
        let installed = tauri::async_runtime::spawn_blocking(move || update.install(bytes))
            .await
            .map_err(|e| e.to_string())?;
        installed.map_err(|e| e.to_string())?;
        crate::update::clear(&dir_owned);
        app.restart();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The window starts on a page bundled with the app, and that page
    /// speaks the gate's commands and event.
    #[test]
    fn the_gate_page_is_bundled() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).expect("conf");
        let dist = conf["build"]["frontendDist"].as_str().expect("build.frontendDist");
        let page = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(dist).join(crate::GATE_PAGE);
        let html = std::fs::read_to_string(&page).expect("the bundled gate page");
        for needle in ["gate:state", "gate_state", "gate_not_now", "gate_update_now", "gate_quit", "Restarting in ", "Quit Ember", "Not now", "Update now"] {
            assert!(html.contains(needle), "gate.html has no {needle}");
        }
        assert!(!html.contains('\u{2014}'), "no em dashes in the copy");
    }

    fn offer(version: &str) -> Offer {
        Offer { version: version.into(), mandatory: false, reason: None, download_page: false, url: None }
    }

    fn required(version: &str) -> Offer {
        Offer { mandatory: true, reason: Some("min-version".into()), ..offer(version) }
    }

    fn shown(m: &mut Machine, o: Offer, staged: bool) -> Vec<Effect> {
        m.handle(Input::Checked { offer: Some(o), staged })
    }

    fn has(effects: &[Effect], want: &Effect) -> bool {
        effects.iter().any(|e| e == want)
    }

    fn event_names(effects: &[Effect]) -> Vec<&'static str> {
        effects.iter().filter_map(|e| if let Effect::Event(n, _) = e { Some(*n) } else { None }).collect()
    }

    // --- The check -----------------------------------------------------------

    #[test]
    fn no_update_timeout_or_error_opens_the_app() {
        // quick_check turns a timeout and an error into "no offer" too.
        let mut m = Machine::new(false, true, false);
        assert_eq!(m.handle(Input::Checked { offer: None, staged: false }), vec![Effect::EnterApp]);
        assert_eq!(m.phase, Phase::Done);
    }

    #[test]
    fn an_update_starts_the_download_with_the_dialog_up() {
        let mut m = Machine::new(false, true, false);
        let fx = shown(&mut m, offer("0.5.0"), false);
        assert!(has(&fx, &Effect::StartDownload));
        assert_eq!(event_names(&fx), vec!["update.gate.shown"]);
        assert_eq!(m.phase, Phase::Downloading { percent: None });
    }

    #[test]
    fn a_kept_copy_goes_straight_to_the_countdown() {
        let mut m = Machine::new(false, true, false);
        let fx = shown(&mut m, offer("0.5.0"), true);
        assert!(!has(&fx, &Effect::StartDownload));
        assert_eq!(m.phase, Phase::Countdown { seconds: COUNTDOWN_S, held: false });
    }

    #[test]
    fn the_countdown_is_seven_seconds_then_installs() {
        assert_eq!(COUNTDOWN_S, 7);
        let mut m = Machine::new(false, true, false);
        shown(&mut m, offer("0.5.0"), true);
        for left in (1..COUNTDOWN_S).rev() {
            assert!(m.handle(Input::Tick).is_empty());
            assert_eq!(m.phase, Phase::Countdown { seconds: left, held: false });
        }
        let fx = m.handle(Input::Tick);
        assert!(has(&fx, &Effect::Install));
        assert_eq!(m.phase, Phase::Installing);
    }

    #[test]
    fn progress_then_download_done_starts_the_countdown() {
        let mut m = Machine::new(false, true, false);
        shown(&mut m, offer("0.5.0"), false);
        m.handle(Input::Progress(Some(42)));
        assert_eq!(m.phase, Phase::Downloading { percent: Some(42) });
        m.handle(Input::Progress(Some(250)));
        assert_eq!(m.phase, Phase::Downloading { percent: Some(100) });
        m.handle(Input::Downloaded);
        assert_eq!(m.phase, Phase::Countdown { seconds: COUNTDOWN_S, held: false });
    }

    // --- The person's choice -------------------------------------------------

    #[test]
    fn not_now_opens_the_app_from_the_download_and_the_countdown() {
        for staged in [false, true] {
            let mut m = Machine::new(false, true, false);
            shown(&mut m, offer("0.5.0"), staged);
            let fx = m.handle(Input::NotNow);
            assert!(has(&fx, &Effect::EnterApp));
            assert_eq!(event_names(&fx), vec!["update.gate.cancel"]);
            assert_eq!(m.phase, Phase::Done);
        }
    }

    #[test]
    fn a_download_left_with_not_now_does_not_reopen_the_dialog() {
        let mut m = Machine::new(false, true, false);
        shown(&mut m, offer("0.5.0"), false);
        m.handle(Input::NotNow);
        assert!(m.handle(Input::Downloaded).is_empty());
        assert!(m.handle(Input::Tick).is_empty());
        assert_eq!(m.phase, Phase::Done);
    }

    #[test]
    fn update_now_in_the_countdown_installs_at_once() {
        let mut m = Machine::new(false, true, false);
        shown(&mut m, offer("0.5.0"), true);
        assert!(has(&m.handle(Input::UpdateNow), &Effect::Install));
    }

    #[test]
    fn update_now_during_the_download_installs_as_soon_as_it_is_in() {
        let mut m = Machine::new(false, true, false);
        shown(&mut m, offer("0.5.0"), false);
        assert!(m.handle(Input::UpdateNow).is_empty());
        assert!(m.update_now);
        assert!(has(&m.handle(Input::Downloaded), &Effect::Install));
    }

    #[test]
    fn nothing_can_be_cancelled_once_installing() {
        let mut m = Machine::new(false, true, false);
        shown(&mut m, offer("0.5.0"), true);
        m.handle(Input::UpdateNow);
        assert!(m.handle(Input::NotNow).is_empty());
        assert!(m.handle(Input::Focus(false)).is_empty());
        assert_eq!(m.phase, Phase::Installing);
    }

    // --- Focus: never install while the person is somewhere else ------------

    #[test]
    fn leaving_the_window_opens_the_app_instead_of_installing() {
        for staged in [false, true] {
            let mut m = Machine::new(false, true, false);
            shown(&mut m, offer("0.5.0"), staged);
            let fx = m.handle(Input::Focus(false));
            assert!(has(&fx, &Effect::EnterApp));
            if let Some(Effect::Event(_, data)) = fx.first() {
                assert_eq!(data["focusLost"], true);
            }
        }
    }

    #[test]
    fn a_countdown_that_ends_unfocused_does_not_install() {
        // Never focused at all (opened behind another window).
        let mut m = Machine::new(false, false, false);
        shown(&mut m, offer("0.5.0"), true);
        let fx = m.handle(Input::Tick);
        assert!(!has(&fx, &Effect::Install));
        assert!(has(&fx, &Effect::EnterApp));
    }

    // --- Required updates ------------------------------------------------------

    #[test]
    fn a_required_update_has_no_not_now() {
        let mut m = Machine::new(false, true, false);
        shown(&mut m, required("0.5.0"), false);
        assert!(m.handle(Input::NotNow).is_empty());
        assert_eq!(m.phase, Phase::Downloading { percent: None });
    }

    #[test]
    fn quit_ember_quits_a_required_update_and_only_that() {
        let mut m = Machine::new(false, true, false);
        shown(&mut m, required("0.5.0"), false);
        assert!(has(&m.handle(Input::Quit), &Effect::Quit));

        let mut optional = Machine::new(false, true, false);
        shown(&mut optional, offer("0.5.0"), false);
        assert!(optional.handle(Input::Quit).is_empty());
    }

    #[test]
    fn a_required_update_waits_for_the_person_to_come_back() {
        let mut m = Machine::new(false, true, false);
        shown(&mut m, required("0.5.0"), true);
        m.handle(Input::Tick);
        assert!(m.handle(Input::Focus(false)).is_empty());
        assert_eq!(m.phase, Phase::Countdown { seconds: COUNTDOWN_S, held: true });
        for _ in 0..20 {
            assert!(!has(&m.handle(Input::Tick), &Effect::Install));
        }
        m.handle(Input::Focus(true));
        assert_eq!(m.phase, Phase::Countdown { seconds: COUNTDOWN_S, held: false });
        let mut installed = false;
        for _ in 0..COUNTDOWN_S {
            installed |= has(&m.handle(Input::Tick), &Effect::Install);
        }
        assert!(installed);
    }

    #[test]
    fn a_failed_update_opens_the_app_even_when_required() {
        for o in [offer("0.5.0"), required("0.5.0")] {
            let mut m = Machine::new(false, true, false);
            shown(&mut m, o, false);
            let fx = m.handle(Input::DownloadFailed);
            assert!(has(&fx, &Effect::Linger));
            assert_eq!(m.phase, Phase::Failed);
            assert!(has(&m.handle(Input::FailedTimeout), &Effect::EnterApp));
        }
    }

    // --- Recovery --------------------------------------------------------------

    #[test]
    fn a_recovery_launch_keeps_not_now() {
        let mut m = Machine::new(true, true, false);
        let fx = shown(&mut m, offer("0.5.0"), false);
        if let Some(Effect::Event(_, data)) = fx.first() {
            assert_eq!(data["recovery"], true);
        }
        assert!(has(&m.handle(Input::NotNow), &Effect::EnterApp));
        assert_eq!(RECOVERY_BUDGET, Duration::from_secs(8));
        assert_eq!(CHECK_BUDGET, Duration::from_millis(1500));
    }

    // --- .deb / .rpm --------------------------------------------------------------

    #[test]
    fn a_download_page_offer_shows_the_manual_notice() {
        let mut m = Machine::new(false, true, true);
        let o = Offer { download_page: true, url: Some("https://ember.test/get".into()), ..offer("0.5.0") };
        let fx = shown(&mut m, o, false);
        assert!(!has(&fx, &Effect::StartDownload));
        assert_eq!(m.phase, Phase::Manual { url: Some("https://ember.test/get".into()) });
        let fx = m.handle(Input::UpdateNow);
        assert_eq!(fx, vec![Effect::OpenUrl("https://ember.test/get".into()), Effect::EnterApp]);
    }

    #[test]
    fn a_deb_that_will_not_install_falls_back_to_the_download_page() {
        let mut m = Machine::new(false, true, true);
        let o = Offer { url: Some("https://ember.test/get".into()), ..offer("0.5.0") };
        shown(&mut m, o, true);
        m.handle(Input::UpdateNow);
        m.handle(Input::InstallFailed);
        assert_eq!(m.phase, Phase::Manual { url: Some("https://ember.test/get".into()) });
        assert!(has(&m.handle(Input::NotNow), &Effect::EnterApp));
    }

    #[test]
    fn any_other_failed_install_says_so_and_opens_the_app() {
        let mut m = Machine::new(false, true, false);
        shown(&mut m, offer("0.5.0"), true);
        m.handle(Input::UpdateNow);
        let fx = m.handle(Input::InstallFailed);
        assert!(has(&fx, &Effect::Linger));
        assert_eq!(m.phase, Phase::Failed);
    }

    // --- The server's answer -----------------------------------------------------

    #[test]
    fn reads_the_servers_answer() {
        let body = r#"{"platform":"macos","current":"0.4.21","latest":"0.4.22","update":{"version":"0.4.22","mandatory":true,"reason":"flagged","action":"install","size":1,"notes":"x","url":null},"checkAfter":21600}"#;
        assert_eq!(
            parse_answer(body, "0.4.21"),
            Some(Offer { version: "0.4.22".into(), mandatory: true, reason: Some("flagged".into()), download_page: false, url: None })
        );
        assert_eq!(parse_answer(r#"{"update":null}"#, "0.4.21"), None);
        assert_eq!(parse_answer("not json", "0.4.21"), None);
    }

    #[test]
    fn ignores_an_offer_that_is_not_newer() {
        let body = |v: &str| format!(r#"{{"update":{{"version":"{v}","action":"install"}}}}"#);
        assert_eq!(parse_answer(&body("0.4.21"), "0.4.21"), None);
        assert_eq!(parse_answer(&body("0.4.2"), "0.4.21"), None);
        assert_eq!(parse_answer(&body("banana"), "0.4.21"), None);
        assert!(parse_answer(&body("0.4.22"), "0.4.21").is_some());
    }

    #[test]
    fn a_download_page_must_be_a_web_link() {
        let body = |url: &str| format!(r#"{{"update":{{"version":"0.5.0","action":"download-page","url":"{url}"}}}}"#);
        assert!(parse_answer(&body("https://ember.test/api/desktop/asset/5"), "0.4.0").is_some());
        assert_eq!(parse_answer(&body("file:///etc/passwd"), "0.4.0"), None);
        assert_eq!(parse_answer(r#"{"update":{"version":"0.5.0","action":"store"}}"#, "0.4.0"), None);
    }

    #[test]
    fn the_check_url_names_this_shell() {
        let url = check_url(&Url::parse("https://ember.test/").unwrap(), "0.4.21", "nsis").unwrap();
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(url.path(), "/api/app/update");
        assert_eq!(q["platform"], platform());
        assert_eq!(q["version"], "0.4.21");
        assert_eq!(q["install"], "nsis");
        assert_eq!(q["launch"], "1");
        assert_eq!(q["arch"], std::env::consts::ARCH);
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
    fn only_deb_and_rpm_ask_for_a_password() {
        assert!(install_asks_password("deb"));
        assert!(install_asks_password("rpm"));
        for k in ["nsis", "msi", "appimage", "app", "unknown"] {
            assert!(!install_asks_password(k), "{k}");
        }
    }

    // --- quick_check against a real socket ----------------------------------------

    fn serve_once(status: &'static str, body: &'static str, delay: Duration) -> Url {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
        std::thread::spawn(move || {
            if let Some(Ok(mut stream)) = listener.incoming().next() {
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
                        break;
                    }
                }
                std::thread::sleep(delay);
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            }
        });
        url
    }

    #[tokio::test]
    async fn quick_check_reads_an_update() {
        let url = serve_once("200 OK", r#"{"update":{"version":"9.0.0","action":"install"}}"#, Duration::ZERO);
        let (offer, result) = quick_check(&url, "0.4.21", Duration::from_millis(1500)).await;
        assert_eq!(result, CheckResult::Update);
        assert_eq!(offer.unwrap().version, "9.0.0");
    }

    #[tokio::test]
    async fn quick_check_gives_up_within_the_budget() {
        let url = serve_once("200 OK", r#"{"update":null}"#, Duration::from_secs(5));
        let started = Instant::now();
        let (offer, result) = quick_check(&url, "0.4.21", Duration::from_millis(300)).await;
        assert!(offer.is_none());
        assert_eq!(result, CheckResult::Timeout);
        assert!(started.elapsed() < Duration::from_millis(1500), "{:?}", started.elapsed());
    }

    #[tokio::test]
    async fn quick_check_treats_errors_and_429_as_no_update() {
        let url = serve_once("429 Too Many Requests", "{}", Duration::ZERO);
        assert_eq!(quick_check(&url, "0.4.21", Duration::from_millis(1500)).await.1, CheckResult::None);
        let closed = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            Url::parse(&format!("http://{}/", l.local_addr().unwrap())).unwrap()
        };
        let (offer, result) = quick_check(&closed, "0.4.21", Duration::from_millis(1500)).await;
        assert!(offer.is_none());
        assert_ne!(result, CheckResult::Update);
    }

    // --- Launch history ------------------------------------------------------------

    fn history(stage: Stage, in_gate: u32, after_gate: u32) -> LaunchHistory {
        LaunchHistory { stage, failed_in_gate: in_gate, failed_after_gate: after_gate, last_version: Some("0.4.21".into()) }
    }

    #[test]
    fn a_launch_after_a_good_one_is_normal() {
        let (next, mode, from) = on_launch(&history(Stage::Ready, 0, 0), "0.4.21");
        assert_eq!(mode, LaunchMode::Normal);
        assert_eq!(next.stage, Stage::Starting);
        assert_eq!(from, None);
        assert_eq!(on_launch(&LaunchHistory::default(), "0.4.21").1, LaunchMode::Normal);
    }

    #[test]
    fn two_launches_that_died_after_the_gate_make_a_recovery_launch() {
        let (h1, mode, _) = on_launch(&history(Stage::Gated, 0, 0), "0.4.21");
        assert_eq!(mode, LaunchMode::Normal);
        let h1 = reached(&h1, Stage::Gated);
        let (_, mode, _) = on_launch(&h1, "0.4.21");
        assert_eq!(mode, LaunchMode::Recovery);
    }

    #[test]
    fn two_launches_that_died_in_the_gate_skip_it_the_third_time() {
        let (h1, _, _) = on_launch(&history(Stage::Starting, 0, 0), "0.4.21");
        assert_eq!(h1.failed_in_gate, 1);
        let (h2, mode, _) = on_launch(&h1, "0.4.21");
        assert_eq!(h2.failed_in_gate, 2);
        assert_eq!(mode, LaunchMode::SkipGate);
    }

    #[test]
    fn a_launch_that_got_going_clears_the_count() {
        let h = reached(&history(Stage::Starting, 1, 1), Stage::Ready);
        assert_eq!((h.failed_in_gate, h.failed_after_gate), (0, 0));
        let (_, mode, _) = on_launch(&h, "0.4.21");
        assert_eq!(mode, LaunchMode::Normal);
    }

    #[test]
    fn quitting_on_purpose_is_not_a_failure() {
        let (next, mode, _) = on_launch(&history(Stage::Clean, 1, 1), "0.4.21");
        assert_eq!(mode, LaunchMode::Normal);
        assert_eq!((next.failed_in_gate, next.failed_after_gate), (1, 1));
    }

    #[test]
    fn notices_that_an_update_went_in() {
        let (next, _, from) = on_launch(&history(Stage::Clean, 0, 0), "0.4.22");
        assert_eq!(from.as_deref(), Some("0.4.21"));
        assert_eq!(next.last_version.as_deref(), Some("0.4.22"));
        assert_eq!(on_launch(&history(Stage::Ready, 0, 0), "0.4.20").2, None, "a downgrade is not an update");
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ember-gate-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn the_history_survives_a_restart_and_a_bad_file_is_a_fresh_start() {
        let dir = scratch("history");
        assert_eq!(load_history(&dir), LaunchHistory::default());
        let h = history(Stage::Gated, 0, 1);
        store_history(&dir, &h).unwrap();
        assert_eq!(load_history(&dir), h);
        std::fs::write(dir.join(HISTORY_FILE), "{broken").unwrap();
        assert_eq!(load_history(&dir), LaunchHistory::default());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_launch_is_ready_once_the_app_started_and_a_page_loaded_in_either_order() {
        for page_first in [false, true] {
            let dir = scratch(&format!("ready-{page_first}"));
            let gate = Gate::new(Some(dir.clone()), on_launch(&LaunchHistory::default(), "0.4.21").0, None);
            gate.page_loaded();
            assert_eq!(gate.history().stage, Stage::Starting, "the gate page itself does not count");
            assert!(gate.take_entry());
            assert!(!gate.take_entry(), "the app is entered once");
            gate.mark(Stage::Gated);
            if page_first {
                gate.page_loaded();
                assert_eq!(gate.history().stage, Stage::Gated);
                gate.app_started();
            } else {
                gate.app_started();
                assert_eq!(gate.history().stage, Stage::Gated);
                gate.page_loaded();
            }
            assert_eq!(gate.history().stage, Stage::Ready);
            assert_eq!(load_history(&dir).stage, Stage::Ready, "written to disk");
            let _ = std::fs::remove_dir_all(&dir);
        }
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

    #[test]
    fn the_view_is_what_the_page_reads() {
        let mut m = Machine::new(false, true, false);
        shown(&mut m, required("0.5.0"), true);
        let v = serde_json::to_value(View::of(&m, false, Some("#101014".into()))).unwrap();
        assert_eq!(v["phase"], "countdown");
        assert_eq!(v["seconds"], COUNTDOWN_S);
        assert_eq!(v["held"], false);
        assert_eq!(v["version"], "0.5.0");
        assert_eq!(v["mandatory"], true);
        assert_eq!(v["reason"], "min-version");
        assert_eq!(v["updateNow"], false);
        assert_eq!(v["asksPassword"], false);
        assert_eq!(v["background"], "#101014");
        let mut d = Machine::new(false, true, false);
        shown(&mut d, offer("0.5.0"), false);
        d.handle(Input::Progress(Some(3)));
        let v = serde_json::to_value(View::of(&d, false, None)).unwrap();
        assert_eq!(v["phase"], "downloading");
        assert_eq!(v["percent"], 3);
    }
}
