// Ember desktop shell, webview wrapper + native audio engine (Part 5).
//
// The main window is configured in tauri.conf.json to load the live Ember server
// URL (EMBER_APP_URL, default http://localhost:3000). The native audio engine
// (rodio + stream-download) is exposed over the `audio_*` invoke commands and
// emits `audio:*` events back to the webview.
//
// Launch order: logging, the launch history (src/gate.rs), the window, then
// the audio engine, media controls, output router and the server page
// (`start_app`). There is no launch gate and no update check at launch any
// more (owner, 2026-11-14): updates start from a tap on the page (src/update.rs).

mod applog;
mod connect;
mod audio;
mod cache;
mod discord;
mod eq;
mod external;
mod gate;
mod output;
mod repeat;
mod speech;
mod theme;
mod update;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;

/// Whether EMBER_DEVTOOLS=1 should open devtools on launch (bughunt L4):
/// only in a debug build, and only when the env var is exactly "1". Pure and
/// parameterized (rather than reading `cfg!`/`env::var` itself) so the
/// decision is unit testable independent of which profile `cargo test`
/// itself happens to run as.
fn wants_devtools_on_launch(is_debug_build: bool, env_val: Option<&str>) -> bool {
    is_debug_build && env_val == Some("1")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Logging FIRST. It used to come after the audio engine, so anything that
    // went wrong during audio init produced a silent process death with no log
    // to explain it, which is exactly what happened on a machine with no
    // output device.
    let log_path = applog::init();
    applog::write_line(log_path.as_ref(), "INFO", "ember-desktop starting");

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(discord::DiscordPresence::default())
        .manage(applog::LogFile(std::sync::Mutex::new(log_path.clone())))
        .manage(speech::new_backend(log_path.as_deref()))
        .manage(connect::Retry::default())
        // Runs in the webview BEFORE the page loads. Forwards the things that
        // are otherwise invisible in a packaged app: console errors/warnings,
        // uncaught exceptions, rejected promises, and the status of every
        // /api and /pb request (which is what you need when login fails).
        .append_invoke_initialization_script(APP_LOG_SCRIPT)
        .setup(move |app| {
            // The auto cache of upcoming songs (cache.rs). Opened here because
            // the OS cache dir comes from the app's path resolver. A failure
            // still manages a cache, one that says why it cannot store
            // anything, so the web side shows "unavailable" rather than the
            // commands failing on missing state.
            let cache = match app.path().app_cache_dir() {
                Ok(dir) => cache::AudioCache::open(dir.join(cache::DIR_NAME)),
                Err(e) => Err(format!("no cache directory: {e}")),
            };
            let cache = match cache {
                Ok(c) => {
                    let s = c.stats();
                    applog::write_line(
                        log_path.as_ref(),
                        "INFO",
                        &format!(
                            "audio cache at {} ({} songs, {} MB)",
                            c.location().map(|p| p.display().to_string()).unwrap_or_default(),
                            s.count,
                            s.bytes / (1024 * 1024)
                        ),
                    );
                    c
                }
                Err(e) => {
                    applog::write_line(log_path.as_ref(), "WARN", &format!("audio cache unavailable: {e}"));
                    cache::AudioCache::unavailable(e)
                }
            };
            app.manage(cache);

            // The launch history (src/gate.rs): the version that ran last, so
            // the first launch after an update reports it.
            let data_dir = app.path().app_local_data_dir().ok();
            let version = app.package_info().version.to_string();
            let prev = data_dir.as_deref().map(gate::load_history).unwrap_or_default();
            let (history, updated_from) = gate::on_launch(&prev, &version);
            if let Some(dir) = &data_dir {
                if let Err(e) = gate::store_history(dir, &history) {
                    applog::write_line(log_path.as_ref(), "WARN", &format!("launch history not written: {e}"));
                }
            }
            let launch = Arc::new(gate::Gate::new(data_dir, log_path.clone()));
            app.manage(launch.clone());
            if let Some(from) = updated_from {
                launch.event("update.gate.done", serde_json::json!({ "from": from, "to": version }));
            }

            create_main_window(app)?;

            // The window's background and title bar on the last theme the
            // page reported, before the remote page arrives, so a dark theme
            // never opens on a white window. See theme.rs.
            match theme::apply_stored(app.handle()) {
                Ok(true) => applog::write_line(log_path.as_ref(), "INFO", "stored theme applied"),
                Ok(false) => {}
                Err(e) => applog::write_line(
                    log_path.as_ref(),
                    "WARN",
                    &format!("stored theme not applied: {e}"),
                ),
            }

            let handle = app.handle().clone();
            let start_log = log_path.clone();
            let main_handle = handle.clone();
            if let Err(e) = handle.run_on_main_thread(move || start_app(&main_handle, start_log)) {
                applog::write_line(log_path.as_ref(), "ERROR", &format!("could not start the app: {e}"));
            }

            // Devtools: right-click → Inspect Element works in release too when
            // the `devtools` feature is on (see Cargo.toml). EMBER_DEVTOOLS=1
            // additionally opens it on launch, but only in debug builds: there
            // is no crate-level "devtools" feature to gate on (bughunt L4,
            // clippy flagged the old `#[cfg(feature = "devtools")]` here as
            // unexpected/dead code, so EMBER_DEVTOOLS=1 silently did nothing),
            // and auto-opening in a shipped release build is not the intended
            // behavior anyway.
            if wants_devtools_on_launch(cfg!(debug_assertions), std::env::var("EMBER_DEVTOOLS").ok().as_deref()) {
                if let Some(w) = app.get_webview_window("main") {
                    w.open_devtools();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio::audio_stop,
            audio::audio_load,
            audio::audio_play,
            audio::audio_pause,
            audio::audio_seek,
            audio::audio_set_volume,
            audio::audio_set_eq,
            audio::audio_set_loop,
            audio::audio_set_metadata,
            output::audio_outputs,
            output::audio_set_output,
            cache::cache_prefetch,
            cache::cache_cancel,
            cache::cache_entries,
            cache::cache_touch,
            cache::cache_evict,
            cache::cache_stats,
            cache::cache_clear,
            discord::discord_update,
            applog::log_event,
            applog::log_tail,
            speech::speech_available,
            speech::speech_start,
            speech::speech_stop,
            speech::speech_abort,
            theme::theme_apply,
            connect::connect_retry,
            gate::update_gate_events,
            update::update_download,
            update::update_install,
            update::update_take_resume,
            external::open_external,
        ])
        .build(app_context())
        .expect("error while running Ember desktop")
        .run(|_app, _event| {});
}

/// The main window, on the server. tauri.conf.json declares it with
/// `create: false` (from the launch gate's time, when it could start on a
/// bundled page) and its URL stays where connect.rs and scripts/set-url.mjs
/// read it.
fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    let Some(conf) = app.config().app.windows.iter().find(|w| w.label == "main").cloned() else {
        return Ok(());
    };
    // The window may only ever show the Ember server and the bundled pages;
    // links to other sites go to the system browser (external.rs).
    let mut own: Vec<tauri::Url> = connect::server_url(app.config()).into_iter().collect();
    if tauri::is_dev() {
        own.extend(app.config().build.dev_url.clone());
    }
    tauri::WebviewWindowBuilder::from_config(app.handle(), &conf)?
        .on_navigation(external::guard(own.clone()))
        .on_new_window(external::new_window_guard(own))
        .build()?;
    Ok(())
}

/// Everything that runs once the window exists: the audio engine, media
/// controls, the output router, the speech probe, then the server watch.
/// Runs once, on the main thread.
fn start_app(app: &tauri::AppHandle, log_path: Option<PathBuf>) {
    // A missing audio device must not stop the app from starting: the window
    // still opens and the webview falls back to web audio.
    let engine = match audio::AudioEngine::new() {
        Ok(e) => e,
        Err(e) => {
            applog::write_line(
                log_path.as_ref(),
                "WARN",
                &format!("no audio output ({e}), starting without the native engine"),
            );
            audio::AudioEngine::new_degraded()
        }
    };
    app.manage(engine);

    // Initialize OS media controls (macOS Now Playing / Linux MPRIS /
    // Windows SMTC). Non-fatal: playback still works without them, so a
    // failure is logged and swallowed rather than aborting startup.
    //
    // The outcome goes to the LOG FILE, not just stderr: a packaged
    // Windows app is a GUI subsystem binary with nowhere for stderr to
    // go, so an stderr-only message is invisible exactly where it's
    // most needed. It also gives CI something to assert on.
    let state = app.state::<audio::AudioEngine>();
    match audio::init_media_controls(app, state.inner()) {
        Ok(()) => applog::write_line(log_path.as_ref(), "INFO", "media controls ready"),
        Err(e) => {
            eprintln!("[ember] media controls unavailable: {e}");
            applog::write_line(
                log_path.as_ref(),
                "WARN",
                &format!("media controls unavailable: {e}"),
            );
        }
    }
    // The output device (src/output.rs): every change of the device
    // playing goes to the webview as `audio:outputs`, the router logs
    // into the app log, and the device chosen last session is taken
    // up again (played on at once if it is plugged in, and as soon as
    // it appears if it is not).
    if let Some(router) = state.outputs() {
        let outputs_handle = app.clone();
        router.set_listener(Box::new(move |snapshot| {
            use tauri::Emitter;
            let _ = outputs_handle.emit("audio:outputs", snapshot);
        }));
        let outputs_log = log_path.clone();
        router.set_logger(Box::new(move |level, msg| {
            applog::write_line(outputs_log.as_ref(), level, &format!("audio: {msg}"));
        }));
        match app.path().app_config_dir() {
            Ok(dir) => {
                let preferred = output::load_preferred(&dir);
                if let Some(p) = &preferred {
                    applog::write_line(log_path.as_ref(), "INFO", &format!("audio output chosen last time: {p}"));
                }
                router.set_store_dir(dir);
                router.prefer(preferred);
            }
            Err(e) => applog::write_line(
                log_path.as_ref(),
                "WARN",
                &format!("no config directory, the output device choice will not be kept: {e}"),
            ),
        }
    }
    // One line saying whether voice search can work here; CI's Windows
    // smoke test reads it. Asked off the main thread: the backends may
    // spin up a recognizer (or a WinRT grammar compile) to answer.
    let speech_handle = app.clone();
    let speech_log = log_path.clone();
    std::thread::spawn(move || {
        let a = speech_handle.state::<speech::SpeechState>().0.probe();
        speech::log(
            speech_log.as_ref(),
            "INFO",
            &format!("available={} onDevice={}", a.available, a.on_device),
        );
    });

    if let Some(w) = app.get_webview_window("main") {
        // Log the URL the window is ACTUALLY loading, read back from the
        // window itself. This used to log option_env!("EMBER_APP_URL"),
        // which is a COMPILE-time variable, unset during the CI build, so
        // the log confidently claimed "loading http://localhost:3000"
        // while the window loaded the real server from tauri.conf.json.
        // A diagnostic that lies is worse than no diagnostic.
        match w.url() {
            Ok(url) => applog::write_line(log_path.as_ref(), "INFO", &format!("main window loading {url}")),
            Err(e) => applog::write_line(log_path.as_ref(), "WARN", &format!("could not read window URL: {e}")),
        }
    }

    // The server may be out of reach (offline, down, tailnet not up
    // yet): the window then shows a Retry page instead of staying
    // dead. See connect.rs.
    tauri::async_runtime::spawn(connect::watch(app.clone(), log_path.clone()));
}

/// Injected into the webview before page scripts run.
const APP_LOG_SCRIPT: &str = r#"
;(function () {
  // The IPC bridge may not exist yet when this runs, and on a remotely-loaded
  // page it only appears if the capability whitelists this origin. So queue
  // everything and flush once (if) it shows up; give up quietly after 15s
  // rather than buffering forever.
  var queue = [];
  var ready = false;
  var bridge = function () {
    var i = window.__TAURI_INTERNALS__;
    return i && typeof i.invoke === 'function' ? i : null;
  };
  // invoke() returns a PROMISE. A rejected one (e.g. "Command log_event not
  // allowed by ACL", remote origins are denied every command the capability
  // doesn't name) fires unhandledrejection, which the handler below logs,
  // which invokes again: an infinite loop that filled the whole buffer with
  // one repeated error and drowned out every real diagnostic. A real bug
  // report came back containing nothing but 400 copies of it.
  //
  // So: swallow the rejection, AND guard against re-entry, AND never repeat
  // the same message twice in a row.
  var sending = false;
  var lastMsg = '';
  var fire = function (b, level, msg) {
    sending = true;
    try {
      var p = b.invoke('log_event', { level: level, message: msg });
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (_) {
    } finally {
      sending = false;
    }
  };
  var flush = function (b) {
    ready = true;
    while (queue.length) {
      var q = queue.shift();
      fire(b, q[0], q[1]);
    }
  };
  var send = function (level, msg) {
    if (sending) return;               // don't log our own logging
    var text = String(msg);
    if (text === lastMsg) return;      // one line, not four hundred
    lastMsg = text;
    var b = bridge();
    if (ready && b) { fire(b, level, text); return; }
    if (queue.length < 200) queue.push([level, text]);
  };
  var waited = 0;
  var timer = setInterval(function () {
    var b = bridge();
    if (b) { clearInterval(timer); flush(b); }
    else if ((waited += 100) > 15000) { clearInterval(timer); queue.length = 0; }
  }, 100);

  var fmt = function (args) {
    return Array.prototype.map.call(args, function (a) {
      if (a instanceof Error) return a.message + ' | ' + (a.stack || '');
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch (_) { return '[object]'; } }
      return String(a);
    }).join(' ');
  };
  ['error', 'warn'].forEach(function (name) {
    var orig = console[name].bind(console);
    console[name] = function () { send(name, fmt(arguments)); orig.apply(null, arguments); };
  });
  window.addEventListener('error', function (e) {
    send('error', 'uncaught: ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    send('error', 'unhandled rejection: ' + ((e.reason && (e.reason.message || e.reason)) || ''));
  });
  // Every auth / API call with its status, the missing piece when a login
  // fails inside the shell and there is no console to look at.
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init && init.method) || (input && input.method) || 'GET';
    var watch = url.indexOf('/pb/') !== -1 || url.indexOf('/api/') !== -1;
    // Drop the query string before it hits the log: search terms, tokens
    // passed as params, etc. shouldn't end up in the desktop log file.
    var loggedUrl = url.split('?')[0];
    return origFetch.apply(this, arguments).then(function (res) {
      if (watch) send(res.ok ? 'info' : 'warn', 'fetch ' + method + ' ' + loggedUrl + ' -> ' + res.status);
      return res;
    }).catch(function (err) {
      if (watch) send('error', 'fetch ' + method + ' ' + loggedUrl + ' FAILED: ' + (err && err.message));
      throw err;
    });
  };
  send('info', 'webview logging active @ ' + location.href + ' | bridge at load: ' + (bridge() ? 'yes' : 'no'));
})();
"#;

