use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

// ─── Data Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<String>,
    pub created: Option<String>,
    pub extension: Option<String>,
    pub is_hidden: bool,
    pub is_symlink: bool,
    pub mime_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub name: String,
    pub mount_point: String,
    pub total_space: u64,
    pub available_space: u64,
    pub drive_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub path: String,
    pub entries: Vec<FileEntry>,
    pub parent: Option<String>,
    pub error: Option<String>,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn format_timestamp(secs: u64) -> String {
    let dt = chrono::DateTime::from_timestamp(secs as i64, 0)
        .unwrap_or_default()
        .with_timezone(&chrono::Local);
    dt.to_rfc3339()
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

#[cfg(windows)]
fn is_hidden_path(path: &Path, name: &str) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;

    is_hidden(name)
        || fs::symlink_metadata(path)
            .map(|m| m.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0)
            .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_hidden_path(_path: &Path, name: &str) -> bool {
    is_hidden(name)
}

#[cfg(target_os = "android")]
fn android_shared_storage_root() -> PathBuf {
    PathBuf::from("/storage/emulated/0")
}

fn mime_from_ext(ext: &str) -> Option<String> {
    let m = match ext.to_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "rs" => "text/x-rust",
        "ts" | "tsx" => "text/typescript",
        "js" | "jsx" => "text/javascript",
        "json" => "application/json",
        "toml" => "text/toml",
        "yaml" | "yml" => "text/yaml",
        "zip" => "application/zip",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        _ => return None,
    };
    Some(m.to_string())
}

pub fn path_to_entry(path: &Path) -> Option<FileEntry> {
    let symlink_meta = fs::symlink_metadata(path).ok();
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    let is_symlink = symlink_meta
        .as_ref()
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);

    // Follow symlink for size/type info when possible
    let real_meta = fs::metadata(path).ok().or(symlink_meta.clone());
    let is_dir = real_meta
        .as_ref()
        .map(|m| m.is_dir())
        .unwrap_or_else(|| path.is_dir());
    let size = if is_dir {
        None
    } else {
        real_meta.as_ref().map(|m| m.len())
    };

    let extension = if is_dir {
        None
    } else {
        path.extension().map(|e| e.to_string_lossy().to_string())
    };

    let modified = real_meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| format_timestamp(d.as_secs()));

    let created = real_meta
        .as_ref()
        .and_then(|m| m.created().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| format_timestamp(d.as_secs()));

    let mime_type = extension.as_ref().and_then(|e| mime_from_ext(e));

    Some(FileEntry {
        id: path.to_string_lossy().to_string(),
        name: name.clone(),
        path: path.to_string_lossy().to_string(),
        is_dir,
        size,
        modified,
        created,
        extension,
        is_hidden: is_hidden_path(path, &name),
        is_symlink,
        mime_type,
    })
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_directory(path: String, show_hidden: bool) -> DirListing {
    let dir_path = PathBuf::from(&path);

    if !dir_path.exists() {
        return DirListing {
            path,
            entries: vec![],
            parent: None,
            error: Some("Directory does not exist".to_string()),
        };
    }

    if !dir_path.is_dir() {
        return DirListing {
            path,
            entries: vec![],
            parent: None,
            error: Some("Not a directory".to_string()),
        };
    }

    let read_dir = match fs::read_dir(&dir_path) {
        Ok(rd) => rd,
        Err(e) => {
            return DirListing {
                path,
                entries: vec![],
                parent: None,
                error: Some(format!("Permission denied: {}", e)),
            };
        }
    };

    let mut entries: Vec<FileEntry> = read_dir
        .filter_map(|res| res.ok())
        .filter_map(|entry| path_to_entry(&entry.path()))
        .filter(|e| show_hidden || !e.is_hidden)
        .collect();

    // Folders first, then alphabetical
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    let parent = dir_path.parent().map(|p| p.to_string_lossy().to_string());

    DirListing {
        path,
        entries,
        parent,
        error: None,
    }
}

