// Ember desktop: the auto cache of upcoming songs (offline plan, Task 7).
//
// The web layer decides WHAT to cache (apps/web/lib/autoCache/policy.ts,
// driven by useAutoCache); this file is only the storage it drives: a plain
// directory under the OS cache dir, one file per track, an index with the
// last time each was played, and a least-recently-used eviction that keeps
// the directory under 500 MB and 100 files.
//
// Why not stream-download's BoundedStorageProvider: it bounds the temp buffer
// of ONE stream, it is not a cache of many files. The player keeps its own
// temp-file stream for the current song (that file already holds the whole
// song once it has arrived); a prefetch is a separate plain download into
// this directory, and `audio_load` opens a cached file directly.
//
// Release builds use `panic = "abort"`, so nothing here unwraps anything from
// the network, the filesystem or the webview: every failure is a value.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use stream_download::http::reqwest::header::{CONTENT_TYPE, RETRY_AFTER};
use stream_download::http::reqwest::Client;
use tauri::State;

/// Folder name under `app_cache_dir()`.
pub const DIR_NAME: &str = "audio-cache";
/// Owner-approved defaults: a listening session's worth on a desktop disk.
pub const CAP_BYTES: u64 = 500 * 1024 * 1024;
pub const MAX_FILES: usize = 100;

const INDEX_FILE: &str = "index.json";
const INDEX_VERSION: u32 = 1;
const DATA_EXT: &str = "bin";
const PART_EXT: &str = "part";
/// Longest track id accepted; Ember ids are `<source>:<id>`, far shorter.
const MAX_KEY_LEN: usize = 512;
/// The readable part of a file name; the hash after it keeps names unique.
const MAX_STEM_LEN: usize = 80;

/// How long the host gets to send response headers. A prefetch of a cold
/// song is refused by the server (503) rather than run, so a long wait here
/// means a sick connection, not a busy yt-dlp.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// Longest silence between two chunks before the download is dropped.
const IDLE_TIMEOUT: Duration = Duration::from_secs(30);

// --- File names ---------------------------------------------------------------

/// FNV-1a, 64 bit. Written out rather than taken from `std`'s hasher because
/// file names must stay the same across Rust versions, and a whole crate for
/// one hash is not worth it: the index maps every key to its file anyway, so
/// the hash only has to keep two keys from sharing a name.
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// The file name a track id is stored under, without extension.
///
/// Ids come from the webview (`youtube:<id>`, `upload:<id>`), so they are
/// untrusted: anything outside `[A-Za-z0-9_-]` becomes `_`, which rules out
/// separators, `..` and drive letters, and the length is bounded. The hash of
/// the raw id keeps `youtube:a` and `youtube_a` apart.
pub fn file_stem_for(key: &str) -> String {
    let readable: String = key
        .chars()
        .take(MAX_STEM_LEN)
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    format!("{readable}-{:016x}", fnv1a64(key.as_bytes()))
}

fn valid_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > MAX_KEY_LEN {
        return Err("invalid cache key".into());
    }
    Ok(())
}

/// The stream URL without the `prefetch=1` marker: what playback would ask
/// for, kept so a cached copy that turns out unreadable can still be streamed.
pub fn strip_prefetch_marker(url: &str) -> String {
    let (base, query) = match url.split_once('?') {
        Some((b, q)) => (b, q),
        None => return url.to_string(),
    };
    let kept: Vec<&str> = query.split('&').filter(|p| *p != "prefetch=1" && !p.is_empty()).collect();
    if kept.is_empty() {
        base.to_string()
    } else {
        format!("{base}?{}", kept.join("&"))
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

// --- Index (pure) -------------------------------------------------------------

/// One cached track.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub key: String,
    /// File name inside the cache dir (stem + `.bin`).
    pub file: String,
    pub bytes: u64,
    pub last_used_ms: u64,
    pub added_ms: u64,
    #[serde(default)]
    pub mime: Option<String>,
    /// The stream URL it came from, without the prefetch marker.
    #[serde(default)]
    pub url: Option<String>,
}

/// What `cache_entries` answers per song: the web side's policy sizes its
/// room check and orders eviction by these, so it needs the real numbers.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySummary {
    pub key: String,
    pub bytes: u64,
    pub last_used_ms: u64,
}

#[derive(Serialize, Deserialize)]
struct IndexFile {
    v: u32,
    entries: Vec<Entry>,
}

