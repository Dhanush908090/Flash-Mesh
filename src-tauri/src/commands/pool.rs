use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A member of a Data Pool
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolMember {
    pub fingerprint: String,
    pub nickname: String,
    pub joined_at: String,
    /// Storage quota contributed in bytes
    pub quota_bytes: u64,
}

/// Lightweight pool descriptor returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataPool {
    pub id: String,
    pub name: String,
    /// Fingerprint of the pool owner (hub host)
    pub owner_fp: String,
    /// Google Drive folder ID that serves as the hub
    pub hub_folder_id: String,
    /// Google Drive folder ID of the owner's inbox
    pub inbox_folder_id: String,
    pub members: Vec<PoolMember>,
    pub total_size: u64,
    pub used_size: u64,
    pub status: String,
    pub created_at: String,
}

/// A proposal file found in the pool's inbox/
/// Each proposal describes one action a member wants to take.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolProposal {
    pub proposal_id: String,
    pub member_fp: String,
    pub action: String, // "upload" | "delete" | "mkdir" | "rename" | "join"
    pub payload: serde_json::Value,
    pub timestamp: String,
}

/// Result of processing the inbox
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxProcessResult {
    pub processed_count: usize,
    pub failed_count: usize,
    pub errors: Vec<String>,
}

// ── Registry Helpers ─────────────────────────────────────────────────────────

fn get_registry_path() -> PathBuf {
    let mut p = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push(".flashmesh");
    let _ = std::fs::create_dir_all(&p);
    p.push("pools.json");
    p
}

fn read_registry() -> Result<Vec<DataPool>, String> {
    let path = get_registry_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read registry: {}", e))?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse registry JSON: {}", e))
}

