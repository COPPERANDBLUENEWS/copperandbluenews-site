// 1 hour and 15 minute reminders: windows, one-time dedupe, late skip, idle alarm, goalie when known.
import assert from "node:assert/strict";
import {GameAlerts} from "../src/game-alerts.js";
import worker from "../src/index.js";
import {dueWindow, knownStarter, nextPregameAt, pregameDecision, pregameEvent, viewerTime} from "../src/pregame.js";
import * as store from "../src/store.js";

const start = Date.parse("2026-11-08T03:00:00Z");
const game = {
  id: 2026020276, startTimeUTC: "2026-11-08T03:00:00Z", gameScheduleState: "OK", gameState: "FUT",
  venue: {default: "Rogers Place"},
  awayTeam: {abbrev: "VAN", commonName: {default: "Canucks"}},
  homeTeam: {abbrev: "EDM", commonName: {default: "Oilers"}},
};
const expectState = {
  61: ["early", "early"],
  59: ["due", "early"],
  16: ["late", "early"],
  14: ["late", "due"],
  [-1]: ["late", "late"],
};
for (const [min, want] of Object.entries(expectState)) {
  const now = start - Number(min) * 60000;
  const got = pregameDecision(start, now).map(d => d.state);
  assert.deepEqual(got, want, min + " min before start");
}
assert.equal(dueWindow(start, start - 59 * 60000).type, "pregame_60");
assert.equal(dueWindow(start, start - 14 * 60000).type, "pregame_15");
assert.equal(dueWindow(start, start - 61 * 60000), null);
assert.equal(dueWindow(start, start - 16 * 60000), null);
assert.equal(dueWindow(start, start + 60000), null);
assert.equal(nextPregameAt([game], start, start - 61 * 60000), start - 60 * 60000);
assert.equal(nextPregameAt([game], start, start - 16 * 60000), start - 15 * 60000);
assert.equal(nextPregameAt([game], start, start + 60000), null);
assert.equal(viewerTime(game.startTimeUTC), "9 PM MT | 8 PM PT");
const withGoalie = pregameEvent(game, {type: "pregame_60", title: "1 hour to puck drop"}, {name: "Devon Levi", status: "Confirmed"});
assert.equal(withGoalie.title, "1 hour to puck drop: VAN @ EDM");
assert.equal(withGoalie.url, "/tracker.html?id=2026020276");
assert.match(withGoalie.body, /VAN @ EDM at Rogers Place/);
assert.match(withGoalie.body, /9 PM MT \| 8 PM PT/);
assert.match(withGoalie.body, /Starting goalie: Devon Levi/);
const likely = pregameEvent(game, {type: "pregame_15", title: "15 minutes to puck drop"}, {name: "Devon Levi", status: "Likely"});
assert.match(likely.body, /Likely starter: Devon Levi/);
const bare = pregameEvent(game, {type: "pregame_60", title: "1 hour to puck drop"}, null);
assert.doesNotMatch(bare.body, /goalie|starter/i);
const lineup = {game: {id: 2026020276}, goalie: {status: "Confirmed", starter: {name: "Devon Levi"}}};
assert.deepEqual(knownStarter({lineup, gameId: 2026020276}), {name: "Devon Levi", status: "Confirmed"});
assert.equal(knownStarter({lineup: {game: {id: 2026020276}, goalie: {status: "Unconfirmed", starter: {name: "Someone"}}}, gameId: 2026020276}), null);
const box = {homeTeam: {abbrev: "EDM"}, playerByGameStats: {homeTeam: {goalies: [{name: {default: "D. Levi"}, starter: true}, {name: {default: "T. Jarry"}, starter: false}]}}};
assert.deepEqual(knownStarter({box, lineup, gameId: game.id}), {name: "Devon Levi", status: "Confirmed"});
assert.equal(knownStarter({box: {awayTeam: {abbrev: "EDM"}, playerByGameStats: {}}, gameId: game.id}), null);
const fence = await worker.fetch(new Request("https://worker.test/notify", {method: "POST", headers: {Authorization: "Bearer test", "Content-Type": "application/json"}, body: JSON.stringify({type: "pregame_60", title: "1 hour to puck drop: VAN @ EDM"})}), {NOTIFY_SECRET: "test", GAME_ALERTS_ENABLED: "1"}, {waitUntil() {}});
assert.equal((await fence.json()).ignored, true);
console.log("Pregame windows: 61 early, 59 sends the hour, 16 skips it, 14 sends 15 minutes, -1 skips both");

