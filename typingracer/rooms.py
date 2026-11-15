"""Room state machine: lobby -> countdown -> racing -> results."""

from __future__ import annotations

import json
import math
import random
import secrets
from dataclasses import dataclass
from typing import Any

from . import config, texts
from .ws import OP_TEXT, encode_frame

PALETTE = tuple(hex_ for _, hex_ in config.CAR_COLORS)
LEVELS = {level_id: (label, wpm) for level_id, label, wpm in config.BOT_LEVELS}
BOT_ACCURACY = {"rookie": 0.93, "casual": 0.95, "pro": 0.97, "champ": 0.985}
THEME_IDS = tuple(theme_id for theme_id, _ in config.THEMES)
LOBBY_PHASES = ("lobby", "results")
RACE_PHASES = ("countdown", "racing")


class GameError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _as_int(value: Any, low: int, high: int, default: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    if isinstance(value, float) and not math.isfinite(value):
        return default
    return int(_clamp(value, low, high))


def _wpm(chars: float, seconds: float) -> float:
    return (chars / 5.0) / (max(seconds, 1e-3) / 60.0)


def clean_name(raw: Any, fallback: str) -> str:
    if not isinstance(raw, str):
        return fallback
    printable = "".join(ch for ch in raw if ch.isprintable())
    return " ".join(printable.split())[: config.NAME_MAX].strip() or fallback


@dataclass(eq=False)
class Player:
    id: str
    name: str
    style: str
    color: str
    joined_at: float
    token: str = ""
    bot: bool = False
    level: str = ""
    conn: Any = None
    offline_since: float | None = None
    points: int = 0
    wins: int = 0
    in_race: bool = False
    progress: int = 0
    keys: int = 0
    errors: int = 0
    streak: int = 0
    finished: bool = False
    place: int = 0
    finish_ms: int = 0
    wpm: float = 0.0
    acc: float = 100.0
    base_cps: float = 0.0
    acc_target: float = 0.96
    fprog: float = 0.0
    mood: float = 1.0
    pause_until: float = 0.0

    @property
    def online(self) -> bool:
        return self.bot or self.conn is not None

    def clear_race(self) -> None:
        self.in_race = False
        self.progress = self.keys = self.errors = self.streak = 0
        self.finished = False
        self.place = self.finish_ms = 0
        self.wpm = 0.0
        self.acc = 100.0
        self.fprog = 0.0
        self.mood = 1.0
        self.pause_until = 0.0

    def public(self) -> dict:
        return {
            "id": self.id, "name": self.name, "style": self.style, "color": self.color,
            "bot": self.bot, "level": self.level, "points": self.points, "wins": self.wins,
            "online": self.online, "inRace": self.in_race, "prog": self.progress,
            "place": self.place if self.finished else 0,
        }


class Room:
    def __init__(self, code: str, now: float) -> None:
        self.code = code
        self.created = now
        self.phase = "lobby"
        self.players: dict[str, Player] = {}
        self.host_id = ""
        self.returning_host = ""
        self.pack = "standard"
        self.theme = "neon"
        self.custom_text = ""
        self.round_no = 0
        self.text = ""
        self.last_text = ""
        self.race_start = 0.0
        self.race_ended_at = 0.0
        self.next_place = 1
        self.deadline: float | None = None
        self.humans_done_at: float | None = None
        self.results: list[dict] = []
        self._last_update = now

    # ----- membership -------------------------------------------------

    def humans(self) -> list[Player]:
        return [p for p in self.players.values() if not p.bot]

    def is_empty(self) -> bool:
        return not any(not p.bot for p in self.players.values())

    def find_by_token(self, token: Any) -> Player | None:
        if not isinstance(token, str) or not token:
            return None
        for player in self.humans():
            if secrets.compare_digest(player.token, token):
                return player
        return None

    def add_human(self, conn: Any, name: Any, style: Any, color: Any, now: float) -> Player:
        self._make_room_for_human()
        player = Player(
            id=self._new_id(),
            name=self._unique_name(clean_name(name, "Driver"), None),
            style=style if style in config.CAR_STYLES else config.CAR_STYLES[0],
            color=self._pick_color(color, None),
            joined_at=now,
            token=secrets.token_urlsafe(16),
            conn=conn,
        )
        self.players[player.id] = player
        if not self.host_id:
            self.host_id = player.id
        return player

    def add_bot(self, level_id: Any, now: float) -> Player:
        self._require_phase(LOBBY_PHASES)
        if level_id not in LEVELS:
            raise GameError("bad_request", "Unknown bot level.")
        if len(self.players) >= config.MAX_PLAYERS:
            raise GameError("full", "The grid is full.")
        taken = {p.name.lower() for p in self.players.values()}
        names = [n for n in config.BOT_NAMES if n.lower() not in taken] or list(config.BOT_NAMES)
        free_colors = [c for c in PALETTE if c not in {p.color for p in self.players.values()}]
        bot = Player(
            id=self._new_id(),
            name=self._unique_name(random.choice(names), None),
            style=random.choice(config.CAR_STYLES),
            color=random.choice(free_colors or list(PALETTE)),
            joined_at=now,
            bot=True,
            level=level_id,
        )
        self.players[bot.id] = bot
        return bot

    def remove_bot(self, bot_id: Any, now: float) -> None:
        self._require_phase(LOBBY_PHASES)
        bot = self.players.get(bot_id) if isinstance(bot_id, str) else None
        if bot is None or not bot.bot:
            raise GameError("bad_request", "That bot is already gone.")
        self.remove_player(bot, now)

    def remove_player(self, player: Player, now: float) -> None:
        if self.players.pop(player.id, None) is None:
            return
        if player.conn is not None:
            player.conn.player = None
            player.conn.room = None
            player.conn = None
        if self.host_id == player.id:
            self.elect_host()
        if self.returning_host == player.id:
            self.returning_host = ""
        self.broadcast_snapshot(now)

    def elect_host(self) -> None:
        candidates = sorted(self.humans(), key=lambda p: (p.conn is None, p.joined_at))
        self.host_id = candidates[0].id if candidates else ""

    def reclaim_host(self, player: Player) -> None:
        if self.returning_host == player.id:
            self.host_id = player.id
            self.returning_host = ""

    def apply_profile(self, player: Player, msg: dict, now: float) -> None:
        self._require_phase(LOBBY_PHASES)
        if "name" in msg:
            player.name = self._unique_name(clean_name(msg["name"], player.name), player)
        if msg.get("style") in config.CAR_STYLES:
            player.style = msg["style"]
        if "color" in msg:
            player.color = self._pick_color(msg["color"], player)
        self.broadcast_snapshot(now)

    def apply_settings(self, msg: dict, now: float) -> None:
        self._require_phase(LOBBY_PHASES)
        if "pack" in msg:
            if msg["pack"] not in texts.pack_ids():
                raise GameError("bad_request", "Unknown text pack.")
            self.pack = msg["pack"]
        if "theme" in msg:
            if msg["theme"] not in THEME_IDS:
                raise GameError("bad_request", "Unknown track theme.")
            self.theme = msg["theme"]
        if "custom" in msg:
            cleaned = texts.sanitize_custom(msg["custom"])
            if cleaned is None and isinstance(msg["custom"], str) and msg["custom"].strip():
                raise GameError("bad_text", f"Custom text needs at least {config.CUSTOM_TEXT_MIN} typeable characters.")
            self.custom_text = cleaned or ""
        self.broadcast_snapshot(now)

    # ----- race flow --------------------------------------------------

    def start_race(self, now: float) -> None:
        self._require_phase(LOBBY_PHASES)
        if self.pack == texts.CUSTOM_ID:
            text = self.custom_text
        else:
            text = texts.pick(self.pack, self.last_text)
        if not text:
            raise GameError("no_text", "Add your own text first.")
        self.text = self.last_text = text
        self.round_no += 1
        self.phase = "countdown"
        self.race_start = now + config.COUNTDOWN_S
        self.next_place = 1
        self.deadline = None
        self.humans_done_at = None
        self.results = []
        self._last_update = now
        for player in self.players.values():
            player.clear_race()
            player.in_race = True
            if player.bot:
                label_wpm = LEVELS[player.level][1]
                player.base_cps = label_wpm * 5 / 60 * 1.06 * random.uniform(0.92, 1.08)
                player.acc_target = _clamp(BOT_ACCURACY[player.level] + random.uniform(-0.01, 0.01), 0.9, 0.995)
        self.broadcast_snapshot(now)

    def to_lobby(self, now: float) -> None:
        self.phase = "lobby"
        self.results = []
        self.text = ""
        self.deadline = None
        for player in self.players.values():
            player.clear_race()
        self.broadcast_snapshot(now)

    def update(self, now: float) -> None:
        self._reap(now)
        if self.phase == "countdown":
            self._begin_if_due(now)
        elif self.phase == "racing":
            dt = _clamp(now - self._last_update, 0.0, 0.25)
            self._last_update = now
            for player in list(self.players.values()):
                if player.bot and player.in_race and not player.finished:
                    self._step_bot(player, now, dt)
            if self._race_over(now):
                self.end_race(now)
            else:
                self._send_tick(now)
        elif self.phase == "results" and now - self.race_ended_at > config.RESULTS_IDLE_S:
            self.to_lobby(now)

    def on_progress(self, player: Player, msg: dict, now: float) -> None:
        self._begin_if_due(now)
        if self.phase != "racing" or not player.in_race or player.finished:
            return
        total = len(self.text)
        elapsed = max(0.0, now - self.race_start)
        ceiling = min(total, int(elapsed * config.MAX_CPS) + 8)
        player.progress = _as_int(msg.get("c"), 0, ceiling)
        player.keys = max(_as_int(msg.get("k"), 0, 100_000), player.progress)
        player.errors = _as_int(msg.get("x"), 0, player.keys)
        player.streak = _as_int(msg.get("s"), 0, 100_000)
        if player.progress >= total:
            self._finish(player, now)

    def end_race(self, now: float) -> None:
        racers = [p for p in self.players.values() if p.in_race]
        elapsed = max(0.001, now - self.race_start)
        finished = sorted((p for p in racers if p.finished), key=lambda p: p.place)
        unfinished = sorted((p for p in racers if not p.finished), key=lambda p: (-p.progress, p.joined_at))
        scored = len(racers) >= 2
        results = []
        for index, player in enumerate(finished + unfinished, start=1):
            if not player.finished:
                player.wpm = round(_wpm(player.progress, elapsed), 1) if player.progress else 0.0
                player.acc = self._accuracy(player)
            points = 0
            if scored and player.finished and index <= len(config.POINTS):
                points = config.POINTS[index - 1]
                player.points += points
            if scored and player.finished and index == 1:
                player.wins += 1
            results.append({
                "id": player.id, "name": player.name, "style": player.style, "color": player.color,
                "bot": player.bot, "place": index, "dnf": not player.finished, "wpm": player.wpm,
                "acc": player.acc, "ms": player.finish_ms if player.finished else 0,
                "prog": player.progress, "pts": points,
            })
        self.results = results
        self.phase = "results"
        self.race_ended_at = now
        self.deadline = None
        self.broadcast_snapshot(now)

    # ----- messages out -----------------------------------------------

    def snapshot(self, now: float) -> dict:
        race = None
        if self.phase != "lobby":
            race = {
                "n": self.round_no, "text": self.text, "len": len(self.text),
                "startsIn": max(0, int((self.race_start - now) * 1000)),
                "elapsed": max(0, int((now - self.race_start) * 1000)),
            }
        return {
            "t": "room", "code": self.code, "phase": self.phase, "host": self.host_id,
            "round": self.round_no, "max": config.MAX_PLAYERS,
            "settings": {"pack": self.pack, "theme": self.theme, "customLen": len(self.custom_text)},
            "players": [p.public() for p in self.players.values()],
            "race": race, "results": self.results,
        }

    def broadcast(self, message: dict, exclude: Player | None = None) -> None:
        payload = json.dumps(message, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        frame = encode_frame(OP_TEXT, payload)
        for player in self.players.values():
            if player.conn is not None and player is not exclude:
                player.conn.send_frame(frame)

    def broadcast_snapshot(self, now: float, exclude: Player | None = None) -> None:
        self.broadcast(self.snapshot(now), exclude)

    # ----- internals --------------------------------------------------

    def _require_phase(self, phases: tuple[str, ...]) -> None:
        if self.phase not in phases:
            raise GameError("busy", "Wait for the current race to finish.")

    def _new_id(self) -> str:
        while True:
            candidate = secrets.token_hex(3)
            if candidate not in self.players:
                return candidate

    def _unique_name(self, name: str, me: Player | None) -> str:
        taken = {p.name.lower() for p in self.players.values() if p is not me}
        candidate, n = name, 1
        while candidate.lower() in taken:
            n += 1
            suffix = f" {n}"
            candidate = name[: config.NAME_MAX - len(suffix)] + suffix
        return candidate

    def _pick_color(self, preferred: Any, me: Player | None) -> str:
        used = {p.color for p in self.players.values() if p is not me}
        if isinstance(preferred, str) and preferred.lower() in PALETTE and preferred.lower() not in used:
            return preferred.lower()
        free = [c for c in PALETTE if c not in used]
        return free[0] if free else PALETTE[0]

    def _make_room_for_human(self) -> None:
        if len(self.players) < config.MAX_PLAYERS:
            return
        bots = [p for p in self.players.values() if p.bot]
        if bots and self.phase in LOBBY_PHASES:
            del self.players[bots[-1].id]
            return
        raise GameError("full", "This race is full.")

    def _reap(self, now: float) -> None:
        for player in list(self.players.values()):
            if player.bot or player.conn is not None or player.offline_since is None:
                continue
            grace = config.GRACE_RACE_S if self.phase in RACE_PHASES else config.GRACE_LOBBY_S
            if now - player.offline_since > grace:
                self.remove_player(player, now)

    def _begin_if_due(self, now: float) -> None:
        if self.phase == "countdown" and now >= self.race_start:
            self.phase = "racing"
            self._last_update = now
            self.broadcast_snapshot(now)

    def _race_over(self, now: float) -> bool:
        humans_left = [p for p in self.players.values() if p.in_race and not p.bot and not p.finished]
        if not humans_left:
            if self.humans_done_at is None:
                self.humans_done_at = now
            bots_running = any(p.in_race and p.bot and not p.finished for p in self.players.values())
            return not bots_running or now - self.humans_done_at >= config.BOT_TAIL_S
        if self.deadline is not None and now >= self.deadline:
            return True
        return now - self.race_start >= config.MAX_RACE_S

    def _step_bot(self, bot: Player, now: float, dt: float) -> None:
        total = len(self.text)
        if now < bot.pause_until:
            speed, bot.streak = 0.0, 0
        else:
            drift = (1.0 - bot.mood) * 0.5 * dt + random.gauss(0.0, 0.22) * math.sqrt(dt)
            bot.mood = _clamp(bot.mood + drift, 0.55, 1.4)
            if random.random() < 0.12 * dt:
                bot.pause_until = now + random.uniform(0.3, 1.0)
            speed = bot.base_cps * bot.mood
            bot.streak = 20 if bot.mood > 1.12 else 0
        bot.fprog = min(float(total), bot.fprog + speed * dt)
        bot.progress = int(bot.fprog)
        bot.keys = int(bot.progress / bot.acc_target)
        bot.errors = bot.keys - bot.progress
        if bot.fprog >= total:
            self._finish(bot, now)

    def _finish(self, player: Player, now: float) -> None:
        player.finished = True
        player.progress = len(self.text)
        player.place = self.next_place
        self.next_place += 1
        player.finish_ms = max(1, int((now - self.race_start) * 1000))
        player.wpm = round(_wpm(player.progress, player.finish_ms / 1000), 1)
        player.acc = self._accuracy(player)
        others_running = any(p.in_race and not p.bot and not p.finished for p in self.players.values())
        if not player.bot and self.deadline is None and others_running:
            self.deadline = now + config.FINISH_GRACE_S
        self.broadcast({
            "t": "fin", "id": player.id, "place": player.place, "ms": player.finish_ms,
            "wpm": player.wpm, "acc": player.acc,
        })

    @staticmethod
    def _accuracy(player: Player) -> float:
        if player.keys <= 0:
            return 100.0
        return round(_clamp(100.0 * (player.keys - player.errors) / player.keys, 0.0, 100.0), 1)

    def _send_tick(self, now: float) -> None:
        elapsed = now - self.race_start
        live = {}
        for player in self.players.values():
            if not player.in_race:
                continue
            wpm = player.wpm if player.finished else _wpm(player.progress, max(elapsed, 2.0))
            nitro = 1 if player.streak >= config.NITRO_STREAK and not player.finished else 0
            live[player.id] = [player.progress, round(wpm), nitro, player.place if player.finished else 0]
        message: dict[str, Any] = {"t": "tick", "e": int(elapsed * 1000), "p": live}
        if self.deadline is not None:
            message["d"] = max(0, int((self.deadline - now) * 1000))
        self.broadcast(message)
