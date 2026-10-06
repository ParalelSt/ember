// The sound server, over the PulseAudio protocol (see `server` for why).
//
// PipeWire desktops speak it too (pipewire-pulse), so this one client
// reaches both. libpulse-simple is loaded at run time with dlopen rather
// than linked: a machine without it still starts and plays through ALSA,
// and the build needs no PulseAudio headers. It is in libpulse0, which
// nearly every Linux desktop has installed.
//
// Compiled on every Unix so `cargo check` and the tests cover it on a Mac;
// only Linux uses it.

#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::any::Any;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};

use rodio::{ChannelCount, SampleRate, Source};

use super::server::SoundServer;
use super::{OnLost, Tap};

/// The library, by its runtime soname.
const LIBRARY: &str = "libpulse-simple.so.0";

/// How much audio the server holds ahead. PulseAudio's own default is two
/// seconds, which a pause, a seek or the volume slider would wait out.
const LATENCY_MS: u32 = 100;

/// How much is written at a time.
const CHUNK_MS: u32 = 10;

// pa_stream_direction_t / pa_sample_format_t values from <pulse/def.h> and
// <pulse/sample.h>; they are part of the stable ABI.
const PA_STREAM_PLAYBACK: c_int = 1;
const PA_SAMPLE_FLOAT32LE: c_int = 5;
const PA_SAMPLE_FLOAT32BE: c_int = 6;

/// `pa_sample_spec`.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SampleSpec {
    format: c_int,
    rate: u32,
    channels: u8,
}

/// `pa_buffer_attr`. `u32::MAX` is libpulse's "choose for me".
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BufferAttr {
    maxlength: u32,
    tlength: u32,
    prebuf: u32,
    minreq: u32,
    fragsize: u32,
}

/// Interleaved native-endian f32, which is what the master mixer makes.
pub(crate) fn sample_spec(channels: ChannelCount, rate: SampleRate) -> SampleSpec {
    let format = if cfg!(target_endian = "big") { PA_SAMPLE_FLOAT32BE } else { PA_SAMPLE_FLOAT32LE };
    SampleSpec { format, rate, channels: channels.min(u16::from(u8::MAX)) as u8 }
}

/// Bytes of f32 audio in `ms` milliseconds.
fn bytes_for(channels: ChannelCount, rate: SampleRate, ms: u32) -> u32 {
    rate / 1000 * ms * u32::from(channels) * 4
}

/// A server-side buffer of `LATENCY_MS`, the rest left to the server.
pub(crate) fn buffer_attr(channels: ChannelCount, rate: SampleRate) -> BufferAttr {
    BufferAttr {
        maxlength: u32::MAX,
        tlength: bytes_for(channels, rate, LATENCY_MS),
        prebuf: u32::MAX,
        minreq: u32::MAX,
        fragsize: u32::MAX,
    }
}

/// Samples in one written chunk (whole frames).
pub(crate) fn chunk_len(channels: ChannelCount, rate: SampleRate) -> usize {
    (rate / 1000 * CHUNK_MS) as usize * usize::from(channels.max(1))
}

/// Fills `buf` from the tap (a tap never ends; silence if it somehow did).
pub(crate) fn fill(tap: &mut impl Iterator<Item = f32>, buf: &mut [f32]) {
    for slot in buf.iter_mut() {
        *slot = tap.next().unwrap_or(0.0);
    }
}

// --- The library ------------------------------------------------------------------

