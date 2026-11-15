import asyncio
import json
import socket
import struct
import sys
import threading
import time
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from typingracer import app, config, texts  # noqa: E402
from typingracer.rooms import GameError, Room, clean_name  # noqa: E402
from typingracer.ws import OP_PING, OP_TEXT, ProtocolError, accept_key, encode_frame, read_frame  # noqa: E402
from wsclient import Client  # noqa: E402

CUSTOM = "Race to the line with steady hands today."
LONG_CUSTOM = "abcdefghij " * 20


def decode(frame: bytes, **options):
    async def go():
        reader = asyncio.StreamReader()
        reader.feed_data(frame)
        return await read_frame(reader, **options)

    return asyncio.run(go())


class WireTests(unittest.TestCase):
    def test_accept_key_matches_rfc_example(self):
        self.assertEqual(accept_key("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")

    def test_frames_round_trip_for_all_length_encodings(self):
        for size in (0, 5, 125, 126, 200, 70_000):
            for mask in (None, b"\x01\x02\x03\x04"):
                payload = bytes(i % 251 for i in range(size))
                result = decode(encode_frame(OP_TEXT, payload, mask), max_size=1 << 20, require_mask=False)
                self.assertEqual(result, (True, OP_TEXT, payload))

    def test_unmasked_client_frame_is_rejected(self):
        with self.assertRaises(ProtocolError):
            decode(encode_frame(OP_TEXT, b"hi"), max_size=1024)

    def test_oversized_and_oversized_control_frames_are_rejected(self):
        with self.assertRaises(ProtocolError):
            decode(encode_frame(OP_TEXT, b"x" * 300, b"\x00\x00\x00\x00"), max_size=100)
        with self.assertRaises(ProtocolError):
            decode(encode_frame(OP_PING, b"x" * 200, b"\x00\x00\x00\x00"), max_size=1024)


class TextTests(unittest.TestCase):
    def test_every_pack_text_is_typeable_ascii(self):
        for pack_id, pack in texts.PACKS.items():
            for text in pack["texts"]:
                self.assertTrue(all(" " <= ch <= "~" for ch in text), (pack_id, text))
                self.assertNotIn("  ", text)
                self.assertEqual(text, text.strip())
                self.assertGreaterEqual(len(text), 60, text)

    def test_custom_text_is_normalised(self):
        raw = "  It\u2019s \u201cfine\u201d \u2014 really\u2026\r\n\r\nNo   tabs\there \u00e9\u4e2d "
        self.assertEqual(texts.sanitize_custom(raw), "It's \"fine\" - really... No tabs here")
        self.assertIsNone(texts.sanitize_custom("too short"))
        self.assertIsNone(texts.sanitize_custom(42))
        self.assertLessEqual(len(texts.sanitize_custom("word " * 500)), config.CUSTOM_TEXT_MAX)

    def test_names_are_cleaned(self):
        self.assertEqual(clean_name("  Max   Power \u202e", "x"), "Max Power")
        self.assertEqual(clean_name("", "Driver"), "Driver")
        self.assertEqual(clean_name(12, "Driver"), "Driver")
        self.assertEqual(len(clean_name("A" * 100, "x")), config.NAME_MAX)


class FakeConn:
    def __init__(self):
        self.player = None
        self.room = None
        self.frames = []

    def send_frame(self, frame):
        self.frames.append(frame)


class RoomLogicTests(unittest.TestCase):
    """Drives a Room with a simulated clock, so no sockets or sleeping are needed."""

    def make_room(self, bots=(), humans=1):
        room = Room("TEST", 0.0)
        people = [room.add_human(FakeConn(), f"P{i}", "coupe", None, 0.0) for i in range(humans)]
        for level in bots:
            room.add_bot(level, 0.0)
        room.pack = texts.CUSTOM_ID
        room.custom_text = LONG_CUSTOM.strip()
        return room, people

    def test_bot_speed_roughly_matches_its_level(self):
        room, _ = self.make_room(bots=("champ",))
        room.start_race(0.0)
        bot = next(p for p in room.players.values() if p.bot)
        now = 0.0
        while not bot.finished and now < 90.0:
            now += 0.1
            room.update(now)
        self.assertTrue(bot.finished)
        self.assertTrue(70 <= bot.wpm <= 135, bot.wpm)

    def test_human_finishing_ends_the_race_and_scores_points(self):
        room, (me,) = self.make_room(bots=("rookie",))
        room.start_race(0.0)
        room.update(config.COUNTDOWN_S + 0.1)
        self.assertEqual(room.phase, "racing")
        total = len(room.text)
        t = config.COUNTDOWN_S + 10.0
        room.on_progress(me, {"c": total, "k": total, "x": 0}, t)
        self.assertTrue(me.finished)
        room.update(t + 0.1)
        self.assertEqual(room.phase, "racing", "bots get a short tail to finish")
        room.update(t + 0.1 + config.BOT_TAIL_S + 0.2)
        self.assertEqual(room.phase, "results")
        self.assertEqual(room.results[0]["id"], me.id)
        self.assertEqual(me.points, 10)
        bot = next(p for p in room.players.values() if p.bot)
        self.assertTrue(room.results[1]["dnf"] and room.results[1]["id"] == bot.id)

    def test_bot_that_is_nearly_done_finishes_during_the_tail(self):
        room, (me,) = self.make_room(bots=("champ",))
        room.start_race(0.0)
        room.update(config.COUNTDOWN_S + 0.1)
        total = len(room.text)
        bot = next(p for p in room.players.values() if p.bot)
        bot.fprog = total - 3.0
        start = config.COUNTDOWN_S + 10.0
        room.on_progress(me, {"c": total, "k": total, "x": 0}, start)
        now = start
        while room.phase == "racing" and now < start + config.BOT_TAIL_S + 1:
            now += 0.1
            room.update(now)
        self.assertEqual(room.phase, "results")
        by_id = {r["id"]: r for r in room.results}
        self.assertFalse(by_id[bot.id]["dnf"])
        self.assertEqual(by_id[bot.id]["place"], 2)

    def test_lone_player_gets_no_points(self):
        room, (me,) = self.make_room()
        room.start_race(0.0)
        room.update(config.COUNTDOWN_S + 0.1)
        total = len(room.text)
        room.on_progress(me, {"c": total}, config.COUNTDOWN_S + 20.0)
        room.update(config.COUNTDOWN_S + 20.2)
        self.assertEqual((room.phase, me.points, me.wins), ("results", 0, 0))

    def test_slow_player_is_cut_off_after_the_grace_period(self):
        room, (fast, slow) = self.make_room(humans=2)
        room.start_race(0.0)
        start = config.COUNTDOWN_S
        room.update(start + 0.1)
        total = len(room.text)
        room.on_progress(slow, {"c": 50, "k": 55, "x": 5}, start + 3.0)
        room.on_progress(fast, {"c": total, "k": total, "x": 0}, start + 10.0)
        self.assertIsNotNone(room.deadline)
        room.update(start + 10.1)
        self.assertEqual(room.phase, "racing")
        room.update(start + 10.0 + config.FINISH_GRACE_S + 0.2)
        self.assertEqual(room.phase, "results")
        ranked = {r["id"]: r for r in room.results}
        self.assertEqual(ranked[fast.id]["place"], 1)
        self.assertTrue(ranked[slow.id]["dnf"])
        self.assertEqual(ranked[slow.id]["pts"], 0)
        self.assertEqual(ranked[slow.id]["prog"], 50)

    def test_progress_ahead_of_the_clock_is_clamped(self):
        room, (me,) = self.make_room()
        room.start_race(0.0)
        room.update(config.COUNTDOWN_S + 0.01)
        room.on_progress(me, {"c": 10_000, "k": 10_000}, config.COUNTDOWN_S + 0.5)
        self.assertFalse(me.finished)
        self.assertLessEqual(me.progress, int(0.5 * config.MAX_CPS) + 8)

    def test_garbage_progress_values_are_ignored(self):
        room, (me,) = self.make_room()
        room.start_race(0.0)
        room.update(config.COUNTDOWN_S + 0.01)
        for bad in ({"c": "9"}, {"c": None}, {"c": float("nan")}, {"c": True}, {}, {"c": [1]}):
            room.on_progress(me, bad, config.COUNTDOWN_S + 1.0)
            self.assertEqual(me.progress, 0)

    def test_room_enforces_capacity_and_swaps_bots_for_humans(self):
        room, _ = self.make_room(bots=("pro",) * 7)
        self.assertEqual(len(room.players), config.MAX_PLAYERS)
        joiner = room.add_human(FakeConn(), "Late", "hatch", None, 1.0)
        self.assertEqual(len(room.players), config.MAX_PLAYERS)
        self.assertEqual(sum(1 for p in room.players.values() if p.bot), 6)
        self.assertIn(joiner.id, room.players)
        full, _ = self.make_room(humans=config.MAX_PLAYERS)
        with self.assertRaises(GameError):
            full.add_human(FakeConn(), "Extra", "coupe", None, 1.0)

    def test_colours_and_names_stay_unique(self):
        room = Room("TEST", 0.0)
        wanted = config.CAR_COLORS[0][1]
        for _ in range(3):
            room.add_human(FakeConn(), "Sam", "coupe", wanted, 0.0)
        self.assertEqual([p.name for p in room.players.values()], ["Sam", "Sam 2", "Sam 3"])
        self.assertEqual(len({p.color for p in room.players.values()}), 3)


class HttpAndSocketTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        names = ("COUNTDOWN_S", "FINISH_GRACE_S", "GRACE_LOBBY_S", "GRACE_RACE_S", "BOT_TAIL_S")
        cls._saved = {name: getattr(config, name) for name in names}
        config.COUNTDOWN_S, config.FINISH_GRACE_S, config.BOT_TAIL_S = 0.3, 1.0, 0.4
        config.GRACE_LOBBY_S, config.GRACE_RACE_S = 0.6, 0.6
        ready = threading.Event()
        cls.loop = app.new_event_loop()
        cls.port = 0

        def run():
            asyncio.set_event_loop(cls.loop)
            cls.stop = asyncio.Event()

            def on_ready(port, web):
                cls.port = port
                ready.set()

            cls.loop.run_until_complete(app.serve("127.0.0.1", 0, on_ready=on_ready, stop=cls.stop))

        cls.thread = threading.Thread(target=run, daemon=True)
        cls.thread.start()
        assert ready.wait(5), "server did not start"

    @classmethod
    def tearDownClass(cls):
        cls.loop.call_soon_threadsafe(cls.stop.set)
        cls.thread.join(5)
        for name, value in cls._saved.items():
            setattr(config, name, value)

    # ----- helpers ------------------------------------------------------

    def player(self, name="Sam", room=None, **extra):
        client = Client(self.port)
        self.addCleanup(client.close)
        self.assertEqual(client.status, 101)
        message = {"t": "join", "room": room, "name": name, **extra} if room else {"t": "create", "name": name, **extra}
        client.send(message)
        return client, client.wait_type("welcome")

    def raw_http(self, request: bytes) -> bytes:
        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as sock:
            sock.sendall(request)
            data = b""
            while chunk := sock.recv(4096):
                data += chunk
        return data

    def start_custom_race(self, text=CUSTOM, bots=()):
        host, welcome = self.player("Ann")
        host.send({"t": "settings", "pack": "custom", "custom": text})
        for level in bots:
            host.send({"t": "bot_add", "level": level})
        host.wait(lambda m: m.get("t") == "room" and len(m["players"]) == 1 + len(bots) and m["settings"]["customLen"])
        host.send({"t": "start"})
        return host, welcome

    # ----- HTTP ---------------------------------------------------------

    def test_info_and_room_list_endpoints(self):
        base = f"http://127.0.0.1:{self.port}"
        info = json.load(urllib.request.urlopen(base + "/api/info", timeout=5))
        self.assertEqual({p["id"] for p in info["packs"]}, {"sprint", "standard", "marathon", "tricky", "custom"})
        self.assertEqual(len(info["colors"]), len(config.CAR_COLORS))
        self.assertIsInstance(json.load(urllib.request.urlopen(base + "/api/rooms", timeout=5)), list)

    def test_room_list_shows_open_races(self):
        _, welcome = self.player("Lister")
        listing = json.load(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/api/rooms", timeout=5))
        mine = [r for r in listing if r["code"] == welcome["room"]["code"]]
        self.assertEqual(len(mine), 1)
        self.assertEqual((mine[0]["host"], mine[0]["players"], mine[0]["phase"]), ("Lister", 1, "lobby"))

    def test_static_files_cannot_escape_public_dir(self):
        for target in ("/../server.py", "/%2e%2e/server.py", "/..%5cserver.py", "/%2e%2e%2fserver.py", "/c:/windows/win.ini"):
            response = self.raw_http(f"GET {target} HTTP/1.1\r\nHost: x\r\n\r\n".encode())
            self.assertIn(b" 404 ", response.split(b"\r\n", 1)[0], target)
            self.assertNotIn(b"typingracer", response, target)

    def test_unsupported_methods_and_garbage_requests(self):
        self.assertIn(b" 405 ", self.raw_http(b"POST /api/info HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n").split(b"\r\n", 1)[0])
        self.assertIn(b" 400 ", self.raw_http(b"NONSENSE\r\n\r\n").split(b"\r\n", 1)[0])

    def test_index_is_served_with_security_headers(self):
        response = self.raw_http(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
        head = response.split(b"\r\n\r\n", 1)[0].lower()
        self.assertIn(b" 200 ", head.split(b"\r\n", 1)[0])
        self.assertIn(b"content-security-policy", head)
        self.assertIn(b"x-content-type-options: nosniff", head)

    def test_server_keeps_accepting_after_a_burst_of_reset_connections(self):
        def hammer():
            for _ in range(40):
                sock = socket.socket()
                try:
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
                    sock.settimeout(1)
                    sock.connect(("127.0.0.1", self.port))
                except OSError:
                    pass
                finally:
                    sock.close()

        threads = [threading.Thread(target=hammer, daemon=True) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(20)
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/api/info", timeout=5) as response:
            self.assertEqual(response.status, 200)

    # ----- websocket handshake ------------------------------------------

    def test_cross_origin_websocket_is_refused(self):
        evil = Client(self.port, origin="http://evil.example")
        self.addCleanup(evil.close)
        self.assertEqual(evil.status, 403)
        friendly = Client(self.port, origin=f"http://127.0.0.1:{self.port}")
        self.addCleanup(friendly.close)
        self.assertEqual(friendly.status, 101)

    def test_junk_messages_do_not_break_the_connection(self):
        client, _ = self.player("Junk")
        for junk in (b"not json", b"[]", b'{"t": 5}', b'{"t": ["x"]}', b'{"t": "nope"}', b'{"t":"p","c":{}}'):
            client.send_raw(OP_TEXT, junk)
        client.send({"t": "ping", "ts": 7})
        self.assertEqual(client.wait_type("pong")["ts"], 7)

    # ----- lobby --------------------------------------------------------

    def test_create_and_join_gives_unique_names_and_colours(self):
        host, welcome = self.player("Sam", color=config.CAR_COLORS[0][1])
        code = welcome["room"]["code"]
        self.assertEqual(len(code), 4)
        self.assertEqual(welcome["room"]["host"], welcome["you"])
        guest, guest_welcome = self.player("Sam", room=code.lower(), color=config.CAR_COLORS[0][1])
        players = guest_welcome["room"]["players"]
        self.assertEqual([p["name"] for p in players], ["Sam", "Sam 2"])
        self.assertEqual(len({p["color"] for p in players}), 2)
        host.wait(lambda m: m.get("t") == "room" and len(m["players"]) == 2)

    def test_joining_an_unknown_room_reports_an_error(self):
        client = Client(self.port)
        self.addCleanup(client.close)
        client.send({"t": "join", "room": "ZZZZ", "name": "Lost"})
        self.assertEqual(client.wait_type("error")["code"], "no_room")

    def test_only_the_host_can_change_settings_start_or_kick(self):
        host, welcome = self.player("Host")
        guest, _ = self.player("Guest", room=welcome["room"]["code"])
        for message in ({"t": "settings", "pack": "sprint"}, {"t": "start"}, {"t": "bot_add", "level": "pro"}):
            guest.send(message)
            self.assertEqual(guest.wait_type("error")["code"], "not_host")
        host.send({"t": "settings", "pack": "sprint", "theme": "sunny"})
        snap = host.wait(lambda m: m.get("t") == "room" and m["settings"]["pack"] == "sprint")
        self.assertEqual(snap["settings"]["theme"], "sunny")
        host.send({"t": "settings", "theme": "moon"})
        snap = host.wait(lambda m: m.get("t") == "room" and m["settings"]["theme"] == "moon")
        self.assertEqual(snap["settings"]["theme"], "moon")
        host.send({"t": "settings", "theme": "javascript:alert(1)"})
        self.assertEqual(host.wait_type("error")["code"], "bad_request")

    def test_bots_can_be_added_and_removed(self):
        host, _ = self.player("Host")
        host.send({"t": "bot_add", "level": "casual"})
        snap = host.wait(lambda m: m.get("t") == "room" and len(m["players"]) == 2)
        bot = next(p for p in snap["players"] if p["bot"])
        self.assertEqual(bot["level"], "casual")
        host.send({"t": "bot_remove", "id": bot["id"]})
        host.wait(lambda m: m.get("t") == "room" and len(m["players"]) == 1)

    def test_host_is_handed_over_when_the_host_leaves(self):
        host, welcome = self.player("Host")
        guest, guest_welcome = self.player("Guest", room=welcome["room"]["code"])
        host.send({"t": "leave"})
        snap = guest.wait(lambda m: m.get("t") == "room" and len(m["players"]) == 1)
        self.assertEqual(snap["host"], guest_welcome["you"])

    def test_host_who_drops_and_resumes_gets_the_crown_back(self):
        host, welcome = self.player("Host")
        code = welcome["room"]["code"]
        guest, guest_welcome = self.player("Guest", room=code)
        host.close()
        guest.wait(lambda m: m.get("t") == "room" and m["host"] == guest_welcome["you"])
        back = Client(self.port)
        self.addCleanup(back.close)
        back.send({"t": "resume", "room": code, "token": welcome["token"]})
        self.assertEqual(back.wait_type("welcome")["room"]["host"], welcome["you"])
        snap = guest.wait(lambda m: m.get("t") == "room" and m["host"] == welcome["you"])
        self.assertTrue(all(p["online"] for p in snap["players"]))

    def test_dropped_player_is_removed_after_the_grace_period(self):
        host, welcome = self.player("Host")
        guest, _ = self.player("Guest", room=welcome["room"]["code"])
        host.wait(lambda m: m.get("t") == "room" and len(m["players"]) == 2)
        guest.close()
        host.wait(lambda m: m.get("t") == "room" and any(not p["online"] for p in m["players"]))
        host.wait(lambda m: m.get("t") == "room" and len(m["players"]) == 1)

    def test_resume_restores_the_same_seat(self):
        host, welcome = self.player("Host")
        code = welcome["room"]["code"]
        guest, guest_welcome = self.player("Guest", room=code)
        guest.close()
        back = Client(self.port)
        self.addCleanup(back.close)
        back.send({"t": "resume", "room": code, "token": guest_welcome["token"]})
        again = back.wait_type("welcome")
        self.assertTrue(again["resumed"])
        self.assertEqual(again["you"], guest_welcome["you"])
        stranger = Client(self.port)
        self.addCleanup(stranger.close)
        stranger.send({"t": "resume", "room": code, "token": "wrong"})
        self.assertEqual(stranger.wait_type("error")["code"], "no_session")

    def test_host_can_remove_a_player(self):
        host, welcome = self.player("Host")
        guest, guest_welcome = self.player("Guest", room=welcome["room"]["code"])
        host.send({"t": "kick", "id": guest_welcome["you"]})
        guest.wait_type("kicked")
        host.wait(lambda m: m.get("t") == "room" and len(m["players"]) == 1)

    def test_reactions_are_whitelisted_and_relayed(self):
        host, welcome = self.player("Host")
        guest, _ = self.player("Guest", room=welcome["room"]["code"])
        host.send({"t": "react", "e": "<img src=x>"})
        host.send({"t": "react", "e": "fire"})
        self.assertEqual(guest.wait_type("react")["e"], "fire")

    # ----- racing -------------------------------------------------------

    def test_full_race_against_a_bot(self):
        host, welcome = self.start_custom_race(bots=("rookie",))
        me = welcome["you"]
        countdown = host.wait_phase("countdown")
        self.assertEqual(countdown["race"]["text"], CUSTOM)
        host.wait_phase("racing")
        total = len(CUSTOM)
        finish = None
        deadline = time.monotonic() + 6
        while finish is None and time.monotonic() < deadline:
            host.send({"t": "p", "c": total, "k": total + 2, "x": 2, "s": 3})
            try:
                finish = host.wait_type("fin", 0.2)
            except TimeoutError:
                pass
        self.assertIsNotNone(finish, "player never finished")
        self.assertEqual((finish["id"], finish["place"]), (me, 1))
        results = host.wait_phase("results")
        self.assertEqual([r["place"] for r in results["results"]], [1, 2])
        self.assertEqual(results["results"][0]["pts"], 10)
        self.assertTrue(results["results"][1]["dnf"])
        mine = next(p for p in results["players"] if p["id"] == me)
        self.assertEqual((mine["points"], mine["wins"]), (10, 1))
        self.assertAlmostEqual(results["results"][0]["acc"], 100 * total / (total + 2), delta=0.1)

    def test_server_clamps_progress_claimed_ahead_of_the_clock(self):
        host, welcome = self.start_custom_race(text=LONG_CUSTOM)
        host.wait_phase("racing")
        host.send({"t": "p", "c": 10_000, "k": 10_000, "x": 0})
        tick = host.wait(lambda m: m.get("t") == "tick" and m["p"][welcome["you"]][0] > 0)
        self.assertLess(tick["p"][welcome["you"]][0], 100)

    def test_late_joiner_spectates_until_the_next_race(self):
        host, welcome = self.start_custom_race(text=LONG_CUSTOM)
        host.wait_phase("racing")
        late, late_welcome = self.player("Late", room=welcome["room"]["code"])
        me = next(p for p in late_welcome["room"]["players"] if p["id"] == late_welcome["you"])
        self.assertFalse(me["inRace"])
        self.assertEqual(late_welcome["room"]["race"]["text"], LONG_CUSTOM.strip())
        tick = late.wait_type("tick")
        self.assertNotIn(late_welcome["you"], tick["p"])

    def test_ticks_stream_while_racing_and_host_can_return_to_lobby(self):
        host, welcome = self.start_custom_race(text=CUSTOM)
        host.wait_phase("racing")
        tick = host.wait_type("tick")
        self.assertIn("e", tick)
        total = len(CUSTOM)
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            host.send({"t": "p", "c": total, "k": total, "x": 0})
            try:
                host.wait_phase("results", 0.2)
                break
            except TimeoutError:
                continue
        host.send({"t": "lobby"})
        lobby = host.wait_phase("lobby")
        self.assertIsNone(lobby["race"])
        self.assertTrue(all(p["prog"] == 0 and not p["inRace"] for p in lobby["players"]))


if __name__ == "__main__":
    unittest.main()
