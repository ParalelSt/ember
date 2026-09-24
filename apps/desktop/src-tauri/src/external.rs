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

    #[test]
    fn the_command_is_registered_and_allowed() {
        assert!(include_str!("../permissions/app-commands.toml").contains("\"open_external\""));
        assert!(include_str!("lib.rs").contains("external::open_external"));
    }
}
