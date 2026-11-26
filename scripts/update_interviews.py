#!/usr/bin/env python3
"""Pre-Raw and Post-Raw interviews from the official Edmonton Oilers YouTube channel.

No YouTube API key. Two public sources, same channel:

  RSS (stable, 15 newest uploads):
    https://www.youtube.com/feeds/videos.xml?channel_id=UCyfbxrAcT9w7pHvDeYCtc0Q
  Uploads playlist page (best-effort, about the newest 100, no key):
    https://www.youtube.com/playlist?list=UUyfbxrAcT9w7pHvDeYCtc0Q

The channel posts highlights and Shorts between interviews, so a Pre-Raw from
the morning skate often leaves the 15-item RSS before the next hourly run.
The playlist page fills that gap. If its HTML changes, the RSS result and the
last saved file are kept.

Oilers+ (oilersplus.com) is the club's subscription stream, not a second
YouTube channel. Public Pre-Raw and Post-Raw uploads are on this channel.

Writes data/interviews.json. A failed fetch never wipes a previous good file.
The file is rewritten only when the video list changes, so an hourly run with
nothing new does not commit.
"""
import json, re, pathlib, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "interviews.json"
KEEP = 48
UA = {"User-Agent": "Mozilla/5.0 (compatible; copperandbluenews-site; +https://copperandbluenews.com/)"}
# Browser UA: the uploads playlist is an HTML page, and YouTube often answers
# the site UA with a consent wall that has no video list.
PAGE_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
           "Accept-Language": "en-US,en;q=0.9"}
CHANNEL = {
    "name": "Edmonton Oilers",
    "id": "UCyfbxrAcT9w7pHvDeYCtc0Q",
    "handle": "@edmontonoilers",
    "url": "https://www.youtube.com/@edmontonoilers",
    "rss": "https://www.youtube.com/feeds/videos.xml?channel_id=UCyfbxrAcT9w7pHvDeYCtc0Q",
    "uploads": "UUyfbxrAcT9w7pHvDeYCtc0Q",
}
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}
# Separator required, so "RAW | ..." and "Prepare raw" do not match.
# Hyphen, space, and the common Unicode dashes all count.
RAW_RE = re.compile(r"(?i)(?<![A-Za-z0-9])(pre|post)[\s\-\u2010-\u2015]+raw(?![A-Za-z0-9])")
TITLE_DATE = re.compile(r"\b(\d{1,2})\.(\d{1,2})\.(\d{2})\b")
VID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
EDM = ZoneInfo("America/Edmonton")


def raw_type(title):
    m = RAW_RE.search(title or "")
    if not m:
        return None
    return "Pre-Raw" if m.group(1).lower() == "pre" else "Post-Raw"


def fetch(url, headers):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=25) as r:
        return r.read()


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(s):
    s = (s or "").strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def title_published(title):
    """Game date printed in the title (MM.DD.YY), noon Mountain, when RSS has no timestamp."""
    m = TITLE_DATE.search(title or "")
    if not m:
        return None
    month, day, yy = (int(x) for x in m.groups())
    year = 2000 + yy if yy < 70 else 1900 + yy
    try:
        return iso(datetime(year, month, day, 12, 0, tzinfo=EDM))
    except ValueError:
        return None


def video(vid, title, published, source, channel_id):
    if not VID_RE.match(vid or "") or channel_id != CHANNEL["id"]:
        return None
    kind = raw_type(title)
    if not kind:
        return None
    title = re.sub(r"\s+", " ", title).strip()
    return {
        "id": vid,
        "type": kind,
        "title": title,
        "published": published,
        "publishedSource": source,
        "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
        "url": f"https://www.youtube.com/watch?v={vid}",
        "embed": f"https://www.youtube-nocookie.com/embed/{vid}",
        "channelId": CHANNEL["id"],
        "channel": CHANNEL["name"],
    }


def from_rss():
    root = ET.fromstring(fetch(CHANNEL["rss"], UA))
    title = (root.findtext("atom:title", default="", namespaces=NS) or "").strip()
    if title and title != CHANNEL["name"]:
        raise RuntimeError(f"RSS title is {title!r}, expected {CHANNEL['name']!r}")
    out = []
    for entry in root.findall("atom:entry", NS):
        vid = (entry.findtext("yt:videoId", default="", namespaces=NS) or "").strip()
        channel_id = (entry.findtext("yt:channelId", default="", namespaces=NS) or "").strip()
        name = (entry.findtext("atom:title", default="", namespaces=NS) or "").strip()
        if not name:
            name = (entry.findtext("media:group/media:title", default="", namespaces=NS) or "").strip()
        published = None
        raw_pub = (entry.findtext("atom:published", default="", namespaces=NS) or "").strip()
        if raw_pub:
            try:
                published = iso(parse_iso(raw_pub))
            except Exception:
                published = None
        item = video(vid, name, published, "rss", channel_id or CHANNEL["id"])
        if item:
            out.append(item)
    return out


