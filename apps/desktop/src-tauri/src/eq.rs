// Ember desktop: the equalizer in the native engine's sample pipeline.
//
// Five bands, the same on every engine (apps/web/lib/playback/eq.ts is the
// web twin, Equalizer.kt the Android one): a low shelf at 60 Hz, peaking
// filters at 230 Hz, 910 Hz and 3.6 kHz, a high shelf at 14 kHz, each
// -12..+12 dB. The coefficients are the Audio EQ Cookbook's (R. Bristow-
// Johnson), which is also what Web Audio's BiquadFilterNode uses, so a
// setting sounds the same in the browser and here.
//
// A pre-amp in front of the filters takes the loudest point of the curve
// back down to 0 dB (auto headroom), so a boost never pushes a full-scale
// song into clipping. The webview only sends the switch and the five gains;
// the headroom is worked out here, at the song's own sample rate.
//
// `Equalized` wraps the decoder before it goes into the sink. It reads the
// shared `EqControl` once per frame (one atomic load), so a change
// is heard at once, mid-song, without a reload.

use std::f64::consts::PI;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rodio::source::SeekError;
use rodio::Source;

/// The band centres, in Hz.
pub const BAND_FREQS: [f64; 5] = [60.0, 230.0, 910.0, 3600.0, 14000.0];
/// Band gain bounds, in dB.
pub const MAX_BAND_DB: f32 = 12.0;
/// Q of the three peaking bands (Web Audio's default, and what the web
/// engine sets explicitly).
pub const PEAK_Q: f64 = 1.0;

/// What the listener chose.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EqSettings {
    pub enabled: bool,
    pub bands: [f32; 5],
}

impl Default for EqSettings {
    fn default() -> Self {
        Self { enabled: false, bands: [0.0; 5] }
    }
}

impl EqSettings {
    /// Settings from the webview's command, made safe: missing bands are 0,
    /// extra ones are dropped, anything not a number is 0, and every gain is
    /// held to -12..+12 dB.
    pub fn from_command(enabled: bool, bands: &[f32]) -> Self {
        let mut out = [0.0f32; 5];
        for (i, b) in bands.iter().take(5).enumerate() {
            out[i] = if b.is_finite() { b.clamp(-MAX_BAND_DB, MAX_BAND_DB) } else { 0.0 };
        }
        Self { enabled, bands: out }
    }

    /// Whether the filters change anything at all.
    pub fn is_active(&self) -> bool {
        self.enabled && self.bands.iter().any(|b| *b != 0.0)
    }
}

/// One second-order section, normalized so a0 = 1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Biquad {
    pub b0: f64,
    pub b1: f64,
    pub b2: f64,
    pub a1: f64,
    pub a2: f64,
}

impl Biquad {
    pub const IDENTITY: Biquad = Biquad { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 };

