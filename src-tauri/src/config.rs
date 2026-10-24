use std::fs;
use std::path::{Component, Path, PathBuf};

use serde_json::Value;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone)]
pub struct LoadedConfig {
    pub text: String,
    pub path: PathBuf,
    pub value: Value,
    /// Custom or machine folder, when that directory exists. Empty when it does not.
    pub asset_root: PathBuf,
    /// Install `assets/` folder. Never replaced by `assets.root`.
    pub bundled_asset_root: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedAsset {
    pub path: PathBuf,
    pub root: PathBuf,
    pub found: bool,
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

pub fn configured_asset_root(value: &Value) -> &str {
    value
        .get("assets")
        .and_then(|assets| assets.get("root"))
        .and_then(|root| root.as_str())
        .unwrap_or("")
}

/// Configured `assets.root` first, then `C:\DaytonKiosk\assets` when it is a different folder.
pub fn preferred_asset_roots(configured_root: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let configured = configured_root.trim();
    if !configured.is_empty() {
        roots.push(PathBuf::from(configured));
    }
    let machine = machine_asset_dir();
    if !roots.iter().any(|root| same_root(root, &machine)) {
        roots.push(machine);
    }
    roots
}

/// Folders shipped beside the executable. The custom root is not in this list.
pub fn bundled_asset_roots(resource_dir: Option<&Path>, exe_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(dir) = resource_dir {
        paths.push(dir.join("assets"));
        paths.push(dir.join("resources").join("assets"));
    }
    if let Some(dir) = exe_dir {
        paths.push(dir.join("assets"));
        paths.push(dir.join("resources").join("assets"));
    }
    paths.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"));
    paths
}

pub fn bundled_asset_roots_from_app(app: &AppHandle) -> Vec<PathBuf> {
    let resource = app.path().resource_dir().ok();
    let exe = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    bundled_asset_roots(resource.as_deref(), exe.as_deref())
}

/// First existing file wins: preferred roots, then the bundled install folder.
pub fn resolve_asset_file(
    preferred: &[PathBuf],
    bundled: &[PathBuf],
    relative: &str,
) -> Result<ResolvedAsset, String> {
    let rel = safe_relative(relative)?;
    let mut seen = Vec::new();
    for root in preferred.iter().chain(bundled.iter()) {
        let key = root_key(root);
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        let path = root.join(&rel);
        if path.is_file() {
            return Ok(ResolvedAsset {
                path,
                root: root.clone(),
                found: true,
            });
        }
    }
    Ok(ResolvedAsset {
        path: PathBuf::new(),
        root: PathBuf::new(),
        found: false,
    })
}

fn safe_relative(relative: &str) -> Result<PathBuf, String> {
    let trimmed = relative.trim();
    if trimmed.is_empty() {
        return Err("empty asset path".to_string());
    }
    if trimmed.starts_with(['/', '\\']) || trimmed.contains(':') {
        return Err("asset path must stay inside the asset folder".to_string());
    }
    let normalized = trimmed.replace('\\', "/");
    let mut clean = PathBuf::new();
    for component in Path::new(&normalized).components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            _ => return Err("asset path must stay inside the asset folder".to_string()),
        }
    }
    if clean.as_os_str().is_empty() {
        return Err("empty asset path".to_string());
    }
    Ok(clean)
}

fn same_root(left: &Path, right: &Path) -> bool {
    root_key(left) == root_key(right)
}

fn root_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

pub fn first_existing(paths: &[PathBuf]) -> Option<PathBuf> {
    paths.iter().find(|path| path.exists()).cloned()
}

pub fn machine_asset_dir() -> PathBuf {
    PathBuf::from("C:/DaytonKiosk/assets")
}