class MemoryStorage {
  data = new Map(); alarm = null;
  async get(k) { return structuredClone(this.data.get(k)); }
  async put(k, v) { for (const [key, value] of typeof k === "object" ? Object.entries(k) : [[k, v]]) this.data.set(key, structuredClone(value)); }
  async delete(k) { for (const key of Array.isArray(k) ? k : [k]) this.data.delete(key); }
  async list({prefix = "", limit = Infinity} = {}) { return new Map([...this.data].filter(([k]) => k.startsWith(prefix)).sort().slice(0, limit).map(([k, v]) => [k, structuredClone(v)])); }
  async setAlarm(t) { this.alarm = t; } async deleteAlarm() { this.alarm = null; }
}
class KV {
  data = new Map();
  async get(k, type) { const v = this.data.get(k)?.value ?? null; return type === "json" && v !== null ? JSON.parse(v) : v; }
  async put(k, value, opts = {}) { this.data.set(k, {value, metadata: opts.metadata}); }
  async delete(k) { this.data.delete(k); }
  async list({prefix}) { return {keys: [...this.data].filter(([k]) => k.startsWith(prefix)).map(([name, v]) => ({name, metadata: v.metadata})), list_complete: true}; }
}
const realNow = Date.now;
let time = start;
Date.now = () => time;
function setup(starter) {
  const storage = new MemoryStorage(), kv = new KV();
  const env = {GAME_ALERTS_ENABLED: "1", GAME_ALERTS_SINCE: "2026-11-08T03:00:00Z", ALERTS_KV: kv, PUSH_QUEUE: {async sendBatch() {}}};
  const actor = new GameAlerts({storage}, env);
  actor.schedule = async () => [{...game}];
  actor.starter = async () => starter;
  actor.pause = async ms => { time += ms; };
  actor.nhl = async path => {
    if (String(path).includes("play-by-play")) return {...game, plays: [], gameState: "FUT"};
    throw new Error("unexpected " + path);
  };
  return {actor, storage, env};
}
async function sub(env, id, prefs) {
  await store.putSub(env, id, {endpoint: "https://push.test/" + id, p256dh: "k", auth: "a", prefs: {...store.DEFAULTS, ...prefs}}, new Date(time).toISOString());
}
const ids = async x => [...(await x.storage.list({prefix: "seen:"})).keys()];
try {
  const early = setup({name: "Devon Levi", status: "Confirmed"});
  await sub(early.env, "in");
  await sub(early.env, "out", {pregame_60: false, pregame_15: false});
  time = start - 61 * 60000;
  let r = await early.actor.run(time);
  assert.equal(r.staged, 0);
  assert.equal(early.storage.alarm, start - 60 * 60000);
  time = start - 59 * 60000;
  r = await early.actor.run(time);
  assert.equal(r.staged, 1);
  const row = (await early.storage.list({prefix: "pending:"})).get("pending:2026020276:pregame_60");
  assert.equal(row.payload.title, "1 hour to puck drop: VAN @ EDM");
  assert.equal(row.payload.url, "/tracker.html?id=2026020276");
  assert.match(row.payload.body, /Rogers Place/);
  assert.match(row.payload.body, /9 PM MT \| 8 PM PT/);
  assert.match(row.payload.body, /Starting goalie: Devon Levi/);
  assert.deepEqual(row.batches.flat().map(s => s.id), ["in"]);
  assert.equal(row.log.detail.kind, "pregame_60");
  assert.equal(row.log.detail.starter, "Devon Levi");
  r = await early.actor.run(time);
  assert.equal(r.staged, 0, "second wake inside the hour window must not send again");
  assert.equal([...(await early.storage.list({prefix: "pending:"})).keys()].filter(k => k.includes("pregame")).length, 1);

  const missed = setup(null);
  await sub(missed.env, "in");
  time = start - 16 * 60000;
  r = await missed.actor.run(time);
  assert.equal(r.staged, 0);
  assert.equal((await ids(missed)).some(k => k.includes("pregame_60")), false);
  assert.equal(missed.storage.alarm, start - 15 * 60000);
  time = start - 14 * 60000;
  r = await missed.actor.run(time);
  assert.equal(r.staged, 1);
  const quarter = (await missed.storage.list({prefix: "pending:"})).get("pending:2026020276:pregame_15");
  assert.equal(quarter.payload.title, "15 minutes to puck drop: VAN @ EDM");
  assert.equal(quarter.payload.url, "/tracker.html?id=2026020276");
  assert.doesNotMatch(quarter.payload.body, /goalie|starter/i);
  assert.equal(quarter.log.detail.when, "9 PM MT | 8 PM PT");
  r = await missed.actor.run(time);
  assert.equal(r.staged, 0);

  const late = setup({name: "Devon Levi", status: "Confirmed"});
  await sub(late.env, "in");
  time = start - (-1) * 60000;
  r = await late.actor.run(time);
  assert.equal(r.staged, 0);
  assert.equal((await ids(late)).some(k => k.includes("pregame")), false);
  const logged = await early.env.ALERTS_KV.get("alerts:log", "json");
  assert.equal(logged.filter(a => a.type === "pregame_60").length, 1);
  assert.equal(logged.find(a => a.type === "pregame_60").url, "/tracker.html?id=2026020276");
  console.log("Durable Object: each reminder once, skipped when the window has passed, alarm set from startTimeUTC");

  const old = new KV();
  const mask = 1 | 2 | 4 | 8 | 16 | 64; // v2: every previous type except odds
  await old.put("sub:old", JSON.stringify({v: 2, e: "https://push.test/old", k: "k", a: "a", m: mask, n: "", c: "c", u: "u"}));
  const prev = await store.getSub({ALERTS_KV: old}, "old");
  assert.equal(prev.prefs.pregame_60, true);
  assert.equal(prev.prefs.pregame_15, true);
  assert.equal(prev.prefs.odds, false);
  assert.equal(prev.prefs.gameday, true);
  console.log("Older sign-ups: 1 hour and 15 minute reminders default on");
} finally { Date.now = realNow; }
