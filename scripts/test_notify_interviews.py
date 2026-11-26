#!/usr/bin/env python3
"""Offline checks for which interview ids are allowed to notify. No network."""
import notify_interviews as n
from datetime import datetime, timedelta, timezone

NOW = datetime(2026, 11, 26, 6, 30, tzinfo=timezone.utc)


def vid(i, typ="Post-Raw", hours_ago=2, name="Connor McDavid"):
    return {
        "id": i, "type": typ,
        "title": f"{typ.upper().replace('-', '-')} | {name}",
        "published": (NOW - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def main():
    library = [vid(f"old{i:08d}"[:11], hours_ago=24 * (i + 3)) for i in range(40)]
    assert len(library) == 40
    assert len({v["id"] for v in library}) == 40
    # The file showing up for the first time is the existing library.
    assert n.choose_notify(library, None, None, NOW) == []
    # Already committed, nothing new since HEAD.
    prev = {v["id"] for v in library}
    assert n.choose_notify(library, prev, None, NOW) == []
    fresh = vid("D5sQV9mA8uc", name="Connor McDavid")
    assert n.choose_notify(library + [fresh], prev, None, NOW) == ["D5sQV9mA8uc"]
    # Acked ids are not sent again, even if they are missing from HEAD.
    assert n.choose_notify(library + [fresh], prev, prev | {"D5sQV9mA8uc"}, NOW) == []
    batch = [
        vid("nhzv2CqF0HA", name="Mike Babcock"),
        vid("vNqFAsXKnjY", name="Evan Bouchard"),
        vid("y03DpOTZu4x", name="Mathieu Joseph"),
    ]
    assert n.choose_notify(library + batch, prev, prev, NOW) == [v["id"] for v in batch]
    old = vid("GPvBSgKOrrI", hours_ago=24 * 10, name="Mattias Ekholm")
    assert n.choose_notify([old], set(), set(), NOW) == []
    print("ok", "baseline", len(library), "batch", len(batch))


if __name__ == "__main__":
    main()
