pub mod commands;

use commands::drives::get_drives;
use commands::fs::{
    empty_trash, get_file_metadata, get_home_dir, get_special_dirs, list_directory, list_trash,
    get_image_thumbnail, get_extended_metadata,
};
use commands::operations::{
    copy_items, create_file, create_folder, delete_items, move_items, open_item, open_item_with,
    read_text_file, read_binary_file, write_binary_file, rename_item, cancel_operation,
};
use commands::platform::{
    check_android_permission, get_platform_capabilities, request_android_permission,
};
use commands::search::{list_recent_files, search_files};
use commands::terminal::{open_terminal, path_join, path_separator};
use commands::pool::{
    create_pool, generate_pool_invite, join_pool_from_invite,
    list_pools, process_pool_inbox,
};
use commands::oauth::start_oauth_server;
use commands::share::{start_share_server, stop_share_server, get_share_status};

#[cfg(not(mobile))]
use tauri::image::Image;
#[cfg(not(mobile))]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            #[cfg(not(mobile))]
            {
                // Set the window icon at runtime so the taskbar/dock shows the correct logo
                let icon_bytes = include_bytes!("../icons/icon.png");
                if let Ok(icon) = Image::from_bytes(icon_bytes) {
                    if let Some(window) = _app.get_webview_window("main") {
                        let _ = window.set_icon(icon);
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Filesystem
            list_directory,
            get_home_dir,
            get_special_dirs,
            get_file_metadata,
            list_trash,
            empty_trash,
            get_image_thumbnail,
            get_extended_metadata,
            // Operations
            copy_items,
            move_items,
            cancel_operation,
            rename_item,
            delete_items,
            create_folder,
            create_file,
            read_text_file,
            read_binary_file,
            write_binary_file,
            open_item,
            open_item_with,
            // Search
            search_files,
            list_recent_files,
            // Drives
            get_drives,
            // Terminal & paths
            open_terminal,
            path_join,
            path_separator,
            // Platform
            get_platform_capabilities,
            check_android_permission,
            request_android_permission,
            // Data Pools
            list_pools,
            create_pool,
            process_pool_inbox,
            generate_pool_invite,
            join_pool_from_invite,
            // OAuth
            start_oauth_server,
            // Share
            start_share_server,
            stop_share_server,
            get_share_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
