// Two simulated clients, a laggy network, and the real match actor.
// Latency, jitter, and drops are applied in both directions. A disconnect
// freezes the clock; a reconnect keeps the score and resumes it.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {AirHockeyMatch} from "../src/airhockey-match.js";
import {REG_MS} from "../src/airhockey-physics.js";

const require = createRequire(import.meta.url);
const net = require("../../js/airhockey-net.js");

assert.equal(net.reconnectDelay(0), 200);
assert.equal(net.reconnectDelay(1), 400);
assert.equal(net.reconnectDelay(2), 800);
assert.equal(net.reconnectDelay(4), 1500);
assert.equal(net.pingBars(-1), 0);
assert.equal(net.pingBars(40), 4);
assert.equal(net.pingBars(100), 3);
assert.equal(net.pingBars(200), 2);
assert.equal(net.pingBars(800), 1);
assert.equal(net.isStale(-1, 4), false);
assert.equal(net.isStale(8, 8), true);
assert.equal(net.isStale(8, 9), false);
assert.equal(net.isStale(9000, 1), false);

const buf = net.createBuffer(100);
net.pushSample(buf, 1000, {ts: 1000, k: [0, 0, 1000, 0], a: [10, 10], b: [20, 20]});
net.pushSample(buf, 1100, {ts: 1100, k: [20, 0, 1000, 0], a: [12, 10], b: [22, 20]});
const mid = net.sampleBuffer(buf, 1150);
assert.ok(Math.abs(mid.puck[0] - 10) < 0.2, "interpolates the puck halfway, got " + mid.puck[0]);
const coast = net.sampleBuffer(buf, 1400);
assert.ok(coast.puck[0] <= 20 + 80.01, "puck extrapolation stays inside 80 ms");
assert.ok(coast.gap > 0);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCtx(store, sockets = []) {
  const ctx = {
    alarmAt: 0,
    storage: {
      async get(k) { return store.has(k) ? structuredClone(store.get(k)) : undefined; },
      async put(k, v) { store.set(k, structuredClone(v)); },
      async setAlarm(t) { ctx.alarmAt = t; },
    },
    getWebSockets() { return sockets; },
    acceptWebSocket(ws, tags) { ws.tags = tags; },
    blockConcurrencyWhile(fn) { ctx.boot = Promise.resolve().then(fn); return ctx.boot; },
  };
  return ctx;
}

function fakeSocket() {
  return {
    readyState: 1, att: null, sent: [], tags: null,
    serializeAttachment(v) { this.att = v; },
    deserializeAttachment() { return this.att; },
    send() {},
    close() { this.readyState = 3; },
    accept() {},
    addEventListener() {},
  };
}

const env = {AIRHOCKEY_MANUAL_TICK: "1"};
const store = new Map();
const ctx = makeCtx(store);
const match = new AirHockeyMatch(ctx, env);
await ctx.boot;
await match.init({
  matchId: "m_0123456789abcdef",
  south: {id: "s1", name: "ace", rating: 1000},
  north: {id: "n1", name: "bay", rating: 1100},
});

const sim = {time: 0, q: []};
const BASE = 1_700_000_000_000;
match.now = () => BASE + sim.time;
sim.at = (t, fn) => { sim.q.push({t, fn}); };
sim.flush = () => {
  sim.q.sort((a, b) => a.t - b.t);
  const due = [];
  while (sim.q.length && sim.q[0].t <= sim.time + 0.001) due.push(sim.q.shift());
  for (const item of due) item.fn();
};

const rng = mulberry32(7);
const opts = {latency: 90, jitter: 40, drop: 0.12};

function wire(client) {
    client.socket.send = raw => {
    const msg = JSON.parse(raw);
    client.inbox.push(msg);
    if (rng() < opts.drop) return;
    const lag = Math.max(0, opts.latency + (rng() - 0.5) * 2 * opts.jitter);
    const at = sim.time + lag;
    sim.at(at, () => client.receive(msg, BASE + at));
  };
  return client;
}