/// The app's compiled-in config and assets. One place only: the macro
/// embeds the Info.plist under a fixed symbol, so a second expansion (the
/// version test's) would not link.
fn app_context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

#[cfg(test)]
mod packaging_tests;

// Uses tauri's mock app, which is not built on Windows (see Cargo.toml).
#[cfg(all(test, not(windows)))]
mod version_tests;

#[cfg(test)]
mod launch_order_tests {
    const LIB: &str = include_str!("lib.rs");

    fn body_of(name: &str) -> &'static str {
        let start = LIB.find(&format!("fn {name}(")).unwrap_or_else(|| panic!("no fn {name}"));
        let rest = &LIB[start..];
        // A Windows checkout may have CRLF line endings.
        let end = rest.find("\n}\n").or_else(|| rest.find("\r\n}\r\n")).expect("end of fn");
        &rest[..end]
    }

    #[test]
    fn the_audio_engine_and_media_controls_start_in_start_app() {
        let needle = ["AudioEngine", "::new()"].concat();
        let start = body_of("start_app");
        assert!(start.contains(&needle));
        assert!(start.contains("init_media_controls"));
        assert!(start.contains("connect::watch"));
    }

    /// Owner, 2026-11-14: no launch gate, no update check at launch, no
    /// required updates. The window opens on the server; updates start from
    /// a tap on the page.
    #[test]
    fn the_app_opens_on_the_server_with_no_launch_gate() {
        let run = body_of("run");
        assert!(run.contains("create_main_window(app)?"));
        assert!(!LIB.contains(&["GATE", "_PAGE"].concat()));
        assert!(!LIB.contains(&["gate::", "run("].concat()));
        let gone = ["update::check", "_on_startup"].concat();
        assert!(!LIB.contains(&gone), "no background update check");
        assert!(!std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/offline/gate.html")).exists());
    }

    #[test]
    fn the_update_commands_are_registered_and_allowed() {
        let allowed = include_str!("../permissions/app-commands.toml");
        for cmd in ["gate::update_gate_events", "update::update_download", "update::update_install", "update::update_take_resume"] {
            assert!(LIB.contains(cmd), "{cmd} not registered");
            let name = cmd.split("::").last().unwrap();
            assert!(allowed.contains(&format!("\"{name}\"")), "{name} not allowed");
        }
        for gone in ["gate_state", "gate_not_now", "gate_update_now", "gate_quit", "update_restart"] {
            assert!(!allowed.contains(&format!("\"{gone}\"")), "{gone} is still allowed");
        }
    }
}