extern "C" {
    fn dlopen(filename: *const c_char, flag: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    fn dlerror() -> *mut c_char;
}

/// RTLD_NOW, the same value on Linux and macOS.
const RTLD_NOW: c_int = 2;

type NewFn = unsafe extern "C" fn(
    server: *const c_char,
    name: *const c_char,
    dir: c_int,
    dev: *const c_char,
    stream_name: *const c_char,
    spec: *const SampleSpec,
    map: *const c_void,
    attr: *const BufferAttr,
    error: *mut c_int,
) -> *mut c_void;
type WriteFn = unsafe extern "C" fn(s: *mut c_void, data: *const c_void, bytes: usize, error: *mut c_int) -> c_int;
type FreeFn = unsafe extern "C" fn(s: *mut c_void);
type StrerrorFn = unsafe extern "C" fn(error: c_int) -> *const c_char;

/// The pa_simple calls Ember uses. The library is never unloaded.
struct Lib {
    new: NewFn,
    write: WriteFn,
    free: FreeFn,
    strerror: Option<StrerrorFn>,
}

fn dl_error() -> String {
    // SAFETY: dlerror returns NULL or a NUL-terminated string owned by libc.
    let e = unsafe { dlerror() };
    if e.is_null() {
        "unknown dlopen error".to_string()
    } else {
        // SAFETY: non-null, NUL-terminated, valid until the next dl call.
        unsafe { CStr::from_ptr(e) }.to_string_lossy().into_owned()
    }
}

impl Lib {
    fn load(soname: &str) -> Result<Lib, String> {
        let name = CString::new(soname).map_err(|e| e.to_string())?;
        // SAFETY: a valid C string; dlopen has no other preconditions.
        let handle = unsafe { dlopen(name.as_ptr(), RTLD_NOW) };
        if handle.is_null() {
            return Err(dl_error());
        }
        let sym = |s: &CStr| -> Result<*mut c_void, String> {
            // SAFETY: a live handle from dlopen and a C string.
            let p = unsafe { dlsym(handle, s.as_ptr()) };
            if p.is_null() {
                Err(format!("{soname}: no {}", s.to_string_lossy()))
            } else {
                Ok(p)
            }
        };
        // SAFETY: each symbol is the libpulse-simple function of that name,
        // whose C signature the matching type above spells out.
        unsafe {
            Ok(Lib {
                new: std::mem::transmute::<*mut c_void, NewFn>(sym(c"pa_simple_new")?),
                write: std::mem::transmute::<*mut c_void, WriteFn>(sym(c"pa_simple_write")?),
                free: std::mem::transmute::<*mut c_void, FreeFn>(sym(c"pa_simple_free")?),
                // In libpulse, which libpulse-simple pulls in.
                strerror: sym(c"pa_strerror").ok().map(|p| std::mem::transmute::<*mut c_void, StrerrorFn>(p)),
            })
        }
    }

    fn describe(&self, error: c_int) -> String {
        if let Some(strerror) = self.strerror {
            // SAFETY: pa_strerror takes any int and returns NULL or a static string.
            let s = unsafe { strerror(error) };
            if !s.is_null() {
                // SAFETY: non-null and NUL-terminated.
                return unsafe { CStr::from_ptr(s) }.to_string_lossy().into_owned();
            }
        }
        format!("pulse error {error}")
    }
}

/// A pa_simple connection, owned by the one thread that writes to it.
struct Conn(*mut c_void);

// SAFETY: pa_simple runs its own mainloop thread and may be used from any
// single thread at a time; exactly one thread holds a `Conn`.
unsafe impl Send for Conn {}

// --- The server --------------------------------------------------------------------

/// The PulseAudio-protocol sound server (PulseAudio itself or pipewire-pulse).
pub struct PulseServer {
    lib: &'static Lib,
    app_name: CString,
    stream_name: CString,
}

impl PulseServer {
    /// Loads libpulse-simple, once per process. Err says why it is not there.
    pub fn load() -> Result<Self, String> {
        static LIB: OnceLock<Result<Lib, String>> = OnceLock::new();
        let lib = LIB.get_or_init(|| Lib::load(LIBRARY)).as_ref().map_err(Clone::clone)?;
        Ok(Self::with(lib))
    }

    fn with(lib: &'static Lib) -> Self {
        Self { lib, app_name: c"Ember".to_owned(), stream_name: c"Music".to_owned() }
    }
}

/// Keeps a server stream playing; dropping it ends the stream. The writer
/// thread is told to stop and frees the connection itself, so a drop never
/// waits on the server.
struct PulseStream {
    stop: Arc<AtomicBool>,
}

impl Drop for PulseStream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

impl SoundServer for PulseServer {
    fn open(&self, tap: Tap, on_lost: OnLost) -> Result<Box<dyn Any>, (String, Tap, OnLost)> {
        let (channels, rate) = (tap.channels(), tap.sample_rate());
        let spec = sample_spec(channels, rate);
        let attr = buffer_attr(channels, rate);
        let mut error: c_int = 0;
        // SAFETY: valid C strings or NULL (default server, default device,
        // default channel map), and pointers to live structs of the C layout.
        let conn = unsafe {
            (self.lib.new)(
                std::ptr::null(),
                self.app_name.as_ptr(),
                PA_STREAM_PLAYBACK,
                std::ptr::null(),
                self.stream_name.as_ptr(),
                &spec,
                std::ptr::null(),
                &attr,
                &mut error,
            )
        };
        if conn.is_null() {
            return Err((self.lib.describe(error), tap, on_lost));
        }
        let conn = Conn(conn);
        let lib = self.lib;
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        // Shared so a failed spawn can give the tap and callback back.
        let parts = Arc::new(Mutex::new(Some((tap, on_lost))));
        let thread_parts = Arc::clone(&parts);
        let spawned = std::thread::Builder::new().name("ember-pulse-output".into()).spawn(move || {
            let taken = thread_parts.lock().unwrap_or_else(PoisonError::into_inner).take();
            if let Some((tap, on_lost)) = taken {
                play(lib, conn, tap, on_lost, &thread_stop);
            } else {
                // SAFETY: the connection is ours and used by no one else.
                unsafe { (lib.free)(conn.0) };
            }
        });
        if let Err(e) = spawned {
            if let Some((tap, on_lost)) = parts.lock().unwrap_or_else(PoisonError::into_inner).take() {
                return Err((e.to_string(), tap, on_lost));
            }
        }
        Ok(Box::new(PulseStream { stop }))
    }
}

/// The writer thread: the tap's samples to the server until told to stop or
/// the connection dies, which is reported as a lost device.
fn play(lib: &Lib, conn: Conn, mut tap: Tap, mut on_lost: OnLost, stop: &AtomicBool) {
    let mut buf = vec![0.0f32; chunk_len(tap.channels(), tap.sample_rate())];
    while !stop.load(Ordering::SeqCst) {
        fill(&mut tap, &mut buf);
        let mut error: c_int = 0;
        // SAFETY: a live connection and a buffer of exactly that many bytes.
        let rc = unsafe { (lib.write)(conn.0, buf.as_ptr().cast(), std::mem::size_of_val(&buf[..]), &mut error) };
        if rc < 0 {
            if !stop.load(Ordering::SeqCst) {
                eprintln!("[ember] output: sound server stream ended: {}", lib.describe(error));
                on_lost();
            }
            break;
        }
    }
    // SAFETY: the connection is ours and freed exactly once.
    unsafe { (lib.free)(conn.0) };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_structs_have_the_c_layout() {
        // pa_sample_spec: enum (int), uint32_t, uint8_t, padded to 12.
        assert_eq!(std::mem::size_of::<SampleSpec>(), 12);
        // pa_buffer_attr: five uint32_t.
        assert_eq!(std::mem::size_of::<BufferAttr>(), 20);
    }

    #[test]
    fn the_stream_is_float_at_the_mixer_format() {
        let spec = sample_spec(2, 48_000);
        assert_eq!(spec, SampleSpec { format: PA_SAMPLE_FLOAT32LE, rate: 48_000, channels: 2 });
    }

    #[test]
    fn the_server_holds_a_tenth_of_a_second_not_its_default_two() {
        let attr = buffer_attr(2, 48_000);
        assert_eq!(attr.tlength, 48_000 / 10 * 2 * 4);
        assert_eq!((attr.maxlength, attr.prebuf, attr.minreq, attr.fragsize), (u32::MAX, u32::MAX, u32::MAX, u32::MAX));
        assert_eq!(buffer_attr(6, 44_100).tlength, 4_400 * 6 * 4);
    }

    #[test]
    fn a_chunk_is_ten_milliseconds_of_whole_frames() {
        assert_eq!(chunk_len(2, 48_000), 480 * 2);
        assert_eq!(chunk_len(1, 44_100), 440);
    }

    #[test]
    fn fill_takes_from_the_tap_in_order() {
        let mut src = (1..=6).map(|i| i as f32);
        let mut buf = [0.0; 4];
        fill(&mut src, &mut buf);
        assert_eq!(buf, [1.0, 2.0, 3.0, 4.0]);
        fill(&mut src, &mut buf);
        assert_eq!(buf, [5.0, 6.0, 0.0, 0.0]);
    }

    #[test]
    fn a_missing_library_is_a_reason_not_a_crash() {
        let err = Lib::load("libember-no-such-library.so.0").err().expect("no such library");
        assert!(err.contains("libember-no-such-library"), "{err}");
    }
}
