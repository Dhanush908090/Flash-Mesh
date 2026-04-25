#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
use std::process::Command;

#[tauri::command]
#[allow(unused_variables)]
pub fn open_terminal(path: String) -> Result<(), String> {
    // Try each terminal emulator in priority order
    #[cfg(target_os = "linux")]
    {
        let terminals: &[(&str, &[&str])] = &[
            ("konsole", &["--workdir"]),
            ("alacritty", &["--working-directory"]),
            ("kitty", &["--directory"]),
            ("gnome-terminal", &["--working-directory"]),
            ("xfce4-terminal", &["--working-directory"]),
            ("tilix", &["--working-directory"]),
            ("foot", &["--working-directory"]),
            ("wezterm", &["start", "--cwd"]),
            ("xterm", &["-e"]), // fallback
        ];

        for (term, args) in terminals {
            let result = if *term == "xterm" {
                Command::new(term)
                    .args([
                        "-e",
                        "bash",
                        "-lc",
                        "cd -- \"$1\" && exec bash",
                        "bash",
                        &path,
                    ])
                    .spawn()
            } else {
                Command::new(term)
                    .args(args.iter().map(|s| *s))
                    .arg(&path)
                    .spawn()
            };
            if result.is_ok() {
                return Ok(());
            }
        }
        // Last resort: try $TERM environment variable
        if let Ok(term) = std::env::var("TERM") {
            if Command::new(&term).arg(&path).spawn().is_ok() {
                return Ok(());
            }
        }
        Err(
            "No terminal emulator found. Install konsole, alacritty, or gnome-terminal."
                .to_string(),
        )
    }

    #[cfg(target_os = "windows")]
    {
        // Try Windows Terminal first, fallback to cmd
        Command::new("wt.exe")
            .args(["-d", &path])
            .spawn()
            .or_else(|_| {
                Command::new("cmd.exe")
                    .args(["/K", &format!("cd /d {:?}", path)])
                    .spawn()
            })
            .map_err(|e| format!("Failed to open terminal: {}", e))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal"])
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open Terminal: {}", e))?;
        Ok(())
    }

    #[cfg(target_os = "android")]
    {
        Err("Terminal not supported on Android".to_string())
    }

    #[cfg(target_os = "ios")]
    {
        Err("Terminal not supported on iOS".to_string())
    }
}

/// Join two path segments cross-platform
#[tauri::command]
pub fn path_join(base: String, name: String) -> String {
    std::path::Path::new(&base)
        .join(&name)
        .to_string_lossy()
        .to_string()
}

/// Get the path separator for the current OS
#[tauri::command]
pub fn path_separator() -> String {
    std::path::MAIN_SEPARATOR.to_string()
}
