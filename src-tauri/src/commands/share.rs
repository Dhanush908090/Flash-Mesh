use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use once_cell::sync::Lazy;
use tauri::AppHandle;

#[allow(dead_code)]
struct ServerInfo {
    path: String,
    url: String,
    addr: SocketAddr,
    shutdown: Arc<AtomicBool>,
}

struct ShareState {
    current_server: Option<ServerInfo>,
}

static SHARE_STATE: Lazy<Mutex<ShareState>> = Lazy::new(|| {
    Mutex::new(ShareState {
        current_server: None,
    })
});

fn get_local_ip() -> String {
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".to_string()
}

fn percent_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte as char);
                    i += 3;
                    continue;
                }
            }
        }
        if bytes[i] == b'+' {
            out.push(' ');
        } else {
            out.push(bytes[i] as char);
        }
        i += 1;
    }
    out
}

fn percent_encode_name(name: &str) -> String {
    let mut encoded = String::new();
    for b in name.as_bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*b as char);
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", b));
            }
        }
    }
    encoded
}

fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

fn resolve_path(base: &Path, request_path: &str) -> Option<PathBuf> {
    let decoded = percent_decode(request_path);
    let clean_path = decoded.split('?').next().unwrap_or("");
    let mut path = PathBuf::from(base);
    for component in clean_path.split('/') {
        if component.is_empty() || component == "." {
            continue;
        }
        if component == ".." {
            if !path.pop() {
                return None;
            }
            if !path.starts_with(base) {
                return None;
            }
            continue;
        }
        path.push(component);
    }
    if path.starts_with(base) {
        Some(path)
    } else {
        None
    }
}

fn get_mime_type(path: &Path) -> &'static str {
    match path.extension().and_then(|s| s.to_str()) {
        Some(ext) => match ext.to_lowercase().as_str() {
            "html" | "htm" => "text/html; charset=utf-8",
            "css" => "text/css; charset=utf-8",
            "js" => "application/javascript; charset=utf-8",
            "json" => "application/json; charset=utf-8",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "svg" => "image/svg+xml",
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            "ogg" => "video/ogg",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "txt" => "text/plain; charset=utf-8",
            "pdf" => "application/pdf",
            _ => "application/octet-stream",
        },
        None => "application/octet-stream",
    }
}

fn render_directory_index(dir_path: &Path, relative_url_path: &str) -> Result<String, std::io::Error> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(dir_path)? {
        if let Ok(entry) = entry {
            entries.push(entry);
        }
    }
    entries.sort_by(|a, b| {
        let a_is_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_is_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if a_is_dir != b_is_dir {
            b_is_dir.cmp(&a_is_dir)
        } else {
            a.file_name().cmp(&b.file_name())
        }
    });

    let mut rows = String::new();
    let relative_clean = relative_url_path.trim_matches('/');

    if !relative_clean.is_empty() {
        let parent_link = if let Some(idx) = relative_clean.rfind('/') {
            format!("/{}/", &relative_clean[..idx])
        } else {
            "/".to_string()
        };
        rows.push_str(&format!(
            r#"<tr>
                <td>📁 <a href="{}">..</a></td>
                <td>-</td>
                <td>Parent Directory</td>
            </tr>"#,
            parent_link
        ));
    }

    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let metadata = entry.metadata();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

        let size_str = if is_dir {
            "-".to_string()
        } else {
            match metadata.as_ref().map(|m| m.len()) {
                Ok(len) => format_size(len),
                Err(_) => "-".to_string(),
            }
        };

        let mod_time_str = if let Ok(Ok(modified)) = metadata.as_ref().map(|m| m.modified()) {
            let datetime: chrono::DateTime<chrono::Utc> = modified.into();
            datetime.format("%Y-%m-%d %H:%M:%S UTC").to_string()
        } else {
            "-".to_string()
        };

        let icon = if is_dir { "📁" } else { "📄" };
        let suffix = if is_dir { "/" } else { "" };
        let encoded_name = percent_encode_name(&name);
        let href = if relative_clean.is_empty() {
            format!("/{}{}", encoded_name, suffix)
        } else {
            format!("/{}/{}{}", relative_clean, encoded_name, suffix)
        };

        rows.push_str(&format!(
            r#"<tr>
                <td>{} <a href="{}">{}</a></td>
                <td>{}</td>
                <td>{}</td>
            </tr>"#,
            icon, href, name, size_str, mod_time_str
        ));
    }

    let html = format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>FlashMesh — Index of /{}</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      margin: 0;
      padding: 40px;
    }}
    .container {{
      max-width: 1000px;
      margin: 0 auto;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }}
    h1 {{
      font-size: 24px;
      margin-top: 0;
      color: #f0f6fc;
      border-bottom: 1px solid #30363d;
      padding-bottom: 16px;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      margin-top: 16px;
    }}
    th, td {{
      text-align: left;
      padding: 12px;
      border-bottom: 1px solid #21262d;
    }}
    th {{
      color: #8b949e;
      font-weight: 600;
    }}
    tr:hover td {{
      background: #21262d;
    }}
    a {{
      color: #58a6ff;
      text-decoration: none;
    }}
    a:hover {{
      text-decoration: underline;
    }}
    .footer {{
      margin-top: 32px;
      text-align: center;
      font-size: 12px;
      color: #8b949e;
    }}
  </style>
