#!/usr/bin/env python3
"""Game alerts (web push) hook for the live pipeline. Standard library only.

Detects NEW Oilers game events since the previous run and POSTs each one to the
Cloudflare Worker (worker/, see worker/README.md):  POST $WORKER_URL/notify
  Authorization: Bearer $NOTIFY_SECRET
  {"id": "<event id>", "type": "puck_drop|goal|period_end|final|lineup", "title", "body", "url"}

  --game    (live.yml, after update_data.py) reads data/schedule.json + data/pbp/<id>.json:
            puck drop, each goal (both teams; scorer, assists, score), each period end (score
            after the period), final score. Shootout attempts are not sent; the final covers it.
  --lineup  (live.yml / lineup.yml, after update_lineup.py) reads data/lineup.json:
            starting goalie confirmed (pre-game) and official dressed lineup confirmed.

No-op (exit 0, nothing sent) if WORKER_URL or NOTIFY_SECRET is missing.
No duplicates: every event has a stable id (<gameId>:goal:<eventId> etc). Ids that were sent
are kept in $ALERTS_STATE (default ~/.cbn-alerts/sent.json, carried between Actions runs with
actions/cache), and the Worker also refuses an id it has already fanned out (D1 sent_events),
so a lost cache can't cause repeats. Only games that started in the last 8 h are considered.
On a game's first sighting with a backlog (e.g. secrets added mid-game) only the newest event
of each kind is sent and the rest are marked as seen. Always exits 0 so the pipeline keeps going.
Prints changed=1|0 to $GITHUB_OUTPUT (1 = state file changed, save the cache).
"""
import json, os, pathlib, sys, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
STATE = pathlib.Path(os.environ.get("ALERTS_STATE") or pathlib.Path.home() / ".cbn-alerts" / "sent.json")
PT = ZoneInfo("America/Vancouver")
FINAL, LIVE = ("OFF", "FINAL"), ("LIVE", "CRIT")
EDM = "EDM"


def utc(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def pname(pd):
    if not pd:
        return ""
    if pd.get("periodType") == "OT":
        return "OT" if pd["number"] <= 4 else f"{pd['number'] - 3}OT"
    if pd.get("periodType") == "SO":
        return "SO"
    return ordinal(pd["number"])


def load_state():
    try:
        s = json.loads(STATE.read_text())
        return s if isinstance(s.get("games"), dict) else {"games": {}}
    except Exception:
        return {"games": {}}


def save_state(state):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    state["games"] = {k: v for k, v in state["games"].items() if v.get("seen", "") >= cutoff}
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, separators=(",", ":")))


def post(worker, secret, ev):
    req = urllib.request.Request(worker.rstrip("/") + "/notify", data=json.dumps(ev).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}",
                                          "User-Agent": "copperandbluenews-alerts"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            res = json.loads(r.read() or b"{}")
            print(f"  sent {ev['id']}: {res.get('duplicate') and 'duplicate (already sent)' or res.get('queued', res.get('sent', 'ok'))}")
            return True
    except urllib.error.HTTPError as e:
        print(f"  notify failed {ev['id']}: HTTP {e.code}", file=sys.stderr)
        return e.code in (400, 422)  # payload the Worker will never accept: don't retry forever
    except Exception as e:
        print(f"  notify failed {ev['id']}: {e}", file=sys.stderr)
        return False


# ---------- game events ----------
def team_names(g):
    side = lambda t: {"abbrev": t["abbrev"], "name": (t.get("commonName") or {}).get("default", t["abbrev"])}
    return side(g["awayTeam"]), side(g["homeTeam"])


def score_line(g, away_score, home_score):
    a, h = g["awayTeam"]["abbrev"], g["homeTeam"]["abbrev"]
    # Oilers first, then the opponent: "EDM 2, ANA 1"
    return f"{h} {home_score}, {a} {away_score}" if h == EDM else f"{a} {away_score}, {h} {home_score}"


def strength(sit, scoring_is_home):
    """situationCode = away goalie, away skaters, home skaters, home goalie."""
    if not sit or len(sit) != 4 or not sit.isdigit():
        return ""
    ag, ask, hsk, hg = map(int, sit)
    us, them, their_goalie = (hsk, ask, ag) if scoring_is_home else (ask, hsk, hg)
    if their_goalie == 0:
        return "empty net"
    return "power play" if us > them else "shorthanded" if us < them else ""


