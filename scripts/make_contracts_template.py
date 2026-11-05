#!/usr/bin/env python3
"""Create/refresh data/contracts.json rows for the current roster WITHOUT touching
numbers already entered. Contract figures are entered by hand (see README "Cap &
contracts"): PuckPedia (the chosen source) disallows this bot in robots.txt, so nothing is fetched automatically."""
import json, pathlib, re, unicodedata
from datetime import date
ROOT = pathlib.Path(__file__).resolve().parent.parent
P = ROOT / "data" / "contracts.json"
roster = json.loads((ROOT / "data" / "roster.json").read_text())
cur = json.loads(P.read_text()) if P.exists() else {}
old = {p["id"]: p for p in cur.get("players", [])}
slug = lambda n: re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode().lower()).strip("-")
TEAM_URL = "https://puckpedia.com/team/edmonton-oilers"
FIELDS = ("capHit", "salary", "yearsLeft", "expiry", "status", "clauses")
players = []
for grp, lst in roster["groups"].items():
    for p in lst:
        row = {"id": p["id"], "name": p["name"], "pos": p["pos"], **{f: None for f in FIELDS},
               "link": TEAM_URL}
        row.update({k: v for k, v in old.get(p["id"], {}).items() if k in FIELDS})
        players.append(row)
out = {
    "season": "2026-27",
    "asOf": cur.get("asOf"),
    "source": cur.get("source") or "PuckPedia",
    "sourceUrl": cur.get("sourceUrl") or TEAM_URL,
    "league": cur.get("league") or {"upperLimit": 104000000, "midpoint": 90400000, "lowerLimit": 76900000,
               "maxPlayerSalary": 20800000, "asOf": "2026-05-06",
               "source": "NHL Public Relations", "sourceUrl": "https://www.nhl.com/news/nhl-nhlpa-announce-team-payroll-range-for-2026-27-season"},
    "team": cur.get("team") or {"capHit": None, "capSpace": None, "ltir": None, "deadCap": []},
    "players": players,
    "templateUpdated": date.today().isoformat(),
}
P.write_text(json.dumps(out, indent=2))
print("wrote", P, len(players), "players")