</head>
<body>
  <div class="container">
    <h1>Index of /{}</h1>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Size</th>
          <th>Last Modified</th>
        </tr>
      </thead>
      <tbody>
        {}
      </tbody>
    </table>
    <div class="footer">
      Generated by FlashMesh Local Share Server
    </div>
  </div>
</body>
</html>"#,
        relative_clean, relative_clean, rows
    );

    Ok(html)
}

fn parse_range_header(header_val: &str) -> Option<(Option<u64>, Option<u64>)> {
    let val = header_val.trim();
    if !val.starts_with("bytes=") {
        return None;
    }
    let range_str = &val[6..];
    let mut parts = range_str.split('-');
    let start_str = parts.next()?.trim();
    let end_str = parts.next()?.trim();

    let start = if start_str.is_empty() {
        None
    } else {
        start_str.parse::<u64>().ok()
    };

    let end = if end_str.is_empty() {
        None
    } else {
        end_str.parse::<u64>().ok()
    };

    Some((start, end))
}

fn get_range(start: Option<u64>, end: Option<u64>, file_len: u64) -> Option<(u64, u64)> {
    if file_len == 0 {
        return None;
    }
    match (start, end) {
        (Some(s), Some(e)) => {
            if s >= file_len || e >= file_len || s > e {
                None
            } else {
                Some((s, e))
            }
        }
        (Some(s), None) => {
            if s >= file_len {
                None
            } else {
                Some((s, file_len - 1))
            }
        }
        (None, Some(suffix)) => {
            if suffix == 0 {
                None
            } else {
                let s = if suffix >= file_len {
                    0
                } else {
                    file_len - suffix
                };
                Some((s, file_len - 1))
            }
        }
        (None, None) => None,
    }
}

fn copy_range<R: Read + Seek, W: Write>(
    reader: &mut R,
    writer: &mut W,
    start: u64,
    end: u64,
) -> std::io::Result<()> {
    reader.seek(SeekFrom::Start(start))?;
    let mut remaining = end - start + 1;
    let mut buffer = [0u8; 64 * 1024];
    while remaining > 0 {
        let to_read = std::cmp::min(remaining, buffer.len() as u64) as usize;
        let read = reader.read(&mut buffer[..to_read])?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read])?;
        remaining -= read as u64;
    }
    Ok(())
}

struct RequestInfo {
    method: String,
    path: String,
    range_header: Option<String>,
}

fn parse_request<R: Read>(reader: &mut BufReader<R>) -> Option<RequestInfo> {
    let mut lines = reader.lines();
    let first_line = lines.next()?.ok()?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();

    let mut range_header = None;
    for line in lines {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.is_empty() {
            break;
        }
        if let Some(idx) = line.find(':') {
            let key = line[..idx].trim().to_lowercase();
            let val = line[idx + 1..].trim().to_string();
            if key == "range" {
                range_header = Some(val);
            }
        }
    }

    Some(RequestInfo {
        method,
        path,
        range_header,
    })
}

