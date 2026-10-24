use std::fs;
use std::path::{Path, PathBuf};

/// WebView2 creates this directory inside the user-data folder Tauri passes
/// (`%LOCALAPPDATA%\com.daytonflyers.posewithaflyer` on Windows).
pub const WEBVIEW_PROFILE_DIR: &str = "EBWebView";

/// Sits beside the profile so deleting the cache does not erase the record.
pub const WEBVIEW_VERSION_FILE: &str = "webview-version.txt";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileSync {
    Kept,
    /// `previous` is empty when the marker was missing.
    Cleared { previous: String },
    Initialized,
}

pub fn should_clear_webview_profile(stored: Option<&str>, current: &str) -> bool {
    let Some(stored) = stored.map(str::trim).filter(|value| !value.is_empty()) else {
        return true;
    };
    stored != current.trim()
}

/// Delete `EBWebView` when the stored version differs, then record `current`.
/// Logs and other files in the parent directory are left in place.
/// A failed delete leaves the marker unchanged so the next launch retries.
pub fn sync_webview_profile(local_data_dir: &Path, current: &str) -> Result<ProfileSync, String> {
    let current = current.trim();
    if current.is_empty() {
        return Err("app version is empty".to_string());
    }
    fs::create_dir_all(local_data_dir).map_err(|error| error.to_string())?;
    let marker = local_data_dir.join(WEBVIEW_VERSION_FILE);
    let stored = fs::read_to_string(&marker).ok();
    if !should_clear_webview_profile(stored.as_deref(), current) {
        return Ok(ProfileSync::Kept);
    }
    let previous = stored
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_string();
    let profile = local_data_dir.join(WEBVIEW_PROFILE_DIR);
    let had_profile = profile.exists();
    if had_profile {
        fs::remove_dir_all(&profile).map_err(|error| {
            format!(
                "clear WebView2 profile {}: {error}",
                profile.display()
            )
        })?;
    }
    fs::write(&marker, format!("{current}\n")).map_err(|error| error.to_string())?;
    if had_profile {
        Ok(ProfileSync::Cleared { previous })
    } else {
        Ok(ProfileSync::Initialized)
    }
}

pub fn profile_dir(local_data_dir: &Path) -> PathBuf {
    local_data_dir.join(WEBVIEW_PROFILE_DIR)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pose-webview-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn clears_only_when_the_marker_is_missing_or_different() {
        assert!(should_clear_webview_profile(None, "0.1.7"));
        assert!(should_clear_webview_profile(Some(""), "0.1.7"));
        assert!(should_clear_webview_profile(Some("   "), "0.1.7"));
        assert!(should_clear_webview_profile(Some("0.1.6"), "0.1.7"));
        assert!(!should_clear_webview_profile(Some("0.1.7"), "0.1.7"));
        assert!(!should_clear_webview_profile(Some("  0.1.7\n"), "0.1.7"));
    }

    #[test]
    fn deletes_the_profile_and_keeps_sibling_files() {
        let dir = scratch("clear");
        let profile = dir.join(WEBVIEW_PROFILE_DIR);
        fs::create_dir_all(profile.join("Default")).unwrap();
        fs::write(profile.join("Default").join("Cache"), b"stale").unwrap();
        let logs = dir.join("logs");
        fs::create_dir_all(&logs).unwrap();
        fs::write(logs.join("kiosk.log"), b"keep").unwrap();

        let synced = sync_webview_profile(&dir, "0.1.7").unwrap();
        assert_eq!(
            synced,
            ProfileSync::Cleared {
                previous: String::new()
            }
        );
        assert!(!profile.exists());
        assert_eq!(fs::read(logs.join("kiosk.log")).unwrap(), b"keep");
        assert_eq!(
            fs::read_to_string(dir.join(WEBVIEW_VERSION_FILE)).unwrap(),
            "0.1.7\n"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_a_profile_that_matches_the_running_version() {
        let dir = scratch("keep");
        let profile = dir.join(WEBVIEW_PROFILE_DIR);
        fs::create_dir_all(&profile).unwrap();
        fs::write(profile.join("Cookies"), b"fresh").unwrap();
        fs::write(dir.join(WEBVIEW_VERSION_FILE), b"0.1.7\n").unwrap();

        assert_eq!(sync_webview_profile(&dir, "0.1.7").unwrap(), ProfileSync::Kept);
        assert_eq!(fs::read(profile.join("Cookies")).unwrap(), b"fresh");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn replaces_the_marker_after_a_version_change() {
        let dir = scratch("bump");
        let profile = dir.join(WEBVIEW_PROFILE_DIR);
        fs::create_dir_all(&profile).unwrap();
        fs::write(profile.join("Cookies"), b"old").unwrap();
        fs::write(dir.join(WEBVIEW_VERSION_FILE), b"0.1.6\n").unwrap();

        assert_eq!(
            sync_webview_profile(&dir, "0.1.7").unwrap(),
            ProfileSync::Cleared {
                previous: "0.1.6".to_string()
            }
        );
        assert!(!profile.exists());
        assert_eq!(
            fs::read_to_string(dir.join(WEBVIEW_VERSION_FILE)).unwrap(),
            "0.1.7\n"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn initializes_when_there_is_no_profile_yet() {
        let dir = scratch("init");
        assert_eq!(
            sync_webview_profile(&dir, "0.1.7").unwrap(),
            ProfileSync::Initialized
        );
        assert_eq!(
            fs::read_to_string(dir.join(WEBVIEW_VERSION_FILE)).unwrap(),
            "0.1.7\n"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn leaves_the_marker_alone_when_the_profile_cannot_be_removed() {
        let dir = scratch("locked");
        fs::write(dir.join(WEBVIEW_PROFILE_DIR), b"not-a-directory").unwrap();
        fs::write(dir.join(WEBVIEW_VERSION_FILE), b"0.1.6\n").unwrap();

        let error = sync_webview_profile(&dir, "0.1.7").unwrap_err();
        assert!(error.contains(WEBVIEW_PROFILE_DIR), "{error}");
        assert_eq!(
            fs::read_to_string(dir.join(WEBVIEW_VERSION_FILE)).unwrap(),
            "0.1.6\n"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
