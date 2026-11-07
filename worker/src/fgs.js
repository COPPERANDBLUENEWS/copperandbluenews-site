// First-goal poll: who scores the Oilers' first goal?
//   POST /fgs  {game, voter, player}   (browser, CORS) one pick per device per game; can change it until puck drop
//   GET  /fgs?game=ID                  crowd totals (edge-cached) and, once it happens, the Oilers' first goal
// Storage matches Pick'em: one KV key per device, "fgs:<game>:<voter>", pick in the key metadata, so
// results only need list(). Same voter-id check, origin check, payload cap and cached tallies. A repeat
// pick overwrites that device's key, so it stays one vote. Shootout goals are not a first goal.
const PK = "fgs:";
const API = "https://api-web.nhle.com/v1";

export class FgsError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const okGame = g => typeof g === "string" && /^20\d{8}$/.test(g);
const okVoter = v => typeof v === "string" && /^[a-f0-9-]{16,40}$/i.test(v);
function normPlayer(p) {
  if (p === "other") return "other";
  const s = typeof p === "number" && Number.isInteger(p) ? String(p) : p;
  return typeof s === "string" && /^8\d{6}$/.test(s) ? s : null;
}
const FINAL = new Set(["OFF", "FINAL"]);
const OPEN = new Set(["FUT", "PRE"]);

async function loadGame(game, ttl = 60) {
  const url = `${API}/gamecenter/${game}/play-by-play`;
  let r;
  try {
    r = await fetch(url, {headers: {"User-Agent": "Mozilla/5.0 (compatible; CopperAndBlueNews/1.0; +https://copperandbluenews.com)", Accept: "application/json"},
      signal: AbortSignal.timeout(8000), cf: {cacheTtl: ttl, cacheEverything: true}});
  } catch { throw new FgsError(502, "NHL feed unavailable"); }
  if (!r.ok) throw new FgsError(404, "game not found");
  const raw = await r.json();
  const home = raw.homeTeam || {}, away = raw.awayTeam || {};
  if (home.abbrev !== "EDM" && away.abbrev !== "EDM") throw new FgsError(400, "not an Oilers game");
  return {state: raw.gameState || "", start: raw.startTimeUTC || "", raw};
}
function isLocked(info) {
  if (!OPEN.has(info.state)) return true;
  return !!(info.start && Date.parse(info.start) <= Date.now());
}
function seq(p) {
  if (Number.isFinite(p.sortOrder)) return p.sortOrder;
  const [m, s] = String(p.timeInPeriod || "0:00").split(":");
  return ((p.periodDescriptor || {}).number || 0) * 1e6 + (Number(m) || 0) * 60 + (Number(s) || 0);
}
export function firstOilersGoal(raw) {
  if (!raw) return null;
  const home = raw.homeTeam || {}, away = raw.awayTeam || {};
  const edm = home.abbrev === "EDM" ? home : away.abbrev === "EDM" ? away : null;
  if (!edm) return null;
  const goals = (raw.plays || []).filter(p => p.typeDescKey === "goal" && p.periodDescriptor?.periodType !== "SO");
  goals.sort((a, b) => seq(a) - seq(b));
  const goal = goals.find(p => Number(p.details?.eventOwnerTeamId) === Number(edm.id));
  if (!goal) return null;
  const id = goal.details?.scoringPlayerId;
  const spot = (raw.rosterSpots || []).find(r => Number(r.playerId) === Number(id));
  const name = spot ? `${spot.firstName?.default || ""} ${spot.lastName?.default || ""}`.trim() : "";
  return {id: Number.isInteger(id) ? id : (typeof id === "number" ? id : null), name: name || "Oilers",
    num: spot?.sweaterNumber ?? null, period: goal.periodDescriptor || null, time: goal.timeInPeriod || ""};
}
function shootoutOilers(raw) {
  const home = raw.homeTeam || {}, away = raw.awayTeam || {};
  const edm = home.abbrev === "EDM" ? home : away;
  return (raw.plays || []).some(p => p.typeDescKey === "goal" && p.periodDescriptor?.periodType === "SO"
    && Number(p.details?.eventOwnerTeamId) === Number(edm.id));
}
async function bust(game) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) await cache.delete(new Request(`https://fgs.cache/${game}`));
}

export async function vote(body, env) {
  const game = typeof body.game === "number" ? String(body.game) : body.game;
  const voter = body.voter;
  const player = normPlayer(body.player);
  if (!okGame(game) || !okVoter(voter) || !player) throw new FgsError(400, "bad pick");
  const info = await loadGame(game, 30);
  if (isLocked(info)) throw new FgsError(409, "picks are locked: the game has started");
  await env.ALERTS_KV.put(`${PK}${game}:${String(voter).toLowerCase()}`, "",
    {metadata: {p: player, t: Date.now()}, expirationTtl: 120 * 86400});
  await bust(game);
  return {ok: true, game, player};
}

export async function results(game, env) {
  game = typeof game === "number" ? String(game) : game;
  if (!okGame(game)) throw new FgsError(400, "bad game");
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(`https://fgs.cache/${game}`);
  const hit = cache && await cache.match(key);
  if (hit) return hit.json();
  const out = await tally(game, env);
  const ttl = out.locked === false ? 60 : 15;
  if (cache) await cache.put(key, new Response(JSON.stringify(out), {headers: {"Cache-Control": `max-age=${ttl}`}}));
  return out;
}

async function tally(game, env) {
  const picks = [];
  let cursor;
  do {
    const page = await env.ALERTS_KV.list({prefix: `${PK}${game}:`, cursor, limit: 1000});
    for (const k of page.keys) if (k.metadata && k.metadata.p != null) picks.push(k.metadata);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && picks.length < 20000);
  const counts = new Map();
  for (const p of picks) counts.set(String(p.p), (counts.get(String(p.p)) || 0) + 1);
  const votes = [...counts.entries()].map(([id, n]) => ({id, n})).sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1));
  let info = null;
  try { info = await loadGame(game, 30); }
  catch (e) { if (e instanceof FgsError && e.status === 400) throw e; }
  const scorer = info ? firstOilersGoal(info.raw) : null;
  const final = !!(info && FINAL.has(info.state));
  const out = {game, state: info ? info.state : null, locked: info ? isLocked(info) : null, total: picks.length, votes,
    scorer, noGoal: final && !scorer, shootoutGoal: final && !scorer && shootoutOilers(info.raw)};
  if (scorer && scorer.id != null) out.exact = picks.filter(p => String(p.p) === String(scorer.id)).length;
  return out;
}
