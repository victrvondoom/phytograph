"""TEST-ONLY stand-in for a satellite tile provider. Serves generated 256px PNG tiles, one colour per tile.

It exists to verify the server-side proxy wiring (/api/tiles/satellite/{z}/{x}/{y}) without a real provider.
The tiles are NOT satellite imagery. Run:  python scripts/satellite_stub_server.py --port 8766
Then start the backend with VANASIGNAL_SATELLITE_TEMPLATE=http://127.0.0.1:8766/{z}/{x}/{y}.png
"""

from __future__ import annotations

import argparse
import hashlib
import struct
import zlib
from http.server import BaseHTTPRequestHandler, HTTPServer


def png_solid(rgb: tuple[int, int, int], size: int = 256) -> bytes:
    row = b"\x00" + bytes(rgb) * size
    raw = row * size
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        parts = self.path.split("?")[0].strip("/").split("/")
        if len(parts) != 3 or not parts[2].endswith(".png"):
            self.send_response(404); self.end_headers(); return
        z, x, y = parts[0], parts[1], parts[2][:-4]
        digest = hashlib.sha256(f"{z}/{x}/{y}".encode()).digest()
        body = png_solid((60 + digest[0] % 80, 90 + digest[1] % 70, 60 + digest[2] % 60))
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8766)
    HTTPServer(("127.0.0.1", ap.parse_args().port), Handler).serve_forever()
