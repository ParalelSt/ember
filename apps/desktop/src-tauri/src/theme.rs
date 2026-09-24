// The window chrome follows the person's Ember theme.
//
// The page itself is themed by the server (the theme is in the first HTML
// byte), so what is left for the shell is the part the page cannot paint:
// the window's own background, which shows before the remote page arrives
// and behind it while it loads, and the title bar, which follows the window
// theme on macOS and Windows.
//
// The web app calls `theme_apply` after every theme change (see
// apps/web/lib/theme/native.ts). The last value is kept in
// `<app config dir>/theme.json` and applied at startup by `apply_stored`,
// so the next launch opens on the theme's colour instead of white.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::window::Color;
use tauri::{AppHandle, Manager, Runtime, Theme, WebviewWindow};

const FILE_NAME: &str = "theme.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredTheme {
    pub background: String,
    pub scheme: String,
}

/// `#rrggbb` (the `#` optional, either case) as its three channels. Anything
/// else is None: a colour that cannot be read must not paint the window.
pub fn parse_hex(hex: &str) -> Option<(u8, u8, u8)> {
    let s = hex.trim();
    let s = s.strip_prefix('#').unwrap_or(s);
    if s.len() != 6 || !s.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |i: usize| u8::from_str_radix(&s[i..i + 2], 16).ok();
    Some((channel(0)?, channel(2)?, channel(4)?))
}

/// The window theme for a scheme. Every v1 theme is dark, and anything the
/// shell does not recognise is dark too, because that is what Ember is.
pub fn window_theme(scheme: &str) -> Theme {
    if scheme == "light" {
        Theme::Light
    } else {
        Theme::Dark
    }
}

/// A theme worth keeping: a readable colour and a known scheme.
fn validated(background: &str, scheme: &str) -> Option<StoredTheme> {
    let (r, g, b) = parse_hex(background)?;
    let scheme = if scheme == "light" { "light" } else { "dark" };
    Some(StoredTheme {
        background: format!("#{r:02x}{g:02x}{b:02x}"),
        scheme: scheme.to_string(),
    })
}

pub fn store_theme(dir: &Path, theme: &StoredTheme) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let json = serde_json::to_string(theme).map_err(std::io::Error::other)?;
    std::fs::write(dir.join(FILE_NAME), json)
}

/// The stored theme, or None when there is none or it is unreadable (a
/// missing file, bad JSON or a bad colour all mean "use the default").
pub fn load_theme(dir: &Path) -> Option<StoredTheme> {
    let raw = std::fs::read_to_string(dir.join(FILE_NAME)).ok()?;
    let parsed: StoredTheme = serde_json::from_str(&raw).ok()?;
    validated(&parsed.background, &parsed.scheme)
}

fn config_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok()
}

fn apply_to_window<R: Runtime>(
    window: &WebviewWindow<R>,
    theme: &StoredTheme,
) -> tauri::Result<()> {
    if let Some((r, g, b)) = parse_hex(&theme.background) {
        window.set_background_color(Some(Color(r, g, b, 255)))?;
    }
    window.set_theme(Some(window_theme(&theme.scheme)))
}

/// Called by the page after every theme change: paint the window, then keep
/// the value for the next launch. A bad colour is refused rather than
/// guessed at.
#[tauri::command]
pub fn theme_apply(app: AppHandle, background: String, scheme: String) -> Result<(), String> {
    let theme =
        validated(&background, &scheme).ok_or_else(|| format!("not a colour: {background}"))?;
    if let Some(window) = app.get_webview_window("main") {
        apply_to_window(&window, &theme).map_err(|e| e.to_string())?;
    }
    if let Some(dir) = config_dir(&app) {
        store_theme(&dir, &theme).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// At startup, before the remote page arrives: the last theme's colour, so
/// the window is never a white flash on a dark theme. Nothing stored means
/// the window keeps its default.
pub fn apply_stored<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    let Some(theme) = config_dir(app).and_then(|dir| load_theme(&dir)) else {
        return Ok(false);
    };
    if let Some(window) = app.get_webview_window("main") {
        apply_to_window(&window, &theme).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh directory under the system temp dir, removed when dropped.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir()
                .join(format!("ember-theme-{tag}-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn theme_parse_hex_reads_rrggbb_with_or_without_hash() {
        assert_eq!(parse_hex("#1a1b1f"), Some((0x1a, 0x1b, 0x1f)));
        assert_eq!(parse_hex("1A1B1F"), Some((0x1a, 0x1b, 0x1f)));
        assert_eq!(parse_hex(" #ffffff "), Some((255, 255, 255)));
        assert_eq!(parse_hex("#000000"), Some((0, 0, 0)));
    }

    #[test]
    fn theme_parse_hex_refuses_anything_else() {
        for bad in [
            "",
            "#",
            "#fff",
            "#12345",
            "#1234567",
            "#gg0000",
            "red",
            "oklch(0.16 0.005 260)",
            "#ff00ff00",
        ] {
            assert_eq!(parse_hex(bad), None, "{bad:?} should not parse");
        }
    }

    #[test]
    fn theme_window_theme_is_dark_unless_light() {
        assert_eq!(window_theme("light"), Theme::Light);
        assert_eq!(window_theme("dark"), Theme::Dark);
        assert_eq!(window_theme("sepia"), Theme::Dark);
        assert_eq!(window_theme(""), Theme::Dark);
    }

    #[test]
    fn theme_store_and_load_round_trip() {
        let dir = TempDir::new("roundtrip");
        let theme = StoredTheme {
            background: "#0f1420".into(),
            scheme: "dark".into(),
        };
        store_theme(&dir.0, &theme).unwrap();
        assert_eq!(load_theme(&dir.0), Some(theme));
    }

    #[test]
    fn theme_store_creates_the_config_dir() {
        let dir = TempDir::new("nested");
        let nested = dir.0.join("app.ember.desktop");
        let theme = StoredTheme {
            background: "#000000".into(),
            scheme: "light".into(),
        };
        store_theme(&nested, &theme).unwrap();
        assert_eq!(load_theme(&nested), Some(theme));
    }

    #[test]
    fn theme_load_is_none_without_a_file() {
        let dir = TempDir::new("empty");
        assert_eq!(load_theme(&dir.0), None);
    }

    #[test]
    fn theme_load_is_none_for_a_malformed_file() {
        let dir = TempDir::new("malformed");
        for junk in [
            "",
            "not json",
            "{}",
            r##"{"background":"#zzzzzz","scheme":"dark"}"##,
            r#"{"background":42}"#,
        ] {
            std::fs::write(dir.0.join(FILE_NAME), junk).unwrap();
            assert_eq!(load_theme(&dir.0), None, "{junk:?} should not load");
        }
    }

    #[test]
    fn theme_load_normalises_colour_case_and_unknown_schemes() {
        let dir = TempDir::new("normalise");
        std::fs::write(
            dir.0.join(FILE_NAME),
            r##"{"background":"#ABCDEF","scheme":"sepia"}"##,
        )
        .unwrap();
        assert_eq!(
            load_theme(&dir.0),
            Some(StoredTheme {
                background: "#abcdef".into(),
                scheme: "dark".into()
            })
        );
    }
}
