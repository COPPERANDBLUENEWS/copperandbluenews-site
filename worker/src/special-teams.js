// Power play / penalty kill pushes from NHL penalty events. One alert per penalty that
// actually changes strength. Offsetting / coincidental penalties that leave strength even
// are silent. Misconducts and penalty shots do not affect on-ice strength.

export const SPECIAL_TEAMS_TYPE = "special_teams";

const STRENGTH = new Set(["MIN", "BEN", "MAJ"]);
const IGNORE = new Set(["MIS", "GAM", "PS", "PSH"]);
const INFRACTIONS = {
  "too-many-men-on-the-ice": "too many men",
  "delaying-game-puck-over-glass": "puck over glass",
  "high-sticking-double-minor": "high-sticking",
  "interference-goalkeeper": "goaltender interference",
  "unsportsmanlike-conduct-bench": "unsportsmanlike conduct",
  "holding-the-stick": "holding the stick",
};

const ordinal = n => n + (n % 100 >= 10 && n % 100 <= 20 ? "th" : ({1: "st", 2: "nd", 3: "rd"}[n % 10] || "th"));
const periodLabel = p => !p ? "" : p.periodType === "SO" ? "SO" : p.periodType === "OT" ? (p.number <= 4 ? "OT" : `${p.number - 3}OT`) : ordinal(p.number);

function affectsStrength(p) {
  const d = p.details || {};
  const t = d.typeCode;
  if (t && IGNORE.has(t)) return false;
  if (t && STRENGTH.has(t)) return true;
  const dur = Number(d.duration);
  return dur === 2 || dur === 4 || dur === 5;
}

function parseSit(code) {
  if (!/^\d{4}$/.test(code || "")) return null;
  const [ag, as, hs, hg] = [...code].map(Number);
  return {ag, as, hs, hg};
}

function rosterMaps(g) {
  const last = {}, num = {};
  for (const r of g.rosterSpots || []) {
    last[r.playerId] = r.lastName?.default || "";
    if (r.sweaterNumber != null) num[r.playerId] = r.sweaterNumber;
  }
  return {last, num};
}

function infraction(desc) {
  if (INFRACTIONS[desc]) return INFRACTIONS[desc];
  return String(desc || "penalty").replace(/-/g, " ");
}

function who(team, d, maps) {
  const pid = d.committedByPlayerId || d.servedByPlayerId;
  const n = maps.num[pid], name = maps.last[pid];
  const bits = [n != null ? `#${n}` : "", name].filter(Boolean).join(" ");
  return bits ? `${team.abbrev} ${bits}` : `${team.abbrev} bench`;
}

function clusterKey(p) {
  const pd = p.periodDescriptor || {};
  return `${pd.number || 0}:${pd.periodType || ""}:${p.timeInPeriod || ""}`;
}

function penaltyClusters(plays) {
  const map = new Map(), order = [];
  for (const p of plays || []) {
    if (p.typeDescKey !== "penalty") continue;
    if (p.periodDescriptor?.periodType === "SO") continue;
    const key = clusterKey(p);
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    map.get(key).push(p);
  }
  return order.map(k => map.get(k));
}

// Pair equal-duration strength penalties on opposite teams (coincidental minors/majors).
export function netPenalties(cluster, homeId, awayId) {
  const home = [], away = [];
  for (const p of cluster) {
    if (!affectsStrength(p)) continue;
    const id = p.details?.eventOwnerTeamId;
    if (id === homeId) home.push(p);
    else if (id === awayId) away.push(p);
  }
  const usedH = new Set(), usedA = new Set();
  for (let i = 0; i < home.length; i++) {
    for (let j = 0; j < away.length; j++) {
      if (usedH.has(i) || usedA.has(j)) continue;
      if (Number(home[i].details?.duration) === Number(away[j].details?.duration)) {
        usedH.add(i); usedA.add(j);
      }
    }
  }
  return [...home.filter((_, i) => !usedH.has(i)), ...away.filter((_, j) => !usedA.has(j))];
}

function apply(sit, remaining, homeId, awayId) {
  if (!sit) return null;
  const next = {...sit};
  for (const p of remaining) {
    const id = p.details?.eventOwnerTeamId;
    if (id === homeId && next.hs > 3) next.hs--;
    else if (id === awayId && next.as > 3) next.as--;
  }
  return next;
}

function advantage(sit, edmHome) {
  if (!sit) return 0;
  const us = edmHome ? sit.hs : sit.as, them = edmHome ? sit.as : sit.hs;
  return us - them;
}

export function specialTeamsEvents(g) {
  const gid = g?.id, a = g?.awayTeam, h = g?.homeTeam;
  if (!gid || !a || !h) return [];
  const edmHome = h.abbrev === "EDM";
  const maps = rosterMaps(g);
  const plays = g.plays || [];
  const last = plays[plays.length - 1];
  // A scrum's penalties share a timestamp but arrive one play at a time. Hold the tail
  // cluster until a later play (or the final) proves the stoppage is complete, so
  // coincidental minors are not alerted and then contradicted on the next poll.
  const lastKey = last && last.typeDescKey === "penalty" ? clusterKey(last) : null;
  const gameOver = ["OFF", "FINAL"].includes(g.gameState) || plays.some(p => p.typeDescKey === "game-end");
  const evs = [];
  for (const cluster of penaltyClusters(plays)) {
    if (!gameOver && lastKey && clusterKey(cluster[0]) === lastKey) continue;
    const remaining = netPenalties(cluster, h.id, a.id);
    if (!remaining.length) continue;
    const sit0 = parseSit(cluster[0].situationCode);
    const sit = apply(sit0, remaining, h.id, a.id);
    const adv = advantage(sit, edmHome);
    for (const p of remaining) {
      const d = p.details || {}, pd = p.periodDescriptor || {};
      const oppCall = d.eventOwnerTeamId !== (edmHome ? h.id : a.id);
      const team = d.eventOwnerTeamId === h.id ? h : a;
      const dur = Number(d.duration) || 2;
      const time = String(p.timeInPeriod || "").replace(/^0/, "") || "0:00";
      const period = periodLabel(pd);
      const whoLine = who(team, d, maps);
      const detail = `${whoLine}, ${dur} min ${infraction(d.descKey)}, ${time} ${period}`.trim();
      const fiveOnThree = Math.abs(adv) >= 2;
      const kind = oppCall ? "power_play" : "penalty_kill";
      const title = oppCall
        ? (fiveOnThree ? "Oilers 5-on-3" : "Oilers power play")
        : (fiveOnThree ? "Penalty kill (3-on-5)" : "Penalty kill");
      evs.push({
        id: `${gid}:penalty:${p.eventId}`,
        type: SPECIAL_TEAMS_TYPE,
        title,
        body: `${oppCall ? "Power play" : "Penalty kill"}: ${detail}`,
        url: `/tracker.html?id=${gid}`,
        kind,
        team: team.abbrev || "",
        player: maps.last[d.committedByPlayerId || d.servedByPlayerId] || "",
        number: maps.num[d.committedByPlayerId || d.servedByPlayerId] ?? null,
        infraction: infraction(d.descKey),
        duration: dur,
        time,
        period,
        fiveOnThree,
      });
    }
  }
  return evs;
}
