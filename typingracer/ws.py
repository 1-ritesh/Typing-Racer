"""Minimal RFC 6455 WebSocket (text messages only), usable by both server and test client."""

from __future__ import annotations

import struct
import time
import base64
import hashlib

GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

OP_CONT, OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG = 0x0, 0x1, 0x2, 0x8, 0x9, 0xA

MAX_MESSAGE_BYTES = 32 * 1024
MAX_WRITE_BACKLOG = 1024 * 1024


class ProtocolError(Exception):
    def __init__(self, code: int, reason: str = "") -> None:
        super().__init__(reason)
        self.code = code
        self.reason = reason


def accept_key(client_key: str) -> str:
    return base64.b64encode(hashlib.sha1(client_key.encode("ascii") + GUID).digest()).decode("ascii")


def apply_mask(data: bytes, mask: bytes) -> bytes:
    if not data:
        return data
    key = (mask * (len(data) // 4 + 1))[: len(data)]
    return (int.from_bytes(data, "big") ^ int.from_bytes(key, "big")).to_bytes(len(data), "big")


def encode_frame(opcode: int, payload: bytes = b"", mask: bytes | None = None) -> bytes:
    length = len(payload)
    flag = 0x80 if mask else 0
    head = bytearray([0x80 | opcode])
    if length < 126:
        head.append(flag | length)
    elif length < 1 << 16:
        head.append(flag | 126)
        head += struct.pack("!H", length)
    else:
        head.append(flag | 127)
        head += struct.pack("!Q", length)
    if mask:
        head += mask
        payload = apply_mask(payload, mask)
    return bytes(head) + payload


async def read_frame(reader, *, max_size: int, require_mask: bool = True) -> tuple[bool, int, bytes]:
    b1, b2 = await reader.readexactly(2)
    fin, reserved, opcode = bool(b1 & 0x80), b1 & 0x70, b1 & 0x0F
    masked, length = bool(b2 & 0x80), b2 & 0x7F
    if reserved:
        raise ProtocolError(1002, "reserved bits set")
    if require_mask and not masked:
        raise ProtocolError(1002, "client frames must be masked")
    if length == 126:
        (length,) = struct.unpack("!H", await reader.readexactly(2))
    elif length == 127:
        (length,) = struct.unpack("!Q", await reader.readexactly(8))
    if opcode >= 0x8 and (length > 125 or not fin):
        raise ProtocolError(1002, "invalid control frame")
    if length > max_size:
        raise ProtocolError(1009, "message too large")
    mask = await reader.readexactly(4) if masked else b""
    data = await reader.readexactly(length) if length else b""
    return fin, opcode, apply_mask(data, mask) if masked else data


class WebSocket:
    """Server end of an upgraded connection. Writes never block; slow peers are dropped."""

    def __init__(self, reader, writer, *, max_size: int = MAX_MESSAGE_BYTES) -> None:
        self._reader = reader
        self._writer = writer
        self._max_size = max_size
        self.closed = False
        self.last_rx = time.monotonic()

    def send_text(self, text: str) -> None:
        self.send_frame(encode_frame(OP_TEXT, text.encode("utf-8")))

    def send_frame(self, frame: bytes) -> None:
        if self.closed or self._writer.transport.is_closing():
            return
        if self._writer.transport.get_write_buffer_size() > MAX_WRITE_BACKLOG:
            self.abort()
            return
        self._writer.write(frame)

    def ping(self) -> None:
        self.send_frame(encode_frame(OP_PING, b"hb"))

    def close(self, code: int = 1000, reason: str = "") -> None:
        if self.closed:
            return
        if not self._writer.transport.is_closing():
            self._writer.write(encode_frame(OP_CLOSE, struct.pack("!H", code) + reason.encode("utf-8")[:100]))
        self.closed = True
        self._writer.close()

    def abort(self) -> None:
        self.closed = True
        self._writer.transport.abort()

    async def recv(self) -> str | None:
        """Next text message, or None when the peer closes. Raises ProtocolError on violations."""
        buffer: bytearray | None = None
        while True:
            fin, opcode, data = await read_frame(self._reader, max_size=self._max_size)
            self.last_rx = time.monotonic()
            if opcode == OP_PING:
                self.send_frame(encode_frame(OP_PONG, data))
                continue
            if opcode == OP_PONG:
                continue
            if opcode == OP_CLOSE:
                self.close(1000)
                return None
            if opcode in (OP_TEXT, OP_BINARY):
                if buffer is not None:
                    raise ProtocolError(1002, "expected continuation frame")
                if opcode == OP_BINARY:
                    raise ProtocolError(1003, "binary messages are not supported")
                buffer = bytearray(data)
            elif opcode == OP_CONT:
                if buffer is None:
                    raise ProtocolError(1002, "unexpected continuation frame")
                buffer += data
                if len(buffer) > self._max_size:
                    raise ProtocolError(1009, "message too large")
            else:
                raise ProtocolError(1002, "unknown opcode")
            if fin:
                try:
                    return bytes(buffer).decode("utf-8")
                except UnicodeDecodeError:
                    raise ProtocolError(1007, "invalid utf-8") from None