def game_events(g):
    gid, away, home = g["id"], *team_names(g)
    names = {r["playerId"]: f"{r['firstName']['default'][0]}. {r['lastName']['default']}" for r in g.get("rosterSpots", [])}
    last = {r["playerId"]: r["lastName"]["default"] for r in g.get("rosterSpots", [])}
    home_id = g["homeTeam"].get("id")
    edm_home = home["abbrev"] == EDM
    opp = away if edm_home else home
    matchup = f"{away['name']} @ {home['name']}"
    plays = g.get("plays", [])
    evs = []
    started = g.get("gameState") in LIVE + FINAL or any(p["typeDescKey"] == "period-start" for p in plays)
    if started:
        evs.append({"id": f"{gid}:puck_drop", "type": "puck_drop", "title": f"Puck drop: {matchup}",
                    "body": f"{'Oilers vs' if edm_home else 'Oilers @'} {opp['name']} is underway{(' at ' + g['venue']['default']) if g.get('venue') else ''}. Follow it live on the rink tracker.",
                    "url": "/tracker.html"})
    a_sc = h_sc = 0
    for p in plays:
        pd, kind, det = p.get("periodDescriptor") or {}, p["typeDescKey"], p.get("details") or {}
        if kind == "goal" and pd.get("periodType") != "SO":
            a_sc, h_sc = det.get("awayScore", a_sc), det.get("homeScore", h_sc)
            is_home = det.get("eventOwnerTeamId") == home_id
            team = home if is_home else away
            sc = det.get("scoringPlayerId")
            who = names.get(sc, "Unknown")
            if det.get("scoringPlayerTotal"):
                who += f" ({det['scoringPlayerTotal']})"
            aids = [det[k] for k in ("assist1PlayerId", "assist2PlayerId") if det.get(k)]
            lasts = [last.get(a, "") for a in aids]
            # "Hughes, Hughes" is ambiguous: use initials when the assisters share a last name
            assists = [names.get(a, "") for a in aids] if len(set(lasts)) < len(lasts) else lasts
            bits = [who + (f" from {', '.join(a for a in assists if a)}" if assists else ", unassisted"),
                    f"{pname(pd)} {(p.get('timeInPeriod') or '').removeprefix('0') or '0:00'}".strip()]
            st = strength(p.get("situationCode"), is_home)
            if st:
                bits.append(st)
            sl = score_line(g, a_sc, h_sc)
            title = f"🚨 OILERS GOAL! {sl}" if team["abbrev"] == EDM else f"{team['name']} goal. {sl}"
            evs.append({"id": f"{gid}:goal:{p['eventId']}", "type": "goal", "title": title, "body": " · ".join(bits),
                        "url": "/tracker.html", "order": p.get("sortOrder", 0)})
        elif kind == "period-end" and pd.get("periodType") != "SO":
            us_t, them_t = (g["homeTeam"], g["awayTeam"]) if edm_home else (g["awayTeam"], g["homeTeam"])
            sog = f"Shots: {us_t['abbrev']} {us_t.get('sog') or 0}, {them_t['abbrev']} {them_t.get('sog') or 0}"
            evs.append({"id": f"{gid}:period_end:{pd.get('number')}", "type": "period_end",
                        "title": f"End of {pname(pd)}: {score_line(g, a_sc, h_sc)}",
                        "body": f"{'Oilers vs' if edm_home else 'Oilers @'} {opp['name']} · {sog}.",
                        "url": "/tracker.html"})
    if g.get("gameState") in FINAL or any(p["typeDescKey"] == "game-end" for p in plays):
        a, h = g["awayTeam"].get("score", a_sc), g["homeTeam"].get("score", h_sc)
        us, them = (h, a) if edm_home else (a, h)
        lp = (g.get("gameOutcome") or {}).get("lastPeriodType")
        extra = f" ({lp})" if lp in ("OT", "SO") else ""
        res = "Oilers win" if us > them else "Oilers fall"
        evs.append({"id": f"{gid}:final", "type": "final",
                    "title": f"FINAL{extra}: {score_line(g, a, h)}",
                    "body": f"{res} {us}-{them}{extra} {'vs' if edm_home else 'at'} the {opp['name']}. Box score and every goal on the site.",
                    "url": f"/game.html?id={gid}"})
    return evs


