import assert from "node:assert/strict";
import worker from "../src/index.js";
import {slimPbp} from "../src/live.js";
const realNow = Date.now, realFetch = globalThis.fetch;
let time = realNow(), calls = [], failures = false, games = [];
Date.now = () => time;
const cached = new Map(), writes = [];
globalThis.caches = {default: {
  async match(req) { const hit = cached.get(req.url); return hit && hit.until > time ? hit.res.clone() : undefined; },
  async put(req, res) {
    assert.equal(res.headers.get("Cache-Control"), "public, max-age=2");
    cached.set(req.url, {until: time + 2000, res: res.clone()});
  }
}};
const raw = {id: 2026020276, gameState: "LIVE", gameType: 2,
  startTimeUTC: new Date(time - 1000).toISOString(), gameScheduleState: "OK",
  homeTeam: {id: 22, abbrev: "EDM", score: 2, sog: 9}, awayTeam: {id: 23, abbrev: "VAN", score: 1, sog: 8},
  rosterSpots: [{playerId: 97, firstName: {default: "Connor"}, lastName: {default: "McDavid"}, extra: "strip"}],
  plays: [{eventId: 1, typeDescKey: "goal", pptReplayUrl: "strip", details: {scoringPlayerId: 97,
    eventOwnerTeamId: 22, highlightClipSharingUrl: "strip", discreteClip: "strip", xCoord: 4, yCoord: 5}}]};
globalThis.fetch = async (url, opts) => {
  assert.equal(opts.headers["User-Agent"], "copperandbluenews"); calls.push(url);
  if (failures) return new Response("unavailable", {status: 503});
  return Response.json(url.includes("club-schedule-season") ? {games} : raw);
};
const ctx = {waitUntil(p) { writes.push(p); }};
async function request(path, origin = "https://copperandbluenews.com", method = "GET") {
  const res = await worker.fetch(new Request("https://relay.test" + path, {method, headers: origin ? {Origin: origin} : {}}), {}, ctx);
  await Promise.all(writes.splice(0)); return res;
}
try {
  const slim = slimPbp(raw);
  assert.equal(slim.season, null); assert.equal(slim.rosterSpots[0].teamId, null);
  assert.equal(slim.homeTeam.commonName, null); assert.match(slim.fetched, /\+00:00$/);
  assert.equal(slim.plays[0].pptReplayUrl, undefined); assert.equal(slim.plays[0].details.xCoord, 4);
  assert.equal(slim.plays[0].details.highlightClipSharingUrl, undefined);
  assert.equal(slim.rosterSpots[0].extra, undefined); assert.equal(raw.plays[0].pptReplayUrl, "strip");
  let r = await request("/live/pbp?id=2026020276&t=1");
  assert.equal(r.status, 200); assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://copperandbluenews.com");
  assert.equal(r.headers.get("Cache-Control"), "no-store"); assert.equal((await r.json()).homeTeam.score, 2);
  await request("/live/pbp?id=2026020276&t=2", "https://www.copperandbluenews.com");
  assert.equal(calls.length, 1, "canonical cache key ignores timestamp/Origin");
  time += 2100; await request("/live/pbp?id=2026020276"); assert.equal(calls.length, 2, "cache expires after two seconds");
  assert.equal((await request("/live/pbp?id=oops")).status, 400);
  assert.equal((await request("/live/pbp?id=2026020276", "https://evil.test")).status, 403);
  assert.equal((await request("/live/pbp?id=2026020276", undefined, "POST")).status, 405);
  assert.equal((await request("/live/now", undefined, "OPTIONS")).status, 204);
  games = [{...raw}]; r = await request("/live/now"); const now = await r.json();
  assert.equal(now.game.id, raw.id); assert.equal(now.game.home.score, 2); assert.equal(now.goals[0].name, "Connor McDavid");
  time += 2100; games = []; assert.equal((await (await request("/live/now")).json()).game, null);
  time += 2100; raw.gameState = "FUT"; raw.plays = [];
  raw.startTimeUTC = new Date(time + 60000).toISOString(); games = [{...raw}];
  assert.equal((await (await request("/live/now")).json()).game.state, "FUT", "pre-game feed works before puck drop");
  time += 2100; raw.gameState = "FINAL"; raw.startTimeUTC = new Date(time - 3600000).toISOString(); games = [{...raw}];
  assert.equal((await (await request("/live/now")).json()).game.state, "FINAL", "final score remains available for Scores");
  failures = true; time += 2100; assert.equal((await request("/live/pbp?id=2026020276")).status, 502);
  failures = false; assert.equal((await request("/live/pbp?id=2026020276")).status, 200, "error is not cached");
  console.log("live relay: schema, CORS, validation, canonical keys, 2s TTL, scores/goals and failure recovery passed");
} finally { Date.now = realNow; globalThis.fetch = realFetch; }
