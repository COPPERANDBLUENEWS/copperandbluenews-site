// End-to-end test against `wrangler dev` (local KV + local queue) and a mock push service.
// 1) node test/integration.test.mjs --setup   writes .dev.vars with a THROWAWAY VAPID key + test secrets
// 2) npx wrangler dev --port 8787             (other terminal)
// 3) node test/integration.test.mjs           runs the checks
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";

if (process.argv[2] === "--setup") {
  const k = crypto.createECDH("prime256v1"); k.generateKeys();
  fs.writeFileSync(".dev.vars", [
    `VAPID_PUBLIC_KEY="${k.getPublicKey().toString("base64url")}"`, `VAPID_PRIVATE_KEY="${k.getPrivateKey().toString("base64url")}"`,
    `NOTIFY_SECRET="local-notify-test"`, `ADMIN_SECRET="local-admin-test"`, `EXTRA_ORIGINS="http://localhost:8000"`, `ALLOW_ANY_PUSH_HOST="1"`, ""].join("\n"), {mode: 0o600});
  console.log("wrote .dev.vars (throwaway VAPID key)"); process.exit(0);
}
const W = process.env.W || "http://localhost:8787", SITE = {"Content-Type": "application/json", Origin: "https://copperandbluenews.com"};
const hits = [];
const mock = http.createServer((req, res) => { req.resume(); req.on("end", () => {
  hits.push({path: req.url, enc: req.headers["content-encoding"], auth: (req.headers.authorization || "").slice(0, 8)});
  res.writeHead(req.url.includes("dead") ? 410 : 201).end(); }); }).listen(9911);
const keys = () => { const e = crypto.createECDH("prime256v1"); e.generateKeys(); return {p256dh: e.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url")}; };
const post = (path, body, headers = SITE) => fetch(W + path, {method: "POST", headers, body: JSON.stringify(body)});
const notify = (body, secret = "local-notify-test") => post("/notify", body, {"Content-Type": "application/json", Authorization: "Bearer " + secret});
const exportCsv = async () => (await fetch(W + "/export", {headers: {Authorization: "Bearer local-admin-test"}})).text();
const wait = ms => new Promise(r => setTimeout(r, ms));
const tag = Date.now();

const all = {puck_drop: true, goal: true, period_end: true, final: true, lineup: true}; // no odds/gameday keys: defaults apply
let r = await post("/subscribe", {subscription: {endpoint: `http://127.0.0.1:9911/alive-${tag}`, keys: keys()}, prefs: all, email: "=Test Fan"});
assert.equal(r.status, 200); assert.equal(r.headers.get("access-control-allow-origin"), "https://copperandbluenews.com");
r = await post("/subscribe", {subscription: {endpoint: `http://127.0.0.1:9911/dead-${tag}`, keys: keys()}, prefs: all});
assert.equal(r.status, 200);
r = await post("/subscribe", {subscription: {endpoint: `http://127.0.0.1:9911/nogoals-${tag}`, keys: keys()}, prefs: {...all, goal: false}});
assert.equal(r.status, 200);
assert.equal((await post("/subscribe", {}, {...SITE, Origin: "https://evil.example"})).status, 403);
const pre = await fetch(W + "/subscribe", {method: "OPTIONS", headers: {Origin: "https://www.copperandbluenews.com", "Access-Control-Request-Method": "POST"}});
assert.equal(pre.status, 204); assert.equal(pre.headers.get("access-control-allow-origin"), "https://www.copperandbluenews.com");
console.log("subscribe + CORS: ok");

assert.equal((await notify({type: "goal", title: "x"}, "wrong")).status, 401);
let n = await (await notify({id: `t${tag}:goal:1`, type: "goal", title: "GOAL", body: "b", url: "/tracker.html"})).json();
assert.equal(n.recipients, 2, JSON.stringify(n));   // alive + dead (nogoals opted out)
n = await (await notify({id: `t${tag}:goal:1`, type: "goal", title: "GOAL again", body: "b"})).json();
assert.equal(n.duplicate, true);
console.log("notify + prefs filter + dedupe: ok");
await wait(4000);
const mine = hits.filter(h => h.path.endsWith(String(tag)));
assert.equal(mine.length, 2, JSON.stringify(mine)); assert.ok(mine.every(h => h.enc === "aes128gcm" && h.auth === "vapid t="));
let csv = await exportCsv();
assert.ok(!csv.includes(`dead-${tag}`), "dead sub should be deleted after 410");
assert.ok(csv.includes(`alive-${tag}`) && csv.includes("'=Test Fan"));
assert.ok(csv.startsWith("id,email,puck_drop,goal,period_end,final,lineup,odds,gameday,"), csv.split("\n")[0]);
const aliveRow = csv.split("\r\n").find(l => l.includes(`alive-${tag}`)).split(",");
assert.deepEqual(aliveRow.slice(2, 9), ["1", "1", "1", "1", "1", "0", "1"]); // prefs without odds/gameday: odds OFF, gameday ON
console.log("push delivery + 410 cleanup + CSV export + new-type defaults: ok");
r = await post("/subscribe", {subscription: {endpoint: `http://127.0.0.1:9911/odds-${tag}`, keys: keys()}, prefs: {...all, odds: true}});
assert.equal(r.status, 200);
n = await (await notify({id: `t${tag}:odds:pregame`, type: "odds", title: "Odds", body: "Oilers -192 | Ducks +158 · 19+ · Play responsibly"})).json();
assert.equal(n.recipients, 1, JSON.stringify(n)); // only the odds opt-in
n = await (await notify({id: `t${tag}:period_end:1`, type: "period_end", title: "End of 1st", body: "b", alt: {pref: "odds", body: "b + live moneyline"}})).json();
assert.equal(n.recipients, 3, JSON.stringify(n)); // alive, nogoals, odds (alt body only for the odds one)
await wait(4000);
assert.equal(hits.filter(h => h.path.endsWith(`odds-${tag}`)).length, 2);
console.log("odds opt-in + alt body fan-out: ok");
await post("/unsubscribe", {endpoint: `http://127.0.0.1:9911/odds-${tag}`});

await post("/unsubscribe", {endpoint: `http://127.0.0.1:9911/alive-${tag}`});
await post("/unsubscribe", {endpoint: `http://127.0.0.1:9911/nogoals-${tag}`});
csv = await exportCsv();
assert.ok(!csv.includes(String(tag)));
assert.equal((await fetch(W + "/export")).status, 401);
console.log("unsubscribe + export auth: ok");
mock.close();