def recent_games(now):
    try:
        sched = json.loads((DATA / "schedule.json").read_text())["games"]
    except Exception as e:
        print("no schedule:", e, file=sys.stderr)
        return []
    out = []
    for s in sched:
        t = utc(s["startTimeUTC"])
        if t - timedelta(minutes=30) <= now <= t + timedelta(hours=8):
            f = DATA / "pbp" / f"{s['id']}.json"
            if f.exists():
                try:
                    out.append(json.loads(f.read_text()))
                except Exception as e:
                    print("bad pbp", f, e, file=sys.stderr)
    return out


# ---------- lineup events ----------
def lineup_events(now):
    try:
        d = json.loads((DATA / "lineup.json").read_text())
    except Exception:
        return []
    g = d.get("game") or {}
    if not g.get("id") or not g.get("startTimeUTC"):
        return []
    t = utc(g["startTimeUTC"])
    if not (t - timedelta(hours=14) <= now <= t + timedelta(hours=3)):
        return []
    opp = (g.get("opponent") or {}).get("name", "")
    vs = f"{'vs' if g.get('home') else '@'} {opp}".strip()
    when = t.astimezone(PT).strftime("%-I:%M %p").replace(":00", "") + " PT"
    evs = []
    goalie = d.get("goalie") or {}
    starter = (goalie.get("starter") or {}).get("name")
    if goalie.get("status") == "Confirmed" and starter:
        evs.append({"id": f"{g['id']}:lineup:goalie", "type": "lineup", "title": f"Oilers starting goalie confirmed: {starter}",
                    "body": f"{starter} starts {vs}{'' if now >= t else ', puck drop ' + when}. Lines and pairs on the Players tab.",
                    "url": "/players.html"})
    if d.get("status") == "Confirmed":
        evs.append({"id": f"{g['id']}:lineup:official", "type": "lineup", "title": f"Oilers lineup confirmed {vs}",
                    "body": f"Official dressed lineup is in{(', ' + starter + ' in goal') if starter else ''}. See who's in and who's scratched.",
                    "url": "/players.html"})
    return evs


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--game"
    worker, secret = os.environ.get("WORKER_URL", "").strip(), os.environ.get("NOTIFY_SECRET", "").strip()
    changed = False
    try:
        if not worker or not secret:
            print("Game alerts: WORKER_URL / NOTIFY_SECRET not set, skipping (no-op).")
            return
        now = datetime.now(timezone.utc)
        state = load_state()
        groups = {}
        if mode == "--lineup":
            for ev in lineup_events(now):
                groups.setdefault(ev["id"].split(":")[0], []).append(ev)
        else:
            for g in recent_games(now):
                groups[str(g["id"])] = game_events(g)
        for gid, evs in groups.items():
            gs = state["games"].get(gid)
            first = gs is None
            gs = gs or {"sent": [], "seen": now.isoformat()}
            sent = set(gs["sent"])
            new = [e for e in evs if e["id"] not in sent]
            if first and mode == "--game" and len(new) > 2:
                # Backlog on first sight: send only the newest of each kind, mark the rest as seen.
                keep = {}
                for e in new:
                    keep[e["type"]] = e
                if "period_end" in keep or "final" in keep:
                    keep.pop("puck_drop", None)
                if "final" in keep:
                    keep = {"final": keep["final"]}
                skip = [e for e in new if e not in keep.values()]
                for e in skip:
                    sent.add(e["id"])
                if skip:
                    print(f"game {gid}: first sighting, {len(skip)} older event(s) marked seen without sending")
                    changed = True
                new = list(keep.values())
            for e in new:
                payload = {k: v for k, v in e.items() if k != "order"}
                if post(worker, secret, payload):
                    sent.add(e["id"])
                    changed = True
            gs["sent"], gs["seen"] = sorted(sent), now.isoformat()
            if first:
                changed = True
            state["games"][gid] = gs
        if changed:
            save_state(state)
        print(f"Game alerts ({mode[2:]}): {sum(len(v) for v in groups.values())} event(s) checked, state {'updated' if changed else 'unchanged'}.")
    except Exception as e:  # never break the live pipeline
        print("Game alerts error:", e, file=sys.stderr)
    finally:
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
                fh.write(f"changed={'1' if changed else '0'}\n")


if __name__ == "__main__":
    main()
