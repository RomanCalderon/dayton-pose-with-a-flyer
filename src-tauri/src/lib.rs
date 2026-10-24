mod cameras;
mod config;
mod upload;
mod webview_profile;

use tauri::{
    webview::{PermissionKind, PermissionResponse},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

use crate::cameras::CameraList;
use crate::config::{
    bundled_asset_roots_from_app, configured_asset_root, load_kiosk_config, preferred_asset_roots,
    resolve_asset_file, window_settings,
};
use crate::webview_profile::{profile_dir, sync_webview_profile, ProfileSync};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadConfigResponse {
    config_text: String,
    config_path: String,
    asset_root: String,
    bundled_asset_root: String,
    asset_override_root: String,
    log_path: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolveAssetResponse {
    relative: String,
    path: String,
    root: String,
    found: bool,
}

fn log_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_log_dir().map_err(|error| error.to_string())?;
    Ok(dir.join("kiosk.log"))
}

#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<LoadConfigResponse, String> {
    let loaded = load_kiosk_config(&app)?;
    let log_path = log_file(&app)
        .map(|path| path.display().to_string())
        .unwrap_or_default();
    Ok(LoadConfigResponse {
        config_text: loaded.text,
        config_path: loaded.path.display().to_string(),
        asset_root: loaded.asset_root.display().to_string(),
        bundled_asset_root: loaded.bundled_asset_root.display().to_string(),
        asset_override_root: config::override_root_if_present(&config::machine_asset_dir()),
        log_path,
    })
}

#[tauri::command]
fn append_log(app: tauri::AppHandle, line: String) -> Result<String, String> {
    use std::io::Write;
    let path = log_file(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    let clean = line.replace(['\r', '\n'], " ");
    writeln!(file, "{clean}").map_err(|error| error.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn resolve_asset(app: tauri::AppHandle, relative: String) -> Result<ResolveAssetResponse, String> {
    let loaded = load_kiosk_config(&app)?;
    let preferred = preferred_asset_roots(configured_asset_root(&loaded.value));
    let bundled = bundled_asset_roots_from_app(&app);
    let resolved = resolve_asset_file(&preferred, &bundled, &relative)?;
    let key = relative.trim().trim_start_matches(['/', '\\']).replace('\\', "/");
    Ok(ResolveAssetResponse {
        relative: key,
        path: if resolved.found {
            resolved.path.display().to_string()
        } else {
            String::new()
        },
        root: if resolved.found {
            resolved.root.display().to_string()
        } else {
            String::new()
        },
        found: resolved.found,
    })
}

#[tauri::command]
fn list_cameras() -> CameraList {
    cameras::list_cameras()
}

#[tauri::command]
fn upload_photo(request: upload::UploadPhotoRequest) -> upload::UploadPhotoResponse {
    upload::upload_photo(request)
}

/// Drop a stale WebView2 profile before the window is created.
/// `clear_all_browsing_data` deletes asynchronously after navigation and does
/// not reload, so a cached `http://tauri.localhost` page would already be showing.
fn prepare_webview_profile(app: &tauri::App) {
    let version = app.package_info().version.to_string();
    let Ok(dir) = app.path().app_local_data_dir() else {
        let line = format!("webview profile skipped version={version} error=local data dir unavailable");
        eprintln!("{line}");
        return;
    };
    match sync_webview_profile(&dir, &version) {
        Ok(ProfileSync::Kept) => {
            note_profile(app, &format!("webview profile kept version={version}"));
        }
        Ok(ProfileSync::Cleared { previous }) => {
            let previous = if previous.is_empty() { "(none)" } else { previous.as_str() };
            note_profile(
                app,
                &format!(
                    "webview profile cleared previous={previous} version={version} path={}",
                    profile_dir(&dir).display()
                ),
            );
        }
        Ok(ProfileSync::Initialized) => {
            note_profile(app, &format!("webview profile initialized version={version}"));
        }
        Err(error) => {
            note_profile(
                app,
                &format!("webview profile clear failed version={version} error={error}"),
            );
        }
    }
}

fn note_profile(app: &tauri::App, line: &str) {
    eprintln!("{line}");
    let _ = append_log(app.handle().clone(), line.to_string());
}

fn open_main_window(app: &tauri::App) -> tauri::Result<()> {
    let loaded = load_kiosk_config(app.handle()).unwrap_or_else(|error| {
        eprintln!("kiosk config: {error}");
        config::LoadedConfig {
            text: "{}".to_string(),
            path: std::path::PathBuf::new(),
            value: serde_json::json!({}),
            asset_root: std::path::PathBuf::new(),
            bundled_asset_root: std::path::PathBuf::new(),
        }
    });
    let (fullscreen, width, height, always_on_top) = window_settings(&loaded.value);
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Pose with a Flyer")
        .inner_size(width, height)
        .fullscreen(fullscreen)
        .decorations(!fullscreen)
        .resizable(true)
        .center()
        .always_on_top(always_on_top)
        .zoom_hotkeys_enabled(false)
        .additional_browser_args(
            "--autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream --disable-features=msWebOOUI,TranslateUI",
        )
        .on_permission_request(|_window, kind| match kind {
            PermissionKind::Camera | PermissionKind::Microphone => PermissionResponse::Allow,
            other => {
                let _ = other;
                PermissionResponse::Default
            }
        })
        .on_web_resource_request(|_request, response| {
            let value = tauri::http::HeaderValue::from_static("no-store");
            response
                .headers_mut()
                .insert(tauri::http::header::CACHE_CONTROL, value);
        })
        .build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_config,
            resolve_asset,
            list_cameras,
            upload_photo,
            append_log
        ])
        .setup(|app| {
            prepare_webview_profile(app);
            open_main_window(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Pose with a Flyer");
}
