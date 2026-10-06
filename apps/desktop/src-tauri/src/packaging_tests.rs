// Linux packaging checks on tauri.conf.json (a Debian user: "the .deb release
// doesn't come with the correct icon").
//
// What the 0.4.16 .deb shipped, read from the package itself:
//   /usr/share/icons/hicolor/32x32/apps/ember-desktop.png
//   /usr/share/icons/hicolor/128x128/apps/ember-desktop.png
//   /usr/share/icons/hicolor/256x256@2/apps/ember-desktop.png
//   Ember.desktop with `Categories=` (empty)
//
// The bundler files each PNG in `bundle.icon` under its PIXEL size, adding
// "@2" for an "@2x" name, so the 256 px `128x128@2x.png` landed in
// `256x256@2` (a 512 px slot) where no launcher looks for it. That left 32
// and 128 px only: a blurry upscale in docks, app grids and on HiDPI. And the
// Linux window icon (what X11 taskbars and alt-tab draw) is the FIRST PNG in
// the list (tauri-codegen's `find_icon`), which was the 32 px one.

use std::path::{Path, PathBuf};

const CONF: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json"));

fn conf() -> serde_json::Value {
    serde_json::from_str(CONF).expect("tauri.conf.json is valid JSON")
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// The PNG entries of `bundle.icon`, in order.
fn pngs() -> Vec<String> {
    conf()["bundle"]["icon"]
        .as_array()
        .expect("bundle.icon is a list")
        .iter()
        .filter_map(|v| v.as_str())
        .filter(|p| p.ends_with(".png"))
        .map(str::to_string)
        .collect()
}

/// Width and height from a PNG's IHDR chunk.
fn png_size(path: &Path) -> (u32, u32) {
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    assert_eq!(&bytes[1..4], b"PNG", "{} is not a PNG", path.display());
    let w = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let h = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    (w, h)
}

#[test]
fn linux_bundles_get_every_common_icon_size() {
    let sizes: Vec<u32> = pngs().iter().map(|p| png_size(&manifest_dir().join(p)).0).collect();
    for want in [32, 64, 128, 256, 512] {
        assert!(sizes.contains(&want), "bundle.icon has no {want}x{want} PNG (has {sizes:?})");
    }
}

#[test]
fn no_icon_is_filed_under_a_high_density_directory() {
    let doubled: Vec<String> = pngs().into_iter().filter(|p| p.contains("@2x")).collect();
    assert!(doubled.is_empty(), "the bundler files these under NxN@2 by pixel size, the wrong slot: {doubled:?}");
}

#[test]
fn every_icon_is_square_and_the_size_its_name_says() {
    for p in pngs() {
        let (w, h) = png_size(&manifest_dir().join(&p));
        assert_eq!(w, h, "{p} is not square");
        let name = Path::new(&p).file_stem().unwrap().to_string_lossy().to_string();
        if let Some((a, b)) = name.split_once('x') {
            if let (Ok(a), Ok(b)) = (a.parse::<u32>(), b.parse::<u32>()) {
                assert_eq!((a, b), (w, h), "{p} is {w}x{h}");
            }
        }
    }
}

#[test]
fn the_linux_window_icon_is_a_large_one() {
    let first = pngs().into_iter().next().expect("bundle.icon has a PNG");
    let (w, _) = png_size(&manifest_dir().join(&first));
    assert!(w >= 256, "the window icon is the first PNG in bundle.icon, {first} is only {w} px");
}

#[test]
fn the_desktop_entry_has_a_category() {
    let category = conf()["bundle"]["category"].as_str().map(str::to_string);
    assert_eq!(category.as_deref(), Some("Music"), "an empty Categories= puts Ember under Other");
}
