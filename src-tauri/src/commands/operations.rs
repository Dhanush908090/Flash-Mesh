use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use once_cell::sync::Lazy;
use tauri::Emitter;

static CANCELLED_OPERATIONS: Lazy<Arc<Mutex<HashSet<String>>>> = Lazy::new(|| Arc::new(Mutex::new(HashSet::new())));

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub operation_id: String,
    pub label: String,
    pub current: u64,
    pub total: u64,
    pub percent: f32,
}

#[tauri::command]
pub fn cancel_operation(operation_id: String) {
    if let Ok(mut cancelled) = CANCELLED_OPERATIONS.lock() {
        cancelled.insert(operation_id);
    }
}

// ── Copy ──────────────────────────────────────────────────────────────────────

fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<u64> {
    if src.is_dir() {
        fs::create_dir_all(dst)?;
        let mut bytes = 0u64;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let ty = entry.file_type()?;
            let dest_child = dst.join(entry.file_name());
            if ty.is_dir() {
                bytes += copy_recursive(&entry.path(), &dest_child)?;
            } else {
                fs::copy(&entry.path(), &dest_child)?;
                bytes += entry.metadata()?.len();
            }
        }
        Ok(bytes)
    } else {
        let n = fs::copy(src, dst)?;
        Ok(n)
    }
}

#[tauri::command]
pub async fn copy_items(
    sources: Vec<String>,
    destination: String,
    operation_id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        let dest = PathBuf::from(&destination);
        let total = sources.len() as u64;

        for (i, src_str) in sources.iter().enumerate() {
            // Check for cancellation
            if let Ok(cancelled) = CANCELLED_OPERATIONS.lock() {
                if cancelled.contains(&operation_id) {
                    let _ = app.emit("file-operation-progress", ProgressEvent {
                        operation_id: operation_id.clone(),
                        label: "Cancelled".to_string(),
                        current: i as u64,
                        total,
                        percent: (i as f32 / total as f32) * 100.0,
                    });
                    return;
                }
            }

            let src = Path::new(src_str);
            let file_name = src.file_name().unwrap_or_else(|| std::ffi::OsStr::new("unknown"));
            let dst = dest.join(file_name);

            if let Err(e) = copy_recursive(src, &dst) {
                let _ = app.emit("file-operation-error", format!("Copy failed: {}", e));
                return;
            }

            let _ = app.emit(
                "file-operation-progress",
                ProgressEvent {
                    operation_id: operation_id.clone(),
                    label: format!("Copying: {}", file_name.to_string_lossy()),
                    current: (i + 1) as u64,
                    total,
                    percent: (i + 1) as f32 / total as f32 * 100.0,
                },
            );
        }
        
        // Cleanup cancellation record
        if let Ok(mut cancelled) = CANCELLED_OPERATIONS.lock() {
            cancelled.remove(&operation_id);
        }
    });
    
    Ok(())
}

// ── Move ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn move_items(
    sources: Vec<String>,
    destination: String,
    operation_id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        let dest = PathBuf::from(&destination);
        let total = sources.len() as u64;

        for (i, src_str) in sources.iter().enumerate() {
            // Check for cancellation
            if let Ok(cancelled) = CANCELLED_OPERATIONS.lock() {
                if cancelled.contains(&operation_id) {
                    let _ = app.emit("file-operation-progress", ProgressEvent {
                        operation_id: operation_id.clone(),
                        label: "Cancelled".to_string(),
                        current: i as u64,
                        total,
                        percent: (i as f32 / total as f32) * 100.0,
                    });
                    return;
                }
            }

            let src = Path::new(src_str);
            let file_name = src.file_name().unwrap_or_else(|| std::ffi::OsStr::new("unknown"));
            let dst = dest.join(file_name);

            // Try rename first (same filesystem, instant)
            if fs::rename(src, &dst).is_err() {
                // Cross-device: copy then delete
                if let Err(e) = copy_recursive(src, &dst) {
                    let _ = app.emit("file-operation-error", format!("Move failed: {}", e));
                    return;
                }
                if src.is_dir() {
                    let _ = fs::remove_dir_all(src);
                } else {
                    let _ = fs::remove_file(src);
                }
            }

            let _ = app.emit(
                "file-operation-progress",
                ProgressEvent {
                    operation_id: operation_id.clone(),
                    label: format!("Moving: {}", file_name.to_string_lossy()),
                    current: (i + 1) as u64,
                    total,
                    percent: (i + 1) as f32 / total as f32 * 100.0,
                },
            );
        }

        // Cleanup cancellation record
        if let Ok(mut cancelled) = CANCELLED_OPERATIONS.lock() {
            cancelled.remove(&operation_id);
        }
    });

    Ok(())
}

