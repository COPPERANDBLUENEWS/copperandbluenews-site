#!/usr/bin/env python3
"""Offline checks for the Pre-Raw / Post-Raw title filter. No network."""
import update_interviews as iv

CASES = [
    ("POST-RAW | Mike Babcock 11.24.26", "Post-Raw"),
    ("PRE-RAW | Mattias Ekholm 11.24.26", "Pre-Raw"),
    ("pre raw: coach", "Pre-Raw"),
    ("Post Raw", "Post-Raw"),
    ("POST–RAW | Kasperi Kapanen 11.22.26", "Post-Raw"),  # en dash
    ("PRE—RAW | Zach Hyman", "Pre-Raw"),  # em dash
    ("pre-raw", "Pre-Raw"),
    ("  Post  -  Raw interview", "Post-Raw"),
    ("Something PRE-RAW extra", "Pre-Raw"),
    ("RAW | Mike Babcock 11.25.26", None),
    ("RAW | Leon Draisaitl 11.25.26", None),
    ("OILERS MIC'D UP | Episode 53 Trailer", None),
    ("Prepare raw footage", None),
    ("POSTRAW without a separator", None),
    ("postraw", None),
    ("", None),
    (None, None),
]


def main():
    for title, want in CASES:
        got = iv.raw_type(title)
        if got != want:
            raise SystemExit(f"{title!r}: got {got!r}, want {want!r}")
    pub = iv.title_published("PRE-RAW | Mike Babcock 11.24.26")
    local = iv.parse_iso(pub).astimezone(iv.EDM)
    if (local.year, local.month, local.day, local.hour, local.minute) != (2026, 11, 24, 12, 0):
        raise SystemExit(f"title date: {pub} -> {local}")
    if iv.title_published("no date here") is not None:
        raise SystemExit("missing title date should be None")
    bad = iv.video("not-an-id", "PRE-RAW | x", None, "title", iv.CHANNEL["id"])
    if bad is not None:
        raise SystemExit("bad id was accepted")
    other = iv.video("GPvBSgKOrrI", "PRE-RAW | x", None, "title", "UCsomeoneelse")
    if other is not None:
        raise SystemExit("other channel was accepted")
    plain = iv.video("GPvBSgKOrrI", "RAW | Mike Babcock 11.25.26", None, "rss", iv.CHANNEL["id"])
    if plain is not None:
        raise SystemExit("plain RAW was accepted")
    good = iv.video("GPvBSgKOrrI", "PRE-RAW | Mattias Ekholm 11.24.26", "2026-11-24T20:00:00Z", "rss", iv.CHANNEL["id"])
    if not good or good["type"] != "Pre-Raw" or "youtube-nocookie.com/embed/GPvBSgKOrrI" not in good["embed"]:
        raise SystemExit(f"good video: {good}")
    if good["url"] != "https://www.youtube.com/watch?v=GPvBSgKOrrI":
        raise SystemExit(good["url"])
    print("ok", len(CASES), "titles")


if __name__ == "__main__":
    main()
