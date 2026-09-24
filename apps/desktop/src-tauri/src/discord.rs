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

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
}

pub struct DiscordPresence(pub Mutex<DiscordState>);

impl Default for DiscordPresence {
    fn default() -> Self {
        DiscordPresence(Mutex::new(DiscordState::default()))
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
fn log_discord(app: &tauri::AppHandle, msg: &str) {
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

/// Publish (or clear) the current track on the user's own Discord.
/// Every failure path is a no-op: Discord not running, not installed, or no
/// app id configured must never disturb playback.
#[tauri::command]
pub fn discord_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, DiscordPresence>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    artwork_url: Option<String>,
    is_playing: bool,
    position_sec: Option<f64>,
    duration_sec: Option<f64>,
) {
    let Some(app_id) = app_id() else {
        log_discord(&app, "no app id: presence disabled");
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
        log_discord(&app, &format!("update playing=false title={:?} -> {result}", title));
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
        received_ms: now_ms(),
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
        log_discord(&app, &format!("update {key:?} pos={:.1} -> queued ({wait}ms)", position_sec.unwrap_or(0.0)));
        if !st.flush_scheduled {
            st.flush_scheduled = true;
            schedule_flush(app.clone(), wait);
        }
        return;
    }
    st.pending = None;

    send(&mut st, &app, &app_id, presence);
}

/// Wake up when the rate-limit window has passed and send whatever is newest.
fn schedule_flush(app: tauri::AppHandle, wait_ms: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(wait_ms));
        use tauri::Manager;
        let Some(state) = app.try_state::<DiscordPresence>() else { return };
        let Ok(mut st) = state.0.lock() else { return };
        st.flush_scheduled = false;
        let Some(presence) = st.pending.take() else { return };
        let Some(app_id) = app_id() else { return };
        log_discord(&app, &format!("flush {:?} pos={:.1}", presence.key(), presence.position_sec));
        send(&mut st, &app, &app_id, presence);
    });
}

/// One activity to Discord, connecting first if needed. Records the send time
/// and key whether or not Discord took it, so the throttle stays honest.
fn send(st: &mut DiscordState, app: &tauri::AppHandle, app_id: &str, presence: Presence) {
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
    fn no_length_means_no_end() {
        let (_, end) = presence(0.0, 0.0, now_ms()).timestamps();
        assert_eq!(end, None);
    }
}
