// Per-user Discord Rich Presence for the DESKTOP app.
//
// Discord's IPC socket is local to the machine running Discord, so the web
// server can only ever set the HOST's status. Here each listener's own Discord
// shows what they are playing, because this runs on their machine.
//
// App id resolution: DISCORD_APP_ID at runtime, else the value baked in at
// build time, else disabled (silent no-op — exactly like the server side).

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use discord_rich_presence::{
    activity::{Activity, Assets, Timestamps},
    DiscordIpc, DiscordIpcClient,
};

/// Discord rejects presence updates faster than ~1 per 15s.
const RATE_LIMIT_MS: u128 = 15_000;

#[derive(Default)]
pub struct DiscordState {
    client: Option<DiscordIpcClient>,
    connected: bool,
    last_update_ms: u128,
    /// Start of the current track, so the "elapsed" timer doesn't restart on
    /// every throttled update.
    track_started_at: i64,
    last_key: String,
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
    state: tauri::State<'_, DiscordPresence>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    artwork_url: Option<String>,
    is_playing: bool,
) {
    let Some(app_id) = app_id() else { return };
    let Ok(mut st) = state.0.lock() else { return };

    // Nothing playing → clear and keep the connection warm.
    if !is_playing || title.is_none() {
        if st.connected {
            if let Some(c) = st.client.as_mut() {
                let _ = c.clear_activity();
            }
        }
        st.last_key.clear();
        return;
    }

    let title = title.unwrap_or_default();
    let artist = artist.unwrap_or_default();
    let key = format!("{title}|{artist}");
    let same_track = key == st.last_key;

    // Throttle repeats of the SAME track; a track change always goes through.
    let now = now_ms();
    if same_track && now.saturating_sub(st.last_update_ms) < RATE_LIMIT_MS {
        return;
    }
    if !same_track {
        st.track_started_at = (now / 1000) as i64;
        st.last_key = key;
    }
    st.last_update_ms = now;

    if st.client.is_none() {
        // v1.x: new() is infallible and returns the client directly.
        st.client = Some(DiscordIpcClient::new(&app_id));
    }
    if !st.connected {
        if let Some(c) = st.client.as_mut() {
            // Discord closed / not installed — try again on the next update.
            if c.connect().is_err() {
                return;
            }
            st.connected = true;
        } else {
            return;
        }
    }

    let details = trim(&title, 128);
    let state_line = if artist.is_empty() {
        String::new()
    } else {
        trim(&format!("by {artist}"), 128)
    };
    let large_text = trim(album.as_deref().unwrap_or(&title), 128);
    let started = st.track_started_at;

    // Scoped so the &mut borrow of st.client ends before we touch other fields.
    let failed = {
        let Some(client) = st.client.as_mut() else { return };

        let mut assets = Assets::new().large_text(&large_text);
        if let Some(url) = artwork_url.as_deref() {
            if !url.is_empty() {
                assets = assets.large_image(url);
            }
        }
        let mut activity = Activity::new()
            .details(&details)
            .assets(assets)
            .timestamps(Timestamps::new().start(started));
        if !state_line.is_empty() {
            activity = activity.state(&state_line);
        }
        client.set_activity(activity).is_err()
    };

    // A dropped socket (Discord quit) surfaces here — drop the client so the
    // next update reconnects instead of failing forever.
    if failed {
        st.connected = false;
        if let Some(c) = st.client.as_mut() {
            let _ = c.close();
        }
        st.client = None;
    }
}