fn write_registry(pools: &[DataPool]) -> Result<(), String> {
    let path = get_registry_path();
    let content = serde_json::to_string_pretty(pools)
        .map_err(|e| format!("Failed to serialize registry: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write registry file: {}", e))
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

/// List all pools the user is a member of (reads from local pool registry file).
#[tauri::command]
pub async fn list_pools() -> Result<Vec<DataPool>, String> {
    read_registry()
}

/// Create a new Data Pool with the current user as owner/hub.
#[tauri::command]
pub async fn create_pool(name: String, hub_folder_id: String) -> Result<DataPool, String> {
    let mut pools = read_registry()?;
    
    use std::time::{SystemTime, UNIX_EPOCH};
    let pool_id = format!(
        "pool-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    let pool = DataPool {
        id: pool_id,
        name,
        owner_fp: "local-user".to_string(),
        hub_folder_id,
        inbox_folder_id: String::new(),
        members: vec![PoolMember {
            fingerprint: "local-user".to_string(),
            nickname: "Host (Me)".to_string(),
            joined_at: chrono::Utc::now().to_rfc3339(),
            quota_bytes: 5 * 1024 * 1024 * 1024,
        }],
        total_size: 5 * 1024 * 1024 * 1024,
        used_size: 0,
        status: "online".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    pools.push(pool.clone());
    write_registry(&pools)?;

    Ok(pool)
}

/// Process all pending proposals in the pool's inbox folder.
#[tauri::command]
pub async fn process_pool_inbox(
    pool_id: String,
    proposals: Vec<PoolProposal>,
    current_manifest_json: String,
) -> Result<(String, InboxProcessResult), String> {
    let mut manifest: serde_json::Value = if current_manifest_json.trim().is_empty() {
        serde_json::json!({
            "files": [],
            "folders": [],
            "members": []
        })
    } else {
        serde_json::from_str(&current_manifest_json)
            .map_err(|e| format!("Failed to parse current manifest: {}", e))?
    };

    let mut processed_count = 0;
    let mut failed_count = 0;
    let mut errors = Vec::new();

    if !manifest.is_object() {
        manifest = serde_json::json!({
            "files": [],
            "folders": [],
            "members": []
        });
    }
    let obj = manifest.as_object_mut().unwrap();
    if !obj.contains_key("files") {
        obj.insert("files".to_string(), serde_json::json!([]));
    }
    if !obj.contains_key("folders") {
        obj.insert("folders".to_string(), serde_json::json!([]));
    }
    if !obj.contains_key("members") {
        obj.insert("members".to_string(), serde_json::json!([]));
    }

    for prop in proposals {
        let action = prop.action.as_str();
        match action {
            "join" => {
                let nickname = prop.payload.get("nickname").and_then(|v| v.as_str()).unwrap_or("New Member");
                let fingerprint = prop.payload.get("fingerprint").and_then(|v| v.as_str()).unwrap_or(&prop.member_fp);
                let quota_bytes = prop.payload.get("quota_bytes").and_then(|v| v.as_u64()).unwrap_or(5 * 1024 * 1024 * 1024);

                let members_arr = obj.get_mut("members").unwrap().as_array_mut().unwrap();
                if !members_arr.iter().any(|m| m.get("fingerprint").and_then(|f| f.as_str()) == Some(fingerprint)) {
                    members_arr.push(serde_json::json!({
                        "fingerprint": fingerprint,
                        "nickname": nickname,
                        "joined_at": prop.timestamp,
                        "quota_bytes": quota_bytes
                    }));
                    processed_count += 1;
                } else {
                    processed_count += 1;
                }
            }
            "upload" => {
                let file_id = prop.payload.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let files_arr = obj.get_mut("files").unwrap().as_array_mut().unwrap();
                if !file_id.is_empty() {
                    files_arr.retain(|f| f.get("id").and_then(|id| id.as_str()) != Some(file_id));
                }
                files_arr.push(prop.payload.clone());
                processed_count += 1;
            }
            "delete" => {
                if let Some(file_id) = prop.payload.get("id").and_then(|v| v.as_str()) {
                    let files_arr = obj.get_mut("files").unwrap().as_array_mut().unwrap();
                    files_arr.retain(|f| f.get("id").and_then(|id| id.as_str()) != Some(file_id));
                    processed_count += 1;
                } else if let Some(path) = prop.payload.get("path").and_then(|v| v.as_str()) {
                    let files_arr = obj.get_mut("files").unwrap().as_array_mut().unwrap();
                    files_arr.retain(|f| f.get("path").and_then(|p| p.as_str()) != Some(path));
                    processed_count += 1;
                } else {
                    failed_count += 1;
                    errors.push("Delete proposal payload missing id/path".to_string());
                }
            }
            "mkdir" => {
                let folder_id = prop.payload.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let folders_arr = obj.get_mut("folders").unwrap().as_array_mut().unwrap();
                if !folder_id.is_empty() {
                    folders_arr.retain(|f| f.get("id").and_then(|id| id.as_str()) != Some(folder_id));
                }
                folders_arr.push(prop.payload.clone());
                processed_count += 1;
            }
            "rename" => {
                let id = prop.payload.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let new_name = prop.payload.get("name").and_then(|v| v.as_str()).unwrap_or("");
                if !id.is_empty() && !new_name.is_empty() {
                    let files_arr = obj.get_mut("files").unwrap().as_array_mut().unwrap();
                    for file in files_arr.iter_mut() {
                        if file.get("id").and_then(|f_id| f_id.as_str()) == Some(id) {
                            if let Some(obj) = file.as_object_mut() {
                                obj.insert("name".to_string(), serde_json::json!(new_name));
                            }
                        }
                    }
                    processed_count += 1;
                } else {
                    failed_count += 1;
                    errors.push("Rename proposal payload missing id/name".to_string());
                }
            }
            _ => {
                failed_count += 1;
                errors.push(format!("Unknown proposal action: {}", action));
            }
        }
    }

    let mut pools = read_registry()?;
    if let Some(pool) = pools.iter_mut().find(|p| p.id == pool_id) {
        let mut total_used: u64 = 0;
        if let Some(files) = obj.get("files").and_then(|f| f.as_array()) {
            for f in files {
                total_used += f.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
            }
        }
        pool.used_size = total_used;

        let mut new_members = Vec::new();
        if let Some(members) = obj.get("members").and_then(|m| m.as_array()) {
            for m in members {
                if let Ok(member) = serde_json::from_value::<PoolMember>(m.clone()) {
                    new_members.push(member);
                }
            }
        }
        if !new_members.is_empty() {
            pool.members = new_members;
        }

        let total_quota: u64 = pool.members.iter().map(|m| m.quota_bytes).sum();
        pool.total_size = total_quota;
    }
    write_registry(&pools)?;

    let updated_manifest_json = serde_json::to_string(&manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;

    Ok((updated_manifest_json, InboxProcessResult {
        processed_count,
        failed_count,
        errors,
    }))
}

/// Generate an invite link for a pool member.
#[tauri::command]
pub async fn generate_pool_invite(pool_id: String, hub_folder_id: String) -> Result<String, String> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

    let payload = format!("{}|{}", pool_id, hub_folder_id);
    let encoded = URL_SAFE_NO_PAD.encode(payload.as_bytes());
    Ok(format!("flashmesh://join-pool/{}", encoded))
}

/// Join a pool from an invite link.
#[tauri::command]
pub async fn join_pool_from_invite(invite_link: String) -> Result<DataPool, String> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

    let token = invite_link
        .strip_prefix("flashmesh://join-pool/")
        .ok_or("Invalid invite link format")?;

    let decoded = URL_SAFE_NO_PAD
        .decode(token.as_bytes())
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let payload = String::from_utf8(decoded)
        .map_err(|e| format!("UTF-8 decode error: {}", e))?;

    let parts: Vec<&str> = payload.split('|').collect();
    if parts.len() < 2 {
        return Err("Invalid invite payload".to_string());
    }

    let pool_id = parts[0].to_string();
    let hub_folder_id = parts[1].to_string();

    let mut pools = read_registry()?;
    if pools.iter().any(|p| p.id == pool_id) {
        return Err("You are already a member of this pool".to_string());
    }

    let pool = DataPool {
        id: pool_id,
        name: format!("Joined Pool {}", hub_folder_id.chars().take(6).collect::<String>()),
        owner_fp: "remote-owner".to_string(),
        hub_folder_id,
        inbox_folder_id: String::new(),
        members: vec![
            PoolMember {
                fingerprint: "remote-owner".to_string(),
                nickname: "Owner".to_string(),
                joined_at: chrono::Utc::now().to_rfc3339(),
                quota_bytes: 5 * 1024 * 1024 * 1024,
            },
            PoolMember {
                fingerprint: "local-user".to_string(),
                nickname: "Member (Me)".to_string(),
                joined_at: chrono::Utc::now().to_rfc3339(),
                quota_bytes: 5 * 1024 * 1024 * 1024,
            }
        ],
        total_size: 10 * 1024 * 1024 * 1024,
        used_size: 0,
        status: "online".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    pools.push(pool.clone());
    write_registry(&pools)?;

    Ok(pool)
}
