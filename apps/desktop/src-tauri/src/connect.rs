//! What the window shows when the Ember server is out of reach at launch.
//!
//! The main window loads the server straight off the network
//! (tauri.conf.json). With the server down, offline, or the tailnet not up
//! yet, that load failed and the window stayed blank (or showed the
//! webview's own error page) with nothing to click, until Ember was quit and
//! opened again.
//!
//! Now the shell asks the server itself at launch. If it gets no answer, the
//! window shows the page bundled with the app (`offline/index.html`), which
//! says so and has a Retry button, while this keeps asking. Once the server
//! answers, the window goes back to it.

use std::time::Duration;

use stream_download::http::reqwest::Client;
use tauri::{AppHandle, Manager, Url, WebviewUrl};
use tokio::sync::Notify;

use crate::applog;

/// Wakes the retry loop at once: the page's Retry button.
#[derive(Default)]
pub struct Retry(Notify);

#[tauri::command]
pub fn connect_retry(retry: tauri::State<'_, Retry>) {
    retry.0.notify_one();
}

/// The server the main window is configured to load, when it is a remote one.
pub(crate) fn server_url(config: &tauri::Config) -> Option<Url> {
    let window = config.app.windows.iter().find(|w| w.label == "main")?;
    match &window.url {
        WebviewUrl::External(url) => Some(url.clone()),
        _ => None,
    }
}

/// Where the bundled page is served: the dev server under `tauri dev`,
/// otherwise the app's own asset protocol, which Windows spells as http.
pub(crate) fn fallback_url(dev_url: Option<&Url>) -> Url {
    let base = match dev_url {
        Some(u) => u.clone(),
        None if cfg!(windows) => Url::parse("http://tauri.localhost/").expect("static url"),
        None => Url::parse("tauri://localhost/").expect("static url"),
    };
    base.join("index.html").unwrap_or(base)
}

/// Seconds between tries: soon at first, then every 15 s.
pub(crate) fn retry_delay(attempt: u32) -> Duration {
    Duration::from_secs((2u64 << attempt.min(3)).min(15))
}

/// Any answer means the server is there, except a proxy saying the app
/// behind it is not (Tailscale and friends answer 502/503/504 for that).
pub(crate) fn answered(status: u16) -> bool {
    !matches!(status, 502..=504)
}

pub(crate) fn probe_client(timeout: Duration) -> Option<Client> {
    Client::builder().timeout(timeout).build().ok()
}

pub(crate) async fn reachable(client: &Client, url: &Url) -> bool {
    match client.get(url.as_str()).send().await {
        Ok(res) => answered(res.status().as_u16()),
        Err(_) => false,
    }
}

/// Asks until the server answers, waiting `delay(attempt)` between tries, or
/// less when `retry` is woken.
pub(crate) async fn wait_until_reachable(
    client: &Client,
    url: &Url,
    retry: &Notify,
    delay: impl Fn(u32) -> Duration,
) {
    let mut attempt = 0;
    loop {
        tokio::select! {
            _ = tokio::time::sleep(delay(attempt)) => {}
            _ = retry.notified() => {}
        }
        if reachable(client, url).await {
            return;
        }
        attempt = attempt.saturating_add(1);
    }
}

