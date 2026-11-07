// Inbox log: public read, lineup/final URLs unchanged, goal detail, notification deep link.
import assert from "node:assert/strict";
import fs from "node:fs";
import {describeAlert} from "../src/alert-log.js";
import * as store from "../src/store.js";
import worker from "../src/index.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../data/pbp/2026020260.json", import.meta.url)));
const goalPlay = fixture.plays.find(p => p.typeDescKey === "goal");
const goal = describeAlert(fixture, {id: `${fixture.id}:goal:${goalPlay.eventId}`, type: "goal"});
assert.equal(goal.detail.kind, "goal");
assert.equal(goal.detail.period, "1st");
assert.equal(goal.detail.time, "9:26");
assert.equal(goal.detail.strength, "power play");
assert.equal(goal.detail.awayScore, 1);
assert.equal(goal.detail.homeScore, 0);
assert.equal(goal.detail.assists.length, 2);
assert.ok(goal.detail.scorer);
assert.equal(goal.matchup, "Ducks @ Oilers");

class KV {
  data = new Map();
  async get(k, type) { const v = this.data.get(k) ?? null; return type === "json" && v !== null ? JSON.parse(v) : v; }
  async put(k, value) { this.data.set(k, value); }
  async delete(k) { this.data.delete(k); }
  async list() { return {keys: [...this.data.keys()].map(name => ({name, metadata: null})), list_complete: true}; }
}
const kv = new KV();
const jobs = [];
const ctx = {waitUntil(p) { jobs.push(Promise.resolve(p)); }};
const env = {NOTIFY_SECRET: "test", ADMIN_SECRET: "admin", GAME_ALERTS_ENABLED: "0", ALERTS_KV: kv, VAPID_PUBLIC_KEY: "test", VAPID_PRIVATE_KEY: "test"};
async function post(body) {
  return worker.fetch(new Request("https://worker.test/notify", {method: "POST", headers: {Authorization: "Bearer test", "Content-Type": "application/json"}, body: JSON.stringify(body)}), env, ctx);
}
let res = await post({id: "2026020276:lineup:goalie", type: "lineup", title: "Confirmed starter: Devon Levi in goal for the Oilers", body: "Devon Levi starts vs Canucks.", url: "/players.html", matchup: "Canucks @ Oilers", away: "VAN", home: "EDM", detail: {kind: "starter", starter: "Devon Levi", opponent: "Canucks"}});
assert.equal(res.status, 200);
res = await post({id: "2026020260:final", type: "final", title: "FINAL: EDM 4, ANA 5", body: "Oilers fall 4-5 vs the Ducks.", url: "/game.html?id=2026020260"});
assert.equal(res.status, 200);
await Promise.all(jobs);
const log = await store.readAlertLog(env);
const starter = log.find(a => a.id.endsWith(":goalie"));
const fin = log.find(a => a.type === "final");
assert.equal(starter.url, "/players.html");
assert.equal(starter.detail.kind, "starter");
assert.equal(starter.detail.starter, "Devon Levi");
assert.equal(starter.matchup, "Canucks @ Oilers");
assert.equal(fin.url, "/game.html?id=2026020260");
assert.equal(log[0].id, fin.id); // newer write is first when timestamps differ; same ms keeps insertion order
const pub = await worker.fetch(new Request("https://worker.test/alerts/log", {headers: {Origin: "https://copperandbluenews.com"}}), env, ctx);
assert.equal(pub.status, 200);
assert.equal(pub.headers.get("access-control-allow-origin"), "https://copperandbluenews.com");
const body = await pub.json();
assert.equal(body.alerts.length, 2);
assert.equal((await worker.fetch(new Request("https://worker.test/alerts/log", {headers: {Origin: "https://evil.example"}}), env, ctx)).status, 403);
const again = await (await post({id: "2026020276:lineup:goalie", type: "lineup", title: "again", body: "x", url: "/players.html"})).json();
assert.equal(again.duplicate, true);
await Promise.all(jobs);
assert.equal((await store.readAlertLog(env)).length, 2);

const sw = fs.readFileSync(new URL("../../sw.js", import.meta.url), "utf8");
assert.match(sw, /VERSION = "cbn-v43"/);
assert.match(sw, /\/notifications\.html\?id=/);
assert.match(sw, /id: typeof d\.id === "string"/);
assert.match(sw, /\/standings\.html/);
console.log("Alert log HTTP: lineup URL /players.html and final URL /game.html?id= are unchanged; /alerts/log is public and CORS-limited; click deep-links by id");