/// What is on disk, in memory. No IO: every rule the tests pin lives here.
#[derive(Default, Debug, Clone)]
pub struct Index {
    entries: HashMap<String, Entry>,
}

impl Index {
    pub fn total_bytes(&self) -> u64 {
        self.entries.values().map(|e| e.bytes).sum()
    }

    pub fn count(&self) -> usize {
        self.entries.len()
    }

    pub fn get(&self, key: &str) -> Option<&Entry> {
        self.entries.get(key)
    }

    pub fn keys(&self) -> Vec<String> {
        let mut k: Vec<String> = self.entries.keys().cloned().collect();
        k.sort();
        k
    }

    /// Every entry as the web side's policy needs it, sorted by key.
    pub fn summaries(&self) -> Vec<EntrySummary> {
        let mut v: Vec<EntrySummary> = self
            .entries
            .values()
            .map(|e| EntrySummary { key: e.key.clone(), bytes: e.bytes, last_used_ms: e.last_used_ms })
            .collect();
        v.sort_by(|a, b| a.key.cmp(&b.key));
        v
    }

    pub fn insert(&mut self, entry: Entry) {
        // Two ids hashing to one name would share a file: the older one goes.
        self.entries.retain(|k, e| k == &entry.key || e.file != entry.file);
        self.entries.insert(entry.key.clone(), entry);
    }

    pub fn remove(&mut self, key: &str) -> Option<Entry> {
        self.entries.remove(key)
    }

    /// Marks `key` played at `at`. False when it is not cached.
    pub fn touch(&mut self, key: &str, at: u64) -> bool {
        match self.entries.get_mut(key) {
            Some(e) => {
                e.last_used_ms = e.last_used_ms.max(at);
                true
            }
            None => false,
        }
    }

    /// Least recently used first, never an id in `keep`. Ties by id, so the
    /// order is the same on every run.
    pub fn lru_order(&self, keep: &[&str]) -> Vec<&Entry> {
        let mut out: Vec<&Entry> = self.entries.values().filter(|e| !keep.contains(&e.key.as_str())).collect();
        out.sort_by(|a, b| a.last_used_ms.cmp(&b.last_used_ms).then_with(|| a.key.cmp(&b.key)));
        out
    }

    /// Which ids to delete so `incoming_bytes` more (under `incoming_key`)
    /// fits within `cap` bytes and `max_files` files. `None` means it cannot
    /// fit even after evicting everything evictable: then nothing is deleted
    /// and the write is skipped, rather than emptying the cache for a file
    /// that is refused anyway.
    pub fn eviction_plan(
        &self,
        incoming_key: &str,
        incoming_bytes: u64,
        keep: &[&str],
        cap: u64,
        max_files: usize,
    ) -> Option<Vec<String>> {
        // Replacing an entry frees its own bytes and slot first.
        let (mut bytes, mut count) = match self.entries.get(incoming_key) {
            Some(old) => (self.total_bytes() - old.bytes, self.count() - 1),
            None => (self.total_bytes(), self.count()),
        };
        let fits = |bytes: u64, count: usize| {
            bytes.saturating_add(incoming_bytes) <= cap && count < max_files.max(1)
        };
        let mut out = Vec::new();
        for e in self.lru_order(keep) {
            if fits(bytes, count) {
                break;
            }
            if e.key == incoming_key {
                continue;
            }
            bytes -= e.bytes;
            count -= 1;
            out.push(e.key.clone());
        }
        fits(bytes, count).then_some(out)
    }

    /// Ids to delete so the cache is within its caps with nothing incoming
    /// (after the caps shrank, or a hand-edited index).
    pub fn over_cap(&self, keep: &[&str], cap: u64, max_files: usize) -> Vec<String> {
        let mut bytes = self.total_bytes();
        let mut count = self.count();
        let mut out = Vec::new();
        for e in self.lru_order(keep) {
            if bytes <= cap && count <= max_files {
                break;
            }
            bytes -= e.bytes;
            count -= 1;
            out.push(e.key.clone());
        }
        out
    }
}

// --- Outcomes -----------------------------------------------------------------

