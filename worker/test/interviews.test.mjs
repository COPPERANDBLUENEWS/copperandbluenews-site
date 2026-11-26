// Interview alerts: one new video, a post-game batch, no resend of known ids,
// existing sign-ups opted in, and an explicit opt-out.
import assert from "node:assert/strict";
import fs from "node:fs";
import * as interviews from "../src/interviews.js";
import * as store from "../src/store.js";
import worker from "../src/index.js";

const NOW = Date.parse("2026-11-26T06:30:00Z");
const recent = new Date(NOW - 2 * 3600 * 1000).toISOString();
const old = new Date(NOW - 10 * 24 * 3600 * 1000).toISOString();

function video(id, type, name, published = recent) {
  const label = type === "Pre-Raw" ? "PRE-RAW" : "POST-RAW";
  return {id, type, title: `${label} | ${name} 11.24.26`, published, url: `https://www.youtube.com/watch?v=${id}`};
}

const babcock = video("nhzv2CqF0HA", "Post-Raw", "Mike Babcock");
const mcdavid = video("D5sQV9mA8uc", "Post-Raw", "Connor McDavid");
const bouchard = video("vNqFAsXKnjY", "Post-Raw", "Evan Bouchard");
const ekholm = video("GPvBSgKOrrI", "Pre-Raw", "Mattias Ekholm");

assert.equal(interviews.interviewName(babcock.title), "Babcock");
assert.equal(interviews.interviewName(mcdavid.title, true), "Connor McDavid");
assert.equal(interviews.interviewName("PRE-RAW | Ryan Nugent-Hopkins 11.24.26"), "Nugent-Hopkins");

const one = interviews.planInterviewAlerts([babcock], ["seeded"], {notifyIds: [babcock.id], now: NOW});
assert.equal(one.alerts.length, 1);
assert.equal(one.alerts[0].title, "Post-Raw: Mike Babcock");
assert.equal(one.alerts[0].url, "/news.html?v=nhzv2CqF0HA#raw-nhzv2CqF0HA");
assert.equal(one.alerts[0].type, "interviews");
assert.match(one.alerts[0].detail.youtube, /^https:\/\/www\.youtube\.com\/watch\?v=nhzv2CqF0HA$/);

const batch = interviews.planInterviewAlerts([babcock, mcdavid, bouchard], ["seeded"], {notifyIds: [babcock.id, mcdavid.id, bouchard.id], now: NOW});
assert.equal(batch.alerts.length, 1);
assert.equal(batch.alerts[0].title, "3 new Post-Raw interviews: Babcock, McDavid, Bouchard");
assert.equal(batch.alerts[0].url, "/news.html#raw");
assert.equal(batch.alerts[0].body, "Babcock, McDavid, Bouchard");

const mixed = interviews.planInterviewAlerts([babcock, mcdavid, bouchard, ekholm], ["seeded"], {
  notifyIds: [babcock.id, mcdavid.id, bouchard.id, ekholm.id], now: NOW,
});
assert.equal(mixed.alerts.length, 2);
assert.equal(mixed.alerts.find(a => a.detail.interviewType === "Pre-Raw").url, "/news.html?v=GPvBSgKOrrI#raw-GPvBSgKOrrI");

const again = interviews.planInterviewAlerts([babcock], [babcock.id], {notifyIds: [babcock.id], now: NOW});
assert.equal(again.alerts.length, 0);
assert.equal(again.fresh.length, 0);

const library = Array.from({length: 40}, (_, i) => video(`old${String(i).padStart(8, "0")}`.slice(0, 11), i % 2 ? "Pre-Raw" : "Post-Raw", "Library", old));
assert.equal(new Set(library.map(v => v.id)).size, 40);
const seeded = interviews.planInterviewAlerts(library, null, {notifyIds: [], now: NOW});
assert.equal(seeded.bootstrap, true);
assert.equal(seeded.alerts.length, 0);
assert.equal(seeded.nextSeen.length, 40);
const recentLibraryQuiet = library.map(v => ({...v, published: recent}));
const quiet = interviews.planInterviewAlerts(recentLibraryQuiet, null, {notifyIds: [], now: NOW});
assert.equal(quiet.alerts.length, 0);
assert.equal(quiet.bootstrap, true);
assert.equal(quiet.nextSeen.length, 40);

const dump = interviews.planInterviewAlerts(library, null, {notifyIds: library.map(v => v.id), now: NOW});
assert.equal(dump.alerts.length, 0);
assert.equal(dump.suppressed, 0); // the library is older than 72h, so it is not a fresh batch either
const recentLibrary = library.map(v => ({...v, published: recent}));
const suppressed = interviews.planInterviewAlerts(recentLibrary, null, {notifyIds: recentLibrary.map(v => v.id), now: NOW});
assert.equal(suppressed.alerts.length, 0);
assert.equal(suppressed.suppressed, 40);
assert.equal(suppressed.nextSeen.length, 40);

const withNew = interviews.planInterviewAlerts([...library, mcdavid], null, {notifyIds: [mcdavid.id], now: NOW});
assert.equal(withNew.alerts.length, 1);
assert.equal(withNew.alerts[0].id, "interview:D5sQV9mA8uc");
assert.ok(withNew.nextSeen.includes(mcdavid.id));
assert.ok(withNew.nextSeen.includes(library[0].id));

