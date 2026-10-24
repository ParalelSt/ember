// Each desktop OS has its own app version: tauri.windows.conf.json,
// tauri.macos.conf.json and tauri.linux.conf.json carry it, and Tauri merges
// the one for the OS it builds for over tauri.conf.json. A release of one OS
// (the windows-v0.4.26 tag) then moves only that OS's version, and the
// updater and the launch gate (app.package_info().version) read it.

use std::path::PathBuf;

const OSES: [&str; 3] = ["windows", "macos", "linux"];

fn read_json(name: &str) -> serde_json::Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name} is not valid JSON: {e}"))
}

fn is_plain_version(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

#[test]
fn the_shared_config_carries_no_version() {
    // With one there, an OS file that went missing would silently fall back
    // to it instead of failing the build's version check.
    assert!(read_json("tauri.conf.json").get("version").is_none(), "tauri.conf.json must not set version");
}

#[test]
fn every_desktop_os_has_its_own_version_file_and_nothing_else_in_it() {
    for os in OSES {
        let name = format!("tauri.{os}.conf.json");
        let conf = read_json(&name);
        let obj = conf.as_object().unwrap_or_else(|| panic!("{name} is not an object"));
        assert_eq!(obj.keys().collect::<Vec<_>>(), vec!["version"], "{name}: only the version belongs here");
        let v = obj["version"].as_str().unwrap_or_else(|| panic!("{name}: version is not a string"));
        assert!(is_plain_version(v), "{name}: {v} is not x.y.z");
    }
}

#[test]
fn the_app_is_built_with_this_os_version() {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let expected = read_json(&format!("tauri.{os}.conf.json"))["version"].as_str().unwrap().to_string();
    let context = crate::app_context::<tauri::test::MockRuntime>();
    assert_eq!(context.package_info().version.to_string(), expected);
}
