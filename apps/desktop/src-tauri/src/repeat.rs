//! Repeat one inside the engine.
//!
//! The webview used to repeat a song by waiting for `audio:ended` and then
//! seeking back to 0. By then rodio had dropped the source with the sink run
//! dry, so the seek opened the song again from the host: a new request, a new
//! decoder, and seconds of silence between the end and the start ("when the
//! loop ends it takes a while for the song to start playing again").
//!
//! `Looping` sits between the decoder and the sink. With repeat one on, it
//! answers the decoder running out by seeking that same decoder back to the
//! top, over the bytes it already has (the cached file, or the download's
//! temp file), and carries on. The sink never runs dry, so nothing ends.
//!
//! The sink's clock counts every sample it plays and knows nothing of the
//! jump, so each lap adds a song's length to it. `LoopClock` keeps what the
//! laps added, and the engine takes it off before reporting a position.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rodio::source::SeekError;
use rodio::Source;

/// What the sink's clock has counted in laps that went back to the top.
#[derive(Debug, Default)]
pub(crate) struct LoopClock {
    looped_ns: AtomicU64,
    laps: AtomicU64,
}

impl LoopClock {
    /// The song's own position, from the sink's.
    pub(crate) fn track_pos(&self, sink_pos: Duration) -> Duration {
        sink_pos.saturating_sub(Duration::from_nanos(self.looped_ns.load(Ordering::SeqCst)))
    }

    /// How many times the song has gone back to the top.
    #[cfg(test)]
    pub(crate) fn laps(&self) -> u64 {
        self.laps.load(Ordering::SeqCst)
    }
}

/// A source that starts over when it runs out, while `on` is set.
pub(crate) struct Looping<S> {
    inner: S,
    /// Repeat one, engine wide: the webview can switch it any time.
    on: Arc<AtomicBool>,
    /// Set when the source failed (see `FailFlagged`): a stream that died is
    /// reported as a failure, not played again from the top.
    failed: Arc<AtomicBool>,
    /// False for a source that cannot seek back (a forward-only stream): it
    /// ends as before and the webview opens it again.
    can_loop: bool,
    clock: Arc<LoopClock>,
    /// Where this lap started: 0, or the target of the last seek.
    lap_start: Duration,
    /// Samples played in this lap.
    samples: u64,
}

impl<S: Source> Looping<S> {
    pub(crate) fn new(
        inner: S,
        on: Arc<AtomicBool>,
        failed: Arc<AtomicBool>,
        can_loop: bool,
        clock: Arc<LoopClock>,
    ) -> Self {
        Self { inner, on, failed, can_loop, clock, lap_start: Duration::ZERO, samples: 0 }
    }

    /// How far into the song this lap got.
    fn lap_pos(&self) -> Duration {
        let per_sec = self.inner.sample_rate() as f64 * self.inner.channels() as f64;
        let played = if per_sec > 0.0 { self.samples as f64 / per_sec } else { 0.0 };
        self.lap_start + Duration::from_secs_f64(played)
    }
}

impl<S: Source> Iterator for Looping<S> {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        if let Some(x) = self.inner.next() {
            self.samples += 1;
            return Some(x);
        }
        if !self.can_loop || !self.on.load(Ordering::SeqCst) || self.failed.load(Ordering::SeqCst) {
            return None;
        }
        let reached = self.lap_pos();
        if self.inner.try_seek(Duration::ZERO).is_err() {
            return None;
        }
        let x = self.inner.next()?;
        self.clock.looped_ns.fetch_add(reached.as_nanos().min(u64::MAX as u128) as u64, Ordering::SeqCst);
        self.clock.laps.fetch_add(1, Ordering::SeqCst);
        self.lap_start = Duration::ZERO;
        self.samples = 1;
        Some(x)
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.inner.size_hint().0, None)
    }
}

