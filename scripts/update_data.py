#!/usr/bin/env python3
"""Build the site's JSON from the public NHL API (which sends no CORS headers).

Writes:
  data.json              next game / latest result / standings (home page)
  data/schedule.json     full season schedule
  data/stats.json        Oilers skater + goalie season stats
  data/live.json         today's/current Oilers game status (live score)
  data/games/<id>.json   box score per played game (finished games are cached
                         and never refetched; live games refresh every run)
Prints LIVE=1 to $GITHUB_OUTPUT when an Oilers game is live or about to start.
"""
import json, os, pathlib, sys, urllib.request
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

API = "https://api-web.nhle.com/v1"
SEASON = os.environ.get("SEASON", "20262027")
MT, PT = ZoneInfo("America/Edmonton"), ZoneInfo("America/Vancouver")
ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA, GAMES = ROOT / "data", ROOT / "data" / "games"
FINAL = ("OFF", "FINAL")
LIVE = ("LIVE", "CRIT")


def get(path):
    req = urllib.request.Request(f"{API}/{path}", headers={"User-Agent": "copperandbluenews"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")))


def utc(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def fmt(dt, tz):
    return dt.astimezone(tz).strftime("%-I:%M %p").replace(":00", "")


def side(x):
    return {"abbrev": x["abbrev"], "name": x.get("commonName", {}).get("default", x["abbrev"]),
            "place": x.get("placeName", {}).get("default", ""), "score": x.get("score")}


def slim(g):
    t = utc(g["startTimeUTC"])
    return {"id": g["id"], "gameType": g.get("gameType"), "startTimeUTC": g["startTimeUTC"],
            "dateMT": t.astimezone(MT).strftime("%a %b %-d"),
            "timeMT": fmt(t, MT) + " MT", "timePT": fmt(t, PT) + " PT",
            "venue": g.get("venue", {}).get("default", ""), "state": g.get("gameState"),
            "scheduleState": g.get("gameScheduleState"),
            "lastPeriod": g.get("gameOutcome", {}).get("lastPeriodType"),
            "away": side(g["awayTeam"]), "home": side(g["homeTeam"])}


def boxscore(gid):
    box = get(f"gamecenter/{gid}/boxscore")
    land = get(f"gamecenter/{gid}/landing")
    rail = get(f"gamecenter/{gid}/right-rail")
    box.pop("tvBroadcasts", None)
    summ = land.get("summary", {})
    return {"box": box,
            "summary": {k: summ.get(k) for k in ("scoring", "shootout", "threeStars", "penalties")},
            "rail": {k: rail.get(k) for k in ("linescore", "shotsByPeriod", "teamGameStats", "gameInfo")},
            "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def standings():
    try:
        for s in get("standings/now")["standings"]:
            if s["teamAbbrev"]["default"] == "EDM":
                return {k: s.get(k) for k in ("wins", "losses", "otLosses", "points", "gamesPlayed",
                                              "divisionSequence", "divisionName", "streakCode", "streakCount")}
    except Exception as e:
        print("standings failed:", e, file=sys.stderr)


def stats():
    cs = get("club-stats/EDM/now")
    sk = [{"id": p["playerId"], "name": f'{p["firstName"]["default"]} {p["lastName"]["default"]}',
           "pos": p["positionCode"], "gp": p["gamesPlayed"], "g": p["goals"], "a": p["assists"],
           "p": p["points"], "pm": p["plusMinus"], "pim": p["penaltyMinutes"],
           "ppg": p["powerPlayGoals"], "sog": p["shots"], "toi": round(p["avgTimeOnIcePerGame"])}
          for p in cs["skaters"]]
    go = [{"id": p["playerId"], "name": f'{p["firstName"]["default"]} {p["lastName"]["default"]}',
           "gp": p["gamesPlayed"], "w": p["wins"], "l": p["losses"], "otl": p["overtimeLosses"],
           "gaa": round(p["goalsAgainstAverage"], 2), "svp": round(p["savePercentage"], 3),
           "so": p["shutouts"]} for p in cs["goalies"]]
    return {"season": cs.get("season"), "skaters": sk, "goalies": go}


def main():
    now = datetime.now(timezone.utc)
    games = get(f"club-schedule-season/EDM/{SEASON}")["games"]
    sched = [slim(g) for g in games]
    stamp = now.isoformat(timespec="seconds")
    write(DATA / "schedule.json", {"season": SEASON, "updated": stamp, "games": sched})

    # Box scores: fetch finished games once, always refresh live/just-started ones.
    live_game = None
    for g in sched:
        f = GAMES / f'{g["id"]}.json'
        started = utc(g["startTimeUTC"]) <= now
        if g["state"] in FINAL:
            if f.exists() and json.loads(f.read_text())["box"].get("gameState") in FINAL:
                continue
        elif not (g["state"] in LIVE or started) or g["scheduleState"] != "OK":
            continue
        try:
            write(f, boxscore(g["id"]))
            print("box", g["id"], g["state"])
        except Exception as e:
            print("box failed", g["id"], e, file=sys.stderr)

    # Live window: from 30 min before puck drop until the game is final.
    for g in sched:
        t = utc(g["startTimeUTC"])
        if g["state"] in LIVE or (g["state"] not in FINAL and t - timedelta(minutes=30) <= now <= t + timedelta(hours=5)):
            live_game = g
            break
    live = {"updated": stamp, "game": None}
    if live_game and (GAMES / f'{live_game["id"]}.json').exists():
        b = json.loads((GAMES / f'{live_game["id"]}.json').read_text())["box"]
        live["game"] = {**live_game, "state": b.get("gameState"), "period": b.get("periodDescriptor"),
                        "clock": b.get("clock"), "away": {**live_game["away"], "score": b["awayTeam"].get("score"), "sog": b["awayTeam"].get("sog")},
                        "home": {**live_game["home"], "score": b["homeTeam"].get("score"), "sog": b["homeTeam"].get("sog")}}
    elif live_game:
        live["game"] = live_game
    write(DATA / "live.json", live)

    try:
        write(DATA / "stats.json", {"updated": stamp, **stats()})
    except Exception as e:
        print("stats failed:", e, file=sys.stderr)

    done = [g for g in sched if g["state"] in FINAL]
    todo = [g for g in sched if g["state"] not in FINAL]
    (ROOT / "data.json").write_text(json.dumps({"updated": stamp, "next": todo[0] if todo else None,
                                                "last": done[-1] if done else None,
                                                "standings": standings()}, indent=2))
    is_live = bool(live_game)
    print("LIVE" if is_live else "no live game", live_game and live_game["id"])
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
            fh.write(f"live={'1' if is_live else '0'}\n")


if __name__ == "__main__":
    main()
