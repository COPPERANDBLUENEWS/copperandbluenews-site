// Public read-only NHL relay. No push sends or subscriber data on these routes.
const API = "https://api-web.nhle.com/v1";
const TTL = 2;
const fields = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj?.[k] ?? null]));
const TEAM = ["id", "abbrev", "score", "sog", "commonName", "placeName"];
const GAME = ["id", "season", "gameType", "gameDate", "venue", "startTimeUTC", "gameState",
  "gameScheduleState", "periodDescriptor", "clock", "gameOutcome", "regPeriods"];
const ROSTER = ["teamId", "playerId", "firstName", "lastName", "sweaterNumber", "positionCode"];
export class LiveError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function nhl(path) {
  const r = await fetch(`${API}/${path}`, {headers: {"User-Agent": "copperandbluenews"},
    signal: AbortSignal.timeout(8000), cf: {cacheTtl: 0, cacheEverything: false}});
  if (!r.ok) throw new LiveError(502, "NHL feed unavailable");
  return r.json();
}

// Match scripts/update_data.py:pbp exactly, including explicit nulls for absent keys.
export function slimPbp(d) {
  return {...fields(d, GAME), awayTeam: fields(d.awayTeam, TEAM), homeTeam: fields(d.homeTeam, TEAM),
    plays: (d.plays || []).map(x => {
      const p = {...x}; delete p.pptReplayUrl;
      if (p.details) p.details = Object.fromEntries(Object.entries(p.details)
        .filter(([k]) => !k.startsWith("highlightClip") && !k.startsWith("discreteClip")));
      return p;
    }), rosterSpots: (d.rosterSpots || []).map(r => fields(r, ROSTER)),
    fetched: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00")};
}

async function cached(url, ctx, load) {
  // Canonical keys exclude Origin and arbitrary query parameters. Add CORS only after lookup.
  const key = new Request(url), cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const value = await load();
  const response = new Response(JSON.stringify(value), {headers: {
    "Content-Type": "application/json", "Cache-Control": `public, max-age=${TTL}`}});
  ctx.waitUntil(cache.put(key, response));
  return value;
}

export function pbp(id, origin, ctx) {
  if (!/^\d{10}$/.test(id)) throw new LiveError(400, "numeric 10-digit game id required");
  return cached(`${origin}/live/pbp?id=${id}`, ctx, async () => {
    const d = await nhl(`gamecenter/${id}/play-by-play`);
    if (String(d.id) !== id || !d.awayTeam || !d.homeTeam || !Array.isArray(d.plays))
      throw new LiveError(502, "Invalid NHL feed");
    return slimPbp(d);
  });
}

const side = t => ({abbrev: t.abbrev, name: t.commonName?.default || t.abbrev,
  place: t.placeName?.default || "", score: t.score ?? null, sog: t.sog ?? null});
export function scoreGame(p) {
  return {id: p.id, gameType: p.gameType, startTimeUTC: p.startTimeUTC,
    venue: p.venue?.default || "", state: p.gameState, scheduleState: p.gameScheduleState,
    lastPeriod: p.gameOutcome?.lastPeriodType ?? null, period: p.periodDescriptor, clock: p.clock,
    away: side(p.awayTeam), home: side(p.homeTeam)};
}
export async function now(origin, ctx) {
  return cached(`${origin}/live/now`, ctx, async () => {
    const date = new Date(), year = date.getUTCFullYear() - (date.getUTCMonth() < 6 ? 1 : 0);
    const d = await nhl(`club-schedule-season/EDM/${year}${year + 1}`), time = Date.now();
    if (!Array.isArray(d.games)) throw new LiveError(502, "Invalid NHL schedule");
    const games = d.games.filter(g => g.gameScheduleState === "OK");
    const game = games.find(g => ["LIVE", "CRIT"].includes(g.gameState)) || games.find(g =>
      !["OFF", "FINAL"].includes(g.gameState) && time >= Date.parse(g.startTimeUTC) - 90 * 60000 &&
      time <= Date.parse(g.startTimeUTC) + 5 * 3600000) || games.filter(g =>
      ["OFF", "FINAL"].includes(g.gameState) && time >= Date.parse(g.startTimeUTC) &&
      time - Date.parse(g.startTimeUTC) < 8 * 3600000).sort((a, b) => b.id - a.id)[0];
    if (!game) return {updated: new Date().toISOString(), game: null};
    // Do not nest the PBP cache here: two independent 2s caches could compound staleness.
    const raw = await nhl(`gamecenter/${game.id}/play-by-play`);
    if (raw.id !== game.id || !raw.awayTeam || !raw.homeTeam || !Array.isArray(raw.plays))
      throw new LiveError(502, "Invalid NHL feed");
    const p = slimPbp(raw);
    const names = Object.fromEntries(p.rosterSpots.map(r => [r.playerId,
      `${r.firstName?.default || ""} ${r.lastName?.default || ""}`.trim()]));
    const goals = p.plays.filter(x => x.typeDescKey === "goal").map(x => ({
      team: x.details?.eventOwnerTeamId === p.homeTeam.id ? p.homeTeam.abbrev : p.awayTeam.abbrev,
      name: names[x.details?.scoringPlayerId] || "Goal", period: x.periodDescriptor, time: x.timeInPeriod}));
    return {updated: p.fetched, game: scoreGame(p), goals};
  });
}
