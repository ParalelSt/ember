// Ember desktop shell — webview wrapper + native audio engine (Part 5).
//
// The main window is configured in tauri.conf.json to load the live Ember server
// URL (EMBER_APP_URL, default http://localhost:3000). The native audio engine
// (rodio + stream-download) is exposed over the `audio_*` invoke commands and
// emits `audio:*` events back to the webview.

mod applog;
mod audio;
mod discord;
mod update;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Logging FIRST. It used to come after the audio engine, so anything that
    // went wrong during audio init produced a silent process death with no log
    // to explain it — which is exactly what happened on a machine with no
    // output device.
    let log_path = applog::init();
    applog::write_line(log_path.as_ref(), "INFO", "ember-desktop starting");

    // A missing audio device must not stop the app from starting: the window
    // still opens and the webview falls back to web audio.
    let engine = match audio::AudioEngine::new() {
        Ok(e) => e,
        Err(e) => {
            applog::write_line(
                log_path.as_ref(),
                "WARN",
                &format!("no audio output ({e}) — starting without the native engine"),
            );
            audio::AudioEngine::new_degraded()
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(engine)
        .manage(discord::DiscordPresence::default())
        .manage(applog::LogFile(std::sync::Mutex::new(log_path.clone())))
        // Runs in the webview BEFORE the page loads. Forwards the things that
        // are otherwise invisible in a packaged app: console errors/warnings,
        // uncaught exceptions, rejected promises, and the status of every
        // /api and /pb request (which is what you need when login fails).
        .append_invoke_initialization_script(APP_LOG_SCRIPT)
        .setup(move |app| {
            // Initialize OS media controls (macOS Now Playing / Linux MPRIS /
            // Windows SMTC). Non-fatal: playback still works without them, so a
            // failure is logged and swallowed rather than aborting startup.
            //
            // The outcome goes to the LOG FILE, not just stderr: a packaged
            // Windows app is a GUI subsystem binary with nowhere for stderr to
            // go, so an stderr-only message is invisible exactly where it's
            // most needed. It also gives CI something to assert on.
            let handle = app.handle().clone();
            let state = app.state::<audio::AudioEngine>();
            match audio::init_media_controls(&handle, state.inner()) {
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
            // Log the URL the window is ACTUALLY loading, read back from the
            // window itself. This used to log option_env!("EMBER_APP_URL"),
            // which is a COMPILE-time variable — unset during the CI build, so
            // the log confidently claimed "loading http://localhost:3000"
            // while the window loaded the real server from tauri.conf.json.
            // A diagnostic that lies is worse than no diagnostic.
            if let Some(w) = app.get_webview_window("main") {
                match w.url() {
                    Ok(url) => applog::write_line(
                        log_path.as_ref(),
                        "INFO",
                        &format!("main window loading {url}"),
                    ),
                    Err(e) => applog::write_line(
                        log_path.as_ref(),
                        "WARN",
                        &format!("could not read window URL: {e}"),
                    ),
                }
            }

            // Check for a new desktop build in the background. Never blocks
            // startup, and a failure is logged rather than surfaced — see
            // update.rs. EMBER_NO_UPDATE=1 opts out (used by CI's smoke test,
            // which shouldn't reach the network).
            if std::env::var("EMBER_NO_UPDATE").as_deref() != Ok("1") {
                let update_handle = app.handle().clone();
                let update_log = log_path.clone();
                tauri::async_runtime::spawn(async move {
                    update::check_on_startup(update_handle, update_log).await;
                });
            }

            // Devtools: right-click → Inspect Element works in release too when
            // the `devtools` feature is on. EMBER_DEVTOOLS=1 opens it on launch.
            #[cfg(feature = "devtools")]
            if std::env::var("EMBER_DEVTOOLS").as_deref() == Ok("1") {
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
            audio::audio_set_metadata,
            discord::discord_update,
            applog::log_event,
            applog::log_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ember desktop");
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
  var flush = function (b) {
    ready = true;
    while (queue.length) {
      var q = queue.shift();
      try { b.invoke('log_event', { level: q[0], message: q[1] }); } catch (_) {}
    }
  };
  var send = function (level, msg) {
    var b = bridge();
    if (ready && b) { try { b.invoke('log_event', { level: level, message: String(msg) }); } catch (_) {} return; }
    if (queue.length < 200) queue.push([level, String(msg)]);
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
  // Every auth / API call with its status — the missing piece when a login
  // fails inside the shell and there is no console to look at.
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init && init.method) || (input && input.method) || 'GET';
    var watch = url.indexOf('/pb/') !== -1 || url.indexOf('/api/') !== -1;
    return origFetch.apply(this, arguments).then(function (res) {
      if (watch) send(res.ok ? 'info' : 'warn', 'fetch ' + method + ' ' + url + ' -> ' + res.status);
      return res;
    }).catch(function (err) {
      if (watch) send('error', 'fetch ' + method + ' ' + url + ' FAILED: ' + (err && err.message));
      throw err;
    });
  };
  send('info', 'webview logging active @ ' + location.href + ' | bridge at load: ' + (bridge() ? 'yes' : 'no'));
})();
"#;
