use serde::{Deserialize, Serialize};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::collections::HashMap;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::path::Path;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use sysinfo::Disks;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub name: String,
    pub device_path: String,
    pub mount_point: Option<String>,
    pub is_mounted: bool,
    pub total_space: u64,
    pub available_space: u64,
    pub used_space: u64,
    pub drive_type: String,
    pub file_system: String,
    pub is_removable: bool,
}

#[cfg(target_os = "linux")]
fn mount_table() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(contents) = std::fs::read_to_string("/proc/mounts") else {
        return map;
    };

    for line in contents.lines() {
        let mut parts = line.split_whitespace();
        let Some(device) = parts.next() else {
            continue;
        };
        let Some(mount) = parts.next() else {
            continue;
        };
        let mount = mount.replace("\\040", " ");
        map.insert(device.to_string(), mount);
    }

    map
}

#[cfg(not(target_os = "linux"))]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn mount_table() -> HashMap<String, String> {
    HashMap::new()
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn get_drives() -> Vec<DriveInfo> {
    let mounts = mount_table();
    let disks = Disks::new_with_refreshed_list();
    disks
        .iter()
        .map(|disk| {
            let total = disk.total_space();
            let available = disk.available_space();
            let device_path = disk.name().to_string_lossy().to_string();
            let reported_mount = disk.mount_point().to_string_lossy().to_string();

            let mount_point = if !reported_mount.trim().is_empty()
                && Path::new(&reported_mount).is_absolute()
                && Path::new(&reported_mount).is_dir()
            {
                Some(reported_mount)
            } else {
                mounts.get(&device_path).cloned().or_else(|| {
                    if device_path.starts_with("/dev/") {
                        None
                    } else {
                        mounts.get(&format!("/dev/{}", device_path)).cloned()
                    }
                })
            };

            let mount_point = mount_point.filter(|m| Path::new(m).is_dir());

            DriveInfo {
                name: disk.name().to_string_lossy().to_string(),
                device_path,
                is_mounted: mount_point.is_some(),
                mount_point,
                total_space: total,
                available_space: available,
                used_space: total.saturating_sub(available),
                drive_type: format!("{:?}", disk.kind()),
                file_system: disk.file_system().to_string_lossy().to_string(),
                is_removable: disk.is_removable(),
            }
        })
        .collect()
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn get_drives() -> Vec<DriveInfo> {
    #[cfg(target_os = "android")]
    {
        let mut drives = Vec::new();
        let path = "/storage/emulated/0";
        if std::path::Path::new(path).exists() {
            // Try to get space info if possible, otherwise use defaults
            let (total, available) = if let Ok(stats) = fs2::statvfs(path) {
                (stats.total_space(), stats.available_space())
            } else {
                (0, 0)
            };

            drives.push(DriveInfo {
                name: "Internal Storage".to_string(),
                device_path: path.to_string(),
                mount_point: Some(path.to_string()),
                is_mounted: true,
                total_space: total,
                available_space: available,
                used_space: total.saturating_sub(available),
                drive_type: "Internal".to_string(),
                file_system: "ext4/f2fs".to_string(),
                is_removable: false,
            });
        }
        drives
    }
    #[cfg(target_os = "ios")]
    {
        Vec::new()
    }
}