/// What a prefetch ended as. Serialised for the webview as
/// `{ kind: 'done' | 'retry-after' | 'gone' | 'failed' | 'busy' | 'cancelled', ... }`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PrefetchOutcome {
    Done { bytes: u64 },
    /// 429 (per-user limit) or 503 (host busy). `seconds` is the server's
    /// Retry-After when it sent a number of seconds.
    RetryAfter { status: u16, seconds: Option<u64> },
    /// 410: the host flagged the song unavailable.
    Gone,
    Failed { message: String },
    /// Another prefetch is running. The web policy runs one at a time, so this
    /// is a guard, not a path it takes.
    Busy,
    /// `cache_cancel` stopped it (the queue moved on).
    Cancelled,
}

/// What an HTTP status means for a prefetch: `None` is "a body to store".
pub fn classify_status(status: u16, retry_after: Option<&str>) -> Option<PrefetchOutcome> {
    match status {
        200..=299 => None,
        410 => Some(PrefetchOutcome::Gone),
        429 | 503 => Some(PrefetchOutcome::RetryAfter {
            status,
            // Only the delta-seconds form; an HTTP date is rare here and the
            // policy's own backoff is a fine answer to it.
            seconds: retry_after.and_then(|v| v.trim().parse::<u64>().ok()),
        }),
        other => Some(PrefetchOutcome::Failed { message: format!("the host answered {other}") }),
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub bytes: u64,
    pub count: usize,
    pub cap: u64,
    pub max_files: usize,
}

// --- The cache directory ------------------------------------------------------

/// Stops the download in flight. `notify_one` keeps a permit when nobody is
/// waiting yet, so a cancel between two chunks is not lost.
struct CancelSignal {
    flag: AtomicBool,
    notify: tokio::sync::Notify,
}

impl CancelSignal {
    fn new() -> Self {
        Self { flag: AtomicBool::new(false), notify: tokio::sync::Notify::new() }
    }
    fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.notify.notify_one();
    }
    fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
}

/// Tauri managed state: the cache directory and its index.
pub struct AudioCache {
    /// `None` when the OS gave no cache dir or it could not be created: every
    /// command then reports the reason and the web side shows "unavailable".
    root: Option<PathBuf>,
    unavailable: Option<String>,
    cap_bytes: u64,
    max_files: usize,
    index: Mutex<Index>,
    /// The id the engine is playing from this cache, never evicted.
    playing: Mutex<Option<String>>,
    /// One prefetch at a time; a second one answers `Busy` instead of waiting.
    prefetch_gate: tokio::sync::Mutex<()>,
    cancel: Mutex<Option<Arc<CancelSignal>>>,
}

fn relock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panic elsewhere while holding the lock aborts the app in release, so
    // a poisoned lock only shows up in tests; the data is still consistent
    // enough to use (each mutation is a single insert or remove).
    m.lock().unwrap_or_else(|p| p.into_inner())
}

impl AudioCache {
    /// Opens (creating) the cache at `root` with the default caps.
    pub fn open(root: PathBuf) -> Result<Self, String> {
        Self::open_with(root, CAP_BYTES, MAX_FILES)
    }

