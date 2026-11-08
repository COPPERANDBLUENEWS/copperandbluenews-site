// Quick Match: pair two humans inside the wait, then Copper, with no ghost queue.
// The lobby runs on node:sqlite. Computer games never open a match or change rating.
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {AirHockeyLobby, QUICK_WAIT_MS} from "../src/airhockey-lobby.js";

assert.equal(QUICK_WAIT_MS, 8000);

function makeLobby() {
  const db = new DatabaseSync(":memory:");
  let boot;
  const calls = [];
  const ctx = {
    storage: {
      sql: {
        exec(query, ...args) {
          const stmt = db.prepare(query);
          if (/^\s*(SELECT|PRAGMA)/i.test(query)) return {toArray: () => stmt.all(...args)};
          stmt.run(...args);
          return {toArray: () => []};
        },
      },
      transactionSync(fn) {
        db.exec("BEGIN");
        try { fn(); db.exec("COMMIT"); }
        catch (e) { db.exec("ROLLBACK"); throw e; }
      },
    },
    blockConcurrencyWhile(fn) { boot = fn(); return boot; },
  };
  const env = {
    AIRHOCKEY_MATCH: {
      idFromName(name) { return name; },
      get(id) {
        return {async fetch() { calls.push(id); return new Response("ok", {status: 200}); }};
      },
    },
  };
  const lobby = new AirHockeyLobby(ctx, env);
  return {lobby, boot, calls, db};
}

async function body(res) {
  const data = await res.json();
  data._status = res.status;
  return data;
}
const queueCount = lobby => lobby.one("SELECT COUNT(*) AS n FROM queue").n;
const matchCount = lobby => lobby.one("SELECT COUNT(*) AS n FROM matches").n;
const resultCount = lobby => lobby.one("SELECT COUNT(*) AS n FROM results").n;

async function signup(lobby, username) {
  const res = await body(await lobby.signup({username, ip: "ip-" + username}));
  assert.equal(res.ok, true, res.error || "signup");
  return res;
}
async function poll(lobby, token) {
  return body(await lobby.quickPoll(new URL("https://lobby.internal/quick?token=" + encodeURIComponent(token))));
}
async function join(lobby, token, ip) {
  return body(await lobby.quick({token, ip: ip || "ip-" + token.slice(0, 6)}));
}
async function leave(lobby, token) {
  return body(await lobby.quickLeave(new URL("https://lobby.internal/quick?token=" + encodeURIComponent(token))));
}

const {lobby, boot, calls} = makeLobby();
await boot;
let now = 1_700_000_000_000;
lobby.now = () => now;

const a = await signup(lobby, "Rink_Ace");
const b = await signup(lobby, "Bay_Blue");
const beforeA = a.user.rating;
const beforeB = b.user.rating;
assert.equal(beforeA, 1000);
assert.equal(a.user.wins, 0);

let qa = await join(lobby, a.token, "net-a");
assert.equal(qa.status, "queued");
assert.equal(qa.waitMs, QUICK_WAIT_MS);
assert.equal(queueCount(lobby), 1);
assert.equal(calls.length, 0);

now += 5000;
qa = await join(lobby, a.token, "net-a");
assert.equal(qa.status, "queued");
assert.equal(qa.waitMs, 3000, "a second tap does not extend the wait");

now += 2999;
qa = await poll(lobby, a.token);
assert.equal(qa.status, "queued");
assert.equal(qa.waitMs, 1);

const qb = await join(lobby, b.token, "net-b");
assert.equal(qb.status, "matched");
assert.equal(qb.seat, "north");
assert.equal(qb.opponent, "Rink_Ace");
assert.equal(qb.you, "Bay_Blue");
assert.equal(queueCount(lobby), 0);
assert.equal(matchCount(lobby), 1);
assert.equal(calls.length, 1);

now += QUICK_WAIT_MS;
qa = await poll(lobby, a.token);
assert.equal(qa.status, "matched", "a paired player is not sent to Copper after the wait");
assert.equal(qa.matchId, qb.matchId);
assert.equal(qa.seat, "south");
assert.equal(qa.opponent, "Bay_Blue");

await leave(lobby, a.token);
qa = await join(lobby, a.token, "net-a");
assert.equal(qa.status, "matched", "leaving the queue after a match does not drop the human game");
assert.equal(qa.matchId, qb.matchId);
assert.equal(matchCount(lobby), 1);