    fn normalized(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> Self {
        Self { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
    }

    /// The angular frequency, kept under Nyquist: a 14 kHz shelf on a
    /// 22.05 kHz stream would otherwise fold over.
    fn omega(fs: f64, f0: f64) -> f64 {
        2.0 * PI * f0.min(fs * 0.45) / fs
    }

    pub fn peaking(fs: f64, f0: f64, q: f64, db: f64) -> Self {
        if db == 0.0 {
            return Self::IDENTITY;
        }
        let a = 10f64.powf(db / 40.0);
        let w0 = Self::omega(fs, f0);
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * q);
        Self::normalized(1.0 + alpha * a, -2.0 * cos, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * cos, 1.0 - alpha / a)
    }

    /// Shelf slope S = 1, as Web Audio's lowshelf.
    pub fn low_shelf(fs: f64, f0: f64, db: f64) -> Self {
        if db == 0.0 {
            return Self::IDENTITY;
        }
        let a = 10f64.powf(db / 40.0);
        let w0 = Self::omega(fs, f0);
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / std::f64::consts::SQRT_2;
        let k = 2.0 * a.sqrt() * alpha;
        Self::normalized(
            a * ((a + 1.0) - (a - 1.0) * cos + k),
            2.0 * a * ((a - 1.0) - (a + 1.0) * cos),
            a * ((a + 1.0) - (a - 1.0) * cos - k),
            (a + 1.0) + (a - 1.0) * cos + k,
            -2.0 * ((a - 1.0) + (a + 1.0) * cos),
            (a + 1.0) + (a - 1.0) * cos - k,
        )
    }

    /// Shelf slope S = 1, as Web Audio's highshelf.
    pub fn high_shelf(fs: f64, f0: f64, db: f64) -> Self {
        if db == 0.0 {
            return Self::IDENTITY;
        }
        let a = 10f64.powf(db / 40.0);
        let w0 = Self::omega(fs, f0);
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / std::f64::consts::SQRT_2;
        let k = 2.0 * a.sqrt() * alpha;
        Self::normalized(
            a * ((a + 1.0) + (a - 1.0) * cos + k),
            -2.0 * a * ((a - 1.0) + (a + 1.0) * cos),
            a * ((a + 1.0) + (a - 1.0) * cos - k),
            (a + 1.0) - (a - 1.0) * cos + k,
            2.0 * ((a - 1.0) - (a + 1.0) * cos),
            (a + 1.0) - (a - 1.0) * cos - k,
        )
    }

    /// This section's gain at `f` Hz, in dB.
    pub fn magnitude_db(&self, fs: f64, f: f64) -> f64 {
        let w = 2.0 * PI * f / fs;
        let (s1, c1) = w.sin_cos();
        let (s2, c2) = (2.0 * w).sin_cos();
        let nr = self.b0 + self.b1 * c1 + self.b2 * c2;
        let ni = -(self.b1 * s1 + self.b2 * s2);
        let dr = 1.0 + self.a1 * c1 + self.a2 * c2;
        let di = -(self.a1 * s1 + self.a2 * s2);
        10.0 * ((nr * nr + ni * ni) / (dr * dr + di * di)).log10()
    }
}

/// The five sections for `bands` at sample rate `fs`.
pub fn design(fs: f64, bands: &[f32; 5]) -> [Biquad; 5] {
    [
        Biquad::low_shelf(fs, BAND_FREQS[0], bands[0] as f64),
        Biquad::peaking(fs, BAND_FREQS[1], PEAK_Q, bands[1] as f64),
        Biquad::peaking(fs, BAND_FREQS[2], PEAK_Q, bands[2] as f64),
        Biquad::peaking(fs, BAND_FREQS[3], PEAK_Q, bands[3] as f64),
        Biquad::high_shelf(fs, BAND_FREQS[4], bands[4] as f64),
    ]
}

/// The whole curve's gain at `f` Hz, in dB.
pub fn response_db(sections: &[Biquad; 5], fs: f64, f: f64) -> f64 {
    sections.iter().map(|s| s.magnitude_db(fs, f)).sum()
}

/// The pre-amp that brings the curve's loudest point (20 Hz to 20 kHz, or
/// to just under Nyquist) back to 0 dB: 0 or less, never a boost.
pub fn auto_preamp_db(sections: &[Biquad; 5], fs: f64) -> f64 {
    const POINTS: usize = 240;
    let lo: f64 = 20.0;
    let hi = 20_000f64.min(fs * 0.49);
    let mut peak = f64::NEG_INFINITY;
    for i in 0..POINTS {
        let f = lo * (hi / lo).powf(i as f64 / (POINTS - 1) as f64);
        peak = peak.max(response_db(sections, fs, f));
    }
    // The band centres themselves, so a narrow peak between grid points is
    // not missed.
    for f in BAND_FREQS {
        if f < hi {
            peak = peak.max(response_db(sections, fs, f));
        }
    }
    -peak.max(0.0)
}

/// The settings every playing song reads, shared by the engine and the
/// `Equalized` wrapper of whatever is loaded.
#[derive(Debug, Default)]
pub struct EqControl {
    settings: Mutex<EqSettings>,
    version: AtomicU64,
}

impl EqControl {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(&self, s: EqSettings) {
        if let Ok(mut g) = self.settings.lock() {
            if *g == s {
                return;
            }
            *g = s;
        }
        self.version.fetch_add(1, Ordering::Release);
    }

    pub fn get(&self) -> EqSettings {
        self.settings.lock().map(|g| *g).unwrap_or_default()
    }