impl<S: Source> Source for Looping<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.inner.current_span_len()
    }

    fn channels(&self) -> rodio::ChannelCount {
        self.inner.channels()
    }

    fn sample_rate(&self) -> rodio::SampleRate {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.inner.try_seek(pos)?;
        // The sink's clock starts again at `pos` on a seek, laps and all.
        self.clock.looped_ns.store(0, Ordering::SeqCst);
        self.lap_start = pos;
        self.samples = 0;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;

    /// One second of mono at 10 Hz: samples 0..10.
    fn second() -> SamplesBuffer {
        SamplesBuffer::new(1, 10, (0..10).map(|i| i as f32).collect::<Vec<_>>())
    }

    fn looping(on: bool, can_loop: bool) -> (Looping<SamplesBuffer>, Arc<AtomicBool>, Arc<AtomicBool>, Arc<LoopClock>) {
        let on = Arc::new(AtomicBool::new(on));
        let failed = Arc::new(AtomicBool::new(false));
        let clock = Arc::new(LoopClock::default());
        let l = Looping::new(second(), Arc::clone(&on), Arc::clone(&failed), can_loop, Arc::clone(&clock));
        (l, on, failed, clock)
    }

    #[test]
    fn off_it_plays_the_song_once() {
        let (l, _, _, clock) = looping(false, true);
        assert_eq!(l.count(), 10);
        assert_eq!(clock.laps(), 0);
    }

    #[test]
    fn on_it_goes_back_to_the_top_at_the_end() {
        let (l, _, _, clock) = looping(true, true);
        let out: Vec<f32> = l.take(25).collect();
        assert_eq!(&out[..12], &[0., 1., 2., 3., 4., 5., 6., 7., 8., 9., 0., 1.]);
        assert_eq!(clock.laps(), 2);
        // Two whole laps of one second came off the sink's clock.
        assert_eq!(clock.track_pos(Duration::from_millis(2_500)), Duration::from_millis(500));
    }

    #[test]
    fn switched_off_mid_song_it_ends_at_the_end() {
        let (mut l, on, _, _) = looping(true, true);
        for _ in 0..15 {
            l.next();
        }
        on.store(false, Ordering::SeqCst);
        assert_eq!(l.count(), 5);
    }

    #[test]
    fn a_failed_source_is_not_played_again() {
        let (mut l, _, failed, clock) = looping(true, true);
        failed.store(true, Ordering::SeqCst);
        assert_eq!(l.by_ref().count(), 10);
        assert_eq!(clock.laps(), 0);
    }

    #[test]
    fn a_source_that_cannot_seek_back_ends() {
        let (l, _, _, clock) = looping(true, false);
        assert_eq!(l.count(), 10);
        assert_eq!(clock.laps(), 0);
    }

    #[test]
    fn a_seek_resets_the_clock_and_starts_the_lap_where_it_landed() {
        let (mut l, _, _, clock) = looping(true, true);
        for _ in 0..12 {
            l.next();
        }
        assert_eq!(clock.laps(), 1);
        l.try_seek(Duration::from_millis(500)).expect("seek");
        assert_eq!(clock.track_pos(Duration::from_millis(500)), Duration::from_millis(500));
        // From 0.5 s to the end is half a lap: the clock loses 1 s at the wrap.
        for _ in 0..6 {
            l.next();
        }
        assert_eq!(clock.track_pos(Duration::from_millis(1_100)), Duration::from_millis(100));
    }
}

#[cfg(test)]
mod wiring {
    /// The remote page is denied any command the ACL does not name: without
    /// these the webview's `audio_set_loop` fails and repeat one falls back
    /// to the slow way.
    #[test]
    fn the_command_is_registered_and_allowed() {
        let acl = include_str!("../permissions/app-commands.toml");
        assert!(acl.contains("\"audio_set_loop\""));
        let lib = include_str!("lib.rs");
        assert!(lib.contains("audio::audio_set_loop"));
    }
}
