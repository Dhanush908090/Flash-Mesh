use crate::commands::fs::path_to_entry;
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub entry: crate::commands::fs::FileEntry,
    pub match_score: u32,
}

fn is_text_extension(ext: &str) -> bool {
    matches!(
        ext,
        "txt"
            | "md"
            | "json"
            | "ts"
            | "js"
            | "py"
            | "rs"
            | "go"
            | "c"
            | "cpp"
            | "h"
            | "html"
            | "css"
            | "yaml"
            | "toml"
            | "sh"
            | "bat"
            | "ini"
            | "cfg"
            | "csv"
            | "log"
    )
}

/// Search recursively for files matching `query` under `root_path`.
/// Returns up to `limit` results ordered by relevance.
#[tauri::command]
pub fn search_files(
    root_path: String,
    query: String,
    show_hidden: bool,
    limit: usize,
    level: u8,
) -> Vec<SearchResult> {
    if query.trim().is_empty() {
        return vec![];
    }

    let query_lower = query.to_lowercase();
    let mut results: Vec<SearchResult> = Vec::new();

    // Bounded max depth depending on search intensity to prevent freeze
    let max_depth = match level {
        1 => 8,
        2 => 5,
        _ => 4,
    };

    for entry in WalkDir::new(&root_path)
        .follow_links(false)
        .max_depth(max_depth)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden unless requested
        if !show_hidden && name.starts_with('.') {
            continue;
        }

        let name_lower = name.to_lowercase();

        // 1. Check filename match
        let mut score = if name_lower == query_lower {
            100u32
        } else if name_lower.starts_with(&query_lower) {
            70
        } else if name_lower.contains(&query_lower) {
            40
        } else {
            0
        };

        // 2. Check content match if filename didn't match and level > 1
        if score == 0 && entry.file_type().is_file() && level > 1 {
            if let Ok(metadata) = entry.metadata() {
                // Size limit: 5MB for text scan, 2MB for deep binary scan
                let size_limit = if level == 2 { 5 * 1024 * 1024 } else { 2 * 1024 * 1024 };
                if metadata.len() <= size_limit {
                    let ext = path.extension()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default()
                        .to_lowercase();
                    
                    let should_scan = match level {
                        2 => is_text_extension(&ext),
                        3 => true, // scan everything in level 3
                        _ => false,
                    };

                    if should_scan {
                        if let Ok(bytes) = std::fs::read(path) {
                            let content = String::from_utf8_lossy(&bytes);
                            if content.to_lowercase().contains(&query_lower) {
                                score = 30; // content match score
                            }
                        }
                    }
                }
            }
        }

        if score > 0 {
            if let Some(file_entry) = path_to_entry(path) {
                results.push(SearchResult {
                    entry: file_entry,
                    match_score: score,
                });
            }
        }

        if results.len() >= limit * 3 {
            break; // collect enough then sort
        }
    }

    results.sort_by(|a, b| b.match_score.cmp(&a.match_score));
    results.truncate(limit);
    results
}

#[tauri::command]
pub fn list_recent_files(
    paths: Vec<String>,
    show_hidden: bool,
    limit: usize,
) -> Vec<crate::commands::fs::FileEntry> {
    let mut entries: Vec<(u64, crate::commands::fs::FileEntry)> = Vec::new();

    for root_path in paths {
        if !std::path::Path::new(&root_path).exists() {
            continue;
        }
        for entry in WalkDir::new(&root_path)
            .follow_links(false)
            .max_depth(3) // Reduced depth for performance
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if path == std::path::Path::new(&root_path) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !show_hidden && name.starts_with('.') {
                continue;
            }

            let modified_secs = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            if let Some(file_entry) = path_to_entry(path) {
                if !file_entry.is_dir {
                    entries.push((modified_secs, file_entry));
                }
            }

            if entries.len() > limit.saturating_mul(6).max(500) {
                break;
            }
        }
    }

    entries.sort_by_key(|(modified, _)| Reverse(*modified));
    entries.truncate(limit);
    entries.into_iter().map(|(_, e)| e).collect()
}