def _walk_lockups(node, acc):
    if isinstance(node, dict):
        if "lockupViewModel" in node and isinstance(node["lockupViewModel"], dict):
            acc.append(node["lockupViewModel"])
        for value in node.values():
            _walk_lockups(value, acc)
    elif isinstance(node, list):
        for value in node:
            _walk_lockups(value, acc)


def from_playlist():
    """Newest uploads on the public playlist page. Titles only; dates come from RSS or the title."""
    html = fetch(f"https://www.youtube.com/playlist?list={CHANNEL['uploads']}", PAGE_UA).decode("utf-8", "replace")
    m = re.search(r"ytInitialData\s*=\s*(\{.*?\});\s*</script>", html, re.S)
    if not m:
        raise RuntimeError("uploads playlist page had no ytInitialData")
    data = json.loads(m.group(1))
    lockups = []
    _walk_lockups(data, lockups)
    if len(lockups) < 10:
        raise RuntimeError(f"uploads playlist page listed {len(lockups)} videos")
    out = []
    for lock in lockups:
        vid = lock.get("contentId") or ""
        try:
            title = lock["metadata"]["lockupMetadataViewModel"]["title"]["content"]
        except Exception:
            continue
        item = video(vid, title, title_published(title), "title", CHANNEL["id"])
        if item:
            out.append(item)
    return out


def load_prev():
    if not OUT.exists():
        return []
    try:
        data = json.loads(OUT.read_text())
    except Exception:
        return []
    return [v for v in data.get("videos") or [] if isinstance(v, dict)]


def absorb(dst, src):
    for key, val in src.items():
        if not val:
            continue
        if key in ("published", "publishedSource") and dst.get("publishedSource") == "rss" and src.get("publishedSource") != "rss":
            continue
        dst[key] = val
    if not dst.get("published"):
        dst["published"] = title_published(dst.get("title"))
        dst["publishedSource"] = "title" if dst["published"] else None


def merge(groups):
    by = {}
    for group in groups:
        for item in group:
            vid = item.get("id")
            if not vid:
                continue
            if vid not in by:
                by[vid] = dict(item)
            else:
                absorb(by[vid], item)
            kind = raw_type(by[vid].get("title"))
            if not kind:
                by.pop(vid, None)
                continue
            by[vid]["type"] = kind
            by[vid]["thumbnail"] = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
            by[vid]["url"] = f"https://www.youtube.com/watch?v={vid}"
            by[vid]["embed"] = f"https://www.youtube-nocookie.com/embed/{vid}"
            if not by[vid].get("published"):
                by[vid]["published"] = title_published(by[vid].get("title"))
                by[vid]["publishedSource"] = "title" if by[vid]["published"] else None
    videos = list(by.values())
    videos.sort(key=lambda v: v.get("published") or "", reverse=True)
    return videos[:KEEP]


def signature(videos):
    keys = ("id", "type", "title", "published", "publishedSource", "thumbnail", "url", "embed", "channelId", "channel")
    return [{k: v.get(k) for k in keys} for v in videos]


def update():
    errors, sources, fresh = [], [], []
    rss, playlist = [], []
    try:
        rss = from_rss()
        sources.append(f"rss ({len(rss)})")
        fresh.append(rss)
    except Exception as e:
        errors.append(f"rss: {e}")
    try:
        playlist = from_playlist()
        sources.append(f"uploads playlist ({len(playlist)})")
        fresh.append(playlist)
    except Exception as e:
        errors.append(f"uploads playlist: {e}")
    prev = load_prev()
    if not fresh:
        print("interviews fetch failed, kept previous:", "; ".join(errors))
        if not prev:
            raise RuntimeError("; ".join(errors) or "no interviews")
        return
    # RSS last so its timestamps win over the title-date estimate.
    videos = merge([prev, playlist, rss])
    counts = {k: sum(v["type"] == k for v in videos) for k in ("Pre-Raw", "Post-Raw")}
    if signature(videos) == signature(prev):
        print("interviews unchanged", len(videos), counts, sources, errors)
        return
    doc = {
        "updated": iso(datetime.now(timezone.utc)),
        "channels": [CHANNEL],
        "note": "Oilers+ (https://www.oilersplus.com) is the club subscription stream, not a separate YouTube channel. Public Pre-Raw and Post-Raw interviews are uploaded to the official Edmonton Oilers channel.",
        "sources": sources,
        "errors": errors,
        "videos": videos,
    }
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    print("interviews", len(videos), counts, sources, errors)


if __name__ == "__main__":
    update()
