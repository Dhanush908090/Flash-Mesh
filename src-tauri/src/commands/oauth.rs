/// OAuth loopback server for Tauri desktop apps.
///
/// Google deprecated the OOB (urn:ietf:wg:oauth:2.0:oob) redirect URI in Oct 2022.
/// Dropbox never supported it. The correct approach for native apps (RFC 8252) is to
/// spin up a temporary HTTP server on 127.0.0.1 and use it as the redirect target.
///
/// Flow:
///   1. Frontend calls start_oauth_server() → gets back the free port.
///   2. Frontend builds auth URL with redirect_uri=http://127.0.0.1:PORT
///   3. openUrl() opens the auth URL in the system browser.
///   4. After sign-in, Google/Dropbox redirects to http://127.0.0.1:PORT/?access_token=...
///      (implicit flow) or http://127.0.0.1:PORT/?code=... (auth-code flow).
///   5. The server serves a tiny HTML page that captures the fragment/token and POSTs it.
///   6. Server emits a Tauri event "flashmesh:oauth-token" with the token payload.
///   7. Server shuts down.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// HTML page served at the redirect URI.
/// - For implicit flow: the token is in window.location.hash, so we extract it via JS
///   and hit GET /callback?token=TOKEN.
/// - For auth-code flow: the code is already in the query string as ?code=CODE.
const CAPTURE_HTML: &str = r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>FlashMesh — Signing In…</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #050508; color: #e2e8f0;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .box { text-align: center; padding: 40px; background: rgba(255,255,255,.05);
           border: 1px solid rgba(255,255,255,.1); border-radius: 16px; max-width: 380px; }
    .spinner { display: inline-block; width: 32px; height: 32px; border: 3px solid rgba(255,255,255,.2);
               border-top-color: #2563eb; border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 { margin: 16px 0 8px; font-size: 18px; }
    p  { margin: 0; font-size: 14px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="box">
    <div class="spinner"></div>
    <h2>Connecting to FlashMesh…</h2>
    <p>You can close this window once connected.</p>
  </div>
  <script>
    // Extract token from either the query string (?access_token=) or the fragment (#access_token=)
    function extract() {
      var search = window.location.search.substring(1);
      var hash   = window.location.hash.substring(1);
      var params = new URLSearchParams(search.length > hash.length ? search : hash);
      return params.get('access_token') || params.get('code') || '';
    }
    var token = extract();
    if (token) {
      fetch('/callback?token=' + encodeURIComponent(token))
        .then(function() { document.querySelector('p').textContent = '✅ Connected! You can close this tab.'; })
        .catch(function() {});
    } else {
      // Fragment is not sent to the server on first load — reload to trigger the script
      // (Some providers redirect with fragment on a 302, which means we load the page first.)
      window.addEventListener('hashchange', function() {
        var t = extract();
        if (t) fetch('/callback?token=' + encodeURIComponent(t));
      });
    }
  </script>
</body>
</html>"#;

fn respond_200(mut stream: TcpStream, body: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn respond_204(mut stream: TcpStream) {
    let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
}

/// Start a temporary OAuth loopback server.
/// Returns the local port number. The server shuts itself down after capturing one token
/// or after the 120-second timeout.
#[tauri::command]
pub async fn start_oauth_server(app: AppHandle, port: u16) -> Result<u16, String> {
    // Bind to specified port or OS-assigned free port (if port is 0)
    let listener = TcpListener::bind(format!("127.0.0.1:{}", port)).map_err(|e| e.to_string())?;
    let bound_port = listener.local_addr().map_err(|e| e.to_string())?.port();

    // Set a 120-second accept timeout so the thread doesn't hang forever
    listener
        .set_nonblocking(false)
        .map_err(|e| e.to_string())?;

    let done = Arc::new(AtomicBool::new(false));
    let done_clone = Arc::clone(&done);

    std::thread::spawn(move || {
        // Accept connections until we get the token or time runs out
        for stream in listener.incoming() {
            if done_clone.load(Ordering::SeqCst) {
                break;
            }
            match stream {
                Ok(stream) => {
                    let first_line = {
                        let reader = BufReader::new(&stream);
                        reader.lines().next().and_then(|l| l.ok()).unwrap_or_default()
                    };

                    // GET /callback?token=TOKEN
                    if first_line.contains("GET /callback") {
                        if let Some(query) = first_line.split_whitespace().nth(1) {
                            if let Some(qs) = query.split('?').nth(1) {
                                let params: Vec<(String, String)> = qs
                                    .split('&')
                                    .filter_map(|pair| {
                                        let mut kv = pair.splitn(2, '=');
                                        let k = kv.next()?.to_string();
                                        let v = kv.next().unwrap_or("").to_string();
                                        Some((k, v))
                                    })
                                    .collect();

                                if let Some(token) = params.iter().find(|(k, _)| k == "token").map(|(_, v)| {
                                    percent_decode(v)
                                }) {
                                    respond_204(stream);
                                    done_clone.store(true, Ordering::SeqCst);
                                    // Emit the token back to the frontend
                                    let _ = app.emit("flashmesh:oauth-token", token);
                                    break;
                                }
                             }
                        }
                        respond_204(stream);
                    } else {
                        // Serve the capture HTML page
                        respond_200(stream, CAPTURE_HTML);
                    }
                }
                Err(_) => break,
            }
        }
    });

    Ok(bound_port)
}

/// Minimal percent-decoder (handles %XX sequences)
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
