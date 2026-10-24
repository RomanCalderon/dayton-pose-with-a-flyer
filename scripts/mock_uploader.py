#!/usr/bin/env python3
"""Stand-in for the arena uploader.

Accepts the kiosk contract and writes the JPEG plus a sidecar JSON file.
Any HTTP 2xx is success for the kiosk. A missing file or participant_id is 400.

    python3 scripts/mock_uploader.py --port 5001 --out ./uploads

The real service listens on port 5000 inside Docker and is published on the
host as http://localhost:5001. This mock binds IPv4 and IPv6 loopback when
--host localhost so either resolution works.
"""

from __future__ import annotations

import argparse
import json
import socket
import threading
from email import message_from_bytes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def parse_multipart(content_type: str, body: bytes) -> dict[str, tuple[str, bytes]]:
    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode()
    message = message_from_bytes(header + body)
    parts: dict[str, tuple[str, bytes]] = {}
    if not message.is_multipart():
        raise ValueError("expected multipart/form-data")
    for part in message.walk():
        if part.get_content_maintype() == "multipart":
            continue
        disposition = part.get("Content-Disposition", "")
        name = ""
        filename = ""
        for item in disposition.split(";"):
            item = item.strip()
            if item.startswith("name="):
                name = item.split("=", 1)[1].strip('"')
            elif item.startswith("filename="):
                filename = item.split("=", 1)[1].strip('"')
        payload = part.get_payload(decode=True)
        if isinstance(payload, bytes) and name:
            parts[name] = (filename, payload)
    return parts


def text_part(parts: dict[str, tuple[str, bytes]], name: str) -> str:
    found = parts.get(name)
    if found is None:
        return ""
    return found[1].decode("utf-8", "replace").strip()


class Handler(BaseHTTPRequestHandler):
    out_dir: Path = Path("uploads")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path != "/upload":
            self.send_json(404, {"error": "expected /upload"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        content_type = self.headers.get("Content-Type", "")
        try:
            parts = parse_multipart(content_type, body)
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        image = parts.get("file")
        participant_id = text_part(parts, "participant_id")
        if image is None or not image[1]:
            self.send_json(400, {"error": "missing file"})
            return
        if not participant_id:
            self.send_json(400, {"error": "missing participant_id"})
            return
        interactive_id = text_part(parts, "interactive_id")
        filename = Path(image[0] or f"photo_{participant_id}.jpg").name or "photo.jpg"
        meta = {
            "participant_id": participant_id,
            "filename": filename,
            "bytes": len(image[1]),
            "fields": sorted(parts),
        }
        if interactive_id:
            meta["interactive_id"] = interactive_id
        self.out_dir.mkdir(parents=True, exist_ok=True)
        (self.out_dir / filename).write_bytes(image[1])
        stem = Path(filename).stem
        (self.out_dir / f"{stem}.json").write_text(json.dumps(meta, indent=2) + "\n")
        self.send_json(200, {"status": "accepted", "participant_id": participant_id})

    def send_json(self, status: int, payload: dict[str, object]) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[uploader] {self.address_string()} {fmt % args}")


class V6Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def bind_servers(host: str, port: int) -> list[ThreadingHTTPServer]:
    if host == "localhost":
        targets = [("127.0.0.1", ThreadingHTTPServer), ("::1", V6Server)]
    elif ":" in host:
        targets = [(host, V6Server)]
    else:
        targets = [(host, ThreadingHTTPServer)]
    servers: list[ThreadingHTTPServer] = []
    errors: list[str] = []
    for address, factory in targets:
        try:
            servers.append(factory((address, port), Handler))
        except OSError as error:
            errors.append(f"{address}:{port} {error}")
    if not servers:
        raise SystemExit("could not bind mock uploader: " + "; ".join(errors))
    return servers


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=5001)
    parser.add_argument("--out", default="uploads")
    args = parser.parse_args()
    Handler.out_dir = Path(args.out)
    servers = bind_servers(args.host, args.port)
    threads = []
    for server in servers[1:]:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        threads.append(thread)
    bound = ", ".join(f"http://{server.server_address[0]}:{server.server_address[1]}/upload" for server in servers)
    print(f"mock uploader on {bound} -> {Handler.out_dir}")
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for server in servers:
            server.shutdown()


if __name__ == "__main__":
    main()
