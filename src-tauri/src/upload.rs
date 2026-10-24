use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadField {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadPhotoRequest {
    pub endpoint: String,
    pub image: Vec<u8>,
    pub filename: String,
    pub file_field: String,
    pub fields: Vec<UploadField>,
    pub timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadPhotoResponse {
    pub ok: bool,
    pub status: u16,
    pub error: Option<String>,
    pub body: String,
}

pub fn upload_photo(request: UploadPhotoRequest) -> UploadPhotoResponse {
    let timeout = Duration::from_millis(request.timeout_ms.clamp(500, 30_000));
    match post_http(&request, timeout) {
        Ok((status, body)) => UploadPhotoResponse {
            ok: (200..300).contains(&status),
            status,
            error: if (200..300).contains(&status) {
                None
            } else {
                Some(format!("HTTP {status}"))
            },
            body,
        },
        Err(error) => UploadPhotoResponse {
            ok: false,
            status: 0,
            error: Some(error),
            body: String::new(),
        },
    }
}

struct HttpTarget {
    host: String,
    port: u16,
    path: String,
}

fn parse_http_url(endpoint: &str) -> Result<HttpTarget, String> {
    let rest = endpoint
        .strip_prefix("http://")
        .ok_or_else(|| "uploader URL must start with http://".to_string())?;
    if rest.is_empty() {
        return Err("uploader URL is missing a host".to_string());
    }
    let (authority, path) = match rest.split_once('/') {
        Some((authority, path)) => (authority, format!("/{path}")),
        None => (rest, "/".to_string()),
    };
    let (host, port) = split_host_port(authority)?;
    if host.is_empty() {
        return Err("uploader URL is missing a host".to_string());
    }
    Ok(HttpTarget { host, port, path })
}

fn split_host_port(authority: &str) -> Result<(String, u16), String> {
    if let Some(host) = authority.strip_prefix('[') {
        let (host, rest) = host
            .split_once(']')
            .ok_or_else(|| "uploader URL has a bad IPv6 host".to_string())?;
        let port = rest
            .strip_prefix(':')
            .unwrap_or("80")
            .parse::<u16>()
            .map_err(|_| "uploader URL has a bad port".to_string())?;
        return Ok((host.to_string(), port));
    }
    match authority.rsplit_once(':') {
        Some((host, port)) => {
            let port = port
                .parse::<u16>()
                .map_err(|_| "uploader URL has a bad port".to_string())?;
            Ok((host.to_string(), port))
        }
        None => Ok((authority.to_string(), 80)),
    }
}

/// Resolved addresses for the uploader. `localhost` always includes 127.0.0.1
/// so an IPv6 miss still reaches a container published on IPv4.
fn candidate_addrs(host: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
    let mut addrs = Vec::new();
    if let Ok(ip) = host.parse::<IpAddr>() {
        addrs.push(SocketAddr::new(ip, port));
    } else {
        match (host, port).to_socket_addrs() {
            Ok(found) => addrs.extend(found),
            Err(error) => {
                if !host.eq_ignore_ascii_case("localhost") {
                    return Err(format!("uploader resolve: {error}"));
                }
            }
        }
    }
    if host.eq_ignore_ascii_case("localhost") {
        let fallback = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        if !addrs
            .iter()
            .any(|addr| addr.ip() == fallback.ip() && addr.port() == port)
        {
            addrs.push(fallback);
        }
    }
    if addrs.is_empty() {
        return Err(format!("uploader resolve: no addresses for {host}"));
    }
    Ok(addrs)
}

fn connect_host(host: &str, port: u16, timeout: Duration) -> Result<TcpStream, String> {
    let addrs = candidate_addrs(host, port)?;
    let connect_timeout = timeout.min(Duration::from_secs(2));
    let mut last = "uploader connect: no address".to_string();
    for addr in &addrs {
        match TcpStream::connect_timeout(addr, connect_timeout) {
            Ok(stream) => return Ok(stream),
            Err(error) => last = format!("uploader connect {addr}: {error}"),
        }
    }
    Err(last)
}

fn field_name_ok(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn field_value(value: &str) -> String {
    value
        .chars()
        .filter(|c| *c != '\r' && *c != '\n' && *c != '\0')
        .collect()
}

fn safe_filename(filename: &str) -> String {
    let safe: String = filename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '_' || *c == '-')
        .take(120)
        .collect();
    if safe.is_empty() {
        "photo_session.jpg".to_string()
    } else {
        safe
    }
}

fn file_part_name(name: &str) -> &str {
    if field_name_ok(name) {
        name
    } else {
        "image"
    }
}

fn multipart_body(
    boundary: &str,
    filename: &str,
    file_field: &str,
    fields: &[(&str, &str)],
    image: &[u8],
) -> Vec<u8> {
    let mut body = Vec::new();
    let name = safe_filename(filename);
    let part = file_part_name(file_field);
    let _ = write!(
        body,
        "--{boundary}\r\nContent-Disposition: form-data; name=\"{part}\"; filename=\"{name}\"\r\nContent-Type: image/jpeg\r\n\r\n"
    );
    body.extend_from_slice(image);
    let _ = write!(body, "\r\n");
    for (field, value) in fields {
        if !field_name_ok(field) {
            continue;
        }
        let value = field_value(value);
        let _ = write!(
            body,
            "--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"\r\n\r\n{value}\r\n"
        );
    }
    let _ = write!(body, "--{boundary}--\r\n");
    body
}

fn host_header(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn post_http(request: &UploadPhotoRequest, timeout: Duration) -> Result<(u16, String), String> {
    let target = parse_http_url(&request.endpoint)?;
    let boundary = "----PoseWithAFlyer";
    let fields: Vec<(&str, &str)> = request
        .fields
        .iter()
        .map(|field| (field.name.as_str(), field.value.as_str()))
        .collect();
    let body = multipart_body(
        boundary,
        &request.filename,
        &request.file_field,
        &fields,
        &request.image,
    );
    let header = format!(
        "POST {path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: multipart/form-data; boundary={boundary}\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n",
        path = target.path,
        host = host_header(&target.host, target.port),
        len = body.len(),
    );
    let mut stream = connect_host(&target.host, target.port, timeout)?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|error| error.to_string())?;
    stream
        .write_all(header.as_bytes())
        .and_then(|_| stream.write_all(&body))
        .and_then(|_| stream.flush())
        .map_err(|error| format!("uploader write: {error}"))?;
    let bytes = read_http_message(&mut stream)?;
    parse_http_response(&bytes)
}

fn read_http_message(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 2048];
    loop {
        if buf.len() > 65_536 {
            break;
        }
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&tmp[..n]);
                if message_complete(&buf) {
                    break;
                }
            }
            Err(error) => {
                let stalled = error.kind() == ErrorKind::TimedOut || error.kind() == ErrorKind::WouldBlock;
                if stalled && !buf.is_empty() {
                    break;
                }
                return Err(format!("uploader read: {error}"));
            }
        }
    }
    if buf.is_empty() {
        return Err("uploader reply was empty".to_string());
    }
    Ok(buf)
}