#[tauri::command]
pub fn get_home_dir() -> String {
    #[cfg(target_os = "android")]
    {
        return android_shared_storage_root().to_string_lossy().to_string();
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    let dir = dirs::document_dir()
        .or_else(dirs::data_local_dir)
        .or_else(dirs::cache_dir);

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let dir = dirs::home_dir();

    dir.unwrap_or_else(|| PathBuf::from("/"))
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
pub fn get_special_dirs() -> serde_json::Value {
    fn p(opt: Option<std::path::PathBuf>) -> Option<String> {
        opt.map(|p| p.to_string_lossy().to_string())
    }

    #[cfg(target_os = "android")]
    {
        let root = android_shared_storage_root();
        return serde_json::json!({
            "home":      Some(root.to_string_lossy().to_string()),
            "desktop":   Option::<String>::None,
            "downloads": Some(root.join("Download").to_string_lossy().to_string()),
            "documents": Some(root.join("Documents").to_string_lossy().to_string()),
            "pictures":  Some(root.join("Pictures").to_string_lossy().to_string()),
            "videos":    Some(root.join("DCIM").to_string_lossy().to_string()),
            "music":     Some(root.join("Music").to_string_lossy().to_string()),
        });
    }

    serde_json::json!({
        "home":      p(dirs::home_dir()),
        "desktop":   p(dirs::desktop_dir()),
        "downloads": p(dirs::download_dir()),
        "documents": p(dirs::document_dir()),
        "pictures":  p(dirs::picture_dir()),
        "videos":    p(dirs::video_dir()),
        "music":     p(dirs::audio_dir()),
    })
}

#[tauri::command]
pub fn get_file_metadata(path: String) -> Option<FileEntry> {
    path_to_entry(Path::new(&path))
}

#[tauri::command]
pub fn list_trash() -> DirListing {
    #[cfg(any(
        target_os = "windows",
        all(
            unix,
            not(target_os = "macos"),
            not(target_os = "ios"),
            not(target_os = "android")
        )
    ))]
    {
        match trash::os_limited::list() {
            Ok(items) => {
                let mut entries = Vec::new();
                for item in items {
                    // For trash items, the id is internal, name is the original name
                    let ext = Path::new(&item.name)
                        .extension()
                        .map(|e| e.to_string_lossy().to_string());
                    let mime_type = ext.as_ref().and_then(|e| mime_from_ext(e));

                    entries.push(FileEntry {
                        id: item.id.to_string_lossy().to_string(),
                        name: item.name.to_string_lossy().to_string(),
                        path: item.id.to_string_lossy().to_string(), // we use internal id as path
                        is_dir: false, // In trash, we rarely query correct is_dir easily without more work
                        size: None,
                        modified: Some(format_timestamp(item.time_deleted as u64)),
                        created: None,
                        extension: ext,
                        is_hidden: false,
                        is_symlink: false,
                        mime_type,
                    });
                }
                DirListing {
                    path: "__trash__".to_string(),
                    entries,
                    parent: None,
                    error: None,
                }
            }
            Err(e) => DirListing {
                path: "__trash__".to_string(),
                entries: vec![],
                parent: None,
                error: Some(format!("Failed to list trash: {}", e)),
            },
        }
    }
    #[cfg(not(any(
        target_os = "windows",
        all(
            unix,
            not(target_os = "macos"),
            not(target_os = "ios"),
            not(target_os = "android")
        )
    )))]
    {
        DirListing {
            path: "__trash__".to_string(),
            entries: vec![],
            parent: None,
            error: Some("Trash listing not supported on this OS".to_string()),
        }
    }
}

#[tauri::command]
pub fn empty_trash() -> Result<(), String> {
    #[cfg(any(
        target_os = "windows",
        all(
            unix,
            not(target_os = "macos"),
            not(target_os = "ios"),
            not(target_os = "android")
        )
    ))]
    {
        let items = trash::os_limited::list().map_err(|e| format!("List failed: {}", e))?;
        trash::os_limited::purge_all(items).map_err(|e| format!("Purge failed: {}", e))?;
        Ok(())
    }
    #[cfg(not(any(
        target_os = "windows",
        all(
            unix,
            not(target_os = "macos"),
            not(target_os = "ios"),
            not(target_os = "android")
        )
    )))]
    {
        Err("Empty trash not supported on this OS".to_string())
    }
}
