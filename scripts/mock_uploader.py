#!/usr/bin/env python3
"""Tiny stand-in for the local uploader service.

Accepts the kiosk's multipart POST and writes the JPEG plus a sidecar JSON
file. Any 2xx is success for the kiosk; this server returns 202.

    python3 scripts/mock_uploader.py --port 8765 --out ./uploads
"""

from __future__ import annotations

import argparse
import json
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
        if self.path.rstrip("/") != "/uploads":
            self.send_error(404, "expected /uploads")
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        content_type = self.headers.get("Content-Type", "")
        try:
            parts = parse_multipart(content_type, body)
        except ValueError as error:
            self.send_error(400, str(error))
            return
        image = parts.get("image")
        if image is None:
            self.send_error(400, "missing image")
            return
        athletes_raw = parts.get("athletes", ("", b"[]"))[1].decode("utf-8", "replace")
        meta = {
            "participantUrl": parts.get("participantUrl", ("", b""))[1].decode("utf-8", "replace"),
            "sessionId": parts.get("sessionId", ("", b""))[1].decode("utf-8", "replace"),
            "capturedAt": parts.get("capturedAt", ("", b""))[1].decode("utf-8", "replace"),
            "athletes": json.loads(athletes_raw),
            "roster": parts.get("roster", ("", b""))[1].decode("utf-8", "replace"),
        }
        self.out_dir.mkdir(parents=True, exist_ok=True)
        stem = meta["sessionId"] or "session"
        (self.out_dir / f"{stem}.jpg").write_bytes(image[1])
        (self.out_dir / f"{stem}.json").write_text(json.dumps(meta, indent=2) + "\n")
        payload = json.dumps({"status": "accepted"}).encode()
        self.send_response(202)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[uploader] {self.address_string()} {fmt % args}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--out", default="uploads")
    args = parser.parse_args()
    Handler.out_dir = Path(args.out)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"mock uploader on http://{args.host}:{args.port}/uploads -> {Handler.out_dir}")
    server.serve_forever()


if __name__ == "__main__":
    main()