pub fn override_root_if_present(path: &std::path::Path) -> String {
    if path.is_dir() {
        path.display().to_string()
    } else {
        String::new()
    }
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
    let preferred = preferred_asset_roots(configured_asset_root(&value));
    let bundled = bundled_asset_roots_from_app(app);
    let asset_root = first_existing_dir(&preferred).unwrap_or_default();
    let bundled_asset_root = first_existing_dir(&bundled).unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets")
    });
    Ok(LoadedConfig {
        text,
        path,
        value,
        asset_root,
        bundled_asset_root,
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
    fn override_root_is_empty_until_the_directory_exists() {
        let missing = PathBuf::from("/tmp/does-not-exist-dayton-assets");
        assert_eq!(override_root_if_present(&missing), "");
        let dir = std::env::temp_dir().join(format!("pose-override-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(override_root_if_present(&dir), dir.display().to_string());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prefers_the_first_path_that_exists() {
        let missing = PathBuf::from("/tmp/does-not-exist-kiosk.json");
        let here = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../config/kiosk.json");
        let found = first_existing(&[missing, here.clone()]).unwrap();
        assert_eq!(found, here);
    }

    #[test]
    fn preferred_roots_put_the_configured_folder_ahead_of_the_machine_folder() {
        let roots = preferred_asset_roots("D:/Shows/assets");
        assert_eq!(
            roots,
            vec![PathBuf::from("D:/Shows/assets"), machine_asset_dir()]
        );
        assert_eq!(preferred_asset_roots("  "), vec![machine_asset_dir()]);
        assert_eq!(
            preferred_asset_roots(r"C:\DaytonKiosk\assets"),
            vec![PathBuf::from(r"C:\DaytonKiosk\assets")]
        );
    }

    #[test]
    fn bundled_roots_are_the_install_folders() {
        let roots = bundled_asset_roots(Some(Path::new("C:/Program/Pose")), Some(Path::new("C:/Program/Pose")));
        assert_eq!(roots[0], PathBuf::from("C:/Program/Pose/assets"));
        assert_eq!(roots[1], PathBuf::from("C:/Program/Pose/resources/assets"));
        assert!(roots.iter().all(|root| root_key(root) != root_key(&machine_asset_dir())));
    }

    #[test]
    fn resolve_uses_the_custom_file_and_falls_back_per_file() {
        let dir = std::env::temp_dir().join(format!("pose-assets-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let custom = dir.join("custom");
        let machine = dir.join("machine");
        let bundled = dir.join("bundled");
        fs::create_dir_all(custom.join("branding")).unwrap();
        fs::create_dir_all(machine.join("branding")).unwrap();
        fs::create_dir_all(bundled.join("branding")).unwrap();
        fs::create_dir_all(bundled.join("frames")).unwrap();
        fs::write(custom.join("branding/qr.png"), b"custom-qr").unwrap();
        fs::write(bundled.join("branding/qr.png"), b"bundled-qr").unwrap();
        fs::write(machine.join("branding/dayton-d-logo-red.svg"), b"<svg/>").unwrap();
        fs::write(bundled.join("branding/dayton-d-logo-red.svg"), b"<svg bundled/>").unwrap();
        fs::write(bundled.join("frames/takeaway_v1.png"), b"frame").unwrap();

        let preferred = [custom.clone(), machine.clone()];
        let bundled_roots = [bundled.clone()];
        let qr = resolve_asset_file(&preferred, &bundled_roots, "branding/qr.png").unwrap();
        assert!(qr.found);
        assert_eq!(qr.root, custom);
        assert_eq!(fs::read(qr.path).unwrap(), b"custom-qr");

        let logo = resolve_asset_file(&preferred, &bundled_roots, r"branding\dayton-d-logo-red.svg").unwrap();
        assert!(logo.found);
        assert_eq!(logo.root, machine);

        let frame = resolve_asset_file(&preferred, &bundled_roots, "frames/takeaway_v1.png").unwrap();
        assert!(frame.found);
        assert_eq!(frame.root, bundled);

        let missing = resolve_asset_file(&preferred, &bundled_roots, "branding/nope.png").unwrap();
        assert!(!missing.found);
        assert!(missing.path.as_os_str().is_empty());

        let same = resolve_asset_file(&[bundled.clone()], &[bundled.clone()], "frames/takeaway_v1.png").unwrap();
        assert!(same.found);
        assert_eq!(same.root, bundled);

        assert!(resolve_asset_file(&preferred, &bundled_roots, "../secret").is_err());
        assert!(resolve_asset_file(&preferred, &bundled_roots, "/etc/passwd").is_err());
        assert!(resolve_asset_file(&preferred, &bundled_roots, "").is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
