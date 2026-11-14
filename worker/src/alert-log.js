// Structured inbox details for a game alert. This does not change the push title, body, url or id.
// gameEvents() stays the source of the notification itself; this only describes it for the log.

const ordinal = n => n + (n % 100 >= 10 && n % 100 <= 20 ? "th" : ({1: "st", 2: "nd", 3: "rd"}[n % 10] || "th"));
const periodLabel = p => !p ? "" : p.periodType === "SO" ? "SO" : p.periodType === "OT" ? (p.number <= 4 ? "OT" : `${p.number - 3}OT`) : ordinal(p.number);

function strength(code, scoringIsHome) {
  if (!/^\d{4}$/.test(code || "")) return "even strength";
  const [ag, ask, hsk, hg] = [...code].map(Number);
  const [us, them, goalie] = scoringIsHome ? [hsk, ask, ag] : [ask, hsk, hg];
  if (goalie === 0) return "empty net";
  if (us > them) return "power play";
  if (us < them) return "shorthanded";
  return "even strength";
}

function rosterMaps(game) {
  const names = {}, lasts = {};
  for (const r of game.rosterSpots || []) {
    const first = r.firstName?.default || "", last = r.lastName?.default || "";
    names[r.playerId] = first ? `${first[0]}. ${last}` : last;
    lasts[r.playerId] = last;
  }
  return {names, lasts};
}

function scoreAt(game, eventId) {
  let as = 0, hs = 0;
  for (const p of game.plays || []) {
    if (p.typeDescKey === "goal" && p.periodDescriptor?.periodType !== "SO") {
      as = p.details?.awayScore ?? as;
      hs = p.details?.homeScore ?? hs;
    }
    if (eventId != null && p.eventId === eventId) break;
  }
  return [as, hs];
}

function goalDetail(game, event) {
  const eventId = Number(String(event.id).split(":").pop());
  const p = (game.plays || []).find(x => x.typeDescKey === "goal" && x.eventId === eventId);
  const a = game.awayTeam || {}, h = game.homeTeam || {};
  if (!p) return {kind: "goal", awayAbbrev: a.abbrev || "", homeAbbrev: h.abbrev || ""};
  const d = p.details || {}, home = d.eventOwnerTeamId === h.id, team = home ? h : a;
  const {names, lasts} = rosterMaps(game);
  const aids = [d.assist1PlayerId, d.assist2PlayerId].filter(Boolean);
  const last = aids.map(id => lasts[id] || "");
  const assists = (new Set(last).size < last.length ? aids.map(id => names[id] || "") : last).filter(Boolean);
  const [as, hs] = [d.awayScore, d.homeScore].every(n => n != null) ? [d.awayScore, d.homeScore] : scoreAt(game, p.eventId);
  return {
    kind: "goal",
    team: team.abbrev || "",
    scorer: names[d.scoringPlayerId] || "",
    scorerId: d.scoringPlayerId || null,
    scorerTotal: d.scoringPlayerTotal || null,
    assists,
    time: String(p.timeInPeriod || "").replace(/^0/, "") || "0:00",
    period: periodLabel(p.periodDescriptor),
    strength: strength(p.situationCode, home),
    awayAbbrev: a.abbrev || "",
    homeAbbrev: h.abbrev || "",
    awayScore: as,
    homeScore: hs,
  };
}

function shotsLine(game) {
  const a = game.awayTeam || {}, h = game.homeTeam || {};
  const edmHome = h.abbrev === "EDM";
  const us = edmHome ? h : a, them = edmHome ? a : h;
  return `${us.abbrev || ""} ${us.sog || 0}, ${them.abbrev || ""} ${them.sog || 0}`;
}

export function describeAlert(game, event) {
  const a = game?.awayTeam || {}, h = game?.homeTeam || {};
  const an = a.commonName?.default || a.abbrev || "", hn = h.commonName?.default || h.abbrev || "";
  const meta = {
    game: game?.id != null ? String(game.id) : "",
    matchup: an && hn ? `${an} @ ${hn}` : "",
    away: a.abbrev || "",
    home: h.abbrev || "",
    detail: null,
  };
  if (!event) return meta;
  if (event.type === "goal") meta.detail = goalDetail(game, event);
  else if (event.type === "puck_drop") meta.detail = {kind: "puck_drop", venue: game.venue?.default || ""};
  else if (event.type === "pregame_60" || event.type === "pregame_15") {
    const venue = game.venue?.default || (typeof game.venue === "string" ? game.venue : "");
    meta.detail = {kind: event.type, venue, when: event.when || "", starter: event.starter || "", starterStatus: event.starterStatus || "", matchup: event.abbrev || ""};
  }
  else if (event.type === "period_end") {
    const n = Number(String(event.id).split(":").pop());
    const p = (game.plays || []).find(x => x.typeDescKey === "period-end" && x.periodDescriptor?.number === n);
    const [as, hs] = scoreAt(game, p?.eventId);
    meta.detail = {kind: "period_end", period: periodLabel(p?.periodDescriptor), awayAbbrev: a.abbrev || "", homeAbbrev: h.abbrev || "", awayScore: as, homeScore: hs, shots: shotsLine(game)};
  } else if (event.type === "close_game") {
    const [as, hs] = event.awayScore != null && event.homeScore != null ? [event.awayScore, event.homeScore] : scoreAt(game);
    meta.detail = {kind: "close_game", timeRemaining: event.timeRemaining || "", period: "3rd", tied: !!event.tied,
      awayAbbrev: a.abbrev || "", homeAbbrev: h.abbrev || "", awayScore: as, homeScore: hs};
  } else if (event.type === "special_teams") {
    meta.detail = {kind: event.kind || "power_play", team: event.team || "", player: event.player || "",
      number: event.number ?? null, infraction: event.infraction || "", duration: event.duration ?? null,
      time: event.time || "", period: event.period || "", fiveOnThree: !!event.fiveOnThree,
      awayAbbrev: a.abbrev || "", homeAbbrev: h.abbrev || ""};
  } else if (event.type === "final") {
    const as = a.score, hs = h.score;
    const edmHome = h.abbrev === "EDM";
    const us = edmHome ? hs : as, them = edmHome ? as : hs;
    const extra = ["OT", "SO"].includes(game.gameOutcome?.lastPeriodType) ? game.gameOutcome.lastPeriodType : "";
    meta.detail = {kind: "final", result: us > them ? "Oilers win" : us < them ? "Oilers fall" : "Final", extra, awayAbbrev: a.abbrev || "", homeAbbrev: h.abbrev || "", awayScore: as, homeScore: hs};
  }
  return meta;
}

export function entryFromPending(row, id) {
  const p = row?.payload || {};
  const meta = row?.log || {};
  const alertId = p.id || id;
  if (!alertId) return null;
  return {
    id: alertId,
    type: p.type,
    title: p.title,
    body: p.body,
    url: p.url,
    at: new Date(row?.at || Date.now()).toISOString(),
    game: meta.game || null,
    matchup: meta.matchup || "",
    away: meta.away || "",
    home: meta.home || "",
    detail: meta.detail || null,
  };
}