#[cfg(test)]
mod devtools_tests {
    use super::wants_devtools_on_launch;

    #[test]
    fn opens_in_a_debug_build_when_asked() {
        assert!(wants_devtools_on_launch(true, Some("1")));
    }

    #[test]
    fn stays_closed_in_a_release_build_even_when_asked() {
        assert!(!wants_devtools_on_launch(false, Some("1")));
    }

    #[test]
    fn stays_closed_in_a_debug_build_when_not_asked() {
        assert!(!wants_devtools_on_launch(true, None));
        assert!(!wants_devtools_on_launch(true, Some("0")));
    }
}

#[cfg(test)]
mod capability_tests {
    // bughunt L3: the checked-in capability used to grant IPC (native audio,
    // Discord presence, log reading) to http://localhost:3000 unconditionally,
    // even in the file a signed release build ships with if for any reason
    // scripts/set-url.mjs's rewrite is skipped. That script now writes ONLY
    // the origin EMBER_APP_URL points at, and this checked-in default must
    // stay just as narrow, so a shipped build never trusts an unrelated
    // localhost:3000 on the user's machine.
    const DEFAULT_CAPABILITY: &str =
        include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities/default.json"));

    /// The exact string a compromised or merely nosy local process could bind
    /// to on the user's own machine. Built from parts so this file itself
    /// does not read as "the capability grants access to X", which would
    /// make the assertion below trivially true no matter what the JSON says.
    fn local_dev_origin() -> String {
        format!("http://{}:{}", "localhost", 3000)
    }

    #[test]
    fn shipped_capability_does_not_trust_the_local_dev_server() {
        let cap: serde_json::Value = serde_json::from_str(DEFAULT_CAPABILITY).expect("valid JSON");
        let urls = cap["remote"]["urls"].as_array().expect("remote.urls array");
        let origin = local_dev_origin();
        assert!(
            !urls.iter().any(|u| u.as_str() == Some(origin.as_str())),
            "capabilities/default.json must not grant IPC to the local dev server in a shipped build: {urls:?}"
        );
    }

    #[test]
    fn shipped_capability_still_grants_the_real_server() {
        let cap: serde_json::Value = serde_json::from_str(DEFAULT_CAPABILITY).expect("valid JSON");
        let urls = cap["remote"]["urls"].as_array().expect("remote.urls array");
        assert!(
            urls.iter().any(|u| u.as_str().is_some_and(|s| s.contains("ember.tailf4de41.ts.net"))),
            "capabilities/default.json must still grant IPC to the real Ember server: {urls:?}"
        );
    }
}
