// Special-teams trigger: PP/PK from penalty events, offsetting clusters silent, 5-on-3 labeled, majors/double minors.
import assert from "node:assert/strict";
import fs from "node:fs";
import {specialTeamsEvents, netPenalties} from "../src/special-teams.js";
import {GameAlerts} from "../src/game-alerts.js";
import * as store from "../src/store.js";
import worker from "../src/index.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../data/pbp/2026020260.json", import.meta.url)));
const evs = specialTeamsEvents(fixture);
const byId = Object.fromEntries(evs.map(e => [e.id, e]));

// Ordinary opponent minor -> Oilers power play. ANA #47 Warren, 2 min interference, 16:38 1st.
const pp = evs.find(e => e.id.endsWith(":penalty:455"));
assert.ok(pp);
assert.equal(pp.type, "special_teams");
assert.equal(pp.kind, "power_play");
assert.equal(pp.title, "Oilers power play");
assert.equal(pp.body, "Power play: ANA #47 Warren, 2 min interference, 16:38 1st");
assert.equal(pp.url, `/tracker.html?id=${fixture.id}`);
assert.equal(pp.duration, 2);

// Ordinary Oilers minor -> penalty kill. EDM #2 Bouchard, 2 min hooking, 3:50 1st.
const pk = evs.find(e => e.id.endsWith(":penalty:104"));
assert.ok(pk);
assert.equal(pk.kind, "penalty_kill");
assert.equal(pk.title, "Penalty kill");
assert.equal(pk.body, "Penalty kill: EDM #2 Bouchard, 2 min hooking, 3:50 1st");

