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
        android_shared_storage_root().to_string_lossy().to_string()
    }

    #[cfg(target_os = "ios")]
    {
        let dir = dirs::document_dir()
            .or_else(dirs::data_local_dir)
            .or_else(dirs::cache_dir);
        dir.unwrap_or_else(|| PathBuf::from("/"))
            .to_string_lossy()
            .to_string()
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let dir = dirs::home_dir();
        dir.unwrap_or_else(|| PathBuf::from("/"))
            .to_string_lossy()
            .to_string()
    }
}

#[tauri::command]
pub fn get_special_dirs() -> serde_json::Value {
    fn p(opt: Option<std::path::PathBuf>) -> Option<String> {
        opt.map(|p| p.to_string_lossy().to_string())
    }

    #[cfg(target_os = "android")]
    {
        let root = android_shared_storage_root();
        serde_json::json!({
            "home":      Some(root.to_string_lossy().to_string()),
            "desktop":   Option::<String>::None,
            "downloads": Some(root.join("Download").to_string_lossy().to_string()),
            "documents": Some(root.join("Documents").to_string_lossy().to_string()),
            "pictures":  Some(root.join("Pictures").to_string_lossy().to_string()),
            "videos":    Some(root.join("DCIM").to_string_lossy().to_string()),
            "music":     Some(root.join("Music").to_string_lossy().to_string()),
        })
    }

    #[cfg(not(target_os = "android"))]
    {
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

// ─── Extended Metadata & Thumbnail Helpers ────────────────────────────────────

fn fnv1a_128(s: &str) -> String {
    let mut hash: u128 = 0x6c62272e07bb014262b821756295c58d;
    for byte in s.as_bytes() {
        hash ^= *byte as u128;
        hash = hash.wrapping_mul(0x0000000001000000000000000000013b);
    }
    format!("{:032x}", hash)
}

fn get_thumbnail_filename(path: &str) -> String {
    format!("{}.jpg", fnv1a_128(path))
}

fn get_cache_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        let mut path = android_shared_storage_root();
        path.push(".flashmesh");
        path.push("cache");
        path.push("thumbnails");
        Ok(path)
    }
    #[cfg(target_os = "ios")]
    {
        let mut path = dirs::cache_dir()
            .or_else(|| dirs::document_dir())
            .ok_or_else(|| "Could not locate cache/document directory".to_string())?;
        path.push(".flashmesh");
        path.push("cache");
        path.push("thumbnails");
        Ok(path)
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let mut path = dirs::home_dir().ok_or_else(|| "Could not locate home directory".to_string())?;
        path.push(".flashmesh");
        path.push("cache");
        path.push("thumbnails");
        Ok(path)
    }
}

fn parse_image_dimensions(path: &str) -> Option<(u32, u32)> {
    let file = fs::File::open(path).ok()?;
    use std::io::Read;
    let mut buffer = vec![0u8; 65536];
    let bytes_read = file.take(65536).read_to_end(&mut buffer).ok()?;
    let data = &buffer[..bytes_read];

    // PNG Check
    if data.len() >= 24
        && data[0] == 137
        && data[1] == 80
        && data[2] == 78
        && data[3] == 71
        && data[4] == 13
        && data[5] == 10
        && data[6] == 26
        && data[7] == 10
    {
        let width = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
        let height = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
        return Some((width, height));
    }

    // GIF Check
    if data.len() >= 10
        && data[0] == b'G'
        && data[1] == b'I'
        && data[2] == b'F'
        && data[3] == b'8'
        && (data[4] == b'7' || data[4] == b'9')
        && data[5] == b'a'
    {
        let width = u16::from_le_bytes([data[6], data[7]]) as u32;
        let height = u16::from_le_bytes([data[8], data[9]]) as u32;
        return Some((width, height));
    }

    // JPEG Check
    if data.len() >= 4 && data[0] == 0xFF && data[1] == 0xD8 {
        let mut i = 2;
        while i + 8 < data.len() {
            if data[i] != 0xFF {
                i += 1;
                continue;
            }
            let marker = data[i + 1];
            if marker == 0xFF {
                i += 1;
                continue;
            }
            if marker == 0x00 {
                i += 2;
                continue;
            }
            if marker >= 0xC0 && marker <= 0xC3 {
                let height = u16::from_be_bytes([data[i + 5], data[i + 6]]) as u32;
                let width = u16::from_be_bytes([data[i + 7], data[i + 8]]) as u32;
                return Some((width, height));
            }
            if (marker >= 0xD0 && marker <= 0xD9) || marker == 0x01 {
                i += 2;
                continue;
            }
            if i + 3 < data.len() {
                let len = u16::from_be_bytes([data[i + 2], data[i + 3]]) as usize;
                let prev_i = i;
                i += 2 + len;
                if i <= prev_i {
                    i = prev_i + 1;
                }
            } else {
                break;
            }
        }
    }

    None
}