    /// Opens the cache: removes half-written `.part` files, forgets entries
    /// whose file is gone or the wrong size, deletes files no entry names,
    /// and trims to the caps.
    pub fn open_with(root: PathBuf, cap_bytes: u64, max_files: usize) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|e| format!("could not create {}: {e}", root.display()))?;
        let loaded = read_index(&root);
        let mut index = Index::default();
        for e in loaded {
            // The index is a file anyone can edit: an entry only counts when
            // its file name is the one its key sanitises to, so a hand-made
            // entry can never point this code (or a later delete) outside
            // the cache dir. Anything else is dropped without touching disk;
            // a real file it named goes with the orphan sweep below.
            if valid_key(&e.key).is_err() || e.file != format!("{}.{DATA_EXT}", file_stem_for(&e.key)) {
                continue;
            }
            let path = root.join(&e.file);
            if fs::metadata(&path).map(|m| m.is_file() && m.len() == e.bytes).unwrap_or(false) {
                index.insert(e);
            } else {
                let _ = fs::remove_file(&path);
            }
        }
        if let Ok(dir) = fs::read_dir(&root) {
            for item in dir.flatten() {
                let name = item.file_name().to_string_lossy().into_owned();
                let path = item.path();
                let is_part = path.extension().is_some_and(|x| x == PART_EXT);
                let is_orphan = path.extension().is_some_and(|x| x == DATA_EXT)
                    && !index.entries.values().any(|e| e.file == name);
                if is_part || is_orphan {
                    let _ = fs::remove_file(&path);
                }
            }
        }
        for key in index.over_cap(&[], cap_bytes, max_files) {
            if let Some(e) = index.remove(&key) {
                let _ = fs::remove_file(root.join(&e.file));
            }
        }
        write_index(&root, &index)?;
        Ok(Self {
            root: Some(root),
            unavailable: None,
            cap_bytes,
            max_files,
            index: Mutex::new(index),
            playing: Mutex::new(None),
            prefetch_gate: tokio::sync::Mutex::new(()),
            cancel: Mutex::new(None),
        })
    }

    /// A cache that stores nothing and says why.
    pub fn unavailable(reason: String) -> Self {
        Self {
            root: None,
            unavailable: Some(reason),
            cap_bytes: CAP_BYTES,
            max_files: MAX_FILES,
            index: Mutex::new(Index::default()),
            playing: Mutex::new(None),
            prefetch_gate: tokio::sync::Mutex::new(()),
            cancel: Mutex::new(None),
        }
    }

    fn root(&self) -> Result<&Path, String> {
        match &self.root {
            Some(r) => Ok(r),
            None => Err(format!(
                "audio cache unavailable: {}",
                self.unavailable.as_deref().unwrap_or("no cache directory")
            )),
        }
    }

    pub fn location(&self) -> Option<&Path> {
        self.root.as_deref()
    }

    pub fn stats(&self) -> CacheStats {
        let idx = relock(&self.index);
        CacheStats { bytes: idx.total_bytes(), count: idx.count(), cap: self.cap_bytes, max_files: self.max_files }
    }

    pub fn keys(&self) -> Vec<String> {
        relock(&self.index).keys()
    }

    pub fn entries(&self) -> Vec<EntrySummary> {
        relock(&self.index).summaries()
    }

    /// The file holding `key`, if it is cached and still on disk.
    pub fn path_for(&self, key: &str) -> Option<PathBuf> {
        let root = self.root.as_ref()?;
        let mut idx = relock(&self.index);
        let file = idx.get(key)?.file.clone();
        let path = root.join(file);
        if path.is_file() {
            Some(path)
        } else {
            // Someone emptied the folder by hand: forget it.
            idx.remove(key);
            let _ = write_index(root, &idx);
            None
        }
    }

    /// The URL `key` was downloaded from (prefetch marker stripped).
    pub fn source_url(&self, key: &str) -> Option<String> {
        relock(&self.index).get(key).and_then(|e| e.url.clone())
    }

    pub fn touch(&self, key: &str) {
        self.touch_at(key, now_ms());
    }

    pub(crate) fn touch_at(&self, key: &str, at: u64) {
        let Some(root) = self.root.as_ref() else { return };
        let mut idx = relock(&self.index);
        if idx.touch(key, at) {
            let _ = write_index(root, &idx);
        }
    }

    /// The id the engine is playing now (`None` when it plays something else).
    /// It is never evicted to make room for a prefetch.
    pub fn set_playing(&self, key: Option<String>) {
        *relock(&self.playing) = key;
    }

    pub fn evict(&self, keys: &[String]) -> Result<(), String> {
        let root = self.root()?;
        let mut idx = relock(&self.index);
        for key in keys {
            if let Some(e) = idx.remove(key) {
                let _ = fs::remove_file(root.join(&e.file));
            }
        }
        write_index(root, &idx)
    }

    pub fn clear(&self) -> Result<(), String> {
        self.cancel();
        let root = self.root()?;
        let mut idx = relock(&self.index);
        for e in idx.entries.values() {
            let _ = fs::remove_file(root.join(&e.file));
        }
        idx.entries.clear();
        write_index(root, &idx)
    }

    /// Stops the prefetch in flight, if any.
    pub fn cancel(&self) {
        if let Some(c) = relock(&self.cancel).as_ref() {
            c.cancel();
        }
    }

    /// Downloads `url` into the cache as `key`.
    ///
    /// Written to `<file>.part` and renamed into place only once the whole
    /// body is on disk (and matches its Content-Length), so a dropped
    /// connection, a crash or a cancel never leaves a truncated song that
    /// would later play as if complete.
    pub async fn prefetch(&self, client: Client, url: &str, key: &str) -> PrefetchOutcome {
        let failed = |message: String| PrefetchOutcome::Failed { message };
        if let Err(e) = valid_key(key) {
            return failed(e);
        }
        let root = match self.root() {
            Ok(r) => r.to_path_buf(),
            Err(e) => return failed(e),
        };
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return failed("only http(s) stream URLs can be cached".into());
        }
        if let Some(e) = relock(&self.index).get(key) {
            if root.join(&e.file).is_file() {
                return PrefetchOutcome::Done { bytes: e.bytes };
            }
        }
        let Ok(_gate) = self.prefetch_gate.try_lock() else {
            return PrefetchOutcome::Busy;
        };
        let signal = Arc::new(CancelSignal::new());
        *relock(&self.cancel) = Some(Arc::clone(&signal));
        let outcome = self.download(&root, client, url, key, &signal).await;
        *relock(&self.cancel) = None;
        outcome
    }

    async fn download(
        &self,
        root: &Path,
        client: Client,
        url: &str,
        key: &str,
        signal: &CancelSignal,
    ) -> PrefetchOutcome {
        let failed = |message: String| PrefetchOutcome::Failed { message };
        let stem = file_stem_for(key);
        let part = root.join(format!("{stem}.{PART_EXT}"));
        let dest_name = format!("{stem}.{DATA_EXT}");

        let send = client.get(url).send();
        let mut resp = tokio::select! {
            _ = signal.notify.notified() => return PrefetchOutcome::Cancelled,
            r = tokio::time::timeout(CONNECT_TIMEOUT, send) => match r {
                Err(_) => return failed(format!("the host sent nothing for {}s", CONNECT_TIMEOUT.as_secs())),
                Ok(Err(e)) => return failed(format!("request failed: {e}")),
                Ok(Ok(r)) => r,
            },
        };
        let retry_after = resp.headers().get(RETRY_AFTER).and_then(|v| v.to_str().ok()).map(str::to_owned);
        if let Some(outcome) = classify_status(resp.status().as_u16(), retry_after.as_deref()) {
            return outcome;
        }
        let declared = resp.content_length();
        if declared.is_some_and(|len| len > self.cap_bytes) {
            return failed("the song is larger than the whole cache".into());
        }
        let mime = resp.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_owned);

        let mut file = match fs::File::create(&part) {
            Ok(f) => f,
            Err(e) => return failed(format!("could not write the cache: {e}")),
        };
        // Everything below that gives up removes the .part on the way out.
        let give_up = |outcome: PrefetchOutcome| {
            let _ = fs::remove_file(&part);
            outcome
        };
        let mut written: u64 = 0;
        loop {
            if signal.is_cancelled() {
                return give_up(PrefetchOutcome::Cancelled);
            }
            let chunk = tokio::select! {
                _ = signal.notify.notified() => return give_up(PrefetchOutcome::Cancelled),
                c = tokio::time::timeout(IDLE_TIMEOUT, resp.chunk()) => c,
            };
            match chunk {
                Err(_) => {
                    return give_up(failed(format!("the song stopped arriving (nothing for {}s)", IDLE_TIMEOUT.as_secs())))
                }
                Ok(Err(e)) => return give_up(failed(format!("the download broke off: {e}"))),
                Ok(Ok(None)) => break,
                Ok(Ok(Some(bytes))) => {
                    written += bytes.len() as u64;
                    if written > self.cap_bytes {
                        return give_up(failed("the song is larger than the whole cache".into()));
                    }
                    if let Err(e) = file.write_all(&bytes) {
                        return give_up(failed(format!("could not write the cache: {e}")));
                    }
                }
            }
        }
        if let Err(e) = file.flush().and_then(|_| file.sync_all()) {
            return give_up(failed(format!("could not write the cache: {e}")));
        }
        drop(file);
        if written == 0 {
            return give_up(failed("the host sent an empty body".into()));
        }
        if declared.is_some_and(|len| len != written) {
            return give_up(failed(format!(
                "the download ended early ({written} of {} bytes)",
                declared.unwrap_or(0)
            )));
        }
        if signal.is_cancelled() {
            return give_up(PrefetchOutcome::Cancelled);
        }

        // Commit: make room, move the file into place, record it.
        let playing = relock(&self.playing).clone();
        let mut idx = relock(&self.index);
        let mut keep: Vec<&str> = vec![key];
        if let Some(p) = playing.as_deref() {
            keep.push(p);
        }
        let Some(evict) = idx.eviction_plan(key, written, &keep, self.cap_bytes, self.max_files) else {
            return give_up(failed("no room in the cache without evicting the song that is playing".into()));
        };
        for k in &evict {
            if let Some(e) = idx.remove(k) {
                let _ = fs::remove_file(root.join(&e.file));
            }
        }
        if let Err(e) = fs::rename(&part, root.join(&dest_name)) {
            let _ = write_index(root, &idx);
            return give_up(failed(format!("could not move the song into the cache: {e}")));
        }
        let now = now_ms();
        idx.insert(Entry {
            key: key.to_string(),
            file: dest_name,
            bytes: written,
            last_used_ms: now,
            added_ms: now,
            mime,
            url: Some(strip_prefetch_marker(url)),
        });
        if let Err(e) = write_index(root, &idx) {
            // The file is in place; the next start forgets it as an orphan.
            return failed(e);
        }
        PrefetchOutcome::Done { bytes: written }
    }
}

