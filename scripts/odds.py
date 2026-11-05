"""Betting odds for Oilers games from the NHL's public partner-odds feed (FanDuel in Canada).
Standard library only. Every function fails soft: None / "" when the feed is down or the game isn't listed.
Shown on the site (data/odds.json, js/odds.js) and in alerts, always with RG = "19+ · Play responsibly".
No sportsbook logos and no affiliate/referral links are ever used.
"""
import json, urllib.request

URL = "https://api-web.nhle.com/v1/partner-game/CA/now"
RG = "19+ · Play responsibly"


def fetch(timeout=12):
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": "copperandbluenews"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.load(r)
        return d if isinstance(d.get("games"), list) else None
    except Exception:
        return None


def am(v):
    try:
        v = int(round(float(v)))
    except Exception:
        return None
    return f"+{v}" if v > 0 else str(v)


def edm_game(feed, game_id=None):
    """Parsed odds for the Oilers game (or game_id) in the feed, else None."""
    if not feed:
        return None
    for g in feed.get("games", []):
        h, a = g.get("homeTeam") or {}, g.get("awayTeam") or {}
        if (game_id and g.get("gameId") != game_id) or (not game_id and "EDM" not in (h.get("abbrev"), a.get("abbrev"))):
            continue
        out = {"gameId": g.get("gameId"), "startTimeUTC": g.get("startTimeUTC"),
               "partner": ((feed.get("bettingPartner") or {}).get("name") or "FanDuel"),
               "lastUpdatedUTC": feed.get("lastUpdatedUTC"), "teams": [], "ml": {}, "pl": {}, "total": None}
        over = under = None
        for side, t in (("away", a), ("home", h)):
            ab = t.get("abbrev")
            out["teams"].append({"side": side, "abbrev": ab, "name": (t.get("name") or {}).get("default", ab)})
            for o in t.get("odds") or []:
                d, q, v = o.get("description"), (o.get("qualifier") or "").strip(), am(o.get("value"))
                if v is None:
                    continue
                if d == "MONEY_LINE_2_WAY":
                    out["ml"][ab] = v
                elif d == "PUCK_LINE" and q:
                    out["pl"][ab] = {"line": q, "odds": v}
                elif d == "OVER_UNDER" and q[:1] in "OU" and q[1:]:
                    if q[0] == "O":
                        over = (q[1:], v)
                    else:
                        under = (q[1:], v)
        if over or under:
            out["total"] = {"line": (over or under)[0], "over": over and over[1], "under": under and under[1]}
        if len(out["ml"]) < 2:
            return None  # no usable moneyline: treat as unavailable
        return out
    return None


def _edm_first(o):
    t = sorted(o["teams"], key=lambda t: t["abbrev"] != "EDM")
    return t[0], t[1]


def moneyline(o):
    us, them = _edm_first(o)
    return f"{us['name']} {o['ml'][us['abbrev']]} | {them['name']} {o['ml'][them['abbrev']]}"


def full_line(o):
    """'Oilers -192 | Ducks +158 · Puck line EDM -1.5 (+132) · O/U 6.5 (O -148 / U +120) · via FanDuel'"""
    us, _ = _edm_first(o)
    bits = [moneyline(o)]
    p = o["pl"].get(us["abbrev"])
    if p:
        bits.append(f"Puck line {us['abbrev']} {p['line']} ({p['odds']})")
    t = o.get("total")
    if t and t.get("over") and t.get("under"):
        bits.append(f"O/U {t['line']} (O {t['over']} / U {t['under']})")
    bits.append(f"via {o['partner']}")
    return " · ".join(bits)


def site_json(o, updated):
    return {"updated": updated, "rg": "Odds via " + (o["partner"] if o else "FanDuel") + ". 19+. Please play responsibly.", "game": o}