    fn version(&self) -> u64 {
        self.version.load(Ordering::Acquire)
    }
}

/// Transposed direct form II memory for one section on one channel.
#[derive(Clone, Copy, Debug, Default)]
struct State {
    z1: f64,
    z2: f64,
}

impl State {
    #[inline]
    fn run(&mut self, c: &Biquad, x: f64) -> f64 {
        let y = c.b0 * x + self.z1;
        self.z1 = c.b1 * x - c.a1 * y + self.z2;
        self.z2 = c.b2 * x - c.a2 * y;
        y
    }
}

/// A source with the equalizer applied.
pub struct Equalized<S> {
    inner: S,
    control: Arc<EqControl>,
    /// The control's version the filters were built for (`u64::MAX`: never).
    seen: u64,
    settings: EqSettings,
    sections: [Biquad; 5],
    preamp: f64,
    /// One set of section memories per channel.
    states: Vec<[State; 5]>,
    channels: u16,
    rate: u32,
    /// The channel the next sample belongs to.
    channel: usize,
    /// Samples left in the current span: at its end the channel count or
    /// the sample rate may change. `Some(0)` asks for a fresh look.
    span_left: Option<usize>,
}

impl<S: Source> Equalized<S> {
    pub fn new(inner: S, control: Arc<EqControl>) -> Self {
        Self {
            inner,
            control,
            seen: u64::MAX,
            settings: EqSettings::default(),
            sections: [Biquad::IDENTITY; 5],
            preamp: 1.0,
            states: Vec::new(),
            channels: 0,
            rate: 0,
            channel: 0,
            span_left: Some(0),
        }
    }

    fn reset(&mut self) {
        for s in self.states.iter_mut() {
            *s = [State::default(); 5];
        }
    }

    fn rebuild(&mut self) {
        if self.rate == 0 {
            self.sections = [Biquad::IDENTITY; 5];
            self.preamp = 1.0;
            return;
        }
        let fs = self.rate as f64;
        self.sections = design(fs, &self.settings.bands);
        self.preamp = 10f64.powf(auto_preamp_db(&self.sections, fs) / 20.0);
    }

    /// Start of a span: pick up a new channel count or sample rate.
    fn refresh_format(&mut self) {
        let channels = self.inner.channels().max(1);
        let rate = self.inner.sample_rate();
        self.span_left = match self.inner.current_span_len() {
            Some(0) | None => None,
            n => n,
        };
        self.channel = 0;
        if channels != self.channels || rate != self.rate {
            self.channels = channels;
            self.rate = rate;
            self.states = vec![[State::default(); 5]; channels as usize];
            self.rebuild();
        }
    }

    /// Start of a frame: pick up new settings.
    fn refresh_settings(&mut self) {
        let v = self.control.version();
        if v == self.seen {
            return;
        }
        self.seen = v;
        let next = self.control.get();
        let was_active = self.settings.is_active();
        self.settings = next;
        self.rebuild();
        // Memories from before the filters were switched off are stale.
        if !was_active && next.is_active() {
            self.reset();
        }
    }
}

impl<S: Source> Iterator for Equalized<S> {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        if self.span_left == Some(0) {
            self.refresh_format();
        }
        if self.channel == 0 {
            self.refresh_settings();
        }
        let x = self.inner.next()?;
        if let Some(n) = self.span_left.as_mut() {
            *n = n.saturating_sub(1);
        }
        let ch = self.channel;
        self.channel = if ch + 1 >= self.channels as usize { 0 } else { ch + 1 };
        if !self.settings.is_active() {
            return Some(x);
        }
        let Some(state) = self.states.get_mut(ch) else { return Some(x) };
        let mut y = x as f64 * self.preamp;
        for (s, c) in state.iter_mut().zip(self.sections.iter()) {
            y = s.run(c, y);
        }
        Some(y as f32)
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

impl<S: Source> Source for Equalized<S> {
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
        // The filters' memory is of audio that is no longer next, and the
        // decoder starts the new position on a frame boundary.
        self.reset();
        self.span_left = Some(0);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;

    const FS: u32 = 48_000;

    fn sine(freq: f64, secs: f64, amp: f32) -> Vec<f32> {
        let n = (FS as f64 * secs) as usize;
        (0..n).map(|i| amp * (2.0 * PI * freq * i as f64 / FS as f64).sin() as f32).collect()
    }

    /// Interleaves two mono signals into one stereo one.
    fn stereo(l: &[f32], r: &[f32]) -> Vec<f32> {
        l.iter().zip(r).flat_map(|(a, b)| [*a, *b]).collect()
    }

