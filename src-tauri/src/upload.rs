use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use serde::{Deserialize, Serialize};

pub const UPLOAD_FILENAME: &str = "photo_2560x1440.jpg";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadPhotoRequest {
    pub endpoint: String,
    pub image: Vec<u8>,
    pub participant_url: String,
    pub session_id: String,
    pub captured_at: String,
    pub athletes: String,
    pub roster: String,
    pub timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadPhotoResponse {
    pub ok: bool,
    pub status: u16,
    pub error: Option<String>,
}

pub fn upload_photo(request: UploadPhotoRequest) -> UploadPhotoResponse {
    let timeout = Duration::from_millis(request.timeout_ms.clamp(500, 30_000));
    match post_http(&request, timeout) {
        Ok(status) => UploadPhotoResponse {
            ok: (200..300).contains(&status),
            status,
            error: if (200..300).contains(&status) {
                None
            } else {
                Some(format!("HTTP {status}"))
            },
        },
        Err(error) => UploadPhotoResponse {
            ok: false,
            status: 0,
            error: Some(error),
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

fn multipart_body(boundary: &str, fields: &[(&str, &str)], image: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    for (name, value) in fields {
        let _ = write!(
            body,
            "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
        );
    }
    let _ = write!(
        body,
        "--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{UPLOAD_FILENAME}\"\r\nContent-Type: image/jpeg\r\n\r\n"
    );
    body.extend_from_slice(image);
    let _ = write!(body, "\r\n--{boundary}--\r\n");
    body
}

fn post_http(request: &UploadPhotoRequest, timeout: Duration) -> Result<u16, String> {
    let target = parse_http_url(&request.endpoint)?;
    let boundary = "----PoseWithAFlyer";
    let fields = [
        ("participantUrl", request.participant_url.as_str()),
        ("sessionId", request.session_id.as_str()),
        ("capturedAt", request.captured_at.as_str()),
        ("athletes", request.athletes.as_str()),
        ("roster", request.roster.as_str()),
    ];
    let body = multipart_body(boundary, &fields, &request.image);
    let header = format!(
        "POST {path} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: multipart/form-data; boundary={boundary}\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n",
        path = target.path,
        host = target.host,
        port = target.port,
        len = body.len(),
    );
    let address = format!("{}:{}", target.host, target.port);
    let mut stream = TcpStream::connect_timeout(
        &address
            .parse()
            .map_err(|error| format!("uploader address: {error}"))?,
        timeout,
    )
    .map_err(|error| format!("uploader connect: {error}"))?;
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
    let mut response = [0u8; 128];
    let read = stream
        .read(&mut response)
        .map_err(|error| format!("uploader read: {error}"))?;
    parse_status(&response[..read])
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

    #[test]
    fn parses_local_uploader_urls() {
        let target = parse_http_url("http://127.0.0.1:8765/uploads").unwrap();
        assert_eq!(target.host, "127.0.0.1");
        assert_eq!(target.port, 8765);
        assert_eq!(target.path, "/uploads");
        assert!(parse_http_url("https://example.test/uploads").is_err());
    }

    #[test]
    fn multipart_includes_the_contract_fields() {
        let body = multipart_body(
            "BOUND",
            &[
                ("participantUrl", "https://example.test/participants/demo-001"),
                ("athletes", "[\"m01\"]"),
                ("roster", "mens"),
            ],
            b"jpeg",
        );
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("name=\"participantUrl\""));
        assert!(text.contains("https://example.test/participants/demo-001"));
        assert!(text.contains("name=\"athletes\""));
        assert!(text.contains("[\"m01\"]"));
        assert!(text.contains("filename=\"photo_2560x1440.jpg\""));
        assert!(text.contains("jpeg"));
        assert!(text.contains("--BOUND--"));
    }
}
