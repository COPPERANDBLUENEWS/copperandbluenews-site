// Pick'em: fans predict the final score of an Oilers game before puck drop.
//   POST /pickem   {game, voter, edm, opp}   (browser, CORS) one pick per device per game; can change it until puck drop
//   GET  /pickem?game=ID                     crowd results (cached ~60 s); after the final, how many got it right
// Storage: one KV key per pick, "pk:<game>:<voter>", with the pick in the key metadata so results need only list().
const PK = "pk:";
const API = "https://api-web.nhle.com/v1";

export class PickemError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function gameInfo(game, ttl = 120) {
  const url = `${API}/gamecenter/${game}/landing`;
  const r = await fetch(url, {headers: {"User-Agent": "Mozilla/5.0 (compatible; CopperAndBlueNews/1.0; +https://copperandbluenews.com)", Accept: "application/json"}, cf: {cacheTtl: ttl, cacheEverything: true}});
  if (!r.ok) console.log("nhl fetch", r.status, url);
  if (!r.ok) throw new PickemError(404, "game not found");
  const g = await r.json();
  const home = g.homeTeam || {}, away = g.awayTeam || {};
  const edmHome = home.abbrev === "EDM";
  if (!edmHome && away.abbrev !== "EDM") throw new PickemError(400, "not an Oilers game");
  const edm = edmHome ? home : away, opp = edmHome ? away : home;
  return {state: g.gameState, start: g.startTimeUTC, opp: opp.abbrev, edmScore: edm.score, oppScore: opp.score,
    final: g.gameState === "FINAL" || g.gameState === "OFF"};
}

const okGame = g => typeof g === "string" && /^20\d{8}$/.test(g) || (typeof g === "number" && /^20\d{8}$/.test(String(g)));
const okVoter = v => typeof v === "string" && /^[a-f0-9-]{16,40}$/i.test(v);
const okGoals = n => Number.isInteger(n) && n >= 0 && n <= 15;

export async function vote(body, env) {
  const game = String(body.game || ""), voter = body.voter, edm = body.edm, opp = body.opp;
  if (!okGame(game) || !okVoter(voter)) throw new PickemError(400, "bad pick");
  if (!okGoals(edm) || !okGoals(opp) || edm === opp) throw new PickemError(400, "pick a final score (no ties in the NHL)");
  const g = await gameInfo(game, 60);
  if (!(g.state === "FUT" || g.state === "PRE") || (g.start && Date.parse(g.start) <= Date.now()))
    throw new PickemError(409, "picks are locked: the game has started");
  await env.ALERTS_KV.put(`${PK}${game}:${voter.toLowerCase()}`, "",
    {metadata: {e: edm, o: opp, t: Date.now()}, expirationTtl: 120 * 86400});
  return {ok: true, game, edm, opp};
}

// KV list() is limited on the Free plan, so results are cached per data centre for a minute.
export async function results(game, env) {
  if (!okGame(game)) throw new PickemError(400, "bad game");
  const key = new Request(`https://pickem.cache/${game}`);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const hit = cache && await cache.match(key);
  if (hit) return hit.json();
  const out = await tally(game, env);
  if (cache) await cache.put(key, new Response(JSON.stringify(out), {headers: {"Cache-Control": "max-age=60"}}));
  return out;
}

async function tally(game, env) {
  const g = await gameInfo(game, 60);
  const picks = [];
  let cursor;
  do {
    const page = await env.ALERTS_KV.list({prefix: `${PK}${game}:`, cursor, limit: 1000});
    for (const k of page.keys) if (k.metadata) picks.push(k.metadata);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && picks.length < 20000);
  const total = picks.length, edmWins = picks.filter(p => p.e > p.o).length;
  const counts = {};
  for (const p of picks) counts[`${p.e}-${p.o}`] = (counts[`${p.e}-${p.o}`] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, n]) => ({score: s, n}));
  const avg = k => total ? Math.round(picks.reduce((a, p) => a + p[k], 0) / total * 10) / 10 : null;
  const out = {game, opp: g.opp, state: g.state, locked: !(g.state === "FUT" || g.state === "PRE"),
    total, edmWins, oppWins: total - edmWins, avgEdm: avg("e"), avgOpp: avg("o"), top};
  if (g.final && Number.isInteger(g.edmScore)) {
    const edmWon = g.edmScore > g.oppScore;
    out.final = {edm: g.edmScore, opp: g.oppScore,
      rightWinner: picks.filter(p => (p.e > p.o) === edmWon).length,
      exact: picks.filter(p => p.e === g.edmScore && p.o === g.oppScore).length};
  }
  return out;
}
