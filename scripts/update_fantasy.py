#!/usr/bin/env python3
"""data/fantasy.json: Oilers fantasy news + our own data-driven "Fantasy Outlook" (fan projections).

  python3 scripts/update_fantasy.py            # news feeds + outlook (news.yml, hourly)
  python3 scripts/update_fantasy.py --outlook  # outlook only, keeps the last news (site.yml / lineup.yml)

Fantasy news (headline + source + time + link, snippet max ~1-2 lines, never full text). Items must name a
current Oilers roster player (data/roster.json). Feeds (all free/public):
  - RotoWire NHL player-news RSS (direct)
  - Google News RSS: RotoWire Oilers player pages, CBS Sports "Oilers' <player>:" blurbs, "Oilers fantasy"
  - DailyFaceoff RSS and Yahoo Sports NHL RSS (fantasy-relevant items only)
Outlook / tables: only from data the site already has - regular-season box scores in data/games
(G, A, SOG, hits, blocks, TOI, goalie saves/GA/decision), PP points from each game's scoring summary,
data/lineup.json (lines, PP units, projected starter), data/schedule.json, and NHL standings (goals for/against).
"""
import json, re, sys, html, pathlib, difflib, email.utils, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "fantasy.json"
UA = {"User-Agent": "Mozilla/5.0 (compatible; copperandbluenews-site; +https://copperandbluenews.com/)"}
FINAL = ("OFF", "FINAL")
SCORING = {"skater": {"G": 3, "A": 2, "PPP": 1, "SOG": 0.5, "HIT": 0.5, "BLK": 0.5},
           "goalie": {"W": 4, "SV": 0.2, "GA": -1, "SO": 3}}
FANTASY_SRC = re.compile(r"rotowire|fantasypros|daily ?faceoff|numberfire|rotoballer|fantasy", re.I)
FANTASY_KW = re.compile(r"fantasy|starting goalie|starter|start\W+(?:or|and)\W+sit|\bsit\b|sleeper|stream|waiver|pick-?up|dfs|draftkings|fanduel|projection|"
                        r"rankings?|who'?s hot|cold|power[- ]play|pp1|top line|line combination|lineup|injur|day-to-day|\bir\b|"
                        r"scratch|returns?\b|crease|\bprops?\b|^oilers' [^:]{3,40}:", re.I)
NEWS_DAYS, NEWS_KEEP = 10, 24


def now():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return r.read()


def clean(s, n=170):
    s = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0] + "…"


def rj(p, default=None):
    try:
        return json.loads(p.read_text())
    except Exception:
        return default


# ---------------------------------------------------------------- news
def roster_names():
    ro = rj(DATA / "roster.json", {"groups": {}})
    return [(p["id"], p["name"]) for g in ro["groups"].values() for p in g]


def matcher(roster):
    pats = []
    for pid, name in roster:
        last = name.split(" ", 1)[1] if " " in name else name
        pats.append((pid, name, re.compile(r"\b" + re.escape(name) + r"\b", re.I),
                     re.compile(r"\b" + re.escape(last) + r"\b", re.I)))
    oil = re.compile(r"\boilers?'?|edmonton", re.I)

    def players(text):
        hit = []
        for pid, name, full, last in pats:
            # full name anywhere, or last name when the item is clearly about the Oilers
            if full.search(text) or (last.search(text) and oil.search(text)):
                hit.append({"id": pid, "name": name})
        return hit
    return players


def rss(url, source=None, google=False):
    root = ET.fromstring(fetch(url))
    out = []
    for it in root.iter("item"):
        title = clean(it.findtext("title"), 300)
        link = (it.findtext("link") or "").strip().replace(".com//", ".com/")
        desc = it.findtext("description") or ""
        src = source
        if google:
            s = it.find("source")
            src = s.text.strip() if s is not None and s.text else "Google News"
            title = re.sub(r"\s+-\s+" + re.escape(src) + r"$", "", title)
            desc = ""  # Google's description only repeats the title
        desc = re.sub(r"Visit RotoWire\.com for more analysis on this update\.?", "", desc)
        try:
            pub = email.utils.parsedate_to_datetime(re.sub(r"\s+(PST|PDT)$", lambda m: " -0800" if m.group(1) == "PST" else " -0700",
                                                           (it.findtext("pubDate") or "").strip()))
            if pub.tzinfo is None:
                pub = pub.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        out.append({"title": title, "url": link, "source": src, "published": iso(pub), "snippet": clean(desc)})
    return out


def gnews(q):
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q + " when:7d", "hl": "en-CA", "gl": "CA", "ceid": "CA:en"})


FEEDS = [
    ("RotoWire NHL news RSS", lambda: rss("https://www.rotowire.com/rss/news.php?sport=NHL", "RotoWire"), True),
    ("Google News: RotoWire Oilers", lambda: rss(gnews("site:rotowire.com Oilers"), google=True), True),
    ("Google News: CBS Sports Oilers' player news", lambda: rss(gnews('site:cbssports.com "Oilers\'"'), google=True), False),
    ("Google News: Oilers fantasy", lambda: rss(gnews("Oilers fantasy hockey"), google=True), False),
    ("DailyFaceoff RSS", lambda: rss("https://www.dailyfaceoff.com/feed/", "DailyFaceoff"), False),
    ("Yahoo Sports NHL RSS", lambda: rss("https://sports.yahoo.com/nhl/rss.xml", "Yahoo Sports"), False),
]
JUNK = re.compile(r"News, Stats, Game Logs|\(Regular Season\)|Game Highlights|Top Plays|How to watch|TV channel|Goalie Save from", re.I)


def norm(t):
    return re.sub(r"[^a-z0-9 ]", "", t.lower())


def news():
    players = matcher(roster_names())
    cutoff = now() - timedelta(days=NEWS_DAYS)
    items, sources, errors = [], [], []
    for name, fn, fantasy_feed in FEEDS:
        try:
            got = fn()
        except Exception as e:
            errors.append(f"{name}: {type(e).__name__}: {e}"[:200]); continue
        kept = 0
        for x in got:
            text = x["title"] + " " + x["snippet"]
            if JUNK.search(x["title"]) or datetime.fromisoformat(x["published"].replace("Z", "+00:00")) < cutoff:
                continue
            ps = players(text)
            if not ps:
                continue
            if not (fantasy_feed or FANTASY_SRC.search(x["source"] or "") or FANTASY_KW.search(text)):
                continue
            items.append({**x, "players": ps[:4]}); kept += 1
        sources.append({"name": name, "items": len(got), "kept": kept})
    items.sort(key=lambda x: x["published"], reverse=True)
    keep, seen = [], set()
    for x in items:
        u = x["url"].split("?")[0].rstrip("/")
        if u in seen or any(difflib.SequenceMatcher(None, norm(x["title"]), norm(k["title"])).ratio() > 0.8 for k in keep):
            continue
        seen.add(u); keep.append(x)
        if len(keep) >= NEWS_KEEP:
            break
    return {"updated": iso(now()), "sources": sources, "errors": errors, "items": keep}


# ---------------------------------------------------------------- game logs
def secs(t):
    m, s = (t or "0:0").split(":"); return int(m) * 60 + int(s)


def game_logs():
    """Per-player regular-season game logs for EDM, oldest first, from data/games/*.json (final games only)."""
    sk, gk, games = {}, {}, []
    for f in sorted((DATA / "games").glob("*.json")):
        d = rj(f)
        if not d: continue
        b = d["box"]
        if b.get("gameType") != 2 or b.get("gameState") not in FINAL: continue
        home = b["homeTeam"]["abbrev"] == "EDM"
        opp = (b["awayTeam"] if home else b["homeTeam"])["abbrev"]
        ppp = {}
        for per in (d.get("summary") or {}).get("scoring") or []:
            for g in per.get("goals", []):
                if g.get("strength") == "pp" and g.get("teamAbbrev", {}).get("default") == "EDM":
                    for pid in [g["playerId"]] + [a["playerId"] for a in g.get("assists", [])]:
                        ppp[pid] = ppp.get(pid, 0) + 1
        meta = {"id": b["id"], "date": b["gameDate"], "opp": opp, "home": home}
        games.append(meta)
        t = b["playerByGameStats"]["homeTeam" if home else "awayTeam"]
        for p in t.get("forwards", []) + t.get("defense", []):
            row = {**meta, "G": p["goals"], "A": p["assists"], "P": p["points"], "SOG": p.get("sog", 0), "HIT": p.get("hits", 0),
                   "BLK": p.get("blockedShots", 0), "PPP": ppp.get(p["playerId"], 0), "TOI": secs(p.get("toi"))}
            sk.setdefault(p["playerId"], {"name": p["name"]["default"], "pos": p["position"], "log": []})["log"].append(row)
        played = [g for g in t.get("goalies", []) if secs(g.get("toi")) > 0]
        for g in played:
            dec = g.get("decision")
            row = {**meta, "W": int(dec == "W"), "SV": g.get("saves", 0), "GA": g.get("goalsAgainst", 0),
                   "SO": int(dec == "W" and g.get("goalsAgainst", 0) == 0 and len(played) == 1),
                   "SA": g.get("shotsAgainst", 0), "dec": dec, "start": bool(g.get("starter")), "TOI": secs(g.get("toi"))}
            gk.setdefault(g["playerId"], {"name": g["name"]["default"], "log": []})["log"].append(row)
    return sk, gk, games


def fp_sk(r):
    return sum(SCORING["skater"][k] * r[k] for k in SCORING["skater"])


def fp_g(r):
    return sum(SCORING["goalie"][k] * r[k] for k in SCORING["goalie"])


def agg(log, keys, fp):
    s = {k: sum(r[k] for r in log) for k in keys}
    s["gp"] = len(log)
    s["FP"] = round(sum(fp(r) for r in log), 1)
    s["FPG"] = round(s["FP"] / len(log), 2) if log else 0
    return s


SK_KEYS = ("G", "A", "P", "SOG", "PPP", "HIT", "BLK", "TOI")
G_KEYS = ("W", "SV", "GA", "SO", "SA")


# ---------------------------------------------------------------- outlook
def standings():
    try:
        s = json.loads(fetch("https://api-web.nhle.com/v1/standings/now"))["standings"]
        return {t["teamAbbrev"]["default"]: {"gf": t["goalFor"], "ga": t["goalAgainst"], "gp": t["gamesPlayed"],
                                             "name": t.get("teamCommonName", {}).get("default")} for t in s}
    except Exception as e:
        print("standings failed:", e, file=sys.stderr)
        return None


def mmss(s):
    s = round(s); return f"{s // 60}:{s % 60:02d}"


def outlook(sk, gk, prev):
    sched = rj(DATA / "schedule.json", {"games": []})["games"]
    nxt = next((g for g in sched if g["state"] not in FINAL and g.get("gameType") == 2), None)
    if not nxt:
        return None
    home = nxt["home"]["abbrev"] == "EDM"
    opp = nxt["away"] if home else nxt["home"]
    st = standings() or (prev or {}).get("_standings")
    lg_ga = lg_gf = factor = adj = None
    o = (st or {}).get(opp["abbrev"])
    if st:
        tot_gp = sum(t["gp"] for t in st.values()) or 1
        lg_ga = sum(t["ga"] for t in st.values()) / tot_gp
        lg_gf = sum(t["gf"] for t in st.values()) / tot_gp
    if o and o["gp"] and lg_ga:
        factor = (o["ga"] / o["gp"]) / lg_ga
        adj = max(0.85, min(1.15, 1 + 0.5 * (factor - 1)))  # half-strength, capped at +/-15%
    adj = adj or 1.0
    lu = rj(DATA / "lineup.json", {}) or {}
    lu_ok = (lu.get("game") or {}).get("id") == nxt["id"]
    pp = {p["id"]: i + 1 for i, unit in enumerate(lu.get("pp") or []) for p in unit} if lu_ok else {}
    dressed = [p for row in (lu.get("forwards") or []) + (lu.get("defence") or []) for p in row if p.get("id")] if lu_ok else []
    if not dressed:  # no lineup for this game yet: last game's skaters
        last = max((r["id"] for v in sk.values() for r in v["log"]), default=None)
        dressed = [{"id": pid, "name": v["name"]} for pid, v in sk.items() if v["log"] and v["log"][-1]["id"] == last]
    names = {p["id"]: p["name"] for p in dressed}
    toi_rank = {pid: i + 1 for i, pid in enumerate(sorted([p["id"] for p in dressed if p["id"] in sk],
                                                          key=lambda i: -agg(sk[i]["log"], SK_KEYS, fp_sk)["TOI"] / max(1, len(sk[i]["log"]))))}
    proj = []
    for p in dressed:
        v = sk.get(p["id"])
        if not v or not v["log"]: continue
        log = v["log"]; s, l10, l5 = agg(log, SK_KEYS, fp_sk), agg(log[-10:], SK_KEYS, fp_sk), agg(log[-5:], SK_KEYS, fp_sk)
        rate = {k: 0.5 * s[k] / s["gp"] + 0.5 * l10[k] / l10["gp"] for k in ("G", "A", "SOG", "PPP", "HIT", "BLK")}
        for k in ("G", "A", "PPP"): rate[k] *= adj
        fp = sum(SCORING["skater"][k] * rate[k] for k in SCORING["skater"])
        toi_s, toi_l5 = s["TOI"] / s["gp"], l5["TOI"] / l5["gp"]
        reasons = []
        if pp.get(p["id"]): reasons.append(f"PP{pp[p['id']]}")
        if toi_rank.get(p["id"], 99) <= 6: reasons.append(f"#{toi_rank[p['id']]} in TOI ({mmss(toi_s)})")
        hot = l5["gp"] >= 5 and s["FPG"] > 0 and l5["FPG"] >= 1.2 * s["FPG"] and l5["P"] >= 3
        cold = l5["gp"] >= 5 and l5["P"] == 0
        rising = l5["gp"] >= 3 and toi_l5 - toi_s >= 60
        if hot: reasons.append(f"hot: {l5['P']} P, {l5['FP']} FP in last 5")
        if rising: reasons.append(f"TOI up: {mmss(toi_l5)} last 5 vs {mmss(toi_s)}")
        proj.append({"id": p["id"], "name": names.get(p["id"]) or v["name"], "pos": v["pos"], "pp": pp.get(p["id"]),
                     "gp": s["gp"], "projG": round(rate["G"], 2), "projA": round(rate["A"], 2), "projP": round(rate["G"] + rate["A"], 2),
                     "projSOG": round(rate["SOG"], 1), "projFP": round(fp, 2), "seasonFPG": s["FPG"], "l5FPG": l5["FPG"],
                     "l5P": l5["P"], "l5gp": l5["gp"], "toi": round(toi_s), "toiL5": round(toi_l5),
                     "hot": hot, "cold": cold, "rising": rising, "reasons": reasons})
    proj.sort(key=lambda r: -r["projFP"])
    start = proj[:5]
    sleepers = [r for r in proj[5:] if r["pp"] == 2 or r["rising"] or r["hot"]][:3]
    for r in sleepers:
        if r["pp"] == 2 and "PP2" not in r["reasons"]: r["reasons"].insert(0, "PP2")
    taken = {r["id"] for r in start + sleepers}
    sits = sorted([r for r in proj if r["id"] not in taken and (r["cold"] or (r["l5gp"] >= 5 and r["seasonFPG"] >= 1.5 and r["l5FPG"] <= 0.6 * r["seasonFPG"]))],
                  key=lambda r: -r["seasonFPG"])[:4]
    for r in sits:
        r["reasons"] = ([f"pointless in last 5 ({r['l5FPG']} FP/G)"] if r["cold"] else [f"cold: {r['l5FPG']} FP/G last 5 vs {r['seasonFPG']} season"])
    # goalie
    goalie = None
    gs = (lu.get("goalie") or {}) if lu_ok else {}
    starter = gs.get("starter")
    if starter and starter.get("id") in gk:
        log = gk[starter["id"]]["log"]
        s, l5 = agg(log, G_KEYS, fp_g), agg(log[-5:], G_KEYS, fp_g)
        base = 0.5 * s["FPG"] + 0.5 * l5["FPG"]
        gadj = 0.0
        if o and o["gp"] and lg_gf:
            gadj = -1 * 0.5 * ((o["gf"] / o["gp"]) - lg_gf)  # GA = -1, half of the opponent's above/below-average scoring
        goalie = {"id": starter["id"], "name": starter["name"], "status": gs.get("status"), "backup": (gs.get("backup") or {}).get("name"),
                  "gp": s["gp"], "w": s["W"], "svp": round(s["SV"] / s["SA"], 3) if s["SA"] else None, "gaa_per_gp": round(s["GA"] / s["gp"], 2),
                  "seasonFPG": s["FPG"], "l5FPG": l5["FPG"], "projFP": round(base + gadj, 2)}
    elif starter:
        goalie = {"id": starter.get("id"), "name": starter.get("name"), "status": gs.get("status"), "backup": (gs.get("backup") or {}).get("name")}
    return {"game": {"id": nxt["id"], "startTimeUTC": nxt["startTimeUTC"], "home": home, "opp": opp["abbrev"],
                     "oppName": f'{opp.get("place", "")} {opp.get("name", "")}'.strip(), "venue": nxt.get("venue")},
            "opponent": {"gaPerGp": round(o["ga"] / o["gp"], 2) if o and o["gp"] else None, "gfPerGp": round(o["gf"] / o["gp"], 2) if o and o["gp"] else None,
                         "gp": o["gp"] if o else None, "leagueGaPerGp": round(lg_ga, 2) if lg_ga else None,
                         "leagueGfPerGp": round(lg_gf, 2) if lg_gf else None, "factor": round(factor, 3) if factor else None, "adj": round(adj, 3)},
            "lineupBasis": {"status": lu.get("status"), "sources": lu.get("sources"), "updated": lu.get("updated")} if lu_ok else None,
            "goalie": goalie, "start": start, "sleepers": sleepers, "sits": sits, "projections": proj}, st


def tables(sk, gk):
    roster = {pid for pid, _ in roster_names()}
    sks, gos = [], []
    for pid, v in sk.items():
        log = v["log"]; s = agg(log, SK_KEYS, fp_sk)
        sks.append({"id": pid, "name": v["name"], "pos": v["pos"], "onRoster": pid in roster, "season": s,
                    "l5": agg(log[-5:], SK_KEYS, fp_sk), "l10": agg(log[-10:], SK_KEYS, fp_sk)})
    for pid, v in gk.items():
        log = v["log"]
        gos.append({"id": pid, "name": v["name"], "onRoster": pid in roster, "season": agg(log, G_KEYS, fp_g),
                    "l5": agg(log[-5:], G_KEYS, fp_g), "l10": agg(log[-10:], G_KEYS, fp_g)})
    sks.sort(key=lambda r: -r["season"]["FP"]); gos.sort(key=lambda r: -r["season"]["FP"])
    return sks, gos


def full_names(rows):
    ro = dict(roster_names())
    stats = rj(DATA / "stats.json", {}) or {}
    for x in stats.get("skaters", []) + stats.get("goalies", []):
        ro.setdefault(x["id"], x["name"])
    for r in rows:
        r["name"] = ro.get(r["id"], r["name"])


def main():
    prev = rj(OUT, {}) or {}
    n = prev.get("news") if "--outlook" in sys.argv else news()
    sk, gk, games = game_logs()
    sks, gos = tables(sk, gk)
    full_names(sks); full_names(gos)
    o = outlook(sk, gk, prev)
    ol, st = (o if o else (None, None))
    if ol:
        full_names(ol["projections"])
    out = {"updated": iso(now()), "scoring": SCORING,
           "through": games[-1]["date"] if games else None, "games": len(games),
           "news": n, "outlook": ol, "skaters": sks, "goalies": gos,
           "_standings": st or prev.get("_standings")}
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print("fantasy:", len((n or {}).get("items", [])), "news;", [(s["name"], s["items"], s["kept"]) for s in (n or {}).get("sources", [])],
          (n or {}).get("errors"), "| games", len(games), "| top", [(r["name"], r["projFP"], r["projP"]) for r in (ol or {}).get("start", [])])


if __name__ == "__main__":
    main()