fn read_index(root: &Path) -> Vec<Entry> {
    fs::read(root.join(INDEX_FILE))
        .ok()
        .and_then(|raw| serde_json::from_slice::<IndexFile>(&raw).ok())
        .filter(|f| f.v == INDEX_VERSION)
        .map(|f| f.entries)
        .unwrap_or_default()
}

/// Temp file then rename, so a crash mid-write leaves the old index whole.
fn write_index(root: &Path, idx: &Index) -> Result<(), String> {
    let mut entries: Vec<Entry> = idx.entries.values().cloned().collect();
    entries.sort_by(|a, b| a.key.cmp(&b.key));
    let body = serde_json::to_vec_pretty(&IndexFile { v: INDEX_VERSION, entries })
        .map_err(|e| format!("could not encode the cache index: {e}"))?;
    let tmp = root.join(format!("{INDEX_FILE}.tmp"));
    fs::write(&tmp, body).map_err(|e| format!("could not write the cache index: {e}"))?;
    fs::rename(&tmp, root.join(INDEX_FILE)).map_err(|e| format!("could not write the cache index: {e}"))
}

// --- Commands -----------------------------------------------------------------
//
// All async so their file work runs on the async runtime, not the main
// thread (a sync command runs on the main thread). Every one is listed in
// permissions/app-commands.toml: the remote page is denied otherwise.

