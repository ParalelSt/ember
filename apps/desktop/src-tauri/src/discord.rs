// Per-user Discord Rich Presence for the DESKTOP app.
//
// Discord's IPC socket is local to the machine running Discord, so the web
// server can only ever set the HOST's status. Here each listener's own Discord
// shows what they are playing, because this runs on their machine.
//
// App id resolution: DISCORD_APP_ID at runtime, else the value baked in at
// build time, else disabled (silent no-op: exactly like the server side).
//
// The card carries a time bar (Listening + start/end timestamps), so every
// update needs the real playhead: `start = received - position`. That is also why
// updates cannot simply be dropped when they come too fast for Discord: a
// seek that gets dropped leaves the bar lying. Same-track updates inside the
// rate-limit window are kept as `pending` and flushed once the window ends, so
// the newest state always lands.

use std::sync::{mpsc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Runtime};

use discord_rich_presence::{
    activity::{Activity, ActivityType, Assets, Timestamps},
    DiscordIpc, DiscordIpcClient,
};

/// Discord rejects presence updates faster than ~1 per 15s.
const RATE_LIMIT_MS: u128 = 15_000;

/// One "now playing" snapshot, ready to become an activity.
#[derive(Clone, Debug)]
struct Presence {
    title: String,
    artist: String,
    album: Option<String>,
    artwork_url: Option<String>,
    position_sec: f64,
    duration_sec: f64,
    /// When the webview sent it. The playhead is true AT this moment, and an
    /// update can wait out the rate-limit window before it is sent.
    received_ms: u128,
}

impl Presence {
    fn key(&self) -> String {
        format!("{}|{}", self.title, self.artist)
    }

    /// Discord's start/end, in unix seconds: the bar is drawn from wall-clock
    /// timestamps, so "start" is when the song would have begun for the
    /// playhead to be where it is. Taken from when the update was RECEIVED,
    /// not when it is sent: a queued one used to be anchored to the flush,
    /// which left the bar behind by however long it had waited (up to 15s).
    fn timestamps(&self) -> (i64, Option<i64>) {
        let received_sec = (self.received_ms / 1000) as i64;
        let started = received_sec - self.position_sec.round() as i64;
        let end = (self.duration_sec > 0.0).then(|| started + self.duration_sec.round() as i64);
        (started, end)
    }
}

#[derive(Default)]
pub struct DiscordState {
    client: Option<DiscordIpcClient>,
    connected: bool,
    last_update_ms: u128,
    last_key: String,
    /// The newest update that arrived inside the rate-limit window. Only the
    /// latest matters: a seek supersedes the seek before it.
    pending: Option<Presence>,
    flush_scheduled: bool,
    /// "no app id" has been logged: it is said once per run, not per update.
    no_app_id_logged: bool,
}

impl DiscordState {
    /// True the first time only.
    fn first_no_app_id(&mut self) -> bool {
        !std::mem::replace(&mut self.no_app_id_logged, true)
    }
}

pub struct DiscordPresence(pub Mutex<DiscordState>, Worker);

impl Default for DiscordPresence {
    fn default() -> Self {
        DiscordPresence(Mutex::new(DiscordState::default()), Worker::default())
    }
}

type Job = Box<dyn FnOnce() + Send>;

/// The one thread that talks to Discord, so a Discord that is slow to answer
/// holds up nobody else. Updates run there in the order they came in.
#[derive(Default)]
struct Worker(Mutex<Option<mpsc::Sender<Job>>>);

impl Worker {
    /// Queues `job`, starting the thread on first use (and again should it
    /// ever have gone away).
    fn run(&self, job: Job) {
        let Ok(mut slot) = self.0.lock() else { return };
        let job = match slot.as_ref() {
            Some(tx) => match tx.send(job) {
                Ok(()) => return,
                Err(mpsc::SendError(job)) => job,
            },
            None => job,
        };
        let (tx, rx) = mpsc::channel::<Job>();
        let spawned = std::thread::Builder::new().name("ember-discord".into()).spawn(move || {
            for job in rx {
                job();
            }
        });
        if spawned.is_err() {
            *slot = None;
            return;
        }
        let _ = tx.send(job);
        *slot = Some(tx);
    }
}

fn app_id() -> Option<String> {
    if let Ok(id) = std::env::var("DISCORD_APP_ID") {
        if !id.trim().is_empty() {
            return Some(id);
        }
    }
    option_env!("DISCORD_APP_ID")
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
}

