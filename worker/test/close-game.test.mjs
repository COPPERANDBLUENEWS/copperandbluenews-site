// Close-game trigger: 3rd period, regulation, <= 5:00 left, tied or one-goal, once per game.
import assert from "node:assert/strict";
import fs from "node:fs";
import {closeGameEvent, formatClock} from "../src/close-game.js";
import {GameAlerts} from "../src/game-alerts.js";
import * as store from "../src/store.js";
import worker from "../src/index.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../data/pbp/2026020260.json", import.meta.url)));

function base(over = {}) {
  const g = structuredClone(fixture);
  g.gameState = "LIVE";
  g.clock = {timeRemaining: "05:00", secondsRemaining: 300, running: true, inIntermission: false};
  g.periodDescriptor = {number: 3, periodType: "REG", maxRegulationPeriods: 3};
  // 5-4 after the last even-strength goal in the fixture plays (1-goal game).
  return Object.assign(g, over);
}

const tied = ev => ev && ev.title === "Tied 2-2 with 5:00 left in the 3rd";
function withScore(g, as, hs) {
  // Keep real roster/teams; replace goals with a clean running score.
  g.plays = [{
    eventId: 1, typeDescKey: "goal", periodDescriptor: {number: 3, periodType: "REG"},
    timeInPeriod: "10:00", timeRemaining: "10:00",
    details: {awayScore: as, homeScore: hs, eventOwnerTeamId: as >= hs ? g.awayTeam.id : g.homeTeam.id},
  }];
  return g;
}

assert.equal(formatClock(300), "5:00");
assert.equal(formatClock(45), "0:45");

let ev = closeGameEvent(withScore(base(), 3, 2));
assert.equal(ev.type, "close_game");
assert.equal(ev.id, `${fixture.id}:close_game`);
assert.equal(ev.title, "Close game alert: EDM 2-3 ANA, 5:00 left in the 3rd");
assert.equal(ev.url, `/tracker.html?id=${fixture.id}`);
assert.equal(ev.tied, false);

ev = closeGameEvent(withScore(base(), 2, 2));
assert.ok(tied(ev));
assert.equal(ev.title, "Tied 2-2 with 5:00 left in the 3rd");

ev = closeGameEvent(withScore(base({clock: {timeRemaining: "04:48", secondsRemaining: 288, running: true, inIntermission: false}}), 2, 2));
assert.equal(ev.title, "Tied 2-2 with 4:48 left in the 3rd");

assert.equal(closeGameEvent(withScore(base(), 4, 2)), null, "two-goal game is not close");
assert.equal(closeGameEvent(withScore(base({
  periodDescriptor: {number: 3, periodType: "OT", maxRegulationPeriods: 3},
  clock: {timeRemaining: "04:00", secondsRemaining: 240, running: true, inIntermission: false},
}), 2, 2)), null, "OT is not regulation");
assert.equal(closeGameEvent(withScore(base({
  periodDescriptor: {number: 2, periodType: "REG", maxRegulationPeriods: 3},
}), 2, 2)), null, "2nd period is ignored");
assert.equal(closeGameEvent(withScore(base({
  clock: {timeRemaining: "05:01", secondsRemaining: 301, running: true, inIntermission: false},
}), 2, 2)), null, "more than 5:00 left");
assert.equal(closeGameEvent(withScore(base({
  clock: {timeRemaining: "05:00", secondsRemaining: 300, running: false, inIntermission: true},
}), 2, 2)), null, "intermission is ignored");
assert.equal(closeGameEvent(withScore(base({gameState: "FINAL"}), 2, 2)), null, "final is ignored");
assert.equal(closeGameEvent(withScore(base({gameState: "CRIT"}), 3, 2))?.type, "close_game", "CRIT still counts as live");

// Real ANA @ EDM fixture: first time in the final 5 it is 5-2, then 5-4 with 0:45 left.
const late = base({
  clock: {timeRemaining: "04:33", secondsRemaining: 273, running: true, inIntermission: false},
  plays: fixture.plays.filter(p => !(p.periodDescriptor?.number === 3 && p.timeRemaining && Number(p.timeRemaining.split(":")[0]) * 60 + Number(p.timeRemaining.split(":")[1]) < 273)),
});
assert.equal(closeGameEvent(late), null, "5-2 with 4:33 left is not close");
const lastMinute = base({
  clock: {timeRemaining: "00:45", secondsRemaining: 45, running: true, inIntermission: false},
});
ev = closeGameEvent(lastMinute);
assert.equal(ev.title, "Close game alert: EDM 4-5 ANA, 0:45 left in the 3rd");

// Durable outbox: one event, second stage is a no-op, no real subscribers involved (send stubbed).
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
const time = Date.parse(fixture.startTimeUTC) + 3600000;
Date.now = () => time;
try {
  const kv = new KV();
  const env = {GAME_ALERTS_ENABLED: "1", GAME_ALERTS_SINCE: fixture.startTimeUTC, ALERTS_KV: kv, PUSH_QUEUE: {async sendBatch() {}}};
  const actor = new GameAlerts({storage: new MemoryStorage()}, env);
  actor.send = async () => ({sent: 0, failed: 0, gone: 0});
  actor.nhl = async () => ({games: []});
  await store.putSub(env, "fan", {endpoint: "https://push.test/fan", p256dh: "stub", auth: "stub", prefs: store.DEFAULTS}, new Date(time).toISOString());
  const snap = lastMinute;
  assert.equal(await actor.stage(snap) > 0, true);
  const pending = [...(await actor.storage.list({prefix: "pending:"})).values()];
  const close = pending.find(r => r.payload.type === "close_game");
  assert.ok(close);
  assert.equal(close.payload.title, "Close game alert: EDM 4-5 ANA, 0:45 left in the 3rd");
  assert.equal(close.log.detail.kind, "close_game");
  assert.equal(close.log.detail.timeRemaining, "0:45");
  assert.equal(close.log.detail.awayScore, 5);
  assert.equal(close.log.detail.homeScore, 4);
  assert.equal(await actor.stage(snap), 0, "dedupe survives a second poll");
  assert.equal(await actor.stage({...snap, clock: {timeRemaining: "00:20", secondsRemaining: 20, running: true, inIntermission: false}}), 0, "still one per game after the clock ticks");

  const fence = await worker.fetch(new Request("https://worker.test/notify", {method: "POST", headers: {Authorization: "Bearer test"}, body: JSON.stringify({type: "close_game", title: "Close game alert"})}), {NOTIFY_SECRET: "test", GAME_ALERTS_ENABLED: "1"}, {waitUntil() {}});
  assert.equal((await fence.json()).ignored, true);
} finally { Date.now = realNow; }

console.log("Close game: tied and 1-goal fire, 2-goal/OT/intermission/final do not, one event per game, /notify fenced");
