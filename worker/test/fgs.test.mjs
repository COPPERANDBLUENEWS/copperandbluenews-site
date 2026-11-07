// Local fixtures only. NHL fetches are stubbed. No KV namespace, push, or live network.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import worker from "../src/index.js";
import {firstOilersGoal} from "../src/fgs.js";

const data = new Map(), metadata = new Map();
const env = {ALERTS_KV: {
  async get() { return null; },
  async put(k, v, opts) { data.set(k, v); metadata.set(k, structuredClone(opts?.metadata)); env._ttl = opts?.expirationTtl; },
  async delete(k) { data.delete(k); metadata.delete(k); },
  async list({prefix = ""} = {}) {
    const keys = [...data.keys()].filter(k => k.startsWith(prefix)).sort();
    return {keys: keys.map(name => ({name, metadata: structuredClone(metadata.get(name))})), list_complete: true};
  }
}};
const ctx = {waitUntil() {}};
let feed = null, fetches = 0;
globalThis.fetch = async url => {
  fetches++;
  const u = String(url);
  if (!u.includes("api-web.nhle.com")) throw new Error("unexpected fetch " + u);
  if (!feed) return new Response("no", {status: 404});
  return new Response(JSON.stringify(feed), {status: 200, headers: {"Content-Type": "application/json"}});
};
const future = () => new Date(Date.now() + 3600e3).toISOString();
const past = () => new Date(Date.now() - 3600e3).toISOString();
function oilers(over = {}) {
  return {id: 2026020276, gameState: "FUT", startTimeUTC: future(), homeTeam: {id: 22, abbrev: "EDM", score: 0},
    awayTeam: {id: 23, abbrev: "VAN", score: 0}, plays: [], rosterSpots: [], ...over};
}
const V = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
function request(path, {method = "GET", body, origin = "https://copperandbluenews.com"} = {}) {
  return worker.fetch(new Request("https://local.test" + path, {method, headers: {...(origin ? {Origin: origin} : {}), ...(body !== undefined ? {"Content-Type": "application/json"} : {})},
    ...(body !== undefined ? {body: typeof body === "string" ? body : JSON.stringify(body)} : {})}), env, ctx);
}
const goal = (over) => ({typeDescKey: "goal", sortOrder: 10, timeInPeriod: "04:12", periodDescriptor: {number: 1, periodType: "REG", maxRegulationPeriods: 3},
  details: {eventOwnerTeamId: 22, scoringPlayerId: 8478402, awayScore: 0, homeScore: 1}, ...over});

feed = oilers();
let r = await request("/fgs?game=2026020276", {method: "OPTIONS"});
assert.equal(r.status, 204);
assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://copperandbluenews.com");
assert.equal((await request("/fgs?game=2026020276", {method: "OPTIONS", origin: "https://evil.test"})).status, 403);
assert.equal((await request("/fgs?game=2026020276", {method: "PUT"})).status, 405);
assert.equal((await request("/fgs", {method: "POST", origin: "https://evil.test", body: {game: "2026020276", voter: V, player: "other"}})).status, 403);
assert.equal(data.size, 0);

for (const body of [{game: "2026020276", voter: "short", player: "other"}, {game: "nope", voter: V, player: "other"},
  {game: "2026020276", voter: V, player: "McDavid"}, {game: "2026020276", voter: V, player: 15}, {game: "2026020276", voter: V}])
  assert.equal((await request("/fgs", {method: "POST", body})).status, 400, JSON.stringify(body));
assert.equal((await request("/fgs", {method: "POST", body: "{"})).status, 400);
assert.equal((await request("/fgs", {method: "POST", body: "x".repeat(1100)})).status, 413);

r = await request("/fgs", {method: "POST", body: {game: 2026020276, voter: V.toUpperCase(), player: 8478402}});
assert.equal(r.status, 200, await r.clone().text());
assert.deepEqual(await r.json(), {ok: true, game: "2026020276", player: "8478402"});
assert.equal(env._ttl, 120 * 86400);
assert.equal(metadata.get(`fgs:2026020276:${V}`).p, "8478402");
assert.equal(data.size, 1);

r = await request("/fgs", {method: "POST", body: {game: "2026020276", voter: V, player: "other"}, origin: "https://www.copperandbluenews.com"});
assert.equal(r.status, 200);
assert.equal(metadata.get(`fgs:2026020276:${V}`).p, "other");
assert.equal(data.size, 1, "changing a pick overwrites the same device");

