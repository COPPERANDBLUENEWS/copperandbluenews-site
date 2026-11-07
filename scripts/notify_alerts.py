#!/usr/bin/env python3
"""Game alerts (web push) hook for the live pipeline. Standard library only.

Detects NEW Oilers game events since the previous run and POSTs each one to the
Cloudflare Worker (worker/, see worker/README.md):  POST $WORKER_URL/notify
  Authorization: Bearer $NOTIFY_SECRET
  {"id": "<event id>", "type": "puck_drop|goal|period_end|final|lineup", "title", "body", "url"}

  --game    DRY-RUN ONLY after the Worker cutover; real sends disabled. Reads data/schedule.json + data/pbp/<id>.json:
            puck drop, each goal (both teams; scorer, assists, score), each period end (score
            after the period), final score. Shootout attempts are not sent; the final covers it.
  --lineup  (live.yml / lineup.yml, after update_lineup.py) reads data/lineup.json:
            starting goalie confirmed (pre-game) and official dressed lineup confirmed.
  --pregame (live.yml every run, lineup.yml): "odds" alert 20-75 min before puck drop (aim ~60 min) with
            moneyline, puck line and over/under from the NHL partner feed (FanDuel CA). Opt-in type.
  --morning (lineup.yml 16:00 UTC = 9 AM PT, news.yml :41 as backup): "gameday" alert between 8:50 and
            11:30 AM PT on game days: matchup, time, records, likely goalie, McDavid line, moneyline.
  Odds (scripts/odds.py) are optional everywhere: if the feed fails or the game isn't listed, the odds
  part is skipped silently. Every odds text carries "19+ · Play responsibly". No sportsbook links.
  The puck-drop alert gets a short moneyline for everyone when odds are available. If the feed is seen
  updating during the game (listed after puck drop with a changed moneyline), period-end alerts carry the
  current moneyline for odds subscribers only (Worker "alt" body).
  Test flags: --dry-run (print payloads, send nothing, keep state), --now <ISO time> (pretend clock),
  --to <subscriber id> (send only to that subscriber; state is not saved).

No-op (exit 0, nothing sent) if WORKER_URL or NOTIFY_SECRET is missing.
No duplicates: every event has a stable id (<gameId>:goal:<eventId> etc). Ids that were sent
are kept in $ALERTS_STATE (default ~/.cbn-alerts/sent.json, carried between Actions runs with
actions/cache), and the Worker also refuses an id it has already fanned out (KV evt:<id>),
so a lost cache can't cause repeats. Only games that started in the last 8 h are considered.
On a game's first sighting with a backlog (e.g. secrets added mid-game) only the newest event
of each kind is sent and the rest are marked as seen. Always exits 0 so the pipeline keeps going.
Prints changed=1|0 to $GITHUB_OUTPUT (1 = state file changed, save the cache).
"""
import json, os, pathlib, sys, urllib.request, urllib.error
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import odds as O
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
STATE = pathlib.Path(os.environ.get("ALERTS_STATE") or pathlib.Path.home() / ".cbn-alerts" / "sent.json")
PT, MT = ZoneInfo("America/Vancouver"), ZoneInfo("America/Edmonton")
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
        og = ((d.get("opponent") or {}).get("goalie") or {})
        on = (og.get("starter") or {}).get("name")
        other = ""
        if on:
            other = f" {on} {'is confirmed' if og.get('status') == 'Confirmed' else 'is expected'} for the {opp or 'other side'}."
        evs.append({"id": f"{g['id']}:lineup:goalie", "type": "lineup", "title": f"Confirmed starter: {starter} in goal for the Oilers",
                    "body": f"{starter} starts {vs}{'' if now >= t else ', puck drop ' + when}.{other} Lines and pairs on the Players tab.",
                    "url": "/players.html"})
    if d.get("status") == "Confirmed":
        evs.append({"id": f"{g['id']}:lineup:official", "type": "lineup", "title": f"Oilers lineup confirmed {vs}",
                    "body": f"Official dressed lineup is in{(', ' + starter + ' in goal') if starter else ''}. See who's in and who's scratched.",
                    "url": "/players.html"})
    return evs


