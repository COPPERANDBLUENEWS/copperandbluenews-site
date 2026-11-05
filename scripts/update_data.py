#!/usr/bin/env python3
"""Fetch Oilers schedule, scoreboard and standings from the public NHL API and
write ../data.json. The NHL API sends no CORS headers, so the browser can't call
it directly; run this (manually, cron, or a GitHub Action) then commit data.json."""
import json, pathlib, urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

API = "https://api-web.nhle.com/v1"
MT, PT = ZoneInfo("America/Edmonton"), ZoneInfo("America/Vancouver")

def get(path):
    req = urllib.request.Request(f"{API}/{path}", headers={"User-Agent": "copperandbluenews"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)

def fmt(dt, tz):
    return dt.astimezone(tz).strftime("%-I:%M %p").replace(":00", "")

def game(g):
    t = datetime.fromisoformat(g["startTimeUTC"].replace("Z", "+00:00"))
    side = lambda x: {"abbrev": x["abbrev"], "name": x.get("commonName", {}).get("default", x["abbrev"]),
                      "place": x.get("placeName", {}).get("default", ""), "score": x.get("score")}
    return {"id": g["id"], "startTimeUTC": g["startTimeUTC"],
            "dateMT": t.astimezone(MT).strftime("%a %b %-d"),
            "timeMT": fmt(t, MT) + " MT", "timePT": fmt(t, PT) + " PT",
            "venue": g.get("venue", {}).get("default", ""), "state": g.get("gameState"),
            "lastPeriod": g.get("gameOutcome", {}).get("lastPeriodType"),
            "away": side(g["awayTeam"]), "home": side(g["homeTeam"])}

def main():
    games = get("club-schedule-season/EDM/now")["games"]
    done = [g for g in games if g.get("gameState") in ("OFF", "FINAL")]
    todo = [g for g in games if g.get("gameState") not in ("OFF", "FINAL")]
    rec = None
    try:
        for s in get("standings/now")["standings"]:
            if s["teamAbbrev"]["default"] == "EDM":
                rec = {k: s.get(k) for k in ("wins", "losses", "otLosses", "points", "gamesPlayed",
                                             "divisionSequence", "divisionName", "streakCode", "streakCount")}
    except Exception as e:
        print("standings failed:", e)
    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "next": game(todo[0]) if todo else None,
           "last": game(done[-1]) if done else None, "standings": rec}
    p = pathlib.Path(__file__).resolve().parent.parent / "data.json"
    p.write_text(json.dumps(out, indent=2))
    print("wrote", p, json.dumps(out["next"], indent=1))

if __name__ == "__main__":
    main()
