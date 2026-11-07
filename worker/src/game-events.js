// Exact port of scripts/notify_alerts.py game_events/add_odds. Stable IDs survive scorer edits/reversals.
export const GAME_TYPES = ["puck_drop", "goal", "period_end", "final"];
const FINAL = ["OFF", "FINAL"], LIVE = ["LIVE", "CRIT"];
const ordinal = n => n + (n % 100 >= 10 && n % 100 <= 20 ? "th" : ({1:"st", 2:"nd", 3:"rd"}[n % 10] || "th"));
const pname = p => !p ? "" : p.periodType === "SO" ? "SO" : p.periodType === "OT" ? (p.number <= 4 ? "OT" : `${p.number - 3}OT`) : ordinal(p.number);
function strength(s, home) {
  if (!/^\d{4}$/.test(s || "")) return "";
  const [ag, a, h, hg] = [...s].map(Number), [us, them, goalie] = home ? [h, a, ag] : [a, h, hg];
  return goalie === 0 ? "empty net" : us > them ? "power play" : us < them ? "shorthanded" : "";
}
export function gameEvents(g) {
  const gid = g.id, a = g.awayTeam, h = g.homeTeam, edmHome = h.abbrev === "EDM";
  const name = t => t.commonName?.default || t.abbrev, opp = edmHome ? a : h;
  const names = Object.fromEntries((g.rosterSpots || []).map(r => [r.playerId, `${r.firstName.default[0]}. ${r.lastName.default}`]));
  const lasts = Object.fromEntries((g.rosterSpots || []).map(r => [r.playerId, r.lastName.default]));
  const sl = (as, hs) => edmHome ? `${h.abbrev} ${hs}, ${a.abbrev} ${as}` : `${a.abbrev} ${as}, ${h.abbrev} ${hs}`;
  const vs = `Oilers ${edmHome ? "vs" : "@"} ${name(opp)}`, plays = g.plays || [], evs = [];
  if ([...LIVE, ...FINAL].includes(g.gameState) || plays.some(p => p.typeDescKey === "period-start"))
    evs.push({id: `${gid}:puck_drop`, type: "puck_drop", title: `Puck drop: ${name(a)} @ ${name(h)}`,
      body: `${vs} is underway${g.venue ? " at " + g.venue.default : ""}. Follow it live on the rink tracker.`, url: "/tracker.html"});
  let as = 0, hs = 0;
  for (const p of plays) {
    const pd = p.periodDescriptor || {}, d = p.details || {};
    if (p.typeDescKey === "goal" && pd.periodType !== "SO") {
      as = d.awayScore ?? as; hs = d.homeScore ?? hs;
      const home = d.eventOwnerTeamId === h.id, team = home ? h : a;
      let who = names[d.scoringPlayerId] || "Unknown";
      if (d.scoringPlayerTotal) who += ` (${d.scoringPlayerTotal})`;
      const aids = [d.assist1PlayerId, d.assist2PlayerId].filter(Boolean), last = aids.map(id => lasts[id] || "");
      const assists = new Set(last).size < last.length ? aids.map(id => names[id] || "") : last;
      const bits = [who + (assists.length ? ` from ${assists.filter(Boolean).join(", ")}` : ", unassisted"),
        `${pname(pd)} ${(p.timeInPeriod || "").replace(/^0/, "") || "0:00"}`.trim()];
      const st = strength(p.situationCode, home); if (st) bits.push(st);
      evs.push({id: `${gid}:goal:${p.eventId}`, type: "goal", title: team.abbrev === "EDM" ? `🚨 OILERS GOAL! ${sl(as, hs)}` : `${name(team)} goal. ${sl(as, hs)}`,
        body: bits.join(" · "), url: "/tracker.html", order: p.sortOrder || 0});
    } else if (p.typeDescKey === "period-end" && pd.periodType !== "SO") {
      const [us, them] = edmHome ? [h, a] : [a, h];
      evs.push({id: `${gid}:period_end:${pd.number}`, type: "period_end", title: `End of ${pname(pd)}: ${sl(as, hs)}`,
        body: `${vs} · Shots: ${us.abbrev} ${us.sog || 0}, ${them.abbrev} ${them.sog || 0}.`, url: "/tracker.html"});
    }
  }
  if (FINAL.includes(g.gameState) || plays.some(p => p.typeDescKey === "game-end")) {
    const aScore = Object.hasOwn(a, "score") ? a.score : as, hScore = Object.hasOwn(h, "score") ? h.score : hs;
    const [us, them] = edmHome ? [hScore, aScore] : [aScore, hScore], lp = g.gameOutcome?.lastPeriodType;
    const extra = ["OT", "SO"].includes(lp) ? ` (${lp})` : "";
    evs.push({id: `${gid}:final`, type: "final", title: `FINAL${extra}: ${sl(aScore, hScore)}`,
      body: `${us > them ? "Oilers win" : "Oilers fall"} ${us}-${them}${extra} ${edmHome ? "vs" : "at"} the ${name(opp)}. Box score and every goal on the site.`,
      url: `/game.html?id=${gid}`});
  }
  return evs;
}
const RG = "19+ · Play responsibly";
function am(x) {
  const n = Number(x); if (!Number.isFinite(n) || x == null || x === "") return null;
  const floor = Math.floor(n), frac = n - floor;
  const v = frac === .5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(n); // Python round: ties to even
  return v > 0 ? `+${v}` : String(v);
}
export function oddsGame(feed, gid) {
  for (const g of feed?.games || []) {
    if (g.gameId !== +gid) continue;
    const out = {startTimeUTC: g.startTimeUTC, lastUpdatedUTC: feed.lastUpdatedUTC,
      partner: feed.bettingPartner?.name || "FanDuel", teams: [], ml: {}};
    for (const t of [g.awayTeam || {}, g.homeTeam || {}]) {
      out.teams.push({abbrev: t.abbrev, name: t.name?.default || t.abbrev});
      for (const o of t.odds || []) {
        const v = am(o.value); if (v !== null && o.description === "MONEY_LINE_2_WAY") out.ml[t.abbrev] = v;
      }
    }
    return Object.keys(out.ml).length < 2 ? null : out;
  }
  return null;
}
const moneyline = o => [...o.teams].sort((a, b) => Number(a.abbrev !== "EDM") - Number(b.abbrev !== "EDM"))
  .map(t => `${t.name} ${o.ml[t.abbrev]}`).join(" | ");
export function addOdds(events, state, odds) {
  if (!odds) return;
  const ml = moneyline(odds);
  for (const e of events) {
    if (e.type === "puck_drop") {
      state.odds0 = ml; e.body += ` Odds: ${ml} (${odds.partner}) · ${RG}`;
    } else if (e.type === "period_end") {
      if (Date.parse(odds.lastUpdatedUTC) > Date.parse(odds.startTimeUTC) && state.odds0 && ml !== state.odds0) state.odds_live = true;
      if (state.odds_live) e.alt = {pref: "odds", body: `${e.body} Live moneyline: ${ml} (${odds.partner}) · ${RG}`};
    }
  }
}
