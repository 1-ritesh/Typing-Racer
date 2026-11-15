"""Connection handling: parses websocket messages and routes them to rooms."""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from typing import Any

from . import config, texts
from .rooms import GameError, Room
from .ws import ProtocolError, WebSocket

log = logging.getLogger("typingracer")

CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"  # consonants only, so room codes never spell words


class Conn:
    def __init__(self, ws: WebSocket, peer: str) -> None:
        self.ws = ws
        self.peer = peer
        self.player: Any = None
        self.room: Room | None = None
        self.strikes = 0
        self.last_react = 0.0
        self._tokens = float(config.MSG_RATE_CAPACITY)
        self._refilled = time.monotonic()

    def send(self, message: dict) -> None:
        self.ws.send_text(json.dumps(message, separators=(",", ":"), ensure_ascii=False))

    def send_frame(self, frame: bytes) -> None:
        self.ws.send_frame(frame)

    def allow(self, now: float) -> bool:
        self._tokens = min(float(config.MSG_RATE_CAPACITY), self._tokens + (now - self._refilled) * config.MSG_RATE_PER_S)
        self._refilled = now
        if self._tokens < 1:
            return False
        self._tokens -= 1
        return True


def _text(msg: dict, key: str) -> str:
    value = msg.get(key)
    return value if isinstance(value, str) else ""


