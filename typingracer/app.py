"""Command line entry point and server bootstrap."""

from __future__ import annotations

import argparse
import asyncio
import logging
import logging.handlers
import queue
import sys
import webbrowser
from pathlib import Path
from typing import Callable

from . import config
from .hub import Hub
from .lan import lan_addresses
from .web import WebServer

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")


# Windows' default proactor loop stops accepting connections for good once a browser resets one mid-accept.
def new_event_loop() -> asyncio.AbstractEventLoop:
    return asyncio.SelectorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()


def run(coroutine) -> None:
    if sys.platform != "win32":
        asyncio.run(coroutine)
    elif sys.version_info >= (3, 12):
        asyncio.run(coroutine, loop_factory=new_event_loop)
    else:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        asyncio.run(coroutine)


async def serve(
    host: str,
    port: int,
    *,
    public_dir: Path = PUBLIC_DIR,
    tries: int = 1,
    on_ready: Callable[[int, WebServer], None] | None = None,
    stop: asyncio.Event | None = None,
) -> None:
    hub = Hub()
    web = WebServer(hub, public_dir)
    candidates = [0] if port == 0 else range(port, port + max(1, tries))
    server = None
    failure: OSError | None = None
    for candidate in candidates:
        try:
            server = await asyncio.start_server(web.handle, host, candidate, limit=16 * 1024)
            break
        except OSError as exc:
            failure = exc
    if server is None:
        raise failure or OSError("no port available")

    bound_port = server.sockets[0].getsockname()[1]
    ticker = asyncio.create_task(hub.run_ticker())
    try:
        async with server:
            if on_ready:
                on_ready(bound_port, web)
            if stop is None:
                await server.serve_forever()
            else:
                await stop.wait()
    finally:
        ticker.cancel()
        for conn in list(hub.conns):
            conn.ws.abort()


def _banner(port: int, urls: list[str], lan_enabled: bool) -> str:
    rule = "=" * 62
    lines = [rule, "   TYPING RACER is running!", rule, f"   Play on this computer :  http://127.0.0.1:{port}"]
    if lan_enabled and urls:
        lines += ["", "   Friends on your Wi-Fi / network join at:"]
        lines += [f"        {url}" for url in urls]
        lines += [
            "",
            "   If a friend cannot connect: allow Python through the Windows",
            "   Firewall (Private networks) and check you are on the same network.",
        ]
    elif not lan_enabled:
        lines += ["", "   Local-only mode: friends cannot join from other computers."]
    lines += ["", "   Press Ctrl+C in this window to stop the server.", rule]
    return "\n".join(lines)


def _start_logging() -> logging.handlers.QueueListener:
    # A paused console window (Windows QuickEdit selection) blocks writes; keep them off the event loop thread.
    console = logging.StreamHandler()
    console.setFormatter(logging.Formatter("%(asctime)s  %(message)s", "%H:%M:%S"))
    pending: queue.SimpleQueue = queue.SimpleQueue()
    queued = logging.handlers.QueueHandler(pending)
    queued.setFormatter(logging.Formatter("%(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[queued])
    listener = logging.handlers.QueueListener(pending, console)
    listener.start()
    return listener


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Typing Racer - local multiplayer typing race server")
    parser.add_argument("--port", type=int, default=config.DEFAULT_PORT, help="first port to try (default 8080)")
    parser.add_argument("--host", default="0.0.0.0", help="use 127.0.0.1 to keep the game on this computer only")
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser automatically")
    args = parser.parse_args(argv)

    if not PUBLIC_DIR.is_dir():
        print(f"Cannot find the game files at {PUBLIC_DIR}")
        return 2
    listener = _start_logging()

    lan_enabled = args.host not in LOOPBACK_HOSTS

    def ready(port: int, web: WebServer) -> None:
        web.urls = [f"http://{ip}:{port}" for ip in lan_addresses()] if lan_enabled else []
        print(_banner(port, web.urls, lan_enabled), flush=True)
        if not args.no_browser:
            # 127.0.0.1 skips the IPv6 attempt that 'localhost' makes first, which can stall on some networks.
            webbrowser.open(f"http://127.0.0.1:{port}")

    try:
        run(serve(args.host, args.port, tries=config.PORT_FALLBACK_TRIES, on_ready=ready))
    except KeyboardInterrupt:
        print("\nServer stopped. See you at the next race!")
    except OSError as exc:
        print(f"Could not start the server: {exc}")
        return 1
    finally:
        listener.stop()
    return 0