fn format_dt_local(system_time: std::time::SystemTime) -> Option<String> {
    let secs = system_time.duration_since(UNIX_EPOCH).ok()?.as_secs();
    let dt = chrono::DateTime::from_timestamp(secs as i64, 0)
        .unwrap_or_default()
        .with_timezone(&chrono::Local);
    Some(dt.format("%Y-%m-%dT%H:%M:%S").to_string())
}

fn format_permissions(mode: u32) -> String {
    let mut s = String::with_capacity(9);
    // User
    s.push(if mode & 0o400 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o200 != 0 { 'w' } else { '-' });
    s.push(if mode & 0o100 != 0 { 'x' } else { '-' });
    // Group
    s.push(if mode & 0o040 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o020 != 0 { 'w' } else { '-' });
    s.push(if mode & 0o010 != 0 { 'x' } else { '-' });
    // Other
    s.push(if mode & 0o004 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o002 != 0 { 'w' } else { '-' });
    s.push(if mode & 0o001 != 0 { 'x' } else { '-' });
    s
}

#[cfg(any(target_os = "linux", target_os = "android"))]
extern "C" {
    fn getpwuid(uid: u32) -> *mut passwd;
    fn getgrgid(gid: u32) -> *mut group;
}

#[cfg(any(target_os = "linux", target_os = "android"))]
#[repr(C)]
struct passwd {
    pw_name: *mut std::os::raw::c_char,
    pw_passwd: *mut std::os::raw::c_char,
    pw_uid: u32,
    pw_gid: u32,
    pw_gecos: *mut std::os::raw::c_char,
    pw_dir: *mut std::os::raw::c_char,
    pw_shell: *mut std::os::raw::c_char,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
#[repr(C)]
struct group {
    gr_name: *mut std::os::raw::c_char,
    gr_passwd: *mut std::os::raw::c_char,
    gr_gid: u32,
    gr_mem: *mut *mut std::os::raw::c_char,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
static USER_GROUP_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(any(target_os = "linux", target_os = "android"))]
fn get_owner_group(uid: u32, gid: u32) -> (Option<String>, Option<String>) {
    use std::ffi::CStr;
    let _lock = USER_GROUP_MUTEX.lock().unwrap();

    let owner = unsafe {
        let pw = getpwuid(uid);
        if !pw.is_null() {
            let name = CStr::from_ptr((*pw).pw_name);
            Some(name.to_string_lossy().into_owned())
        } else {
            None
        }
    };

    let group = unsafe {
        let gr = getgrgid(gid);
        if !gr.is_null() {
            let name = CStr::from_ptr((*gr).gr_name);
            Some(name.to_string_lossy().into_owned())
        } else {
            None
        }
    };

    (owner, group)
}

#[cfg(not(any(target_os = "linux", target_os = "android")))]
fn get_owner_group(_uid: u32, _gid: u32) -> (Option<String>, Option<String>) {
    (None, None)
}

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[cfg(unix)]
fn get_unix_metadata(metadata: &fs::Metadata) -> (Option<String>, Option<String>, Option<String>) {
    let mode = metadata.permissions().mode();
    let permissions = format_permissions(mode);
    let uid = metadata.uid();
    let gid = metadata.gid();
    let (owner, group) = get_owner_group(uid, gid);
    (Some(permissions), owner, group)
}

#[cfg(not(unix))]
fn get_unix_metadata(metadata: &fs::Metadata) -> (Option<String>, Option<String>, Option<String>) {
    let readonly = metadata.permissions().readonly();
    let permissions = if readonly {
        "r--r--r--".to_string()
    } else {
        "rw-rw-rw-".to_string()
    };
    (Some(permissions), None, None)
}

// ─── Extra Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_image_thumbnail(path: String) -> Result<String, String> {
    use base64::Engine;

    let cache_dir = get_cache_dir()?;
    if !cache_dir.exists() {
        fs::create_dir_all(&cache_dir).map_err(|e| format!("Failed to create cache directory: {}", e))?;
    }

    let filename = get_thumbnail_filename(&path);
    let cache_path = cache_dir.join(filename);