/// Runs at startup, beside the window's own load of the server.
pub async fn watch(app: AppHandle, log_path: Option<std::path::PathBuf>) {
    let log = |level: &str, msg: &str| applog::write_line(log_path.as_ref(), level, msg);
    let Some(server) = server_url(app.config()) else { return };
    let Some(client) = probe_client(Duration::from_secs(10)) else { return };
    if reachable(&client, &server).await {
        return;
    }
    let Some(window) = app.get_webview_window("main") else { return };
    let dev_url = if tauri::is_dev() { app.config().build.dev_url.clone() } else { None };
    log("WARN", &format!("can't reach {server} at launch: showing the retry page"));
    if let Err(e) = window.navigate(fallback_url(dev_url.as_ref())) {
        log("WARN", &format!("retry page not shown: {e}"));
    }
    wait_until_reachable(&client, &server, &app.state::<Retry>().0, retry_delay).await;
    log("INFO", &format!("{server} reachable again: loading it"));
    if let Err(e) = window.navigate(server) {
        log("WARN", &format!("could not go back to the server: {e}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::Arc;
    use std::time::Instant;

    /// The window has a page of its own to show when the server is out of
    /// reach, bundled with the app.
    #[test]
    fn the_retry_page_is_bundled() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).expect("conf");
        let dist = conf["build"]["frontendDist"].as_str().expect("tauri.conf.json build.frontendDist: no bundled page");
        let page = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(dist).join("index.html");
        let html = std::fs::read_to_string(&page).expect("the bundled page");
        assert!(html.contains("Can't reach Ember"), "{html}");
        assert!(html.contains("connect_retry"), "the Retry button asks the shell to try now");
    }

    /// The page's Retry button can call the shell: the command is registered
    /// and allowed.
    #[test]
    fn the_retry_command_is_allowed() {
        assert!(include_str!("../permissions/app-commands.toml").contains("\"connect_retry\""));
        assert!(include_str!("lib.rs").contains("connect::connect_retry"));
    }

    #[test]
    fn the_server_is_the_main_windows_remote_url() {
        let conf: tauri::Config = serde_json::from_str(include_str!("../tauri.conf.json")).expect("conf");
        let url = server_url(&conf).expect("a remote url");
        assert!(url.scheme().starts_with("http"), "{url}");
    }

    #[test]
    fn the_retry_page_url() {
        let dev = Url::parse("http://127.0.0.1:1430/").unwrap();
        assert_eq!(fallback_url(Some(&dev)).as_str(), "http://127.0.0.1:1430/index.html");
        let built = fallback_url(None);
        assert_eq!(built.path(), "/index.html");
        assert!(built.as_str().contains("localhost"), "{built}");
    }

    #[test]
    fn tries_soon_then_every_fifteen_seconds() {
        let secs: Vec<u64> = (0..6).map(|a| retry_delay(a).as_secs()).collect();
        assert_eq!(secs, [2, 4, 8, 15, 15, 15]);
        assert_eq!(retry_delay(u32::MAX).as_secs(), 15);
    }

    #[test]
    fn a_gateway_error_is_not_the_server() {
        assert!(answered(200));
        assert!(answered(307));
        assert!(answered(404));
        assert!(answered(500));
        assert!(!answered(502));
        assert!(!answered(503));
        assert!(!answered(504));
    }

    /// Answers every request with `status`, on `listener`.
    fn serve(listener: TcpListener, status: &'static str) {
        std::thread::spawn(move || {
            for conn in listener.incoming() {
                let Ok(mut stream) = conn else { continue };
                read_headers(&stream);
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            }
        });
    }

    fn read_headers(stream: &TcpStream) {
        let mut reader = BufReader::new(stream.try_clone().expect("clone"));
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
                break;
            }
        }
    }

    fn url_of(listener: &TcpListener) -> Url {
        Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap()
    }

    /// A port nothing listens on.
    fn closed_port() -> Url {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        url_of(&listener)
    }

    fn client() -> Client {
        probe_client(Duration::from_millis(500)).expect("client")
    }

    #[tokio::test]
    async fn reachability() {
        let up = TcpListener::bind("127.0.0.1:0").unwrap();
        let up_url = url_of(&up);
        serve(up, "200 OK");
        assert!(reachable(&client(), &up_url).await, "a server that answers");

        let proxy = TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy_url = url_of(&proxy);
        serve(proxy, "502 Bad Gateway");
        assert!(!reachable(&client(), &proxy_url).await, "a proxy with nothing behind it");

        assert!(!reachable(&client(), &closed_port()).await, "nothing listening");

        // Accepts, never answers: the timeout gives up on it.
        let silent = TcpListener::bind("127.0.0.1:0").unwrap();
        let silent_url = url_of(&silent);
        std::thread::spawn(move || {
            let _held: Vec<_> = silent.incoming().take(1).collect();
            std::thread::sleep(Duration::from_secs(5));
        });
        let started = Instant::now();
        assert!(!reachable(&client(), &silent_url).await, "a server that hangs");
        assert!(started.elapsed() < Duration::from_secs(3), "the timeout held");
    }

    /// The server comes up a while after launch: the loop notices on its own.
    #[tokio::test(flavor = "multi_thread")]
    async fn keeps_trying_until_the_server_comes_up() {
        let url = closed_port();
        let addr = format!("{}:{}", url.host_str().unwrap(), url.port().unwrap());
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            serve(TcpListener::bind(addr).expect("rebind"), "200 OK");
        });
        let notify = Notify::new();
        let tries = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let counted = Arc::clone(&tries);
        let waited = tokio::time::timeout(
            Duration::from_secs(10),
            wait_until_reachable(&client(), &url, &notify, move |a| {
                counted.store(a + 1, std::sync::atomic::Ordering::SeqCst);
                Duration::from_millis(100)
            }),
        )
        .await;
        assert!(waited.is_ok(), "never saw the server come up");
        assert!(tries.load(std::sync::atomic::Ordering::SeqCst) > 1, "it had to try more than once");
    }

    /// Retry does not wait for the next scheduled try.
    #[tokio::test(flavor = "multi_thread")]
    async fn retry_tries_at_once() {
        let up = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = url_of(&up);
        serve(up, "200 OK");
        let notify = Arc::new(Notify::new());
        let press = Arc::clone(&notify);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            press.notify_one();
        });
        let started = Instant::now();
        let waited = tokio::time::timeout(
            Duration::from_secs(10),
            wait_until_reachable(&client(), &url, &notify, |_| Duration::from_secs(60)),
        )
        .await;
        assert!(waited.is_ok(), "Retry did nothing");
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