fn handle_client(mut stream: TcpStream, base_path: &Path, _shutdown: Arc<AtomicBool>) {
    stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).ok();
    stream.set_write_timeout(Some(std::time::Duration::from_secs(30))).ok();

    let mut reader = BufReader::new(&stream);
    let req = match parse_request(&mut reader) {
        Some(r) => r,
        None => {
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
            return;
        }
    };

    if req.method != "GET" && req.method != "HEAD" {
        let _ = stream.write_all(b"HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n");
        return;
    }

    let target_path = if base_path.is_file() {
        Some(base_path.to_path_buf())
    } else {
        resolve_path(base_path, &req.path)
    };

    let target_path = match target_path {
        Some(p) => p,
        None => {
            let _ = stream.write_all(b"HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
            return;
        }
    };

    if !target_path.exists() {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        return;
    }

    if target_path.is_dir() {
        match render_directory_index(&target_path, &req.path) {
            Ok(html) => {
                let response = format!(
                    "HTTP/1.1 200 OK\r\n\
                     Content-Type: text/html; charset=utf-8\r\n\
                     Content-Length: {}\r\n\
                     Connection: close\r\n\r\n\
                     {}",
                    html.len(),
                    html
                );
                let _ = stream.write_all(response.as_bytes());
            }
            Err(_) => {
                let _ = stream.write_all(b"HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n");
            }
        }
        return;
    }

    let mut file = match std::fs::File::open(&target_path) {
        Ok(f) => f,
        Err(_) => {
            let _ = stream.write_all(b"HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n");
            return;
        }
    };

    let file_len = match file.metadata().map(|m| m.len()) {
        Ok(l) => l,
        Err(_) => {
            let _ = stream.write_all(b"HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n");
            return;
        }
    };

    let mime = get_mime_type(&target_path);

    let mut range = None;
    if let Some(ref range_header) = req.range_header {
        if let Some((start, end)) = parse_range_header(range_header) {
            if let Some((s, e)) = get_range(start, end, file_len) {
                range = Some((s, e));
            } else {
                let response = format!(
                    "HTTP/1.1 416 Range Not Satisfiable\r\n\
                     Content-Range: bytes */{}\r\n\
                     Connection: close\r\n\r\n",
                    file_len
                );
                let _ = stream.write_all(response.as_bytes());
                return;
            }
        }
    }

    if let Some((start, end)) = range {
        let content_len = end - start + 1;
        let response_headers = format!(
            "HTTP/1.1 206 Partial Content\r\n\
             Accept-Ranges: bytes\r\n\
             Content-Range: bytes {}-{}/{}\r\n\
             Content-Length: {}\r\n\
             Content-Type: {}\r\n\
             Connection: close\r\n\r\n",
            start, end, file_len, content_len, mime
        );
        if stream.write_all(response_headers.as_bytes()).is_err() {
            return;
        }
        if req.method == "GET" {
            let _ = copy_range(&mut file, &mut stream, start, end);
        }
    } else {
        let response_headers = format!(
            "HTTP/1.1 200 OK\r\n\
             Accept-Ranges: bytes\r\n\
             Content-Length: {}\r\n\
             Content-Type: {}\r\n\
             Connection: close\r\n\r\n",
            file_len, mime
        );
        if stream.write_all(response_headers.as_bytes()).is_err() {
            return;
        }
        if req.method == "GET" {
            let _ = copy_range(&mut file, &mut stream, 0, file_len - 1);
        }
    }
}

#[tauri::command]
pub async fn start_share_server(_app: AppHandle, path: String) -> Result<String, String> {
    let canonical_path = PathBuf::from(&path);
    if !canonical_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let _ = stop_share_server();

    let listener = TcpListener::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    let local_addr = listener.local_addr().map_err(|e| e.to_string())?;
    let port = local_addr.port();

    let local_ip = get_local_ip();
    let server_url = format!("http://{}:{}/", local_ip, port);

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = Arc::clone(&shutdown);
    let path_clone = canonical_path.clone();

    std::thread::spawn(move || {
        loop {
            if shutdown_clone.load(Ordering::SeqCst) {
                break;
            }
            match listener.accept() {
                Ok((stream, _)) => {
                    if shutdown_clone.load(Ordering::SeqCst) {
                        break;
                    }
                    let path_inner = path_clone.clone();
                    let shutdown_inner = Arc::clone(&shutdown_clone);
                    std::thread::spawn(move || {
                        handle_client(stream, &path_inner, shutdown_inner);
                    });
                }
                Err(_) => {
                    break;
                }
            }
        }
    });

    let mut state = SHARE_STATE.lock().map_err(|e| e.to_string())?;
    state.current_server = Some(ServerInfo {
        path,
        url: server_url.clone(),
        addr: local_addr,
        shutdown,
    });

    Ok(server_url)
}

#[tauri::command]
pub fn stop_share_server() -> Result<(), String> {
    let mut state = SHARE_STATE.lock().map_err(|e| e.to_string())?;
    if let Some(server) = state.current_server.take() {
        server.shutdown.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(server.addr);
    }
    Ok(())
}

#[tauri::command]
pub fn get_share_status() -> Result<Option<String>, String> {
    let state = SHARE_STATE.lock().map_err(|e| e.to_string())?;
    Ok(state.current_server.as_ref().map(|s| s.url.clone()))
}
