use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone)]
pub struct LoadedConfig {
    pub text: String,
    pub path: PathBuf,
    pub value: Value,
    pub asset_root: PathBuf,
}

pub fn strip_json_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    let mut in_string = false;
    let mut escape = false;
    while i < chars.len() {
        let c = chars[i];
        if in_string {
            out.push(c);
            if escape {
                escape = false;
            } else if c == '\\' {
                escape = true;
            } else if c == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if c == '"' {
            in_string = true;
            out.push(c);
            i += 1;
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'/') {
            i += 2;
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

pub fn discover_config_paths(app: &AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    paths.push(PathBuf::from("C:/DaytonKiosk/kiosk.json"));
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("kiosk.json"));
            paths.push(dir.join("config").join("kiosk.json"));
            paths.push(dir.join("resources").join("config").join("kiosk.json"));
        }
    }
    if let Ok(dir) = app.path().app_config_dir() {
        paths.push(dir.join("kiosk.json"));
    }
    if let Ok(dir) = app.path().resource_dir() {
        paths.push(dir.join("config").join("kiosk.json"));
        paths.push(dir.join("kiosk.json"));
    }
    paths.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../config/kiosk.json"));
    paths
}

pub fn asset_candidates(app: &AppHandle, configured_root: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if !configured_root.trim().is_empty() {
        paths.push(PathBuf::from(configured_root));
    }
    if let Ok(dir) = app.path().resource_dir() {
        paths.push(dir.join("assets"));
        paths.push(dir.join("resources").join("assets"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("assets"));
            paths.push(dir.join("resources").join("assets"));
        }
    }
    paths.push(PathBuf::from("C:/DaytonKiosk/assets"));
    paths.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"));
    paths
}

pub fn first_existing(paths: &[PathBuf]) -> Option<PathBuf> {
    paths.iter().find(|path| path.exists()).cloned()
}

pub fn first_existing_dir(paths: &[PathBuf]) -> Option<PathBuf> {
    paths.iter().find(|path| path.is_dir()).cloned()
}

pub fn load_kiosk_config(app: &AppHandle) -> Result<LoadedConfig, String> {
    let path = first_existing(&discover_config_paths(app))
        .ok_or_else(|| "kiosk.json was not found next to the app or in the bundle".to_string())?;
    let text = fs::read_to_string(&path).map_err(|error| format!("read {}: {error}", path.display()))?;
    let value: Value = serde_json::from_str(&strip_json_comments(&text))
        .map_err(|error| format!("parse {}: {error}", path.display()))?;
    let configured = value
        .get("assets")
        .and_then(|assets| assets.get("root"))
        .and_then(|root| root.as_str())
        .unwrap_or("");
    let asset_root = first_existing_dir(&asset_candidates(app, configured)).unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets")
    });
    Ok(LoadedConfig {
        text,
        path,
        value,
        asset_root,
    })
}

pub fn window_settings(value: &Value) -> (bool, f64, f64, bool) {
    let window = value.get("window");
    let fullscreen = window
        .and_then(|item| item.get("fullscreen"))
        .and_then(|item| item.as_bool())
        .unwrap_or(false);
    let width = window
        .and_then(|item| item.get("width"))
        .and_then(|item| item.as_f64())
        .unwrap_or(1600.0);
    let height = window
        .and_then(|item| item.get("height"))
        .and_then(|item| item.as_f64())
        .unwrap_or(900.0);
    let always_on_top = window
        .and_then(|item| item.get("alwaysOnTop"))
        .and_then(|item| item.as_bool())
        .unwrap_or(false);
    (fullscreen, width, height, always_on_top)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_comments_but_keeps_slashes_in_strings() {
        let raw = "{\n  // hi\n  \"start\": { \"mode\": \"touch\" }, /* x */\n  \"note\": \"keep // this\"\n}\n";
        let json: Value = serde_json::from_str(&strip_json_comments(raw)).unwrap();
        assert_eq!(json["start"]["mode"], "touch");
        assert_eq!(json["note"], "keep // this");
    }

    #[test]
    fn prefers_the_first_path_that_exists() {
        let missing = PathBuf::from("/tmp/does-not-exist-kiosk.json");
        let here = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../config/kiosk.json");
        let found = first_existing(&[missing, here.clone()]).unwrap();
        assert_eq!(found, here);
    }
}