// ── Rename ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn rename_item(path: String, new_name: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    let parent = src.parent().ok_or("Cannot rename root")?;
    let dst = parent.join(&new_name);

    if dst.exists() {
        return Err(format!("'{}' already exists", new_name));
    }

    fs::rename(&src, &dst).map_err(|e| format!("Rename failed: {}", e))?;
    Ok(dst.to_string_lossy().to_string())
}

// ── Delete ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn delete_items(paths: Vec<String>, permanent: bool) -> Result<(), String> {
    for path_str in paths {
        let p = Path::new(&path_str);
        if permanent {
            if p.is_dir() {
                fs::remove_dir_all(p).map_err(|e| format!("Delete failed: {}", e))?;
            } else {
                fs::remove_file(p).map_err(|e| format!("Delete failed: {}", e))?;
            }
        } else {
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                return Err(
                    "Move to Trash is not supported on mobile. Use permanent delete.".to_string(),
                );
            }

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            trash::delete(p).map_err(|e| format!("Trash failed: {}", e))?;
        }
    }
    Ok(())
}

// ── Create ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn create_folder(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Create folder failed: {}", e))
}

#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Create dirs failed: {}", e))?;
    }
    fs::File::create(&path).map_err(|e| format!("Create file failed: {}", e))?;
    Ok(())
}

// ── File Content (for preview) ────────────────────────────────────────────────

#[tauri::command]
pub fn read_text_file(path: String, max_bytes: usize) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Read failed: {}", e))?;
    let slice = &bytes[..bytes.len().min(max_bytes)];
    Ok(String::from_utf8_lossy(slice).to_string())
}

// ── Open Item Native ─────────────────────────────────────────────────────────

#[tauri::command]
#[allow(unused_variables)]
pub fn open_item(app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open: {}", e))?;
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &path])
                .spawn()
                .map_err(|e| format!("Failed to open: {}", e))?;
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open: {}", e))?;
        }
        Ok(())
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_path(&path, None::<String>)
            .map_err(|e| format!("Failed to open on mobile: {}", e))?;
        Ok(())
    }
}
#[tauri::command]
#[allow(unused_variables)]
pub fn open_item_with(app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        // Try to trigger a picker if possible. mimeopen -d is a common fallback.
        // On KDE/GNOME, there isn't a simple 'open-with' binary that is universal.
        // We'll try mimeopen -d (desktop choice) or just xdg-open as a fallback.
        let status = std::process::Command::new("mimeopen")
            .arg("-d")
            .arg(&path)
            .spawn();

        if status.is_err() {
            std::process::Command::new("xdg-open")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open: {}", e))?;
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        // Use the native OpenWith.exe on Windows
        std::process::Command::new("rundll32.exe")
            .args(["shell32.dll,OpenAs_RunDLL", &path])
            .spawn()
            .map_err(|e| format!("Failed to open-with: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        // MacOS 'open' doesn't have an 'ask' flag easily, but we can try to use AppleScript or just open.
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
        Ok(())
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        // On mobile, "Open With" usually means the default open picker if no default is set.
        // Opener plugin might handle this or we just use open_path.
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_path(&path, None::<String>)
            .map_err(|e| format!("Failed to open on mobile: {}", e))?;
        Ok(())
    }
}

#[tauri::command]
pub fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read binary file {}: {}", path, e))
}

#[tauri::command]
pub fn write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, contents).map_err(|e| format!("Failed to write binary file {}: {}", path, e))
}

