"""Tiny HTTP layer: static files, two JSON endpoints, and the websocket upgrade."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .hub import Hub
from .ws import WebSocket, accept_key

log = logging.getLogger("typingracer")

MAX_HTTP_CONNECTIONS = 400
HEAD_TIMEOUT_S = 10.0

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
}

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
    "font-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
)

REASONS = {
    200: "OK", 101: "Switching Protocols", 400: "Bad Request", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 408: "Request Timeout", 431: "Request Header Fields Too Large",
    503: "Service Unavailable",
}


class WebServer:
    def __init__(self, hub: Hub, public_dir: Path) -> None:
        self.hub = hub
        self.public_dir = public_dir.resolve()
        self.urls: list[str] = []
        self._open = 0

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        peername = writer.get_extra_info("peername") or ("?", 0)
        peer = f"{peername[0]}:{peername[1]}"
        self._open += 1
        try:
            if self._open > MAX_HTTP_CONNECTIONS:
                await self._send(writer, 503, b"Too many connections", "text/plain; charset=utf-8")
                return
            await self._serve(reader, writer, peer)
        except (asyncio.IncompleteReadError, asyncio.TimeoutError, ConnectionError, OSError):
            pass
        except Exception:
            log.exception("request from %s failed", peer)
        finally:
            self._open -= 1
            writer.close()

    async def _serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, peer: str) -> None:
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), HEAD_TIMEOUT_S)
        except asyncio.LimitOverrunError:
            await self._send(writer, 431, b"Headers too large", "text/plain; charset=utf-8")
            return
        parsed = self._parse_head(head)
        if parsed is None:
            await self._send(writer, 400, b"Bad request", "text/plain; charset=utf-8")
            return
        method, target, headers = parsed
        url_path = unquote(urlsplit(target).path)

        if url_path == "/ws" and "websocket" in headers.get("upgrade", "").lower():
            await self._upgrade(reader, writer, method, headers, peer)
            return
        if method not in ("GET", "HEAD"):
            await self._send(writer, 405, b"Method not allowed", "text/plain; charset=utf-8", {"Allow": "GET, HEAD"})
            return
        head_only = method == "HEAD"
        if url_path == "/api/info":
            await self._json(writer, self.hub.info(self.urls), head_only)
        elif url_path == "/api/rooms":
            await self._json(writer, self.hub.room_list(), head_only)
        else:
            await self._static(writer, url_path, head_only)

    @staticmethod
    def _parse_head(head: bytes) -> tuple[str, str, dict[str, str]] | None:
        lines = head.decode("latin-1").split("\r\n")
        parts = lines[0].split(" ")
        if len(parts) != 3 or not parts[2].startswith("HTTP/"):
            return None
        headers: dict[str, str] = {}
        for line in lines[1:]:
            if not line:
                continue
            key, sep, value = line.partition(":")
            if not sep:
                return None
            headers[key.strip().lower()] = value.strip()
        return parts[0].upper(), parts[1], headers

    async def _upgrade(self, reader, writer, method: str, headers: dict[str, str], peer: str) -> None:
        key = headers.get("sec-websocket-key", "")
        if method != "GET" or headers.get("sec-websocket-version") != "13" or not key:
            await self._send(writer, 400, b"Bad websocket request", "text/plain; charset=utf-8")
            return
        origin = headers.get("origin")
        if origin and urlsplit(origin).netloc.lower() != headers.get("host", "").lower():
            await self._send(writer, 403, b"Cross-origin websocket blocked", "text/plain; charset=utf-8")
            return
        try:
            accept = accept_key(key)
        except UnicodeEncodeError:
            await self._send(writer, 400, b"Bad websocket key", "text/plain; charset=utf-8")
            return
        writer.write(
            ("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
             f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode("ascii")
        )
        await self.hub.serve(WebSocket(reader, writer), peer)

    async def _json(self, writer, payload, head_only: bool) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        await self._send(writer, 200, body, MIME[".json"], {"Cache-Control": "no-store"}, head_only)

    async def _static(self, writer, url_path: str, head_only: bool) -> None:
        path = self._resolve(url_path)
        if path is None:
            await self._send(writer, 404, b"Not found", "text/plain; charset=utf-8")
            return
        body = await asyncio.to_thread(path.read_bytes)
        content_type = MIME.get(path.suffix.lower(), "application/octet-stream")
        extra = {"Cache-Control": "no-cache"}
        if content_type.startswith("text/html"):
            extra["Content-Security-Policy"] = CSP
        await self._send(writer, 200, body, content_type, extra, head_only)

    def _resolve(self, url_path: str) -> Path | None:
        relative = url_path.lstrip("/") or "index.html"
        if "\x00" in relative or "\\" in relative or ":" in relative:
            return None
        candidate = (self.public_dir / relative).resolve()
        if not candidate.is_relative_to(self.public_dir) or not candidate.is_file():
            return None
        return candidate

    @staticmethod
    async def _send(writer, status: int, body: bytes, content_type: str,
                    extra: dict[str, str] | None = None, head_only: bool = False) -> None:
        headers = {
            "Content-Type": content_type,
            "Content-Length": str(len(body)),
            "Connection": "close",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        }
        headers.update(extra or {})
        head = f"HTTP/1.1 {status} {REASONS.get(status, 'Status')}\r\n" + "".join(f"{k}: {v}\r\n" for k, v in headers.items())
        writer.write(head.encode("latin-1") + b"\r\n" + (b"" if head_only else body))
        await writer.drain()