r = await request("/fgs", {method: "POST", body: {game: "2026020276", voter: V2, player: "8477934"}});
assert.equal(r.status, 200);
r = await request("/fgs?game=2026020276");
let j = await r.json();
assert.equal(r.headers.get("Cache-Control"), "public, max-age=60");
assert.equal(j.total, 2);
assert.equal(j.locked, false);
assert.equal(j.state, "FUT");
assert.equal(j.scorer, null);
assert.equal(j.noGoal, false);
assert.deepEqual(j.votes.map(v => v.id).sort(), ["8477934", "other"]);

async function clearCache() {
  if (typeof caches !== "undefined" && caches.default) await caches.default.delete(new Request("https://fgs.cache/2026020276"));
}
await clearCache();
feed = oilers({gameState: "FUT", startTimeUTC: past()});
assert.equal((await request("/fgs", {method: "POST", body: {game: "2026020276", voter: V, player: "8478402"}})).status, 409);
feed = oilers({gameState: "LIVE", startTimeUTC: future()});
assert.equal((await request("/fgs", {method: "POST", body: {game: "2026020276", voter: V, player: "8478402"}})).status, 409);
await clearCache();
feed = oilers({homeTeam: {id: 22, abbrev: "EDM"}, awayTeam: {id: 23, abbrev: "VAN"}, gameState: "LIVE", startTimeUTC: past(),
  plays: [goal({sortOrder: 5, details: {eventOwnerTeamId: 23, scoringPlayerId: 8480001, awayScore: 1, homeScore: 0}}),
    goal({sortOrder: 20, timeInPeriod: "11:02", details: {eventOwnerTeamId: 22, scoringPlayerId: 8478402, awayScore: 1, homeScore: 1}}),
    {typeDescKey: "goal", sortOrder: 90, timeInPeriod: "00:08", periodDescriptor: {number: 5, periodType: "SO"}, details: {eventOwnerTeamId: 22, scoringPlayerId: 8477934}}],
  rosterSpots: [{playerId: 8478402, firstName: {default: "Connor"}, lastName: {default: "McDavid"}, sweaterNumber: 97}]});
r = await request("/fgs?game=2026020276");
j = await r.json();
assert.equal(r.headers.get("Cache-Control"), "public, max-age=15");
assert.equal(j.locked, true);
assert.equal(j.scorer.id, 8478402);
assert.equal(j.scorer.name, "Connor McDavid");
assert.equal(j.scorer.num, 97);
assert.equal(j.scorer.time, "11:02");
assert.equal(j.exact, 0);
assert.equal(j.noGoal, false);
metadata.set(`fgs:2026020276:${V}`, {p: "8478402", t: 1});
await clearCache();
r = await request("/fgs?game=2026020276");
// Node has no caches.default, so the tally is fresh.
j = await r.json();
assert.equal(j.exact, 1);

await clearCache();
feed = oilers({gameState: "FINAL", startTimeUTC: past(), plays: [{typeDescKey: "goal", sortOrder: 4, timeInPeriod: "00:20", periodDescriptor: {number: 5, periodType: "SO"}, details: {eventOwnerTeamId: 22, scoringPlayerId: 8478402}}]});
j = await (await request("/fgs?game=2026020276")).json();
assert.equal(j.scorer, null);
assert.equal(j.noGoal, true);
assert.equal(j.shootoutGoal, true);

feed = {gameState: "FUT", startTimeUTC: future(), homeTeam: {abbrev: "VAN", id: 23}, awayTeam: {abbrev: "SEA", id: 55}, plays: []};
assert.equal((await request("/fgs", {method: "POST", body: {game: "2026020276", voter: V, player: "other"}})).status, 400);

assert.equal((await request("/live/pbp?id=2026020276", {method: "POST"})).status, 405);
assert.equal((await request("/health", {origin: null})).status, 200);
feed = oilers();
const pick = await (await request("/pickem?game=2026020276")).json();
assert.equal(pick.game, "2026020276");
assert.equal(pick.total, 0);

const real = JSON.parse(readFileSync(new URL("../../data/pbp/2026020260.json", import.meta.url)));
const first = firstOilersGoal(real);
assert.equal(first.name, "Evan Bouchard");
assert.equal(first.id, 8480803);
assert.equal(first.period.number, 1);
assert.ok(fetches > 0);
console.log("FGS PASS", {votes: data.size, fetches});
