// Links out of the app open in the system browser.
//
// The window is a WKWebView (WebView2 on Windows) with no new-window handler,
// so a `target="_blank"` link or `window.open` in the remote page does
// nothing at all: the tab page's "Find one" links (Ultimate Guitar, Guitar Pro
// files, Songsterr) looked dead on the desktop app. The page asks for them
// here instead (apps/web/lib/openExternal.ts), and a click on any other
// new-tab link is routed the same way.

use tauri::Url;

/// Only web links leave the app: http(s), nothing that could name a local
/// file or another app's scheme.
pub(crate) fn openable(url: &str) -> Option<Url> {
    let u = Url::parse(url.trim()).ok()?;
    match u.scheme() {
        "http" | "https" if u.host_str().is_some_and(|h| !h.is_empty()) => Some(u),
        _ => None,
    }
}

/// Whether the app window may navigate to `target` itself. Only the Ember
/// server's own origin and the pages bundled with the app stay in the window;
/// every other web address (a Google link on the Privacy page, anything a
/// future page links to) is handed to the system browser instead, so the
/// window can never be turned into someone else's site with no way back.
pub(crate) fn navigation_allowed(target: &Url, own_origins: &[Url]) -> bool {
    match target.scheme() {
        // The bundled pages (offline/index.html) and blank pages.
        "tauri" | "about" | "blob" | "data" => true,
        "http" | "https" => {
            // Windows serves the bundled pages as http://tauri.localhost.
            target.host_str() == Some("tauri.localhost")
                || own_origins.iter().any(|o| o.origin() == target.origin())
        }
        _ => false,
    }
}

/// The navigation guard for the main window: a web link to another site
/// opens in the system browser and the window stays where it is. Other
/// schemes (`javascript:`, `file:`) are refused and not opened.
pub(crate) fn guard(own_origins: Vec<Url>) -> impl Fn(&Url) -> bool + Send + 'static {
    move |target| {
        if navigation_allowed(target, &own_origins) {
            return true;
        }
        if let Some(u) = openable(target.as_str()) {
            let _ = launch(u.as_str());
        }
        false
    }
}

/// The same rule for `window.open` and `target="_blank"` links: never a new
/// app window; another site opens in the system browser.
pub(crate) fn new_window_guard<R: tauri::Runtime>(
    own_origins: Vec<Url>,
) -> impl Fn(Url, tauri::webview::NewWindowFeatures) -> tauri::webview::NewWindowResponse<R> + Send + 'static {
    move |target, _features| {
        if !navigation_allowed(&target, &own_origins) {
            if let Some(u) = openable(target.as_str()) {
                let _ = launch(u.as_str());
            }
        }
        tauri::webview::NewWindowResponse::Deny
    }
}

#[cfg(target_os = "macos")]
fn launch(url: &str) -> std::io::Result<std::process::Child> {
    std::process::Command::new("open").arg(url).spawn()
}

#[cfg(target_os = "windows")]
fn launch(url: &str) -> std::io::Result<std::process::Child> {
    // Not `cmd /c start`: cmd would read the `&` of a query string as a
    // command separator.
    std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn launch(url: &str) -> std::io::Result<std::process::Child> {
    std::process::Command::new("xdg-open").arg(url).spawn()
}

/// Open `url` in the system browser.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let u = openable(&url).ok_or_else(|| "only http and https links open outside the app".to_string())?;
    launch(u.as_str()).map(|_| ()).map_err(|e| format!("could not open the browser: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_links_open() {
        let u = openable("https://www.ultimate-guitar.com/search.php?search_type=title&value=a+b").unwrap();
        assert_eq!(u.as_str(), "https://www.ultimate-guitar.com/search.php?search_type=title&value=a+b");
        assert!(openable("http://example.com").is_some());
        // A title in Japanese arrives percent-encoded and stays so.
        let jp = openable("https://www.songsterr.com/?pattern=%E9%BB%84%E6%B3%89").unwrap();
        assert!(jp.as_str().ends_with("%E9%BB%84%E6%B3%89"));
    }

    #[test]
    fn nothing_else_does() {
        for bad in ["file:///etc/passwd", "javascript:alert(1)", "ftp://x.y/z", "mailto:a@b.c", "", "not a url", "https://", "-a https://x.y"] {
            assert!(openable(bad).is_none(), "{bad}");
        }
    }

    fn own() -> Vec<Url> {
        vec![Url::parse("https://ember.tailf4de41.ts.net").unwrap()]
    }

    fn allowed(u: &str) -> bool {
        navigation_allowed(&Url::parse(u).unwrap(), &own())
    }

    #[test]
    fn the_window_stays_on_the_server_and_bundled_pages() {
        assert!(allowed("https://ember.tailf4de41.ts.net/privacy"));
        assert!(allowed("https://ember.tailf4de41.ts.net/link/abc?x=1"));
        assert!(allowed("tauri://localhost/index.html"));
        assert!(allowed("http://tauri.localhost/index.html"));
        assert!(allowed("about:blank"));
    }

    #[test]
    fn other_sites_do_not_replace_the_window() {
        for bad in [
            "https://developers.google.com/terms/api-services-user-data-policy",
            "https://myaccount.google.com/permissions",
            // Look-alike hosts and a different scheme or port on the same host.
            "https://ember.tailf4de41.ts.net.evil.com/",
            "https://evil.com/ember.tailf4de41.ts.net",
            "http://ember.tailf4de41.ts.net/",
            "https://ember.tailf4de41.ts.net:8443/",
            "https://user@evil.com/",
            "javascript:alert(1)",
            "file:///etc/passwd",
        ] {
            assert!(!allowed(bad), "{bad}");
        }
    }

    #[test]
    fn the_main_window_uses_the_guards() {
        let lib = include_str!("lib.rs");
        assert!(lib.contains("external::guard("));
        assert!(lib.contains("external::new_window_guard("));
    }

    #[test]
    fn the_command_is_registered_and_allowed() {
        assert!(include_str!("../permissions/app-commands.toml").contains("\"open_external\""));
        assert!(include_str!("lib.rs").contains("external::open_external"));
    }
}