def load_json(path, default=None):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def schedule():
    return (load_json(DATA / "schedule.json", {}) or {}).get("games", [])


def fmt_time(t, tz, label):
    return t.astimezone(tz).strftime("%-I:%M %p").replace(":00", "") + f" {label}"


class OddsCache:
    """One feed fetch per run, only when something needs it."""
    def __init__(self):
        self.feed, self.done = None, False

    def get(self, gid):
        if not self.done:
            self.feed, self.done = O.fetch(), True
        return O.edm_game(self.feed, int(gid))


def matchup_names(s):
    return f"{s['away']['name']} @ {s['home']['name']}"


def pregame_events(now, oc, state):
    evs = []
    for s in schedule():
        t = utc(s["startTimeUTC"])
        if s.get("state") in FINAL or not (timedelta(minutes=20) <= t - now <= timedelta(minutes=75)):
            continue
        o = oc.get(s["id"])
        if not o:
            print(f"pregame {s['id']}: no odds listed, skipping")
            continue
        state["games"].setdefault(str(s["id"]), {"sent": [], "seen": now.isoformat()})["odds0"] = O.moneyline(o)
        evs.append({"id": f"{s['id']}:odds:pregame", "type": "odds",
                    "title": f"Odds: {matchup_names(s)}, {fmt_time(t, PT, 'PT')}",
                    "body": f"{O.full_line(o)} · {O.RG}", "url": "/tracker.html"})
    return evs


def standings_records():
    try:
        req = urllib.request.Request("https://api-web.nhle.com/v1/standings/now", headers={"User-Agent": "copperandbluenews"})
        with urllib.request.urlopen(req, timeout=15) as r:
            st = json.load(r)["standings"]
        return {x["teamAbbrev"]["default"]: f"{x['wins']}-{x['losses']}-{x['otLosses']}" for x in st}
    except Exception:
        return {}


def morning_events(now, oc):
    local = now.astimezone(PT)
    if not (local.replace(hour=8, minute=50, second=0) <= local <= local.replace(hour=11, minute=30, second=0)):
        return []
    evs = []
    for s in schedule():
        t = utc(s["startTimeUTC"])
        if t.astimezone(PT).date() != local.date() or s.get("state") in FINAL or s.get("scheduleState", "OK") != "OK":
            continue
        rec = standings_records()
        us, them = (s["home"], s["away"]) if s["home"]["abbrev"] == EDM else (s["away"], s["home"])
        bits = []
        if rec.get(us["abbrev"]) and rec.get(them["abbrev"]):
            bits.append(f"{us['name']} {rec[us['abbrev']]} · {them['name']} {rec[them['abbrev']]}.")
        lu = load_json(DATA / "lineup.json", {}) or {}
        gl = lu.get("goalie") or {}
        if (lu.get("game") or {}).get("id") == s["id"] and (gl.get("starter") or {}).get("name"):
            word = "Confirmed" if gl.get("status") == "Confirmed" else "Likely"
            bits.append(f"{word} in goal: {gl['starter']['name']}.")
        st = load_json(DATA / "stats.json", {}) or {}
        mc = next((p for p in st.get("skaters", []) if p.get("id") == 8478402), None)
        if mc:
            bits.append(f"McDavid: {mc['g']} G, {mc['a']} A in {mc['gp']} GP.")
        o = oc.get(s["id"])
        if o:
            bits.append(f"Moneyline: {O.moneyline(o)} ({o['partner']}) · {O.RG}")
        venue = f" at {s['venue']}" if s.get("venue") else ""
        evs.append({"id": f"{s['id']}:gameday", "type": "gameday",
                    "title": f"GAME DAY: {matchup_names(s)} tonight, {fmt_time(t, MT, 'MT')} / {fmt_time(t, PT, 'PT')}{venue}",
                    "body": " ".join(bits) or "Game day! Follow it live on the rink tracker.", "url": "/tracker.html"})
    return evs