// 08:06 scrum: Podkolzin 5 major + 2 instigator + 10 game misconduct vs Helleson 2 unsportsmanlike.
// Game misconduct ignored; 2s offset; remaining 5-min major is a penalty kill.
assert.equal(byId[`${fixture.id}:penalty:219`], undefined, "offsetting unsportsmanlike is silent");
assert.equal(byId[`${fixture.id}:penalty:13`], undefined, "offsetting instigator is silent");
assert.equal(byId[`${fixture.id}:penalty:17`], undefined, "game misconduct is silent");
const maj = byId[`${fixture.id}:penalty:214`];
assert.ok(maj);
assert.equal(maj.kind, "penalty_kill");
assert.equal(maj.duration, 5);
assert.match(maj.body, /5 min fighting/);
assert.match(maj.body, /#92 Podkolzin/);

// 16:52: hooking 2, unsportsmanlike 2, and two fighting majors all offset. No alerts.
for (const id of [464, 467, 506, 25]) assert.equal(byId[`${fixture.id}:penalty:${id}`], undefined, `offsetting ${id} is silent`);

// Bench minor on ANA, served by Sennecke.
const bench = byId[`${fixture.id}:penalty:639`];
assert.ok(bench);
assert.equal(bench.kind, "power_play");
assert.match(bench.body, /2 min too many men/);
assert.match(bench.body, /#45 Sennecke/);

// Every emitted id is unique and stable.
assert.equal(new Set(evs.map(e => e.id)).size, evs.length);
assert.ok(evs.every(e => e.id.startsWith(`${fixture.id}:penalty:`)));

// Synthetic 5-on-3: two ANA minors at different times, no Oilers offset.
function penalty({eventId, team, desc, duration = 2, typeCode = "MIN", time = "10:00", remaining = "10:00", period = 2, sit = "1551", player}) {
  return {
    eventId, typeDescKey: "penalty",
    periodDescriptor: {number: period, periodType: "REG", maxRegulationPeriods: 3},
    timeInPeriod: time, timeRemaining: remaining, situationCode: sit,
    details: {typeCode, descKey: desc, duration, eventOwnerTeamId: team, committedByPlayerId: player},
  };
}
const five = {
  id: 2026020999,
  gameState: "FINAL",
  awayTeam: {id: 10, abbrev: "TOR", commonName: {default: "Maple Leafs"}},
  homeTeam: {id: 22, abbrev: "EDM", commonName: {default: "Oilers"}},
  rosterSpots: [
    {teamId: 10, playerId: 1, firstName: {default: "Morgan"}, lastName: {default: "Rielly"}, sweaterNumber: 44},
    {teamId: 10, playerId: 2, firstName: {default: "Auston"}, lastName: {default: "Matthews"}, sweaterNumber: 34},
    {teamId: 22, playerId: 3, firstName: {default: "Leon"}, lastName: {default: "Draisaitl"}, sweaterNumber: 29},
  ],
  plays: [
    penalty({eventId: 11, team: 10, desc: "tripping", time: "12:34", remaining: "07:26", player: 1, sit: "1551"}),
    penalty({eventId: 12, team: 10, desc: "slashing", time: "13:10", remaining: "06:50", player: 2, sit: "1451"}),
  ],
};
const fiveEvs = specialTeamsEvents(five);
assert.equal(fiveEvs.length, 2);
assert.equal(fiveEvs[0].title, "Oilers power play");
assert.equal(fiveEvs[0].body, "Power play: TOR #44 Rielly, 2 min tripping, 12:34 2nd");
assert.equal(fiveEvs[1].title, "Oilers 5-on-3");
assert.equal(fiveEvs[1].fiveOnThree, true);
assert.equal(fiveEvs[1].body, "Power play: TOR #34 Matthews, 2 min slashing, 13:10 2nd");

// Coincidental minors at the same timestamp: strength stays even, no alerts.
const even = structuredClone(five);
even.plays = [
  penalty({eventId: 21, team: 10, desc: "tripping", time: "08:00", player: 1}),
  penalty({eventId: 22, team: 22, desc: "hooking", time: "08:00", player: 3}),
];
assert.deepEqual(specialTeamsEvents(even), []);
assert.equal(netPenalties(even.plays, 22, 10).length, 0);

// Double minor keeps a 4-minute duration on the alert.
const dm = structuredClone(five);
dm.plays = [penalty({eventId: 31, team: 10, desc: "high-sticking-double-minor", duration: 4, time: "05:00", player: 1})];
const dmEv = specialTeamsEvents(dm)[0];
assert.equal(dmEv.duration, 4);
assert.equal(dmEv.body, "Power play: TOR #44 Rielly, 4 min high-sticking, 5:00 2nd");

// OT penalty still alerts (close-game is regulation-only; special teams are not).
const ot = structuredClone(five);
ot.plays = [penalty({eventId: 41, team: 10, desc: "tripping", time: "02:00", remaining: "03:00", period: 4, player: 1})];
ot.plays[0].periodDescriptor.periodType = "OT";
const otEv = specialTeamsEvents(ot)[0];
assert.equal(otEv.title, "Oilers power play");
assert.match(otEv.body, /2:00 OT$/);

// Durable outbox dedupes by penalty event id across re-polls.
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
  const env = {GAME_ALERTS_ENABLED: "1", GAME_ALERTS_SINCE: fixture.startTimeUTC, ALERTS_KV: new KV(), PUSH_QUEUE: {async sendBatch() {}}};
  const actor = new GameAlerts({storage: new MemoryStorage()}, env);
  actor.send = async () => ({sent: 0, failed: 0, gone: 0});
  actor.nhl = async () => ({games: []});
  await store.putSub(env, "fan", {endpoint: "https://push.test/fan", p256dh: "stub", auth: "stub", prefs: store.DEFAULTS}, new Date(time).toISOString());
  const g = structuredClone(fixture);
  g.gameState = "LIVE";
  g.clock = {timeRemaining: "16:10", secondsRemaining: 970, running: true, inIntermission: false};
  g.periodDescriptor = {number: 1, periodType: "REG", maxRegulationPeriods: 3};
  const hook = fixture.plays.find(p => p.eventId === 104);
  const after = fixture.plays.find(p => p.sortOrder > hook.sortOrder && p.typeDescKey !== "penalty");
  g.plays = fixture.plays.filter(p => p.eventId === 104 || p === after || (p.typeDescKey === "period-start" && p.periodDescriptor?.number === 1));
  const n = await actor.stage(g);
  assert.ok(n >= 1);
  const row = (await actor.storage.list({prefix: "pending:"})).get(`pending:${fixture.id}:penalty:104`);
  assert.ok(row);
  assert.equal(row.payload.title, "Penalty kill");
  assert.equal(row.log.detail.kind, "penalty_kill");
  assert.equal(row.log.detail.player, "Bouchard");
  assert.equal(row.log.detail.duration, 2);
  assert.equal(await actor.stage(g), 0, "same penalty is not re-staged");

  const fence = await worker.fetch(new Request("https://worker.test/notify", {method: "POST", headers: {Authorization: "Bearer test"}, body: JSON.stringify({type: "special_teams", title: "Oilers power play"})}), {NOTIFY_SECRET: "test", GAME_ALERTS_ENABLED: "1"}, {waitUntil() {}});
  assert.equal((await fence.json()).ignored, true);
} finally { Date.now = realNow; }

console.log("Special teams: PP/PK wording, coincidental silent, 5-on-3 and 4-min double minor, per-event dedupe, /notify fenced");
