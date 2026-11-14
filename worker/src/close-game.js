// One close-game push per Oilers game: 3rd period, regulation, <= 5:00 left, tied or one goal.
// Clock comes from the NHL play-by-play `clock` + `periodDescriptor` on each poll.

const LIVE = ["LIVE", "CRIT"];

export const CLOSE_GAME_TYPE = "close_game";

export function parseClock(t) {
  const m = String(t || "").trim().match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatClock(secs) {
  if (!Number.isFinite(secs) || secs < 0) return "";
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function runningScore(g) {
  let as = 0, hs = 0;
  for (const p of g?.plays || []) {
    if (p.typeDescKey === "goal" && p.periodDescriptor?.periodType !== "SO") {
      as = p.details?.awayScore ?? as;
      hs = p.details?.homeScore ?? hs;
    }
  }
  return [as, hs];
}

export function closeGameEvent(g) {
  if (!g || !LIVE.includes(g.gameState)) return null;
  const clock = g.clock || {};
  if (clock.inIntermission) return null;
  const pd = g.periodDescriptor || {};
  if (pd.number !== 3 || pd.periodType !== "REG") return null;
  const secs = Number.isFinite(+clock.secondsRemaining) ? +clock.secondsRemaining : parseClock(clock.timeRemaining);
  if (!Number.isFinite(secs) || secs > 300 || secs < 0) return null;
  const [as, hs] = runningScore(g);
  if (Math.abs(as - hs) > 1) return null;
  const a = g.awayTeam || {}, h = g.homeTeam || {};
  const opp = h.abbrev === "EDM" ? a : h;
  const edm = h.abbrev === "EDM" ? hs : as;
  const them = h.abbrev === "EDM" ? as : hs;
  const left = formatClock(secs);
  const tied = as === hs;
  const title = tied
    ? `Tied ${as}-${hs} with ${left} left in the 3rd`
    : `Close game alert: EDM ${edm}-${them} ${opp.abbrev || ""}, ${left} left in the 3rd`;
  const vs = h.abbrev === "EDM"
    ? `Oilers vs ${a.commonName?.default || a.abbrev || "the opponent"}`
    : `Oilers @ ${h.commonName?.default || h.abbrev || "the opponent"}`;
  return {
    id: `${g.id}:close_game`,
    type: CLOSE_GAME_TYPE,
    title,
    body: `${vs} · Follow it live on the rink tracker.`,
    url: `/tracker.html?id=${g.id}`,
    timeRemaining: left,
    awayScore: as,
    homeScore: hs,
    tied,
  };
}