function makeClient(seat) {
  const client = {
    seat, socket: fakeSocket(), inbox: [], ping: 0, lastN: -1, buf: net.createBuffer(100),
    samples: [], score: null, oppGrace: 0, sawDisc: false,
    receive(msg, recv) {
      if (msg.t === "disc") this.sawDisc = true;
      if (msg.t !== "s") return;
      if (net.isStale(this.lastN, msg.n)) return;
      this.lastN = msg.n | 0;
      net.pushSample(this.buf, recv, msg);
      this.score = msg.sc.slice();
      const left = seat === "south" ? msg.gr[1] : msg.gr[0];
      if (left > this.oppGrace) this.oppGrace = left;
    },
    sample(now) {
      const view = net.sampleBuffer(this.buf, now);
      if (!view) return;
      this.samples.push(view.puck.slice());
    },
    send(obj) {
      if (this.socket.readyState !== 1) return;
      if (rng() < opts.drop) return;
      const lag = Math.max(0, opts.latency + (rng() - 0.5) * 2 * opts.jitter);
      const text = JSON.stringify(obj);
      const at = sim.time + lag;
      const ws = this.socket;
      sim.at(at, () => {
        if (ws.readyState !== 1 || match.sockets[seat] !== ws) return;
        match.webSocketMessage(ws, text);
      });
    },
  };
  return wire(client);
}

const south = makeClient("south");
const north = makeClient("north");
const auth = (seat, id, name, opp, oppId, oppName) => ({
  seat, id, username: name, opponent: opp, rating: 1000, wins: 4, losses: 2, ties: 1, otl: 1, gp: 8,
  oppStats: {id: oppId, username: oppName, rating: 1040, wins: 6, losses: 3, ties: 0, otl: 2, gp: 11},
});
match.attach(south.socket, auth("south", "s1", "ace", "bay", "n1", "bay"));
match.attach(north.socket, auth("north", "n1", "bay", "ace", "s1", "ace"));
match.game.rng = mulberry32(99);
assert.equal(match.game.phase, "versus");
const hello = south.inbox.find(m => m.t === "hello");
assert.ok(hello, "hello missing");
assert.equal(hello.rec.w, 4);
assert.equal(hello.oppRec.name, "bay");
assert.equal(hello.oppRec.elo, 1040);

match.webSocketMessage(south.socket, JSON.stringify({t: "i", s: 1, x: 200, y: 500, ts: 10}));
match.webSocketMessage(south.socket, JSON.stringify({t: "i", s: 2, x: 300, y: 500, ts: 20}));
assert.equal(match.game.south.tx, 300);
match.webSocketMessage(south.socket, JSON.stringify({t: "i", s: 2, x: 40, y: 500, ts: 30}));
match.webSocketMessage(south.socket, JSON.stringify({t: "i", s: 1, x: 40, y: 500, ts: 1}));
assert.equal(match.game.south.tx, 300, "stale input is dropped");

const clients = [south, north];
function pump(ms) {
  const end = sim.time + ms;
  let nextBeat = sim.time;
  while (sim.time < end - 0.01) {
    sim.time += 1000 / 60;
    if (sim.time >= nextBeat) {
      nextBeat += 1000;
      for (const c of clients) c.send({t: "h", s: ++c.ping});
    }
    match.tick();
    sim.flush();
    if (match.game.phase === "playing" && !match.game.paused) {
      for (const c of clients) c.sample(BASE + sim.time);
    }
  }
}

const clock0 = match.game.clock;
pump(3200);
assert.equal(match.game.clock, clock0, "VS intro and faceoff do not spend the clock");
assert.notEqual(match.game.phase, "versus");
let guard = 0;
while (match.game.phase !== "playing" && guard++ < 40) pump(100);
assert.equal(match.game.phase, "playing");
assert.ok(match.game.clock > REG_MS - 300, "clock starts with the full two minutes");
const started = match.game.clock;
pump(2000);
assert.ok(started - match.game.clock > 1500, "clock runs during play, left " + match.game.clock);
for (const client of [south, north]) {
  assert.ok(client.score, client.seat + " never got a snapshot");
  assert.ok(Math.abs(client.score[0] - match.game.score.south) <= 1);
  assert.ok(Math.abs(client.score[1] - match.game.score.north) <= 1);
}