#[tauri::command]
pub async fn cache_prefetch(
    cache: State<'_, AudioCache>,
    url: String,
    key: String,
    cookie: Option<String>,
) -> Result<PrefetchOutcome, String> {
    let client = crate::audio::http_client(cookie.as_deref())?;
    Ok(cache.prefetch(client, &url, &key).await)
}

#[tauri::command]
pub async fn cache_cancel(cache: State<'_, AudioCache>) -> Result<(), String> {
    cache.cancel();
    Ok(())
}

#[tauri::command]
pub async fn cache_has(cache: State<'_, AudioCache>, key: String) -> Result<bool, String> {
    cache.root()?;
    Ok(cache.path_for(&key).is_some())
}

#[tauri::command]
pub async fn cache_keys(cache: State<'_, AudioCache>) -> Result<Vec<String>, String> {
    cache.root()?;
    Ok(cache.keys())
}

#[tauri::command]
pub async fn cache_entries(cache: State<'_, AudioCache>) -> Result<Vec<EntrySummary>, String> {
    cache.root()?;
    Ok(cache.entries())
}

#[tauri::command]
pub async fn cache_path(cache: State<'_, AudioCache>, key: String) -> Result<Option<String>, String> {
    cache.root()?;
    Ok(cache.path_for(&key).map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn cache_touch(cache: State<'_, AudioCache>, key: String) -> Result<(), String> {
    cache.root()?;
    cache.touch(&key);
    Ok(())
}

#[tauri::command]
pub async fn cache_evict(cache: State<'_, AudioCache>, keys: Vec<String>) -> Result<(), String> {
    cache.evict(&keys)
}

#[tauri::command]
pub async fn cache_stats(cache: State<'_, AudioCache>) -> Result<CacheStats, String> {
    cache.root()?;
    Ok(cache.stats())
}

#[tauri::command]
pub async fn cache_clear(cache: State<'_, AudioCache>) -> Result<(), String> {
    cache.clear()
}

#[cfg(test)]
pub(crate) mod tests;