    fn rms(x: &[f32]) -> f64 {
        (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt()
    }

    fn db(ratio: f64) -> f64 {
        20.0 * ratio.log10()
    }

    fn control(enabled: bool, bands: [f32; 5]) -> Arc<EqControl> {
        let c = Arc::new(EqControl::new());
        c.set(EqSettings::from_command(enabled, &bands));
        c
    }

    /// Runs `input` through the equalizer and drops the first quarter
    /// second, where the filters are still settling.
    fn run(input: Vec<f32>, channels: u16, c: Arc<EqControl>) -> Vec<f32> {
        let out: Vec<f32> = Equalized::new(SamplesBuffer::new(channels, FS, input), c).collect();
        let skip = FS as usize / 4 * channels as usize;
        out[skip..].to_vec()
    }

    fn settle(x: &[f32]) -> &[f32] {
        &x[FS as usize / 4..]
    }

    #[test]
    fn a_zero_gain_band_is_the_identity() {
        assert_eq!(Biquad::peaking(48_000.0, 910.0, 1.0, 0.0), Biquad::IDENTITY);
        assert_eq!(Biquad::low_shelf(48_000.0, 60.0, 0.0), Biquad::IDENTITY);
        assert_eq!(Biquad::high_shelf(48_000.0, 14_000.0, 0.0), Biquad::IDENTITY);
    }

    #[test]
    fn a_peaking_band_has_its_gain_at_its_centre_and_none_far_away() {
        let fs = 48_000.0;
        for g in [-12.0, -6.0, 3.0, 12.0] {
            let b = Biquad::peaking(fs, 910.0, PEAK_Q, g);
            assert!((b.magnitude_db(fs, 910.0) - g).abs() < 1e-6, "{g} dB at centre");
            assert!(b.magnitude_db(fs, 20.0).abs() < 0.2, "{g} dB far below");
            assert!(b.magnitude_db(fs, 18_000.0).abs() < 0.2, "{g} dB far above");
        }
    }

    #[test]
    fn shelves_reach_their_gain_on_their_side_and_half_of_it_at_the_corner() {
        let fs = 48_000.0;
        let low = Biquad::low_shelf(fs, 60.0, 12.0);
        assert!((low.magnitude_db(fs, 5.0) - 12.0).abs() < 0.2);
        assert!((low.magnitude_db(fs, 60.0) - 6.0).abs() < 0.05);
        assert!(low.magnitude_db(fs, 5_000.0).abs() < 0.05);
        let high = Biquad::high_shelf(fs, 14_000.0, -9.0);
        assert!((high.magnitude_db(fs, 14_000.0) + 4.5).abs() < 0.05);
        assert!(high.magnitude_db(fs, 100.0).abs() < 0.05);
        assert!(high.magnitude_db(fs, 23_000.0) < -8.0);
    }

    #[test]
    fn auto_preamp_cancels_the_loudest_boost_and_never_boosts() {
        let fs = 48_000.0;
        assert_eq!(auto_preamp_db(&design(fs, &[0.0; 5]), fs), 0.0);
        assert_eq!(auto_preamp_db(&design(fs, &[-6.0; 5]), fs), 0.0);
        let one = auto_preamp_db(&design(fs, &[0.0, 0.0, 9.0, 0.0, 0.0]), fs);
        assert!((one + 9.0).abs() < 0.05, "{one}");
        // Neighbouring boosts overlap: the headroom covers their sum, which
        // is more than either on its own.
        let two = auto_preamp_db(&design(fs, &[12.0, 12.0, 0.0, 0.0, 0.0]), fs);
        assert!(two < -12.0, "{two}");
    }

    #[test]
    fn settings_from_the_webview_are_made_safe() {
        let s = EqSettings::from_command(true, &[40.0, -40.0, f32::NAN, 3.0]);
        assert_eq!(s.bands, [12.0, -12.0, 0.0, 3.0, 0.0]);
        let s = EqSettings::from_command(true, &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        assert_eq!(s.bands, [1.0, 2.0, 3.0, 4.0, 5.0]);
        assert!(!EqSettings::from_command(true, &[0.0; 5]).is_active());
        assert!(!EqSettings::from_command(false, &[6.0; 5]).is_active());
    }

    #[test]
    fn off_or_flat_passes_the_samples_through_untouched() {
        let input = sine(440.0, 0.5, 0.8);
        for c in [control(false, [12.0, 0.0, -6.0, 3.0, 9.0]), control(true, [0.0; 5])] {
            let out: Vec<f32> = Equalized::new(SamplesBuffer::new(1, FS, input.clone()), c).collect();
            assert_eq!(out, input);
        }
    }

    #[test]
    fn a_bass_boost_lifts_a_low_tone_and_leaves_a_high_one_at_the_preamp() {
        let bands = [12.0, 0.0, 0.0, 0.0, 0.0];
        let fs = FS as f64;
        let sections = design(fs, &bands);
        let pre = auto_preamp_db(&sections, fs);

        let low = sine(40.0, 1.0, 0.25);
        let out = run(low.clone(), 1, control(true, bands));
        let got = db(rms(&out) / rms(settle(&low)));
        let want = response_db(&sections, fs, 40.0) + pre;
        assert!((got - want).abs() < 0.3, "40 Hz: got {got:.2} dB, want {want:.2}");

        let high = sine(5_000.0, 1.0, 0.25);
        let out = run(high.clone(), 1, control(true, bands));
        let got = db(rms(&out) / rms(settle(&high)));
        assert!((got - pre).abs() < 0.3, "5 kHz: got {got:.2} dB, want {pre:.2}");
    }

    #[test]
    fn a_full_scale_tone_at_the_boosted_band_does_not_clip() {
        let bands = [0.0, 0.0, 12.0, 0.0, 0.0];
        let out = run(sine(910.0, 1.0, 1.0), 1, control(true, bands));
        let peak = out.iter().fold(0f32, |m, v| m.max(v.abs()));
        assert!(peak <= 1.01, "peak {peak}");
        assert!(peak > 0.95, "the boost is not simply thrown away: peak {peak}");
    }

    #[test]
    fn each_channel_is_filtered_on_its_own() {
        // Bass in the left ear, treble in the right: cutting the bass must
        // quieten only the left.
        let l = sine(50.0, 1.0, 0.5);
        let r = sine(8_000.0, 1.0, 0.5);
        let out = run(stereo(&l, &r), 2, control(true, [-12.0, 0.0, 0.0, 0.0, 0.0]));
        let left: Vec<f32> = out.iter().step_by(2).copied().collect();
        let right: Vec<f32> = out.iter().skip(1).step_by(2).copied().collect();
        let dl = db(rms(&left) / rms(settle(&l)));
        let dr = db(rms(&right) / rms(settle(&r)));
        let want = response_db(&design(FS as f64, &[-12.0, 0.0, 0.0, 0.0, 0.0]), FS as f64, 50.0);
        assert!(want < -7.0, "the cut is deep at 50 Hz: {want:.2}");
        assert!((dl - want).abs() < 0.3, "left {dl:.2} dB, want {want:.2}");
        assert!(dr.abs() < 0.2, "right {dr:.2} dB");
    }

    #[test]
    fn a_change_is_heard_mid_song() {
        let c = control(false, [0.0; 5]);
        let input = sine(60.0, 2.0, 0.25);
        let mut eq = Equalized::new(SamplesBuffer::new(1, FS, input.clone()), Arc::clone(&c));
        let first: Vec<f32> = eq.by_ref().take(FS as usize).collect();
        assert_eq!(first, input[..FS as usize]);
        c.set(EqSettings::from_command(true, &[-12.0, 0.0, 0.0, 0.0, 0.0]));
        let rest: Vec<f32> = eq.collect();
        let got = db(rms(&rest[FS as usize / 4..]) / rms(&input[FS as usize + FS as usize / 4..]));
        assert!(got < -5.0, "{got:.2} dB");
    }

    #[test]
    fn it_reports_the_format_of_what_it_wraps() {
        let eq = Equalized::new(SamplesBuffer::new(2, 44_100, vec![0.0; 88_200]), Arc::new(EqControl::new()));
        assert_eq!(eq.channels(), 2);
        assert_eq!(eq.sample_rate(), 44_100);
        assert_eq!(eq.total_duration(), Some(Duration::from_secs(1)));
    }

    #[test]
    fn a_seek_clears_the_filters_memory() {
        let c = control(true, [12.0, 0.0, 0.0, 0.0, 0.0]);
        let mut eq = Equalized::new(SamplesBuffer::new(1, FS, sine(40.0, 2.0, 0.5)), c);
        let _ = eq.by_ref().take(FS as usize / 2).count();
        eq.try_seek(Duration::from_millis(1500)).expect("seek");
        assert!(eq.states.iter().all(|s| s.iter().all(|st| st.z1 == 0.0 && st.z2 == 0.0)));
        assert!(eq.next().is_some());
    }
}
