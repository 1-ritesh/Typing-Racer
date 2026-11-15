"""Find the addresses friends on the same network can use to reach this machine."""

from __future__ import annotations

import ipaddress
import socket


def lan_addresses() -> list[str]:
    found: list[str] = []

    def add(raw: str) -> None:
        try:
            addr = ipaddress.ip_address(raw)
        except ValueError:
            return
        if addr.version != 4 or addr.is_loopback or addr.is_link_local or addr.is_unspecified or addr.is_multicast:
            return
        if raw not in found:
            found.append(raw)

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 9))  # UDP connect only picks a route; nothing is sent
            add(probe.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            add(info[4][0])
    except OSError:
        pass
    found.sort(key=lambda ip: 0 if ipaddress.ip_address(ip).is_private else 1)
    return found