const stale = interviews.planInterviewAlerts([video("GPvBSgKOrrI", "Pre-Raw", "Mattias Ekholm", old)], ["seeded"], {notifyIds: ["GPvBSgKOrrI"], now: NOW});
assert.equal(stale.alerts.length, 0);

// Existing sign-ups (mask v4, no interviews bit) stay opted in. A saved opt-out stays off.
class KV {
  data = new Map();
  meta = new Map();
  async get(k, type) { const v = this.data.get(k) ?? null; return type === "json" && v !== null ? JSON.parse(v) : v; }
  async put(k, value, opts = {}) { this.data.set(k, value); if (opts.metadata) this.meta.set(k, opts.metadata); }
  async delete(k) { this.data.delete(k); this.meta.delete(k); }
  async list({prefix} = {}) {
    const keys = [...this.data.keys()].filter(n => !prefix || n.startsWith(prefix)).map(name => ({name, metadata: this.meta.get(name) || null}));
    return {keys, list_complete: true};
  }
}
const kv = new KV();
const env = {NOTIFY_SECRET: "test", ADMIN_SECRET: "admin", GAME_ALERTS_ENABLED: "1", ALERTS_KV: kv, VAPID_PUBLIC_KEY: "test", VAPID_PRIVATE_KEY: "test"};
const jobs = [];
const ctx = {waitUntil(p) { jobs.push(Promise.resolve(p)); }};
const mask = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10].reduce((m, i) => m | (1 << i), 0);
const oldRec = {v: 4, e: "https://updates.push.services.mozilla.com/wpush/v2/old", k: "k", a: "a", m: mask, n: "", c: "c", u: "u"};
await kv.put("sub:old", JSON.stringify(oldRec), {metadata: oldRec});
const legacy = await store.getSub(env, "old");
assert.equal(legacy.prefs.interviews, true);
assert.equal(legacy.prefs.odds, false);
assert.equal(legacy.prefs.goal, true);
await store.putSub(env, "off", {endpoint: "https://updates.push.services.mozilla.com/wpush/v2/off", p256dh: "k", auth: "a", prefs: {...store.DEFAULTS, interviews: false}}, "2026-11-26T00:00:00Z");
assert.equal((await store.getSub(env, "off")).prefs.interviews, false);
await store.putSub(env, "on", {endpoint: "https://updates.push.services.mozilla.com/wpush/v2/on", p256dh: "k", auth: "a", prefs: store.DEFAULTS}, "2026-11-26T00:00:00Z");

async function post(body, auth = "Bearer test") {
  return worker.fetch(new Request("https://worker.test/interviews", {
    method: "POST", headers: {Authorization: auth, "Content-Type": "application/json"}, body: JSON.stringify(body),
  }), env, ctx);
}
let res = await post({videos: library, notify: []}, "");
assert.equal(res.status, 401);
res = await post({videos: library, notify: []});
assert.equal(res.status, 200);
let body = await res.json();
assert.equal(body.bootstrapped, true);
assert.equal(body.new, 0);
assert.equal(body.seen, 40);
assert.equal((await store.getInterviewSeen(env)).length, 40);

res = await post({videos: [...library, babcock, mcdavid, bouchard], notify: [babcock.id, mcdavid.id, bouchard.id]});
body = await res.json();
assert.equal(body.new, 3);
assert.equal(body.alerts.length, 1);
assert.equal(body.alerts[0].recipients, 2); // legacy default-on + explicit on; the opt-out is excluded
assert.equal(body.alerts[0].duplicate, undefined);
await Promise.all(jobs);
const log = await store.readAlertLog(env);
assert.equal(log.length, 1);
assert.equal(log[0].type, "interviews");
assert.equal(log[0].url, "/news.html#raw");
assert.equal(log[0].title, "3 new Post-Raw interviews: Babcock, McDavid, Bouchard");

res = await post({videos: [...library, babcock, mcdavid, bouchard], notify: [babcock.id, mcdavid.id, bouchard.id]});
body = await res.json();
assert.equal(body.new, 0);
assert.equal(body.alerts.length, 0);
await Promise.all(jobs);
assert.equal((await store.readAlertLog(env)).length, 1);

res = await post({videos: [...library, babcock, mcdavid, bouchard, ekholm], notify: [ekholm.id]});
body = await res.json();
assert.equal(body.new, 1);
assert.equal(body.alerts[0].recipients, 2);
await Promise.all(jobs);
const single = (await store.readAlertLog(env)).find(a => a.detail?.videoId === ekholm.id);
assert.equal(single.url, "/news.html?v=GPvBSgKOrrI#raw-GPvBSgKOrrI");
assert.equal(single.detail.youtube, "https://www.youtube.com/watch?v=GPvBSgKOrrI");

const sw = fs.readFileSync(new URL("../../sw.js", import.meta.url), "utf8");
assert.match(sw, /VERSION = "cbn-v56"/);
assert.match(sw, /data\.type === "interviews"/);
assert.match(sw, /\/notifications\.html\?id=/);
const pwa = fs.readFileSync(new URL("../../js/pwa.js", import.meta.url), "utf8");
assert.match(pwa, /"interviews", "Pre-Raw &amp; Post-Raw interviews", true/);
const page = fs.readFileSync(new URL("../../notifications.html", import.meta.url), "utf8");
assert.match(page, /id="alertSettingsPage"/);
assert.match(page, /Pre-Raw and Post-Raw interviews/);
console.log("Interview alerts: new video, batched Post-Raw, baseline of 40 not sent, opt-out excluded, legacy sign-ups included");