fn message_complete(buf: &[u8]) -> bool {
    let Some(header_end) = buf.windows(4).position(|window| window == b"\r\n\r\n") else {
        return false;
    };
    let header = String::from_utf8_lossy(&buf[..header_end]);
    for line in header.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("content-length") {
            let Ok(len) = value.trim().parse::<usize>() else {
                continue;
            };
            return buf.len() >= header_end + 4 + len;
        }
    }
    false
}

fn parse_http_response(bytes: &[u8]) -> Result<(u16, String), String> {
    let header_end = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "uploader reply had no header".to_string())?;
    let status = parse_status(&bytes[..header_end])?;
    let body = snippet_from(&bytes[header_end + 4..]);
    Ok((status, body))
}

fn snippet_from(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let flat = text.replace(['\r', '\n'], " ");
    flat.chars().take(500).collect()
}

fn parse_status(bytes: &[u8]) -> Result<u16, String> {
    let text = String::from_utf8_lossy(bytes);
    let line = text.lines().next().unwrap_or("");
    let mut parts = line.split_whitespace();
    let version = parts.next().unwrap_or("");
    let code = parts.next().unwrap_or("");
    if !version.starts_with("HTTP/") {
        return Err(format!("uploader reply was not HTTP: {line}"));
    }
    code.parse::<u16>()
        .map_err(|_| format!("uploader reply had no status: {line}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn parses_local_uploader_urls() {
        let target = parse_http_url("http://localhost:5001/upload").unwrap();
        assert_eq!(target.host, "localhost");
        assert_eq!(target.port, 5001);
        assert_eq!(target.path, "/upload");
        let v6 = parse_http_url("http://[::1]:5001/upload").unwrap();
        assert_eq!(v6.host, "::1");
        assert_eq!(v6.port, 5001);
        assert!(parse_http_url("https://example.test/upload").is_err());
    }

    #[test]
    fn localhost_candidates_include_ipv4_loopback() {
        let addrs = candidate_addrs("localhost", 5001).unwrap();
        assert!(addrs.iter().any(|addr| {
            addr.ip() == IpAddr::V4(Ipv4Addr::LOCALHOST) && addr.port() == 5001
        }));
        let literal = candidate_addrs("::1", 5001).unwrap();
        assert_eq!(literal.len(), 1);
        assert_eq!(literal[0].ip(), IpAddr::V6("::1".parse().unwrap()));
        assert_eq!(literal[0].port(), 5001);
    }

    #[test]
    fn multipart_matches_the_uploader_contract() {
        let body = multipart_body(
            "BOUND",
            "photo_abc.jpg",
            "image",
            &[("participant_id", "1001")],
            b"jpeg",
        );
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("name=\"image\"; filename=\"photo_abc.jpg\""));
        assert!(!text.contains("name=\"file\""));
        assert!(text.contains("Content-Type: image/jpeg"));
        assert!(text.contains("name=\"participant_id\""));
        assert!(text.contains("1001"));
        assert!(!text.contains("interactive_id"));
        assert!(!text.contains("participantUrl"));
        assert!(text.contains("jpeg"));
        assert!(text.contains("--BOUND--"));
        let with_extra = multipart_body(
            "BOUND",
            "photo_abc.jpg",
            "image",
            &[
                ("participant_id", "1001"),
                ("interactive_id", "booth"),
                ("bad name", "nope"),
            ],
            b"jpeg",
        );
        let extra = String::from_utf8_lossy(&with_extra);
        assert!(extra.contains("name=\"interactive_id\""));
        assert!(extra.contains("booth"));
        assert!(!extra.contains("bad name"));
        let fallback = multipart_body("BOUND", "photo_abc.jpg", "bad name", &[], b"jpeg");
        let fallback_text = String::from_utf8_lossy(&fallback);
        assert!(fallback_text.contains("name=\"image\""));
        assert!(!fallback_text.contains("bad name"));
    }

    #[test]
    fn localhost_reaches_an_ipv4_listener_and_keeps_the_body() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            sock.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut buf = Vec::new();
            let mut tmp = [0u8; 1024];
            loop {
                match sock.read(&mut tmp) {
                    Ok(0) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&tmp[..n]);
                        if buf.windows(4).any(|window| window == b"\r\n\r\n")
                            && buf.windows(20).any(|window| window == b"----PoseWithAFlyer--")
                        {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let reply = b"HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: 21\r\nConnection: close\r\n\r\n{\"status\":\"accepted\"}";
            sock.write_all(reply).unwrap();
            String::from_utf8_lossy(&buf).to_string()
        });
        let response = upload_photo(UploadPhotoRequest {
            endpoint: format!("http://localhost:{port}/upload"),
            image: b"jpeg-bytes".to_vec(),
            filename: "photo_abc.jpg".to_string(),
            file_field: "image".to_string(),
            fields: vec![UploadField {
                name: "participant_id".to_string(),
                value: "1001".to_string(),
            }],
            timeout_ms: 2000,
        });
        let request = server.join().unwrap();
        assert!(response.ok, "{response:?} request={request}");
        assert_eq!(response.status, 201);
        assert!(response.body.contains("accepted"));
        assert!(request.contains("POST /upload "));
        assert!(request.contains("name=\"image\""));
        assert!(!request.contains("name=\"file\""));
        assert!(request.contains("filename=\"photo_abc.jpg\""));
        assert!(request.contains("name=\"participant_id\""));
        assert!(request.contains("1001"));
        assert!(!request.contains("participantUrl"));
        assert!(!request.contains("interactive_id"));
    }
}
