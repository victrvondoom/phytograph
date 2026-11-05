"""Local stand-in for api.gbif.org that replays the hand-authored connector fixtures.

It exists so the REAL backend (HTTP client, retries, pagination, caching, audit) and the REAL UI can be
exercised end to end while the live API is unreachable from the build environment. Start the backend with
VANASIGNAL_GBIF_API=http://127.0.0.1:8765/v1 . The UI shows a warning whenever data comes from a non-GBIF
endpoint, so these responses cannot pass as live GBIF evidence.

    python scripts/gbif_fixture_server.py --port 8765
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "tests"))

import httpx  # noqa: E402

from connector_fixtures import ConnectorDouble  # noqa: E402

double = ConnectorDouble("ok")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        url = f"http://127.0.0.1{self.path}"
        resp = double.handle(httpx.Request("GET", url))
        body = resp.content
        self.send_response(resp.status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # quiet
        sys.stderr.write("[gbif-fixture] " + (fmt % args) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
