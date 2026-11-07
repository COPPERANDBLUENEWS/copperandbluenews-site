#!/usr/bin/env python3
"""Build the site's JSON from the public NHL API (which sends no CORS headers).

Writes:
  data.json              next game / latest result / standings (home page)
  data/schedule.json     full season schedule
  data/stats.json        Oilers skater + goalie season stats
  data/standings.json    league table (division / conference / wild card)
  data/leaders.json      NHL skater and goalie stat leaders
  data/live.json         today's/current Oilers game status (live score)
  data/games/<id>.json   box score per played game (finished games are cached
                         and never refetched; live games refresh every run)
  data/odds.json         today's Oilers betting odds (NHL partner feed, FanDuel CA) or game null
  data/pbp/<id>.json     slim play-by-play (events + x/y coords + rosters) for the
                         Live rink tracker (tracker.html); same caching rules
Prints LIVE=1 to $GITHUB_OUTPUT when an Oilers game is live or about to start.
"""
import json, os, pathlib, sys, urllib.request
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

API = "https://api-web.nhle.com/v1"
SEASON = os.environ.get("SEASON", "20262027")
MT, PT = ZoneInfo("America/Edmonton"), ZoneInfo("America/Vancouver")
ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA, GAMES, PBP = ROOT / "data", ROOT / "data" / "games", ROOT / "data" / "pbp"
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


