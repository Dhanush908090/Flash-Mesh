use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilities {
    pub os: String,
    pub family: String,
    pub is_mobile: bool,
    pub supports_drives: bool,
    pub supports_trash: bool,
    pub supports_terminal: bool,
    pub supports_open_with: bool,
    pub filesystem_scope: String,
}

#[tauri::command]
pub fn get_platform_capabilities() -> PlatformCapabilities {
    let os = std::env::consts::OS.to_string();
    let family = std::env::consts::FAMILY.to_string();
    let is_mobile = cfg!(any(target_os = "android", target_os = "ios"));

    PlatformCapabilities {
        os,
        family,
        is_mobile,
        supports_drives: true,
        supports_trash: cfg!(any(
            target_os = "windows",
            all(
                unix,
                not(target_os = "macos"),
                not(target_os = "ios"),
                not(target_os = "android")
            )
        )),
        supports_terminal: cfg!(any(
            target_os = "linux",
            target_os = "windows",
            target_os = "macos"
        )),
        supports_open_with: true,
        filesystem_scope: "native-filesystem".to_string(),
    }
}

/// Checks whether the app has sufficient storage access on Android.
/// Ground-truth check: attempt to list /storage/emulated/0.
/// - Android 11+ : succeeds only if MANAGE_EXTERNAL_STORAGE is granted
/// - Android 6-10: succeeds only if READ_EXTERNAL_STORAGE is granted
/// - Android  <6 : always succeeds (install-time grant)
#[tauri::command]
pub fn check_android_permission() -> bool {
    #[cfg(target_os = "android")]
    {
        match std::fs::read_dir("/storage/emulated/0") {
            Ok(mut rd) => rd.next().is_some(),
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        true
    }
}

/// Emits a Tauri event to signal the frontend that a permission request is
/// needed. The frontend listener will dispatch a native custom event that
/// the Kotlin WebViewClient picks up, delegating to
/// MainActivity.requestStoragePermissions() which shows the correct dialog
/// for the device's API level (runtime dialog on Android 6-10, settings
/// intent on Android 11+).
#[tauri::command]
pub fn request_android_permission(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        app.emit("flashmesh:request-permission", ())
            .map_err(|e| format!("Failed to emit permission request: {}", e))?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
    }
    Ok(())
}
