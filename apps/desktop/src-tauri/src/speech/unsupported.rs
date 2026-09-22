// Platforms without a recognizer we drive (Linux): the mic reports
// "unavailable" and the web shows "Voice search isn't available on this
// device." instead of a dead button.

use super::{Availability, SpeechBackend, SpeechError, SpeechErrorKind};

pub struct Unsupported;

impl SpeechBackend for Unsupported {
    fn available(&self) -> Availability {
        Availability { available: false, on_device: false }
    }

    fn start(&self, _lang: String, _app: tauri::AppHandle) -> Result<(), SpeechError> {
        Err(SpeechError::new(
            SpeechErrorKind::Unavailable,
            "no speech recognizer on this platform",
        ))
    }

    fn stop(&self) {}

    fn abort(&self) {}
}