def pbp(gid):
    """Slim play-by-play for tracker.html: plays (with coords), score, clock, SOG, rosters (names only)."""
    d = get(f"gamecenter/{gid}/play-by-play")
    team = lambda t: {k: t.get(k) for k in ("id", "abbrev", "score", "sog", "commonName", "placeName")}
    plays = []
    for x in d.get("plays", []):
        x.pop("pptReplayUrl", None)
        det = x.get("details")
        if det:
            for k in [k for k in det if k.startswith(("highlightClip", "discreteClip"))]:
                det.pop(k)
        plays.append(x)
    return {**{k: d.get(k) for k in ("id", "season", "gameType", "gameDate", "venue", "startTimeUTC", "gameState",
                                      "gameScheduleState", "periodDescriptor", "clock", "gameOutcome", "regPeriods")},
            "awayTeam": team(d["awayTeam"]), "homeTeam": team(d["homeTeam"]), "plays": plays,
            "rosterSpots": [{k: r.get(k) for k in ("teamId", "playerId", "firstName", "lastName", "sweaterNumber", "positionCode")}
                            for r in d.get("rosterSpots", [])],
            "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def standings():
    try:
        for s in get("standings/now")["standings"]:
            if s["teamAbbrev"]["default"] == "EDM":
                return {k: s.get(k) for k in ("wins", "losses", "otLosses", "points", "gamesPlayed",
                                              "divisionSequence", "divisionName", "streakCode", "streakCount")}
    except Exception as e:
        print("standings failed:", e, file=sys.stderr)


def _name(block, fallback=""):
    if isinstance(block, dict):
        return block.get("default") or fallback
    return block or fallback


def league_table():
    """Full NHL table for the Standings view. No logos."""
    d = get("standings/now")
    teams = []
    for s in d.get("standings") or []:
        code = s.get("streakCode") or ""
        teams.append({
            "abbrev": _name(s.get("teamAbbrev")),
            "name": _name(s.get("teamCommonName"), _name(s.get("teamAbbrev"))),
            "place": _name(s.get("placeName")),
            "conf": s.get("conferenceAbbrev") or "",
            "conference": s.get("conferenceName") or "",
            "div": s.get("divisionAbbrev") or "",
            "division": s.get("divisionName") or "",
            "gp": s.get("gamesPlayed") or 0,
            "w": s.get("wins") or 0,
            "l": s.get("losses") or 0,
            "otl": s.get("otLosses") or 0,
            "pts": s.get("points") or 0,
            "pct": s.get("pointPctg"),
            "gf": s.get("goalFor") or 0,
            "ga": s.get("goalAgainst") or 0,
            "diff": s.get("goalDifferential") or 0,
            "streak": f"{code}{s.get('streakCount') or ''}" if code else "",
            "l10": f"{s.get('l10Wins') or 0}-{s.get('l10Losses') or 0}-{s.get('l10OtLosses') or 0}",
            "divRank": s.get("divisionSequence") or 0,
            "confRank": s.get("conferenceSequence") or 0,
            "lgRank": s.get("leagueSequence") or 0,
            "wc": s.get("wildcardSequence") or 0,
        })
    return {"wildCard": bool(d.get("wildCardIndicator")), "teams": teams}


def _leaders(items):
    rows = []
    for p in items or []:
        first, last = _name(p.get("firstName")), _name(p.get("lastName"))
        rows.append({"id": p.get("id"), "name": f"{first} {last}".strip(), "team": p.get("teamAbbrev") or "",
                     "pos": p.get("position") or "", "value": p.get("value")})
    return rows


def league_leaders():
    """NHL leaderboards for the Leaders view. `current` follows the season the API is in."""
    sk = get("skater-stats-leaders/current?limit=15")
    go = get("goalie-stats-leaders/current?limit=10")
    return {
        "skaters": {
            "points": _leaders(sk.get("points")),
            "goals": _leaders(sk.get("goals")),
            "assists": _leaders(sk.get("assists")),
            "plusMinus": _leaders(sk.get("plusMinus")),
            "ppg": _leaders(sk.get("goalsPp")),
        },
        "goalies": {
            "gaa": _leaders(go.get("goalsAgainstAverage")),
            "svp": _leaders(go.get("savePctg")),
            "wins": _leaders(go.get("wins")),
            "so": _leaders(go.get("shutouts")),
        },
    }


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


PLAYER_KEYS = ("playerId", "isActive", "currentTeamAbbrev", "firstName", "lastName", "sweaterNumber", "position",
               "headshot", "heroImage", "heightInInches", "heightInCentimeters", "weightInPounds", "weightInKilograms",
               "birthDate", "birthCity", "birthStateProvince", "birthCountry", "shootsCatches", "draftDetails",
               "featuredStats", "careerTotals", "last5Games", "awards", "inHHOF", "inTop100AllTime")


def players(extra_ids=()):
    """data/roster.json + data/players/<id>.json (player landing, NHL seasons only)."""
    ro = get("roster/EDM/current")
    groups = {}
    for key, label in (("forwards", "Forwards"), ("defensemen", "Defence"), ("goalies", "Goalies")):
        groups[label] = [{"id": p["id"], "name": f'{p["firstName"]["default"]} {p["lastName"]["default"]}',
                          "num": p.get("sweaterNumber"), "pos": p["positionCode"], "shoots": p.get("shootsCatches"),
                          "headshot": p.get("headshot"),
                          **{k: p.get(k) for k in ("heightInInches", "heightInCentimeters", "weightInPounds", "weightInKilograms")}} for p in sorted(ro.get(key, []), key=lambda x: x.get("sweaterNumber") or 999)]
    write(DATA / "roster.json", {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "groups": groups})
    ids = {p["id"] for g in groups.values() for p in g} | set(extra_ids)
    for pid in sorted(ids):
        try:
            d = get(f"player/{pid}/landing")
        except Exception as e:
            print("player failed", pid, e, file=sys.stderr)
            continue
        out = {k: d.get(k) for k in PLAYER_KEYS}
        out["nhlSeasons"] = [{k: v for k, v in x.items() if k not in ("teamPlaceNameWithPreposition", "teamCommonName")}
                             for x in d.get("seasonTotals", []) if x.get("leagueAbbrev") == "NHL"]
        write(DATA / "players" / f"{pid}.json", out)
    print("players", len(ids))


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

    # Play-by-play for the rink tracker: same rules (finished = cached once, live = every run).
    for g in sched:
        f = PBP / f'{g["id"]}.json'
        started = utc(g["startTimeUTC"]) <= now
        if g["state"] in FINAL:
            if f.exists() and json.loads(f.read_text()).get("gameState") in FINAL:
                continue
        elif not (g["state"] in LIVE or started) or g["scheduleState"] != "OK":
            continue
        try:
            write(f, pbp(g["id"]))
            print("pbp", g["id"], g["state"])
        except Exception as e:
            print("pbp failed", g["id"], e, file=sys.stderr)

    # Live window: from 90 min before puck drop until the game is final.
    # GitHub's */10 cron can lag by 30-50+ min, so a 30-min window often misses
    # the start and never begins the self-re-dispatch loop.
    for g in sched:
        t = utc(g["startTimeUTC"])
        if g["state"] in LIVE or (g["state"] not in FINAL and t - timedelta(minutes=90) <= now <= t + timedelta(hours=5)):
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

    # Betting odds for today's Oilers game (shown pre-game with "19+. Please play responsibly."). Fails soft.
    try:
        sys.path.insert(0, str(ROOT / "scripts"))
        import odds as _odds
        write(DATA / "odds.json", _odds.site_json(_odds.edm_game(_odds.fetch()), stamp))
    except Exception as e:
        print("odds failed:", e, file=sys.stderr)

    st = None
    try:
        st = stats()
        write(DATA / "stats.json", {"updated": stamp, **st})
    except Exception as e:
        print("stats failed:", e, file=sys.stderr)
    # Standings and leaders move a few times a day, including after finals, so the same
    # pipeline that writes stats.json writes them. The browser cannot call the NHL API (no CORS).
    try:
        write(DATA / "standings.json", {"updated": stamp, **league_table()})
    except Exception as e:
        print("league standings failed:", e, file=sys.stderr)
    try:
        write(DATA / "leaders.json", {"updated": stamp, **league_leaders()})
    except Exception as e:
        print("leaders failed:", e, file=sys.stderr)
    if os.environ.get("LIVE_RUN") != "1":  # live loop skips the ~30 player requests
        try:
            players([p["id"] for p in (st["skaters"] + st["goalies"])] if st else ())
        except Exception as e:
            print("players failed:", e, file=sys.stderr)

    done = [g for g in sched if g["state"] in FINAL]
    todo = [g for g in sched if g["state"] not in FINAL]
    (ROOT / "data.json").write_text(json.dumps({"updated": stamp, "next": todo[0] if todo else None,
                                                "last": done[-1] if done else None,
                                                "standings": standings()}, indent=2))
    is_live = bool(live_game) or os.environ.get("FORCE_LIVE") == "1"
    print("LIVE" if is_live else "no live game", live_game and live_game["id"])
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
            fh.write(f"live={'1' if is_live else '0'}\n")


if __name__ == "__main__":
    main()