    if cache_path.exists() {
        let bytes = fs::read(&cache_path).map_err(|e| format!("Failed to read cache file: {}", e))?;
        let base64_data = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(format!("data:image/jpeg;base64,{}", base64_data));
    }

    // Generate thumbnail
    let img = image::open(&path).map_err(|e| format!("Failed to open image: {}", e))?;
    let thumbnail = img.thumbnail(120, 120);

    let mut jpeg_bytes = Vec::new();
    {
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_bytes, 65);
        encoder.encode(
            thumbnail.as_bytes(),
            thumbnail.width(),
            thumbnail.height(),
            thumbnail.color(),
        ).map_err(|e| format!("Failed to encode jpeg: {}", e))?;
    }

    // Write to cache folder
    fs::write(&cache_path, &jpeg_bytes).map_err(|e| format!("Failed to write cache file: {}", e))?;

    let base64_data = base64::engine::general_purpose::STANDARD.encode(&jpeg_bytes);
    Ok(format!("data:image/jpeg;base64,{}", base64_data))
}

fn hash_file_contents(path: &str) -> Option<String> {
    use std::io::Read;
    let mut file = fs::File::open(path).ok()?;
    let mut hash: u64 = 0xcbf29ce484222325;
    let mut buffer = [0u8; 16384];
    let mut total_read = 0;
    const MAX_HASH_SIZE: usize = 20 * 1024 * 1024; // 20 MB

    loop {
        if total_read >= MAX_HASH_SIZE {
            break;
        }
        let to_read = std::cmp::min(buffer.len(), MAX_HASH_SIZE - total_read);
        let bytes_read = file.read(&mut buffer[..to_read]).ok()?;
        if bytes_read == 0 {
            break;
        }
        total_read += bytes_read;
        for &byte in &buffer[..bytes_read] {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x00000100000001B3);
        }
    }
    Some(format!("{:016x}", hash))
}

#[tauri::command]
pub fn get_extended_metadata(path: String) -> Result<serde_json::Value, String> {
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to read metadata: {}", e))?;

    let accessed = metadata.accessed().ok().and_then(format_dt_local);
    let modified = metadata.modified().ok().and_then(format_dt_local);

    let (permissions, owner, group) = get_unix_metadata(&metadata);

    let mut files_count = None;
    let mut folders_count = None;

    if metadata.is_dir() {
        let mut fi = 0;
        let mut fo = 0;
        if let Ok(entries) = fs::read_dir(&path) {
            for entry in entries.flatten() {
                if let Ok(ft) = entry.file_type() {
                    if ft.is_dir() {
                        fo += 1;
                    } else {
                        fi += 1;
                    }
                }
            }
        }
        files_count = Some(fi);
        folders_count = Some(fo);
    }

    let mut image_width = None;
    let mut image_height = None;

    let ext_str = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());

    if let Some(ref ext) = ext_str {
        if ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "gif" {
            if let Some((w, h)) = parse_image_dimensions(&path) {
                image_width = Some(w);
                image_height = Some(h);
            }
        }
    }

    let mut line_count = None;
    let mut word_count = None;
    let mut char_count = None;

    if let Some(ref ext) = ext_str {
        let is_text_ext = match ext.as_str() {
            "txt" | "md" | "json" | "js" | "ts" | "tsx" | "jsx" | "rs" | "toml" | "yaml" | "yml" | "html" | "css" | "xml" | "ini" | "cfg" | "sh" | "bat" => true,
            _ => false,
        };
        let file_size = metadata.len();
        if file_size < 5 * 1024 * 1024 && is_text_ext {
            if let Ok(content) = fs::read_to_string(&path) {
                line_count = Some(content.lines().count());
                word_count = Some(content.split_whitespace().count());
                char_count = Some(content.chars().count());
            }
        }
    }

    let mime_type = if metadata.is_dir() {
        Some("inode/directory".to_string())
    } else {
        ext_str.as_ref().and_then(|ext| mime_from_ext(ext))
    };

    let content_hash = if !metadata.is_dir() {
        hash_file_contents(&path)
    } else {
        None
    };

    Ok(serde_json::json!({
        "permissions": permissions,
        "owner": owner,
        "group": group,
        "accessed": accessed,
        "modified": modified,
        "imageWidth": image_width,
        "imageHeight": image_height,
        "lineCount": line_count,
        "wordCount": word_count,
        "charCount": char_count,
        "filesCount": files_count,
        "foldersCount": folders_count,
        "mimeType": mime_type,
        "contentHash": content_hash,
    }))
}

