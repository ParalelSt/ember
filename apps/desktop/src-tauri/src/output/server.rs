// Linux: playing through the desktop sound server instead of straight into ALSA.
//
// cpal only speaks ALSA on Linux. Its "default" PCM is whatever the ALSA
// config makes it: on a desktop with pipewire-alsa (or PulseAudio's ALSA
// redirect) that is the sound server, but without that package it is the
// sound card itself. A Debian user's .deb hit exactly that: Ember played on
// the laptop speaker while every other app followed the Bluetooth headphones
// the desktop had chosen, it never showed up in the volume mixer (so it could
// not be moved there either), and when the server was holding the card the
// open failed outright and the webview fell back to web audio.
//
// `ServerFirst` puts a stream on the sound server in front of the ALSA
// devices. The server plays to whatever output the desktop has chosen,
// follows it when that changes, and lists the stream in the mixer under the
// name set below. The ALSA devices stay listed and can still be picked.

#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::any::Any;
use std::sync::{Mutex, PoisonError};

use rodio::{ChannelCount, SampleRate};

use super::{OnLost, OutputBackend, OutputDevice, Tap};

/// The id and name the sound server goes by in the device list.
pub const SERVER_ID: &str = "Sound server";

/// The master mixer's format on the sound server. The server converts to
/// each device's own format, so there is no device to ask.
const SERVER_FORMAT: (ChannelCount, SampleRate) = (2, 48_000);

/// What the volume mixer shows for Ember's stream. The icon is the name the
/// .deb installs its icon under (the binary's name, see tauri.conf.json).
const APP_NAME: &str = "Ember";
const ICON_NAME: &str = "ember-desktop";

/// A connection to the desktop sound server.
pub trait SoundServer: Send + 'static {
    /// Starts a playback stream on the server's default output that plays
    /// `tap`, calling `on_lost` if the connection later dies. Dropping the
    /// handle ends the stream. On failure the tap and the callback come back,
    /// so the caller can hand them to ALSA instead.
    fn open(&self, tap: Tap, on_lost: OnLost) -> Result<Box<dyn Any>, (String, Tap, OnLost)>;
}

/// The sound server first, then ALSA (see the top of this file).
pub struct ServerFirst {
    server: Option<Box<dyn SoundServer>>,
    alsa: Box<dyn OutputBackend>,
    /// Why there is no server, until the router has logged it once.
    note: Mutex<Option<String>>,
}

impl ServerFirst {
    /// `server` is Err with the reason when no server could be reached at
    /// all (no client library on the machine).
    pub fn new(server: Result<Box<dyn SoundServer>, String>, alsa: Box<dyn OutputBackend>) -> Self {
        let (server, note) = match server {
            Ok(s) => (Some(s), None),
            Err(e) => (None, Some(format!("no sound server client ({e}); playing through ALSA directly"))),
        };
        Self { server, alsa, note: Mutex::new(note) }
    }

    fn note(&self, msg: String) {
        *self.note.lock().unwrap_or_else(PoisonError::into_inner) = Some(msg);
    }
}

impl OutputBackend for ServerFirst {
    fn devices(&self) -> Vec<OutputDevice> {
        let alsa = self.alsa.devices();
        if self.server.is_none() {
            return alsa;
        }
        let mut out = vec![OutputDevice { id: SERVER_ID.into(), name: SERVER_ID.into(), is_default: true }];
        out.extend(
            alsa.into_iter()
                .filter(|d| d.id != SERVER_ID)
                .map(|d| OutputDevice { is_default: false, ..d }),
        );
        out
    }

    fn default_format(&self) -> Option<(ChannelCount, SampleRate)> {
        match self.server {
            Some(_) => Some(SERVER_FORMAT),
            None => self.alsa.default_format(),
        }
    }

    fn open(&self, id: Option<&str>, tap: Tap, on_lost: OnLost) -> Result<(String, Box<dyn Any>), String> {
        let Some(server) = &self.server else {
            return self.alsa.open(id, tap, on_lost);
        };
        match id {
            Some(id) if id != SERVER_ID => self.alsa.open(Some(id), tap, on_lost),
            Some(_) => match server.open(tap, on_lost) {
                Ok(stream) => Ok((SERVER_ID.to_string(), stream)),
                Err((e, _, _)) => Err(format!("{SERVER_ID}: {e}")),
            },
            None => match server.open(tap, on_lost) {
                Ok(stream) => Ok((SERVER_ID.to_string(), stream)),
                Err((e, tap, on_lost)) => {
                    let opened = self.alsa.open(None, tap, on_lost);
                    if opened.is_ok() {
                        self.note(format!("the sound server would not play ({e}); playing through ALSA directly"));
                    }
                    opened.map_err(|alsa| format!("{SERVER_ID}: {e}; {alsa}"))
                }
            },
        }
    }

    fn take_note(&self) -> Option<String> {
        self.note.lock().unwrap_or_else(PoisonError::into_inner).take()
    }
}

/// The environment that names Ember's stream in the volume mixer, for the
/// paths that do not name it themselves: libpulse reads `PULSE_PROP` (the
/// "pulse" ALSA PCM, and WebKit's own audio when the webview plays), the
/// PipeWire ALSA plugin reads `PIPEWIRE_PROPS`. A variable already set is
/// left alone, so a user's own setting wins. `get` reads the environment.
pub fn stream_env(get: impl Fn(&str) -> Option<String>) -> Vec<(&'static str, String)> {
    let wanted = [
        ("PULSE_PROP", format!("application.name='{APP_NAME}' application.icon_name='{ICON_NAME}' media.role='music'")),
        (
            "PIPEWIRE_PROPS",
            format!(r#"{{ "application.name": "{APP_NAME}", "application.icon-name": "{ICON_NAME}", "media.role": "Music" }}"#),
        ),
    ];
    wanted.into_iter().filter(|(k, _)| get(k).is_none()).collect()
}

/// Sets `stream_env` on this process. Called before any audio thread or
/// GTK starts, while the process has one thread.
pub fn apply_stream_env() {
    for (k, v) in stream_env(|k| std::env::var_os(k).map(|v| v.to_string_lossy().into_owned())) {
        std::env::set_var(k, v);
    }
}
