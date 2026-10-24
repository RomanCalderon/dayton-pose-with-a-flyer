fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "load_config",
                "resolve_asset",
                "list_cameras",
                "upload_photo",
                "append_log",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