function maxStep(samples) {
  let max = 0, span = 0;
  for (let i = 1; i < samples.length; i++) {
    max = Math.max(max, Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]));
    span = Math.max(span, Math.hypot(samples[i][0] - samples[0][0], samples[i][1] - samples[0][1]));
  }
  return {max, span, n: samples.length};
}
const southMove = maxStep(south.samples);
const northMove = maxStep(north.samples);
assert.ok(southMove.n > 40 && northMove.n > 40, "both clients rendered a buffer");
assert.ok(southMove.span > 15 && northMove.span > 15, "puck actually moved " + JSON.stringify({southMove, northMove}));
assert.ok(southMove.max < 48, "south puck teleported " + southMove.max);
assert.ok(northMove.max < 48, "north puck teleported " + northMove.max);

const frozen = match.game.clock;
const score = match.game.score.south + "-" + match.game.score.north;
north.socket.readyState = 3;
match.webSocketClose(north.socket);
assert.equal(match.game.paused, true);
pump(2000);
assert.equal(match.game.paused, true);
assert.equal(match.game.clock, frozen, "clock stays frozen while the opponent is gone");
assert.equal(match.game.score.south + "-" + match.game.score.north, score);
assert.ok(south.sawDisc || south.oppGrace > 0, "remaining player is told about the reconnect window");

const resumed = fakeSocket();
north.socket = resumed;
wire(north);
match.attach(resumed, auth("north", "n1", "bay", "ace", "s1", "ace"));
assert.equal(match.game.paused, false);
assert.equal(match.game.clock, frozen);
assert.equal(match.game.score.south + "-" + match.game.score.north, score);
assert.ok(["playing", "goal", "faceoff"].includes(match.game.phase), match.game.phase);
let spins = 0;
while (frozen - match.game.clock < 600 && spins++ < 40 && match.game.phase !== "over") pump(200);
assert.ok(frozen - match.game.clock > 500, "clock resumes after reconnect, left " + match.game.clock);
assert.equal(match.game.score.south + "-" + match.game.score.north, score);

await match.persist();
const held = fakeSocket();
held.readyState = 1;
held.serializeAttachment({seat: "south"});
const store2 = store;
const ctx2 = makeCtx(store2, [held]);
const woke = new AirHockeyMatch(ctx2, env);
await ctx2.boot;
assert.equal(woke.sockets.south, held, "hibernation wake adopts the open socket");
assert.equal(woke.game.score.south, match.game.score.south);
assert.equal(woke.game.score.north, match.game.score.north);
assert.equal(woke.game.paused, true, "a missing seat pauses the clock on wake");
assert.ok(Math.abs(woke.game.clock - match.game.clock) < 1);

const ctx3 = makeCtx(new Map());
const late = new AirHockeyMatch(ctx3, env);
await ctx3.boot;
late.now = () => 5_000_000;
await late.init({matchId: "m_abcdef0123456789", south: {id: "s1", name: "ace", rating: 1000}, north: {id: "n1", name: "bay", rating: 1000}});
const sLate = fakeSocket();
const nLate = fakeSocket();
late.attach(sLate, auth("south", "s1", "ace", "bay", "n1", "bay"));
late.attach(nLate, auth("north", "n1", "bay", "ace", "s1", "ace"));
for (let i = 0; i < 400; i++) late.tick();
assert.equal(late.game.phase, "playing");
nLate.readyState = 3;
late.webSocketClose(nLate);
late.gone.north = late.now() - 16000;
late.checkGrace(late.now());
assert.equal(late.game.phase, "over");
assert.equal(late.game.winner, "south");
assert.equal(late.forfeitFlag, true);
assert.equal(late.game.paused, true);

console.log("airhockey net pass", {southMove, northMove, clock: Math.round(match.game.clock), score});
