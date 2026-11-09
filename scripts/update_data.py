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
  data/mcdavid.json      McDavid 2026-27 point chase vs Gretzky's 215 (mcdavid.html)
  data/scoreboard.json   today's NHL scoreboard for the header strip (no logos)
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


MCDAVID_ID, GRETZKY_ID = 8478402, 8447400
RECORD, RECORD_SEASON = 215, 19851986


def _read_json(path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def _num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _season_label(sid):
    s = str(sid)
    return f"{s[:4]}-{s[6:]}" if len(s) == 8 else s


def _cum_games(log):
    """Oldest first. Cumulative points are the sum of the NHL game log, nothing estimated."""
    rows = sorted(log or [], key=lambda g: (g.get("gameDate") or "", g.get("gameId") or 0))
    out, cum, goals, assists = [], 0, 0, 0
    for g in rows:
        team = g.get("teamAbbrev")
        if team and team != "EDM":
            continue
        p, gl, a = _num(g.get("points")), _num(g.get("goals")), _num(g.get("assists"))
        cum += p
        goals += gl
        assists += a
        opp = g.get("opponentCommonName")
        out.append({"gp": len(out) + 1, "date": g.get("gameDate"), "gameId": g.get("gameId"),
                    "opp": g.get("opponentAbbrev") or "",
                    "oppName": (opp or {}).get("default") or g.get("opponentAbbrev") or "",
                    "home": g.get("homeRoadFlag") == "H", "g": gl, "a": a, "p": p, "cum": cum})
    return out, goals, assists, cum


def _games_needed(points, gp, target):
    """Smallest number of additional games for points/gp pace to reach target. None if it can't."""
    if points >= target:
        return 0
    if points <= 0 or gp <= 0:
        return None
    num = gp * (target - points)
    return (num + points - 1) // points


def _pace_target(points, gp, games_left, remaining, target):
    """On-pace game, or how many points short the current pace finishes."""
    if gp <= 0:
        projected = 0
    else:
        projected = points * (gp + games_left) / gp
    k = _games_needed(points, gp, target)
    game = None
    if k == 0:
        on = True
    elif k is not None and k <= games_left and k >= 1:
        on = True
        game = remaining[k - 1]
    else:
        on = False
    off = None if on else round(target - projected, 4)
    return {"target": target, "onPace": on, "offBy": off, "gamesNeeded": k, "game": game,
            "projected": round(projected, 4)}


def _gretzky_block(prev):
    """Real 1985-86 game log, or None so the page draws a labeled 215/80 average."""
    cached = (prev or {}).get("gretzky") or {}
    if os.environ.get("LIVE_RUN") == "1" and cached.get("pace") == "game-log" and _gretzky_ok(cached):
        return cached
    try:
        log = get(f"player/{GRETZKY_ID}/game-log/{RECORD_SEASON}/2")["gameLog"]
        games, goals, assists, points = _cum_games(log)
        block = {"playerId": GRETZKY_ID, "name": "Wayne Gretzky", "seasonId": RECORD_SEASON,
                 "season": _season_label(RECORD_SEASON), "goals": goals, "assists": assists,
                 "points": points, "gamesPlayed": len(games), "pace": "game-log",
                 "cumulative": [g["cum"] for g in games],
                 "source": f"player/{GRETZKY_ID}/game-log/{RECORD_SEASON}/2"}
        if _gretzky_ok(block):
            return block
        print("gretzky log failed validation", goals, assists, points, len(games), file=sys.stderr)
    except Exception as e:
        print("gretzky log failed:", e, file=sys.stderr)
    if cached.get("pace") == "game-log" and _gretzky_ok(cached):
        print("keeping previous Gretzky game log", file=sys.stderr)
        return cached
    return {"playerId": GRETZKY_ID, "name": "Wayne Gretzky", "seasonId": RECORD_SEASON,
            "season": _season_label(RECORD_SEASON), "goals": 52, "assists": 163,
            "points": RECORD, "gamesPlayed": 80, "pace": "average",
            "source": "season line only; game log unavailable"}


def _gretzky_ok(block):
    cum = block.get("cumulative") or []
    return (block.get("gamesPlayed") == 80 and block.get("points") == RECORD
            and block.get("goals") == 52 and block.get("assists") == 163
            and len(cum) == 80 and cum[-1] == RECORD and all(cum[i] <= cum[i + 1] for i in range(79)))


def _season_rows(landing):
    rows = []
    for s in landing.get("seasonTotals") or []:
        if s.get("leagueAbbrev") != "NHL" or s.get("gameTypeId") != 2:
            continue
        sid = s.get("season")
        rows.append({"seasonId": sid, "season": _season_label(sid), "gp": _num(s.get("gamesPlayed")),
                     "g": _num(s.get("goals")), "a": _num(s.get("assists")), "p": _num(s.get("points"))})
    return rows


def _best_log(best, prev):
    """Game-by-game cumulative for his best prior season, cached once it validates."""
    if not best:
        return None
    cached = (prev or {}).get("careerBest") or {}
    if (cached.get("seasonId") == best["seasonId"] and cached.get("points") == best["p"]
            and cached.get("gamesPlayed") == best["gp"] and len(cached.get("cumulative") or []) == best["gp"]
            and cached["cumulative"][-1] == best["p"]):
        return cached
    try:
        log = get(f"player/{MCDAVID_ID}/game-log/{best['seasonId']}/2")["gameLog"]
        games, goals, assists, points = _cum_games(log)
        block = {"seasonId": best["seasonId"], "season": best["season"], "goals": goals, "assists": assists,
                 "points": points, "gamesPlayed": len(games), "cumulative": [g["cum"] for g in games],
                 "source": f"player/{MCDAVID_ID}/game-log/{best['seasonId']}/2"}
        if len(games) == best["gp"] and points == best["p"] and goals == best["g"] and assists == best["a"]:
            return block
        print("career-best log failed validation", best["seasonId"], points, len(games), file=sys.stderr)
    except Exception as e:
        print("career-best log failed:", e, file=sys.stderr)
    return None


def _box_line(gid):
    box = get(f"gamecenter/{gid}/boxscore")
    for side in (box.get("playerByGameStats") or {}).values():
        if not isinstance(side, dict):
            continue
        for group in side.values():
            if not isinstance(group, list):
                continue
            for p in group:
                if isinstance(p, dict) and p.get("playerId") == MCDAVID_ID:
                    return {"goals": _num(p.get("goals")), "assists": _num(p.get("assists")),
                            "points": _num(p.get("points"))}
    return None


def _opp(g):
    home = g["home"]["abbrev"] == "EDM"
    opp = g["away"] if home else g["home"]
    return {"id": g["id"], "startTimeUTC": g["startTimeUTC"], "opp": opp.get("abbrev") or "",
            "oppName": opp.get("name") or opp.get("abbrev") or "", "home": home, "state": g.get("state")}


def mcdavid_chase(sched, stamp):
    """data/mcdavid.json for mcdavid.html. Runs on the 3-hour build and on the live loop."""
    path = DATA / "mcdavid.json"
    prev = _read_json(path)
    try:
        log = get(f"player/{MCDAVID_ID}/game-log/{SEASON}/2")["gameLog"]
    except Exception as e:
        print("mcdavid log failed:", e, file=sys.stderr)
        if prev:
            print("keeping previous mcdavid.json", file=sys.stderr)
            return
        raise
    games, goals, assists, points = _cum_games(log)
    logged = {g["gameId"] for g in games}
    reg = [g for g in sched if g.get("gameType") == 2 and (not g.get("scheduleState") or g.get("scheduleState") == "OK")]
    live_src = next((g for g in reg if g.get("state") in LIVE and g["id"] not in logged), None)
    remaining = [_opp(g) for g in reg if g["id"] not in logged and g.get("state") not in FINAL]
    remaining.sort(key=lambda g: g["startTimeUTC"])
    missed = sum(1 for g in reg if g.get("state") in FINAL and g["id"] not in logged)
    live = None
    if live_src:
        try:
            line = _box_line(live_src["id"])
            if line:
                live = {**_opp(live_src), **line,
                        "toTie": RECORD - (points + line["points"]),
                        "toBreak": RECORD + 1 - (points + line["points"])}
        except Exception as e:
            print("mcdavid live box failed:", e, file=sys.stderr)
            old = (prev or {}).get("live") or {}
            if old.get("id") == live_src["id"]:
                live = old

    live_run = os.environ.get("LIVE_RUN") == "1"
    seasons = (prev or {}).get("seasons") if live_run and (prev or {}).get("seasons") else None
    if not seasons:
        try:
            seasons = _season_rows(get(f"player/{MCDAVID_ID}/landing"))
        except Exception as e:
            print("mcdavid landing failed:", e, file=sys.stderr)
            seasons = (prev or {}).get("seasons") or []
    prior = [s for s in seasons if str(s.get("seasonId")) != SEASON]
    prior.sort(key=lambda s: (-s["p"], -s["gp"]))
    best = prior[0] if prior else None
    best_log = _best_log(best, prev)
    gretzky = _gretzky_block(prev)

    gp = len(games)
    games_left = len(remaining)
    summary = {"goals": goals, "assists": assists, "points": points, "gp": gp,
               "gamesLeft": games_left, "seasonGames": len(reg), "missed": missed,
               "toTie": RECORD - points, "toBreak": RECORD + 1 - points,
               "ppg": round(points / gp, 4) if gp else None,
               "tie": _pace_target(points, gp, games_left, remaining, RECORD),
               "break": _pace_target(points, gp, games_left, remaining, RECORD + 1)}
    if gretzky.get("pace") == "game-log" and 1 <= gp <= len(gretzky.get("cumulative") or []):
        summary["gretzkyThrough"] = gretzky["cumulative"][gp - 1]
    else:
        summary["gretzkyThrough"] = None
    if best_log and 1 <= gp <= len(best_log["cumulative"]):
        summary["careerBestThrough"] = best_log["cumulative"][gp - 1]
    else:
        summary["careerBestThrough"] = None

    obj = {"updated": stamp, "season": SEASON, "seasonLabel": _season_label(SEASON),
           "playerId": MCDAVID_ID, "name": "Connor McDavid", "record": RECORD,
           "summary": summary, "live": live, "games": games, "remaining": remaining,
           "gretzky": gretzky, "careerBest": best_log, "seasons": seasons,
           "sources": {"gameLog": f"player/{MCDAVID_ID}/game-log/{SEASON}/2",
                       "landing": f"player/{MCDAVID_ID}/landing",
                       "schedule": f"club-schedule-season/EDM/{SEASON}"}}
    write(path, obj)
    print("mcdavid", f"{goals}-{assists}-{points}", "gp", gp, "left", games_left,
          "proj", summary["tie"]["projected"], "gretzkyThrough", summary["gretzkyThrough"])


def _slim_score_games(games):
    """Abbrev, score, clock and period only. Skip postponed or cancelled games. No logos."""
    out = []
    for g in games or []:
        if g.get("gameScheduleState") not in (None, "OK"):
            continue
        away, home = g.get("awayTeam") or {}, g.get("homeTeam") or {}
        if not away.get("abbrev") or not home.get("abbrev"):
            continue
        clock, period = g.get("clock"), g.get("periodDescriptor")
        out.append({
            "id": g.get("id"),
            "startTimeUTC": g.get("startTimeUTC"),
            "state": g.get("gameState"),
            "period": None if not period else {"number": period.get("number"), "periodType": period.get("periodType")},
            "clock": None if not clock else {"timeRemaining": clock.get("timeRemaining") or "",
                                              "inIntermission": bool(clock.get("inIntermission"))},
            "lastPeriod": (g.get("gameOutcome") or {}).get("lastPeriodType"),
            "away": {"abbrev": away.get("abbrev"), "score": away.get("score")},
            "home": {"abbrev": home.get("abbrev"), "score": home.get("score")},
        })
    return out


def league_scoreboard(stamp):
    """Today's NHL slate for the header strip. If today is empty, the next date that has games."""
    d = get("score/now")
    games = _slim_score_games(d.get("games"))
    date, next_day = d.get("currentDate"), False
    if not games and d.get("nextDate"):
        nxt = get(f"score/{d['nextDate']}")
        nxt_games = _slim_score_games(nxt.get("games"))
        if nxt_games:
            games, date, next_day = nxt_games, nxt.get("currentDate") or d.get("nextDate"), True
    return {"updated": stamp, "date": date, "nextDay": next_day, "games": games}


def main():
    now = datetime.now(timezone.utc)
    games = get(f"club-schedule-season/EDM/{SEASON}")["games"]
    sched = [slim(g) for g in games]
    stamp = now.isoformat(timespec="seconds")
    write(DATA / "schedule.json", {"season": SEASON, "updated": stamp, "games": sched})
    # League header strip. Same pipeline as the other JSON (the browser cannot call the NHL API).
    try:
        write(DATA / "scoreboard.json", league_scoreboard(stamp))
    except Exception as e:
        print("scoreboard failed:", e, file=sys.stderr)

    # McDavid's record chase. Same schedule as the other JSON, including the live loop
    # (so a game that just hit the NHL game log is on the site with the next deploy).
    try:
        mcdavid_chase(sched, stamp)
    except Exception as e:
        print("mcdavid failed:", e, file=sys.stderr)

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