class Hub:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.conns: set[Conn] = set()
        self._last_ping = time.monotonic()
        self._handlers = {
            "ping": self._h_ping, "create": self._h_create, "join": self._h_join, "resume": self._h_resume,
            "leave": self._h_leave, "profile": self._h_profile, "settings": self._h_settings,
            "bot_add": self._h_bot_add, "bot_remove": self._h_bot_remove, "kick": self._h_kick,
            "start": self._h_start, "again": self._h_start, "lobby": self._h_lobby,
            "p": self._h_progress, "react": self._h_react,
        }

    # ----- connection lifecycle ---------------------------------------

    async def serve(self, ws: WebSocket, peer: str) -> None:
        conn = Conn(ws, peer)
        self.conns.add(conn)
        try:
            while True:
                text = await ws.recv()
                if text is None:
                    break
                self._on_text(conn, text)
        except ProtocolError as exc:
            ws.close(exc.code, exc.reason)
        except (asyncio.IncompleteReadError, ConnectionError, OSError):
            pass
        finally:
            self.conns.discard(conn)
            self._on_disconnect(conn)
            ws.close()

    def _on_text(self, conn: Conn, text: str) -> None:
        now = time.monotonic()
        if not conn.allow(now):
            conn.strikes += 1
            if conn.strikes > 200:
                conn.ws.close(1008, "too many messages")
            return
        try:
            msg = json.loads(text)
        except (ValueError, RecursionError):
            return
        kind = msg.get("t") if isinstance(msg, dict) else None
        handler = self._handlers.get(kind) if isinstance(kind, str) else None
        if handler is None:
            return
        try:
            handler(conn, msg, now)
        except GameError as exc:
            conn.send({"t": "error", "code": exc.code, "msg": exc.message})

    def _on_disconnect(self, conn: Conn) -> None:
        room, player = conn.room, conn.player
        conn.room = conn.player = None
        if room is None or player is None or player.conn is not conn:
            return
        now = time.monotonic()
        player.conn = None
        player.offline_since = now
        if room.host_id == player.id:
            room.returning_host = player.id
            room.elect_host()
        log.info("%s lost connection in room %s", player.name, room.code)
        room.broadcast_snapshot(now)

    # ----- background work --------------------------------------------

    async def run_ticker(self) -> None:
        interval = 1.0 / config.TICK_HZ
        next_at = time.monotonic()
        while True:
            next_at += interval
            await asyncio.sleep(max(0.0, next_at - time.monotonic()))
            now = time.monotonic()
            if next_at < now - 1.0:
                next_at = now
            for room in list(self.rooms.values()):
                try:
                    room.update(now)
                except Exception:
                    log.exception("room %s update failed", room.code)
                if room.is_empty():
                    self.rooms.pop(room.code, None)
                    log.info("room %s closed", room.code)
            self._heartbeat(now)

    def _heartbeat(self, now: float) -> None:
        if now - self._last_ping < config.IDLE_PING_S:
            return
        self._last_ping = now
        for conn in list(self.conns):
            if now - conn.ws.last_rx > config.IDLE_TIMEOUT_S:
                conn.ws.abort()
            else:
                conn.ws.ping()

    # ----- read-only views for the HTTP API ---------------------------

    def room_list(self) -> list[dict]:
        listing = []
        for room in self.rooms.values():
            if not any(p.conn is not None for p in room.humans()):
                continue
            host = room.players.get(room.host_id)
            listing.append({
                "code": room.code, "host": host.name if host else "", "players": len(room.players),
                "max": config.MAX_PLAYERS, "phase": room.phase, "pack": room.pack,
            })
        listing.sort(key=lambda r: (r["phase"] not in ("lobby", "results"), r["code"]))
        return listing

    @staticmethod
    def info(urls: list[str]) -> dict:
        return {
            "name": config.APP_NAME,
            "urls": urls,
            "maxPlayers": config.MAX_PLAYERS,
            "packs": texts.pack_info(),
            "styles": list(config.CAR_STYLES),
            "colors": [{"name": n, "hex": h} for n, h in config.CAR_COLORS],
            "themes": [{"id": i, "label": label} for i, label in config.THEMES],
            "levels": [{"id": i, "label": label, "wpm": wpm} for i, label, wpm in config.BOT_LEVELS],
            "reactions": list(config.REACTIONS),
            "limits": {"nameMax": config.NAME_MAX, "customMin": config.CUSTOM_TEXT_MIN, "customMax": config.CUSTOM_TEXT_MAX},
            "game": {
                "countdown": config.COUNTDOWN_S, "nitroStreak": config.NITRO_STREAK,
                "finishGrace": config.FINISH_GRACE_S, "points": list(config.POINTS),
            },
        }

    # ----- message handlers -------------------------------------------

    @staticmethod
    def _ctx(conn: Conn) -> tuple[Room, Any]:
        if conn.room is None or conn.player is None:
            raise GameError("no_room", "You are not in a race.")
        return conn.room, conn.player

    @classmethod
    def _host_ctx(cls, conn: Conn) -> tuple[Room, Any]:
        room, player = cls._ctx(conn)
        if room.host_id != player.id:
            raise GameError("not_host", "Only the host can do that.")
        return room, player

    @staticmethod
    def _ensure_unjoined(conn: Conn) -> None:
        if conn.room is not None:
            raise GameError("already_in", "Leave your current race first.")

    @staticmethod
    def _code(raw: Any) -> str:
        if not isinstance(raw, str):
            return ""
        return "".join(ch for ch in raw.upper() if ch.isalnum())[:8]

    def _new_code(self) -> str:
        for _ in range(200):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(4))
            if code not in self.rooms:
                return code
        raise GameError("busy", "No free room codes right now.")

    def _enter(self, conn: Conn, room: Room, msg: dict, now: float) -> Any:
        player = room.add_human(conn, msg.get("name"), msg.get("style"), msg.get("color"), now)
        conn.player, conn.room = player, room
        snapshot = room.snapshot(now)
        conn.send({"t": "welcome", "you": player.id, "token": player.token, "room": snapshot})
        room.broadcast(snapshot, exclude=player)
        return player

    def _h_ping(self, conn: Conn, msg: dict, now: float) -> None:
        ts = msg.get("ts")
        conn.send({"t": "pong", "ts": ts if isinstance(ts, (int, float)) and not isinstance(ts, bool) else 0})

    def _h_create(self, conn: Conn, msg: dict, now: float) -> None:
        self._ensure_unjoined(conn)
        if len(self.rooms) >= config.MAX_ROOMS:
            raise GameError("busy", "The server is hosting too many races right now.")
        room = Room(self._new_code(), now)
        self.rooms[room.code] = room
        try:
            player = self._enter(conn, room, msg, now)
        except GameError:
            self.rooms.pop(room.code, None)
            raise
        log.info("%s created room %s", player.name, room.code)

    def _h_join(self, conn: Conn, msg: dict, now: float) -> None:
        self._ensure_unjoined(conn)
        room = self.rooms.get(self._code(msg.get("room")))
        if room is None:
            raise GameError("no_room", "No race with that code. Check the letters and try again.")
        player = self._enter(conn, room, msg, now)
        log.info("%s joined room %s", player.name, room.code)

    def _h_resume(self, conn: Conn, msg: dict, now: float) -> None:
        self._ensure_unjoined(conn)
        room = self.rooms.get(self._code(msg.get("room")))
        player = room.find_by_token(msg.get("token")) if room else None
        if room is None or player is None:
            raise GameError("no_session", "That race is no longer available.")
        previous = player.conn
        if previous is not None and previous is not conn:
            previous.player = previous.room = None
            previous.send({"t": "replaced"})
            previous.ws.close(4000, "replaced")
        player.conn = conn
        player.offline_since = None
        conn.player, conn.room = player, room
        if not room.host_id or room.host_id not in room.players:
            room.elect_host()
        room.reclaim_host(player)
        snapshot = room.snapshot(now)
        conn.send({"t": "welcome", "you": player.id, "token": player.token, "room": snapshot, "resumed": True})
        room.broadcast(snapshot, exclude=player)
        log.info("%s is back in room %s", player.name, room.code)

    def _h_leave(self, conn: Conn, msg: dict, now: float) -> None:
        room, player = self._ctx(conn)
        room.remove_player(player, now)
        conn.send({"t": "left"})

    def _h_profile(self, conn: Conn, msg: dict, now: float) -> None:
        room, player = self._ctx(conn)
        room.apply_profile(player, msg, now)

    def _h_settings(self, conn: Conn, msg: dict, now: float) -> None:
        room, _ = self._host_ctx(conn)
        room.apply_settings(msg, now)

    def _h_bot_add(self, conn: Conn, msg: dict, now: float) -> None:
        room, _ = self._host_ctx(conn)
        room.add_bot(msg.get("level"), now)
        room.broadcast_snapshot(now)

    def _h_bot_remove(self, conn: Conn, msg: dict, now: float) -> None:
        room, _ = self._host_ctx(conn)
        room.remove_bot(msg.get("id"), now)

    def _h_kick(self, conn: Conn, msg: dict, now: float) -> None:
        room, host = self._host_ctx(conn)
        target = room.players.get(_text(msg, "id"))
        if target is None or target is host or target.bot:
            raise GameError("bad_request", "You can't remove that driver.")
        target_conn = target.conn
        room.remove_player(target, now)
        if target_conn is not None:
            target_conn.send({"t": "kicked"})
        log.info("%s removed %s from room %s", host.name, target.name, room.code)

    def _h_start(self, conn: Conn, msg: dict, now: float) -> None:
        room, _ = self._host_ctx(conn)
        room.start_race(now)
        log.info("room %s: race %d starts (%d drivers)", room.code, room.round_no, len(room.players))

    def _h_lobby(self, conn: Conn, msg: dict, now: float) -> None:
        room, _ = self._host_ctx(conn)
        if room.phase == "results":
            room.to_lobby(now)

    def _h_progress(self, conn: Conn, msg: dict, now: float) -> None:
        room, player = self._ctx(conn)
        room.on_progress(player, msg, now)

    def _h_react(self, conn: Conn, msg: dict, now: float) -> None:
        room, player = self._ctx(conn)
        if msg.get("e") not in config.REACTIONS or now - conn.last_react < 0.8:
            return
        conn.last_react = now
        room.broadcast({"t": "react", "id": player.id, "e": msg["e"]})