const recorded = await body(await lobby.result({
  matchId: qb.matchId, gameNo: 1,
  southId: a.user.id, northId: b.user.id,
  southName: "Rink_Ace", northName: "Bay_Blue",
  southScore: 3, northScore: 1, winnerId: a.user.id,
  tie: false, ot: false, forfeit: false, durationSec: 90,
}));
assert.equal(recorded.ok, true);
assert.equal(recorded.records[a.user.id].wins, 1);
assert.equal(recorded.records[b.user.id].losses, 1);
assert.equal(recorded.records[a.user.id].rating, 1016);
assert.equal(recorded.records[b.user.id].rating, 984);
assert.equal(resultCount(lobby), 1);

const c = await signup(lobby, "Solo_C");
const ratingC = c.user.rating;
const winsC = c.user.wins;
now += 1000;
let qc = await join(lobby, c.token, "net-c");
assert.equal(qc.status, "queued");
const queuedAt = now;
now = queuedAt + QUICK_WAIT_MS - 1;
qc = await poll(lobby, c.token);
assert.equal(qc.status, "queued");
assert.equal(queueCount(lobby), 1);
now = queuedAt + QUICK_WAIT_MS;
qc = await poll(lobby, c.token);
assert.equal(qc.status, "copper");
assert.equal(qc.computer, true);
assert.equal(qc.opponent, "Copper");
assert.equal(queueCount(lobby), 0);
assert.equal(matchCount(lobby), 1, "Copper does not open a multiplayer match");
assert.equal(calls.length, 1);
qc = await poll(lobby, c.token);
assert.equal(qc.status, "idle");
assert.equal(resultCount(lobby), 1);
const still = lobby.one("SELECT wins, losses, rating FROM users WHERE id = ?", c.user.id);
assert.equal(still.wins, winsC);
assert.equal(still.losses, 0);
assert.equal(still.rating, ratingC);

const ghost = await signup(lobby, "Ghost_G");
now += 10;
await join(lobby, ghost.token, "net-g");
now += QUICK_WAIT_MS;
const later = await signup(lobby, "Later_L");
const ql = await join(lobby, later.token, "net-l");
assert.equal(ql.status, "queued", "an expired search is not a waiting human");
assert.equal(ql.opponent, undefined);
assert.equal(matchCount(lobby), 1);
const ghostPoll = await poll(lobby, ghost.token);
assert.equal(ghostPoll.status, "idle");
assert.equal(queueCount(lobby), 1);

now += 1000;
const mate = await signup(lobby, "Mate_M");
const qm = await join(lobby, mate.token, "net-m");
assert.equal(qm.status, "matched");
assert.equal(qm.opponent, "Later_L");
assert.notEqual(qm.opponent, "Ghost_G");
const ghostAgain = await join(lobby, ghost.token, "net-g");
assert.equal(ghostAgain.status, "queued", "a player who already fell through does not join that match");
assert.equal(matchCount(lobby), 2);

await leave(lobby, ghost.token);
assert.equal(queueCount(lobby), 0);
now += 500;
const afterCancel = await signup(lobby, "After_X");
const qx = await join(lobby, afterCancel.token, "net-x");
assert.equal(qx.status, "queued");
assert.equal(qx.opponent, undefined);
const ghostIdle = await poll(lobby, ghost.token);
assert.equal(ghostIdle.status, "idle");

now += QUICK_WAIT_MS;
const claimed = await poll(lobby, afterCancel.token);
assert.equal(claimed.status, "copper");
const denied = await body(await lobby.result({
  matchId: "m_notamatch", gameNo: 1,
  southId: afterCancel.user.id, northId: c.user.id,
  southScore: 1, northScore: 0, winnerId: afterCancel.user.id, tie: false,
}));
assert.equal(denied._status, 404);
const unchanged = lobby.one("SELECT wins, rating FROM users WHERE id = ?", afterCancel.user.id);
assert.equal(unchanged.wins, 0);
assert.equal(unchanged.rating, 1000);

const missing = await join(lobby, "not-a-real-token", "net-z");
assert.equal(missing._status, 401);
console.log("airhockey quick pass", {waitMs: QUICK_WAIT_MS, matches: matchCount(lobby), results: resultCount(lobby)});
