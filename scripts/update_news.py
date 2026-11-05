#!/usr/bin/env python3
"""Hourly: data/news.json (Oilers news from public feeds). Also builds data/injuries.json.

News sources (public feeds/APIs only; headline + 1-2 line snippet + link out, never full text):
  - NHL.com / EdmontonOilers.com stories via NHL's public content API (forge-dapi, tag teamid-22)
  - Edmonton Journal Oilers RSS
  - Sportsnet RSS (filtered to Oilers items)
  - Google News RSS search "Edmonton Oilers" (fills gaps from other outlets)
Injuries:
  - WHO is injured + injury type: the "Injured:" line in the latest NHL.com
    "projected lineups" game preview (forge-dapi, auto-updated before every game).
  - Status (IR/LTIR/Out), expected return, extra source: data/injuries_manual.json, entered by hand
    from cited reports. Manual notes only show for players NHL.com still lists as injured.
"""
import json, re, html, pathlib, urllib.request, email.utils, difflib
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UA = {"User-Agent": "Mozilla/5.0 (compatible; copperandbluenews-site; +https://copperandbluenews.com/)"}
FORGE = "https://forge-dapi.d3.nhle.com/v2/content/en-us/stories"
KEEP = 36
OIL = re.compile(r"\boilers?\b|edmonton|mcdavid|draisaitl|bouchard|nugent-hopkins|hyman|rogers place", re.I)


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return r.read()


def clean(s, n=190):
    s = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0] + "…"


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def story_url(x):
    tags = {t["slug"] for t in x.get("tags", [])}
    return f"https://www.nhl.com/oilers/news/{x['slug']}" if "edm-created" in tags else f"https://www.nhl.com/news/{x['slug']}"


def forge(q):
    return json.loads(fetch(f"{FORGE}?{q}"))["items"]


def from_forge():
    out = []
    for x in forge("tags.slug=teamid-22&$limit=30"):
        tags = {t["slug"] for t in x.get("tags", [])}
        out.append({"title": x["headline"], "url": story_url(x), "source": "EdmontonOilers.com" if "edm-created" in tags else "NHL.com",
                    "published": x["contentDate"].replace(".000Z", "Z"), "snippet": clean(x.get("summary"))})
    return out


def from_rss(url, source, need_filter, google=False):
    root = ET.fromstring(fetch(url))
    out = []
    for it in root.iter("item"):
        t = clean(it.findtext("title"), 300); link = (it.findtext("link") or "").strip()
        desc = it.findtext("description") or ""
        src = source
        if google:
            s = it.find("source"); src = s.text.strip() if s is not None and s.text else "Google News"
            t = re.sub(r"\s+-\s+" + re.escape(src) + r"$", "", t); desc = ""  # Google's description is just the title again
        if need_filter and not OIL.search(t + " " + desc):
            continue
        try: pub = iso(email.utils.parsedate_to_datetime(it.findtext("pubDate")))
        except Exception: continue
        out.append({"title": t, "url": link, "source": src, "published": pub, "snippet": clean(desc), **({"via": "google"} if google else {})})
    return out


def norm(t):
    return re.sub(r"[^a-z0-9 ]", "", t.lower())


def news():
    items, used, errors = [], [], []
    for name, fn in [("NHL.com / EdmontonOilers.com", from_forge),
                     ("Edmonton Journal", lambda: from_rss("https://edmontonjournal.com/category/sports/hockey/nhl/edmonton-oilers/feed", "Edmonton Journal", False)),
                     ("Sportsnet", lambda: from_rss("https://www.sportsnet.ca/feed/", "Sportsnet", True)),
                     ("Google News", lambda: from_rss("https://news.google.com/rss/search?q=%22Edmonton+Oilers%22+when:3d&hl=en-CA&gl=CA&ceid=CA:en", None, True, google=True))]:
        try: got = fn(); items += got; used.append(f"{name} ({len(got)})")
        except Exception as e: errors.append(f"{name}: {e}")
    items.sort(key=lambda x: x["published"], reverse=True)
    seen_url, keep = set(), []
    for x in items:
        u = x["url"].split("?")[0].rstrip("/")
        if u in seen_url or any(difflib.SequenceMatcher(None, norm(x["title"]), norm(k["title"])).ratio() > 0.8 for k in keep):
            continue
        if x.get("via") == "google" and sum(k.get("via") == "google" for k in keep) >= 18:
            continue  # keep room for first-party / direct-feed stories
        seen_url.add(u); keep.append(x)
        if len(keep) >= KEEP: break
    return {"updated": iso(datetime.now(timezone.utc)), "sources": used, "errors": errors, "items": keep}


def injuries(roster):
    ids = {p["name"]: p["id"] for g in roster["groups"].values() for p in g}
    manual = json.loads((DATA / "injuries_manual.json").read_text()) if (DATA / "injuries_manual.json").exists() else {}
    prev = [x for x in forge("tags.slug=teamid-22&tags.slug=game-preview&$limit=10") if "nhl-created" in {t["slug"] for t in x["tags"]}]
    rows, src = [], None
    for x in prev:
        d = json.loads(fetch(f"{FORGE}/{x['slug']}"))
        md = "\n".join(p.get("content", "") for p in d.get("parts", []) if p.get("type") == "markdown")
        m = re.search(r"Oilers projected lineup(.*?)(?:\n\*\*[A-Z][^\n]*projected lineup|$)", md, re.S)
        if not m: continue
        inj = re.search(r"Injured:\**\s*(.*?)\*?\n", m.group(1) + "\n")
        src = {"name": "NHL.com projected lineups", "url": story_url(x), "date": x["contentDate"][:10], "title": x["headline"]}
        txt = clean(inj.group(1), 2000) if inj else "None"
        report = clean(md.split("Status report", 1)[1], 5000) if "Status report" in md else ""
        for part in ([] if txt.lower().startswith("none") else re.split(r",\s*(?![^()]*\))", txt)):
            mm = re.match(r"\s*(.+?)\s*\((.*?)\)\s*$", part)
            name, what = (mm.group(1), mm.group(2)) if mm else (part.strip(), None)
            last = name.split()[-1]
            note = " ".join(s.strip() for s in re.split(r"\s*\.\.\.\s*", report) if re.search(r"\b" + re.escape(last) + r"\b", s))
            r = {"name": name, "id": ids.get(name), "injury": what, "status": "Out", "expectedReturn": None,
                 "updated": src["date"], "sources": [{"name": "NHL.com", "url": src["url"], "date": src["date"]}], "note": clean(note.strip("* "), 260) or None}
            mt = manual.get(name)
            if mt:
                for k in ("status", "expectedReturn"):
                    if mt.get(k): r[k] = mt[k]
                if mt.get("injury") and (not what or what == "undisclosed"): r["injury"] = mt["injury"]
                r["sources"] += mt.get("sources", [])
                r["updated"] = max([r["updated"]] + [s["date"] for s in mt.get("sources", [])])
            rows.append(r)
        break
    return {"updated": iso(datetime.now(timezone.utc)), "basis": src, "players": rows}


if __name__ == "__main__":
    n = news(); (DATA / "news.json").write_text(json.dumps(n, indent=1, ensure_ascii=False))
    print("news", len(n["items"]), n["sources"], n["errors"])
    roster = json.loads((DATA / "roster.json").read_text())
    try:
        i = injuries(roster); (DATA / "injuries.json").write_text(json.dumps(i, indent=1, ensure_ascii=False))
        print("injuries", [(p["name"], p["status"]) for p in i["players"]])
    except Exception as e:
        print("injuries failed, kept previous:", e)
