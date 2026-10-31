"""Local TV display server using only the Python standard library."""

from __future__ import annotations

import json
import mimetypes
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional


HOST = "127.0.0.1"
PORT = 8765
REMOTE_GAMES_URL = "https://jisabo-asv-hackathon.mycafe24.ai/api/public/games"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
TV_ROOT = PROJECT_ROOT / "tv-display"
PUBLIC_ROOT = PROJECT_ROOT / "public"
LAST_SUCCESS = None
LAST_SUCCESS_LOCK = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch_status() -> dict:
    global LAST_SUCCESS

    request = urllib.request.Request(
        REMOTE_GAMES_URL,
        headers={"Accept": "application/json", "User-Agent": "hakertone-local-tv/1.0"},
    )

    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            data = json.load(response)

        raw_games = data.get("games") if data.get("plazaOpen") else []
        games = raw_games if isinstance(raw_games, list) else []
        # The current public endpoint intentionally does not expose visitor totals.
        # Keep the value empty instead of inventing an inaccurate count.
        visitor_count = data.get("visitorCount", data.get("visitors"))
        fresh = {
            "ok": True,
            "stale": False,
            "visitorCount": visitor_count,
            "gameCount": len(games),
            "votingOpen": bool(data.get("votingOpen")),
            "plazaOpen": bool(data.get("plazaOpen")),
            "updatedAt": now_iso(),
        }
        with LAST_SUCCESS_LOCK:
            LAST_SUCCESS = fresh
        return fresh
    except (AttributeError, OSError, urllib.error.URLError, ValueError, KeyError) as error:
        with LAST_SUCCESS_LOCK:
            cached = dict(LAST_SUCCESS) if LAST_SUCCESS else None
        if cached:
            cached["stale"] = True
            cached["staleReason"] = str(error)
            return cached
        return {
            "ok": False,
            "message": "원격 게임 광장에 연결하지 못했습니다.",
            "updatedAt": now_iso(),
        }


def safe_path(root: Path, relative_path: str) -> Optional[Path]:
    candidate = (root / urllib.parse.unquote(relative_path.lstrip("/"))).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    return candidate


class TVRequestHandler(BaseHTTPRequestHandler):
    server_version = "HackathonTV/1.0"

    def do_GET(self) -> None:  # noqa: N802
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api/status":
            self.send_json(fetch_status())
            return

        if path in {"/", "/display.html"}:
            self.send_file(TV_ROOT / "display.html")
            return

        if path.startswith("/tv-display/"):
            target = safe_path(TV_ROOT, path[len("/tv-display/"):])
            self.send_file(target)
            return

        if path.startswith("/public/"):
            target = safe_path(PUBLIC_ROOT, path[len("/public/"):])
            self.send_file(target)
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def send_json(self, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, target: Optional[Path]) -> None:
        if target is None or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = target.read_bytes()
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        print(f"[TV] {self.address_string()} - {format % args}")


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), TVRequestHandler)
    print(f"해커톤 TV 화면: http://{HOST}:{PORT}/")
    print("종료하려면 이 창에서 Ctrl+C를 누르세요.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nTV 서버를 종료합니다.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
