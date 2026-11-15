"""Blocking websocket client for tests, built on the server's own frame codec."""

from __future__ import annotations

import base64
import json
import os
import socket
import struct
import time

from typingracer.ws import OP_CLOSE, OP_PING, OP_PONG, OP_TEXT, apply_mask, encode_frame


class Client:
    def __init__(self, port: int, *, origin: str | None = None, host: str = "127.0.0.1") -> None:
        self.sock = socket.create_connection((host, port), timeout=5)
        self.inbox: list[dict] = []
        key = base64.b64encode(os.urandom(16)).decode()
        lines = [
            "GET /ws HTTP/1.1", f"Host: {host}:{port}", "Upgrade: websocket", "Connection: Upgrade",
            f"Sec-WebSocket-Key: {key}", "Sec-WebSocket-Version: 13",
        ]
        if origin:
            lines.append(f"Origin: {origin}")
        self.sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(1024)
            if not chunk:
                break
            head += chunk
        self.status = int(head.split(b" ", 2)[1]) if head else 0
        self.head = head

    def _read_exact(self, count: int) -> bytes:
        data = b""
        while len(data) < count:
            chunk = self.sock.recv(count - len(data))
            if not chunk:
                raise ConnectionError("closed")
            data += chunk
        return data

    def _read_frame(self) -> tuple[int, bytes]:
        b1, b2 = self._read_exact(2)
        length = b2 & 0x7F
        if length == 126:
            (length,) = struct.unpack("!H", self._read_exact(2))
        elif length == 127:
            (length,) = struct.unpack("!Q", self._read_exact(8))
        mask = self._read_exact(4) if b2 & 0x80 else b""
        data = self._read_exact(length)
        return b1 & 0x0F, apply_mask(data, mask) if mask else data

    def send(self, message: dict) -> None:
        self.send_raw(OP_TEXT, json.dumps(message).encode())

    def send_raw(self, opcode: int, payload: bytes) -> None:
        self.sock.sendall(encode_frame(opcode, payload, os.urandom(4)))

    def recv(self, timeout: float = 3.0) -> dict | None:
        """Next JSON message, or None if the server closed the connection."""
        self.sock.settimeout(timeout)
        while True:
            try:
                opcode, data = self._read_frame()
            except (ConnectionError, OSError) as exc:
                if isinstance(exc, socket.timeout):
                    raise TimeoutError("no message") from None
                return None
            if opcode == OP_PING:
                self.send_raw(OP_PONG, data)
            elif opcode == OP_CLOSE:
                return None
            elif opcode == OP_TEXT:
                return json.loads(data.decode())

    def wait(self, predicate, timeout: float = 5.0) -> dict:
        """Read until a message satisfies predicate (earlier messages are discarded)."""
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("expected message never arrived")
            message = self.recv(remaining)
            if message is None:
                raise ConnectionError("server closed the connection")
            if predicate(message):
                return message

    def wait_type(self, kind: str, timeout: float = 5.0) -> dict:
        return self.wait(lambda m: m.get("t") == kind, timeout)

    def wait_phase(self, phase: str, timeout: float = 5.0) -> dict:
        return self.wait(lambda m: m.get("t") == "room" and m["phase"] == phase, timeout)

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass
