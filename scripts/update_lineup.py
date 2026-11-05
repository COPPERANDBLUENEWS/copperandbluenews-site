#!/usr/bin/env python3
"""Game-day lineup for the Oilers' current or next game -> data/lineup.json.

Sources (standard library only):
  * NHL API (api-web.nhle.com): which game, and once it starts or ends the official
    dressed roster + starting goalie from the gamecenter boxscore -> "Confirmed (official)".
  * DailyFaceoff line combinations (__NEXT_DATA__ JSON) for lines, pairs, PP units and
    injuries; DailyFaceoff starting-goalies page for the goalie (Confirmed/Likely/Unconfirmed).

Safety: on any fetch/parse failure, or if the data fails sanity checks (wrong team,
too few players, not the current roster), the last good file is kept untouched.
The file is only rewritten when the lineup content changes (keeps commits quiet).
Set GAMEDAY_ONLY=1 to exit immediately unless an Oilers game is today (PT).
Prints changed=1|0 to $GITHUB_OUTPUT. Always exits 0 so workflows keep going.
"""
import json, os, pathlib, re, sys, urllib.request
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

API = "https://api-web.nhle.com/v1"
SEASON = os.environ.get("SEASON", "20262027")
DFO_LINES = "https://www.dailyfaceoff.com/teams/edmonton-oilers/line-combinations"
DFO_GOALIES = "https://www.dailyfaceoff.com/starting-goalies/{date}"
PT = ZoneInfo("America/Vancouver")
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "lineup.json"
SLOT = {"lw": "LW", "c": "C", "rw": "RW", "ld": "LD", "rd": "RD"}
UA = "Mozilla/5.0 (compatible; copperandbluenews.com lineup bot; fan site)"
STARTED = ("LIVE", "CRIT", "OFF", "FINAL")


def fetch(url, as_json=True):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,text/html"})
    with urllib.request.urlopen(req, timeout=25) as r:
        body = r.read().decode("utf-8", "replace")
    return json.loads(body) if as_json else body


def next_data(url):
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', fetch(url, False), re.S)
    if not m:
        raise ValueError("no __NEXT_DATA__ at " + url)
    return json.loads(m.group(1))["props"]["pageProps"]


def utc(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def norm(s):
    return re.sub(r"[^a-z]", "", (s or "").lower())


def pick_game(now):
    """Live game, else a game that started today (PT) and ended < ~6h ago, else the next one."""
    games = fetch(f"{API}/club-schedule-season/EDM/{SEASON}")["games"]
    games = [g for g in games if g.get("gameScheduleState", "OK") == "OK"]
    for g in games:
        if g.get("gameState") in ("LIVE", "CRIT"):
            return g
    for g in games:
        t = utc(g["startTimeUTC"])
        if g.get("gameState") in ("OFF", "FINAL") and t.astimezone(PT).date() == now.astimezone(PT).date() \
                and now - t < timedelta(hours=9):
            return g
    for g in games:
        if g.get("gameState") not in ("OFF", "FINAL") and utc(g["startTimeUTC"]) > now - timedelta(hours=6):
            return g
    return None


class Roster:
    def __init__(self):
        d = json.loads((ROOT / "data" / "roster.json").read_text())
        self.players = [{**p, "group": g} for g, lst in d["groups"].items() for p in lst]
        self.by_id = {p["id"]: p for p in self.players}

    def match(self, name, num=None):
        """Map a DailyFaceoff player to the NHL roster: number + last name, then full name, then last name."""
        last = norm(name.split()[-1]) if name else ""
        if num is not None:
            for p in self.players:
                if p["num"] == num and norm(p["name"].split()[-1]) == last:
                    return p
        for p in self.players:
            if norm(p["name"]) == norm(name):
                return p
        hits = [p for p in self.players if norm(p["name"].split()[-1]) == last]
        return hits[0] if len(hits) == 1 else None


def chip(roster, name=None, num=None, pid=None, pos=None):
    p = roster.by_id.get(pid) if pid else roster.match(name, num)
    if p:
        return {"id": p["id"], "name": p["name"], "num": p["num"], "pos": pos or p["pos"]}
    return {"id": None, "name": name, "num": num, "pos": pos}  # not on the NHL roster file (e.g. call-up)


def dfo_lines(roster):
    c = next_data(DFO_LINES)["combinations"]
    if c.get("teamAbbreviation") != "EDM":
        raise ValueError("DailyFaceoff page is not the Oilers: %r" % c.get("teamAbbreviation"))
    groups = {}
    for p in c["players"]:
        groups.setdefault(p["groupIdentifier"], []).append(p)
    order = {"lw": 0, "c": 1, "rw": 2, "ld": 0, "rd": 1, "g1": 0, "g2": 1}
    def grp(key):
        lst = sorted(groups.get(key, []), key=lambda p: order.get(p["positionIdentifier"], p["positionIdentifier"]))
        return [chip(roster, p["name"], p.get("jerseyNumber"), pos=SLOT.get(p["positionIdentifier"])) for p in lst]
    inj = [{**chip(roster, p["name"], p.get("jerseyNumber")),
            "status": {"ir": "IR", "dtd": "Day-to-day", "out": "Out", "ltir": "LTIR"}.get(p.get("injuryStatus"), (p.get("injuryStatus") or "Out").upper())}
           for p in groups.get("ir", [])]
    return {"forwards": [grp(f"f{i}") for i in range(1, 5)], "defence": [grp(f"d{i}") for i in range(1, 4)],
            "goalies": grp("g"), "pp": [g for g in (grp("pp1"), grp("pp2")) if g], "injured": inj,
            "sourceName": c.get("sourceName"), "sourceRef": c.get("source"), "updatedAt": c.get("updatedAt")}


def dfo_goalie(game_date):
    """(name, 'Confirmed'|'Likely'|'Unconfirmed', news) for EDM from the starting-goalies page."""
    for g in next_data(DFO_GOALIES.format(date=game_date)).get("data", []):
        for side in ("home", "away"):
            if g.get(f"{side}TeamAbbreviation") == "EDM":
                return (g.get(f"{side}GoalieName"), g.get(f"{side}NewsStrengthName") or "Unconfirmed",
                        g.get(f"{side}NewsDetails"))
    return None


def official(gid, roster):
    """Dressed EDM players from the NHL boxscore (only filled once the game starts)."""
    b = fetch(f"{API}/gamecenter/{gid}/boxscore")
    side = "homeTeam" if b["homeTeam"]["abbrev"] == "EDM" else "awayTeam"
    t = (b.get("playerByGameStats") or {}).get(side) or {}
    if len(t.get("forwards", [])) < 10 or len(t.get("defense", [])) < 5 or not t.get("goalies"):
        return None
    mk = lambda p: chip(roster, p["name"]["default"], p.get("sweaterNumber"), pid=p["playerId"]) | \
        {"id": p["playerId"], "num": p.get("sweaterNumber"),
         "name": (roster.by_id.get(p["playerId"]) or {}).get("name") or p["name"]["default"]}
    return {"forwards": [mk(p) for p in t["forwards"]], "defence": [mk(p) for p in t["defense"]],
            "goalies": [mk(p) | {"starter": bool(p.get("starter"))} for p in t["goalies"]]}


def arrange(slots, dressed, size):
    """Keep projected combos for players who actually dressed; fill gaps with the other dressed players."""
    ids = {p["id"] for p in dressed}
    used, rows = set(), []
    for row in slots:
        keep = [p for p in row if p["id"] in ids and p["id"] not in used]
        used |= {p["id"] for p in keep}
        rows.append(keep)
    spare = [p for p in dressed if p["id"] not in used]
    for row in rows:
        while len(row) < size and spare:
            row.append(spare.pop(0))
    while spare:
        rows.append(spare[:size]); spare = spare[size:]
    return rows


def build(now):
    roster = Roster()
    g = pick_game(now)
    if not g:
        raise ValueError("no upcoming Oilers game")
    home = g["homeTeam"]["abbrev"] == "EDM"
    opp = g["awayTeam"] if home else g["homeTeam"]
    start = utc(g["startTimeUTC"])
    lines = dfo_lines(roster)
    # Sanity: must look like the current Oilers lineup.
    sk = [p for row in lines["forwards"] + lines["defence"] for p in row]
    known = sum(1 for p in sk + lines["goalies"] if p["id"])
    if len(sk) < 17 or not lines["goalies"] or known < 0.85 * (len(sk) + len(lines["goalies"])):
        raise ValueError(f"DailyFaceoff lineup failed sanity check ({len(sk)} skaters, {known} on roster)")
    src_upd = lines["updatedAt"]
    if src_upd and now - utc(src_upd) > timedelta(days=21):
        raise ValueError("DailyFaceoff lines are stale: " + src_upd)

    out = {"game": {"id": g["id"], "startTimeUTC": g["startTimeUTC"], "gameDate": g.get("gameDate"),
                    "state": g.get("gameState"), "home": home, "venue": (g.get("venue") or {}).get("default", ""),
                    "opponent": {"abbrev": opp["abbrev"], "name": (opp.get("commonName") or {}).get("default", opp["abbrev"]),
                                 "place": (opp.get("placeName") or {}).get("default", "")},
                    "puckDropPT": start.astimezone(PT).strftime("%a %b %-d, %-I:%M %p PT").replace(":00 ", " ")},
           "status": "Projected", "forwards": lines["forwards"], "defence": lines["defence"], "pp": lines["pp"],
           "injured": lines["injured"], "notes": [],
           "sources": [{"name": "DailyFaceoff", "url": DFO_LINES, "what": "line combinations & PP units",
                        "basis": lines["sourceName"], "updatedAt": src_upd}]}
    g1 = lines["goalies"][0] if lines["goalies"] else None
    g2 = lines["goalies"][1] if len(lines["goalies"]) > 1 else None
    goalie = {"starter": g1, "status": "Unconfirmed", "backup": g2, "note": None}
    try:
        sg = dfo_goalie(g.get("gameDate") or start.astimezone(PT).strftime("%Y-%m-%d"))
        if sg and sg[0]:
            st = chip(roster, sg[0])
            if st["id"] and g1 and st["id"] != g1["id"]:
                goalie["backup"] = g1 if g1 else g2
            goalie.update(starter=st, status=sg[1], note=sg[2])
            out["sources"].append({"name": "DailyFaceoff", "url": DFO_GOALIES.format(date=g.get("gameDate")),
                                   "what": "starting goalie"})
    except Exception as e:
        print("starting goalies failed (using lines page):", e, file=sys.stderr)

    if g.get("gameState") in STARTED or start <= now:
        try:
            off = official(g["id"], roster)
        except Exception as e:
            off = None
            print("boxscore failed:", e, file=sys.stderr)
        if off:
            out["status"] = "Confirmed"
            out["forwards"] = arrange(lines["forwards"], off["forwards"], 3)
            out["defence"] = arrange(lines["defence"], off["defence"], 2)
            dressed = {p["id"] for p in off["forwards"] + off["defence"]}
            out["pp"] = [[p for p in u if p["id"] in dressed] for u in out["pp"]]
            st = next((p for p in off["goalies"] if p["starter"]), off["goalies"][0])
            bk = next((p for p in off["goalies"] if p["id"] != st["id"]), None)
            goalie = {"starter": {k: v for k, v in st.items() if k != "starter"}, "status": "Confirmed",
                      "backup": bk and {k: v for k, v in bk.items() if k != "starter"}, "note": None}
            out["notes"].append("Dressed players and starting goalie are official (NHL game sheet). "
                                "Line combinations are DailyFaceoff's; the NHL doesn't publish lines.")
            out["sources"].insert(0, {"name": "NHL.com Gamecenter",
                                      "url": f"https://www.nhl.com/gamecenter/{g['id']}", "what": "official dressed lineup"})
    out["goalie"] = goalie
    if out["status"] == "Projected" and (lines["sourceName"] or "").lower().startswith("last game"):
        out["notes"].append(f"Projection is based on the {lines['sourceName']} lineup until morning skate or "
                            "practice updates.")
    # Scratches: roster players not in the lineup and not listed injured.
    inl = {p["id"] for row in out["forwards"] + out["defence"] for p in row} | \
          {x["id"] for x in (goalie["starter"], goalie["backup"]) if x}
    hurt = {p["id"] for p in out["injured"]}
    try:
        for r in json.loads((ROOT / "data" / "injuries.json").read_text()).get("players", []):
            if r.get("id"): hurt.add(r["id"])
    except Exception:
        pass
    out["scratches"] = [chip(roster, pid=p["id"]) for p in roster.players if p["id"] not in inl | hurt]
    return out


def main():
    now = datetime.now(timezone.utc)
    if os.environ.get("GAMEDAY_ONLY") == "1":
        try:
            games = fetch(f"{API}/club-schedule-season/EDM/{SEASON}")["games"]
            today = now.astimezone(PT).date()
            if not any(utc(g["startTimeUTC"]).astimezone(PT).date() == today for g in games):
                print("not a game day; skipping"); return set_out(False)
        except Exception as e:
            print("schedule check failed:", e, file=sys.stderr)
    try:
        new = build(now)
    except Exception as e:
        print("lineup NOT updated, keeping last good file:", e, file=sys.stderr)
        return set_out(False)
    old = {}
    if OUT.exists():
        try: old = json.loads(OUT.read_text())
        except Exception: pass
    strip = lambda d: {k: v for k, v in d.items() if k != "updated"}
    if strip(old) == new:
        print("lineup unchanged"); return set_out(False)
    new["updated"] = iso(now)
    OUT.write_text(json.dumps(new, indent=1, ensure_ascii=False))
    print("lineup written:", new["status"], new["game"]["opponent"]["abbrev"], new["game"]["puckDropPT"])
    set_out(True)


def set_out(changed):
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
            fh.write(f"changed={'1' if changed else '0'}\n")


if __name__ == "__main__":
    main()