/// Presence bugs are "the card shows the wrong song" with nothing to go on.
/// Every decision here is one line in the desktop log, next to the audio
/// loads it should line up with.
fn log_discord<R: Runtime>(app: &AppHandle<R>, msg: &str) {
    use tauri::Manager;
    if let Some(state) = app.try_state::<crate::applog::LogFile>() {
        if let Ok(path) = state.0.lock() {
            crate::applog::write_line(path.as_ref(), "INFO", &format!("discord: {msg}"));
        }
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn trim(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    s.chars().take(max.saturating_sub(1)).collect::<String>() + "…"
}

/// What the webview asked `discord_update` for, and when.
struct Update {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    artwork_url: Option<String>,
    is_playing: bool,
    position_sec: Option<f64>,
    duration_sec: Option<f64>,
    received_ms: u128,
}

/// Publish (or clear) the current track on the user's own Discord.
/// Every failure path is a no-op: Discord not running, not installed, or no
/// app id configured must never disturb playback.
///
/// A sync command runs on the window's main thread, and connecting waits for
/// Discord to answer with no time limit, so the work goes to `Worker`.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // the webview's invoke arguments, one each
pub fn discord_update<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, DiscordPresence>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    artwork_url: Option<String>,
    is_playing: bool,
    position_sec: Option<f64>,
    duration_sec: Option<f64>,
) {
    // The playhead is true now, however long the update waits to go out.
    let update = Update {
        title,
        artist,
        album,
        artwork_url,
        is_playing,
        position_sec,
        duration_sec,
        received_ms: now_ms(),
    };
    let worker_app = app.clone();
    state.1.run(Box::new(move || apply(&worker_app, update)));
}

/// `discord_update`, on the Discord thread.
fn apply<R: Runtime>(app: &AppHandle<R>, update: Update) {
    use tauri::Manager;
    let Some(state) = app.try_state::<DiscordPresence>() else { return };
    let Update { title, artist, album, artwork_url, is_playing, position_sec, duration_sec, received_ms } = update;
    let Some(app_id) = app_id() else {
        if state.0.lock().map(|mut st| st.first_no_app_id()).unwrap_or(false) {
            log_discord(app, "no app id: presence disabled");
        }
        return;
    };
    let Ok(mut st) = state.0.lock() else { return };

    // Nothing playing → clear and keep the connection warm. A pending seek
    // for a paused song is moot; resuming republishes from scratch.
    if !is_playing || title.is_none() {
        st.pending = None;
        let mut result = "skipped (not connected)";
        if st.connected {
            if let Some(c) = st.client.as_mut() {
                result = if c.clear_activity().is_ok() { "cleared" } else { "clear FAILED" };
            }
        }
        log_discord(app, &format!("update playing=false title={:?} -> {result}", title));
        st.last_key.clear();
        return;
    }

    let presence = Presence {
        title: title.unwrap_or_default(),
        artist: artist.unwrap_or_default(),
        album,
        artwork_url,
        position_sec: position_sec.unwrap_or(0.0).max(0.0),
        duration_sec: duration_sec.unwrap_or(0.0).max(0.0),
        received_ms,
    };
    let key = presence.key();
    let same_track = key == st.last_key;
    let now = presence.received_ms;
    let since_last = now.saturating_sub(st.last_update_ms);

    // Repeats of the SAME track (seeks, resumes) wait out the window; a track
    // change always goes through, and makes any pending seek obsolete.
    if same_track && since_last < RATE_LIMIT_MS {
        let wait = (RATE_LIMIT_MS - since_last) as u64;
        st.pending = Some(presence);
        log_discord(app, &format!("update {key:?} pos={:.1} -> queued ({wait}ms)", position_sec.unwrap_or(0.0)));
        if !st.flush_scheduled {
            st.flush_scheduled = true;
            schedule_flush(app.clone(), wait);
        }
        return;
    }
    st.pending = None;

    send(&mut st, app, &app_id, presence);
}

/// What the flush timer does when it wakes.
#[derive(Debug, PartialEq, Eq)]
enum Flush {
    /// Nothing is waiting (a track change or a pause sent or dropped it).
    Nothing,
    /// The window is not over yet: sleep this much longer.
    Wait(u64),
    Send,
}

/// The window is counted from the LAST send, not from when the timer was
/// set: a track change goes out at once in between, and a seek in the new
/// song queued behind that timer used to go out with it, seconds after the
/// track change, inside the window Discord drops updates in.
fn flush_due(st: &DiscordState, now: u128) -> Flush {
    if st.pending.is_none() {
        return Flush::Nothing;
    }
    let since = now.saturating_sub(st.last_update_ms);
    if since < RATE_LIMIT_MS {
        Flush::Wait((RATE_LIMIT_MS - since) as u64)
    } else {
        Flush::Send
    }
}

/// Wake up when the rate-limit window has passed and send whatever is newest.
fn schedule_flush<R: Runtime>(app: AppHandle<R>, wait_ms: u64) {
    std::thread::spawn(move || {
        let mut wait = wait_ms;
        loop {
            std::thread::sleep(Duration::from_millis(wait));
            use tauri::Manager;
            let Some(state) = app.try_state::<DiscordPresence>() else { return };
            let Ok(mut st) = state.0.lock() else { return };
            match flush_due(&st, now_ms()) {
                Flush::Wait(ms) => wait = ms,
                Flush::Nothing => {
                    st.flush_scheduled = false;
                    return;
                }
                Flush::Send => {
                    st.flush_scheduled = false;
                    let Some(presence) = st.pending.take() else { return };
                    let Some(app_id) = app_id() else { return };
                    log_discord(&app, &format!("flush {:?} pos={:.1}", presence.key(), presence.position_sec));
                    send(&mut st, &app, &app_id, presence);
                    return;
                }
            }
        }
    });
}

/// One activity to Discord, connecting first if needed. Records the send time
/// and key whether or not Discord took it, so the throttle stays honest.
fn send<R: Runtime>(st: &mut DiscordState, app: &AppHandle<R>, app_id: &str, presence: Presence) {
    let key = presence.key();
    let now = now_ms();
    st.last_key = key.clone();
    st.last_update_ms = now;

    if st.client.is_none() {
        // v1.x: new() is infallible and returns the client directly.
        st.client = Some(DiscordIpcClient::new(app_id));
    }
    if !st.connected {
        if let Some(c) = st.client.as_mut() {
            // Discord closed / not installed: try again on the next update.
            if c.connect().is_err() {
                log_discord(app, &format!("update {key:?} -> connect FAILED"));
                return;
            }
            st.connected = true;
            log_discord(app, "connected to Discord");
        } else {
            return;
        }
    }

    let details = trim(&presence.title, 128);
    let state_line = if presence.artist.is_empty() {
        String::new()
    } else {
        trim(&format!("by {}", presence.artist), 128)
    };
    let large_text = trim(presence.album.as_deref().unwrap_or(&presence.title), 128);

    // Anchored to where the playhead is rather than to when the track was
    // first loaded: that is what makes a seek show up.
    let (started, end) = presence.timestamps();
    let mut timestamps = Timestamps::new().start(started);
    if let Some(end) = end {
        timestamps = timestamps.end(end);
    }

    // Scoped so the &mut borrow of st.client ends before we touch other fields.
    let failed = {
        let Some(client) = st.client.as_mut() else { return };

        let mut assets = Assets::new().large_text(&large_text);
        if let Some(url) = presence.artwork_url.as_deref() {
            if !url.is_empty() {
                assets = assets.large_image(url);
            }
        }
        let mut activity = Activity::new()
            .activity_type(ActivityType::Listening)
            .details(&details)
            .assets(assets)
            .timestamps(timestamps);
        if !state_line.is_empty() {
            activity = activity.state(&state_line);
        }
        client.set_activity(activity).is_err()
    };

    log_discord(app, &format!(
        "update {key:?} pos={:.1}/{:.0} -> {}",
        presence.position_sec,
        presence.duration_sec,
        if failed { "send FAILED" } else { "sent" }
    ));

    // A dropped socket (Discord quit) surfaces here: drop the client so the
    // next update reconnects instead of failing forever.
    if failed {
        st.connected = false;
        if let Some(c) = st.client.as_mut() {
            let _ = c.close();
        }
        st.client = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn presence(position_sec: f64, duration_sec: f64, received_ms: u128) -> Presence {
        Presence {
            title: "Second".into(),
            artist: "The Nulls".into(),
            album: None,
            artwork_url: None,
            position_sec,
            duration_sec,
            received_ms,
        }
    }

    fn secs(ms: u128) -> i64 {
        (ms / 1000) as i64
    }

    #[test]
    fn a_new_song_at_zero_starts_now() {
        let now = now_ms();
        let (start, end) = presence(0.0, 240.0, now).timestamps();
        assert_eq!(start, secs(now));
        assert_eq!(end, Some(secs(now) + 240));
    }

    #[test]
    fn a_seek_starts_the_bar_that_far_back() {
        let now = now_ms();
        let (start, _) = presence(60.0, 240.0, now).timestamps();
        assert_eq!(start, secs(now) - 60);
    }

    #[test]
    fn a_queued_update_keeps_the_moment_it_was_sent() {
        // A seek at 0:30, sent 15s ago and held back by the rate limit. When
        // it finally goes out the song is at 0:45, and the bar must say so:
        // anchoring it to the flush moment put the card 15s behind.
        let sent = now_ms() - u128::from(RATE_LIMIT_MS as u64);
        let (start, end) = presence(30.0, 240.0, sent).timestamps();
        assert_eq!(start, secs(sent) - 30);
        assert_eq!(end, Some(secs(sent) - 30 + 240));
    }

    #[test]
    fn a_seek_queued_after_a_track_change_waits_out_the_new_songs_window() {
        // A seek in song A queued a flush for 0:15. Song B went out at once
        // at 0:10, and a seek in B at 0:12 queued behind A's timer: at 0:15
        // it must wait until 0:25, 15 s after B's send, not go out then.
        let st = DiscordState { last_update_ms: 10_000, pending: Some(presence(30.0, 240.0, 12_000)), flush_scheduled: true, ..Default::default() };
        assert_eq!(flush_due(&st, 15_000), Flush::Wait(10_000));
        assert_eq!(flush_due(&st, 25_000), Flush::Send);
    }

    #[test]
    fn a_timer_with_nothing_left_to_send_ends() {
        let st = DiscordState { last_update_ms: 10_000, flush_scheduled: true, ..Default::default() };
        assert_eq!(flush_due(&st, 15_000), Flush::Nothing);
    }

    #[test]
    fn no_length_means_no_end() {
        let (_, end) = presence(0.0, 0.0, now_ms()).timestamps();
        assert_eq!(end, None);
    }

    /// `discord_update` is a sync command, so it runs on the window's main
    /// thread, and connecting waits for Discord to answer the handshake with
    /// no time limit. A Discord that was slow to answer (starting up, busy,
    /// hung) froze the whole window, music controls included, until it did.
    /// The command now hands the work to a thread of its own and returns.
    /// Needs tauri's mock app, which is off on Windows (see Cargo.toml).
    #[cfg(not(windows))]
    #[test]
    fn a_discord_that_does_not_answer_does_not_hold_up_the_command() {
        use std::os::unix::net::UnixListener;
        use std::time::Instant;
        use tauri::Manager;

        // A short path: a unix socket path is limited to about 100 bytes.
        let dir = std::path::PathBuf::from(format!("/tmp/ember-dc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dir");
        let listener = UnixListener::bind(dir.join("discord-ipc-0")).expect("bind");
        listener.set_nonblocking(true).expect("nonblocking");
        // The first place the client looks for Discord, and an app id so it
        // tries at all. Only this test calls discord_update.
        std::env::set_var("XDG_RUNTIME_DIR", &dir);
        std::env::set_var("DISCORD_APP_ID", "1");

        let app = tauri::test::mock_app();
        app.manage(DiscordPresence::default());
        let handle = app.handle().clone();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let state = handle.state::<DiscordPresence>();
            discord_update(
                handle.clone(),
                state,
                Some("Song".into()),
                Some("Artist".into()),
                None,
                None,
                true,
                Some(0.0),
                Some(180.0),
            );
            let _ = done_tx.send(());
        });

        // "Discord" takes the connection and never answers the handshake.
        let deadline = Instant::now() + Duration::from_secs(5);
        let conn = loop {
            match listener.accept() {
                Ok((conn, _)) => break Some(conn),
                Err(_) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
                Err(_) => break None,
            }
        };
        let returned = done_rx.recv_timeout(Duration::from_secs(2)).is_ok();
        // Closing it ends a handshake still waiting, so nothing is left hanging.
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(returned, "discord_update waited for Discord to answer");
    }

    /// A build without an app id wrote "no app id" on every update, which
    /// crowded the log tail a bug report attaches. Said once per run.
    #[test]
    fn a_missing_app_id_is_logged_once() {
        let mut st = DiscordState::default();
        assert!(st.first_no_app_id());
        assert!(!st.first_no_app_id());
        assert!(!st.first_no_app_id());
    }
}