def add_odds(evs, gid, gs, oc, now):
    """Puck drop: moneyline for everyone. Period ends: live moneyline for odds subscribers, only if the feed updates in-game."""
    sent = set(gs.get("sent", []))
    for e in evs:
        if e["id"] in sent:
            continue
        if e["type"] == "puck_drop":
            o = oc.get(gid)
            if o:
                gs["odds0"] = O.moneyline(o)  # closing line at puck drop: later changes mean live in-game odds
                e["body"] += f" Odds: {O.moneyline(o)} ({o['partner']}) · {O.RG}"
        elif e["type"] == "period_end":
            o = oc.get(gid)
            if not o:
                continue
            started = o.get("startTimeUTC") and o.get("lastUpdatedUTC") and utc(o["lastUpdatedUTC"]) > utc(o["startTimeUTC"])
            if started and gs.get("odds0") and O.moneyline(o) != gs["odds0"]:
                gs["odds_live"] = True
            if gs.get("odds_live"):
                e["alt"] = {"pref": "odds", "body": f"{e['body']} Live moneyline: {O.moneyline(o)} ({o['partner']}) · {O.RG}"}


def main():
    args = sys.argv[1:]
    modes = [a for a in args if a in ("--game", "--lineup", "--pregame", "--morning")] or ["--game"]
    dry = "--dry-run" in args
    to = args[args.index("--to") + 1] if "--to" in args else None
    worker, secret = os.environ.get("WORKER_URL", "").strip(), os.environ.get("NOTIFY_SECRET", "").strip()
    changed = False
    try:
        if not dry and (not worker or not secret):
            print("Game alerts: WORKER_URL / NOTIFY_SECRET not set, skipping (no-op).")
            return
        now = utc(args[args.index("--now") + 1]) if "--now" in args else datetime.now(timezone.utc)
        state = load_state()
        sig = lambda st: json.dumps({k: {a: b for a, b in v.items() if a != "seen"} for k, v in st["games"].items()}, sort_keys=True)
        before = sig(state)
        oc = OddsCache()
        for mode in modes:
            if mode == "--game" and not dry:
                print("Game alerts (--game): Worker is the sole producer; legacy sends disabled.")
                continue
            groups = {}
            if mode == "--lineup":
                evlist = lineup_events(now)
            elif mode == "--pregame":
                evlist = pregame_events(now, oc, state)
            elif mode == "--morning":
                evlist = morning_events(now, oc)
            else:
                evlist = None
                for g in recent_games(now):
                    groups[str(g["id"])] = game_events(g)
            for ev in evlist or []:
                groups.setdefault(ev["id"].split(":")[0], []).append(ev)
            for gid, evs in groups.items():
                gs = state["games"].get(gid)
                first = gs is None
                gs = gs or {"sent": [], "seen": now.isoformat()}
                if mode == "--game":
                    add_odds(evs, gid, gs, oc, now)
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
                    if to:
                        payload["to"] = to
                        payload.pop("id", None)  # a test must not consume the real event id in the Worker
                    if dry:
                        print("DRY RUN payload:", json.dumps(payload, ensure_ascii=False))
                        continue
                    if post(worker, secret, payload):
                        if not to:
                            sent.add(e["id"])
                            changed = True
                gs["sent"], gs["seen"] = sorted(sent), now.isoformat()
                if first:
                    changed = True
                state["games"][gid] = gs
            print(f"Game alerts ({mode[2:]}): {sum(len(v) for v in groups.values())} event(s) checked.")
        if dry or to:
            changed = False
        elif changed or sig(state) != before:
            save_state(state)
            changed = True
    except Exception as e:  # never break the live pipeline
        print("Game alerts error:", e, file=sys.stderr)
    finally:
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
                fh.write(f"changed={'1' if changed else '0'}\n")


if __name__ == "__main__":
    main()
