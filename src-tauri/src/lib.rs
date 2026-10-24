mod cameras;
mod config;
mod upload;

use tauri::{
    webview::{PermissionKind, PermissionResponse},
    WebviewUrl, WebviewWindowBuilder,
};

use crate::cameras::CameraList;
use crate::config::{load_kiosk_config, window_settings};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadConfigResponse {
    config_text: String,
    config_path: String,
    asset_root: String,
}

#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<LoadConfigResponse, String> {
    let loaded = load_kiosk_config(&app)?;
    Ok(LoadConfigResponse {
        config_text: loaded.text,
        config_path: loaded.path.display().to_string(),
        asset_root: loaded.asset_root.display().to_string(),
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

fn open_main_window(app: &tauri::App) -> tauri::Result<()> {
    let loaded = load_kiosk_config(app.handle()).unwrap_or_else(|error| {
        eprintln!("kiosk config: {error}");
        config::LoadedConfig {
            text: "{}".to_string(),
            path: std::path::PathBuf::new(),
            value: serde_json::json!({}),
            asset_root: std::path::PathBuf::new(),
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
        .build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_config, list_cameras, upload_photo])
        .setup(|app| {
            open_main_window(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Pose with a Flyer");
}
