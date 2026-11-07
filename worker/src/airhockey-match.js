// One SQLite Durable Object per match. The server owns the puck and the score.
// Clients send view-space paddle targets (they always sit at the bottom). Physics runs at 60 Hz
// (two 120 Hz substeps) and state is broadcast at 30 Hz.
import {createGame, expireClock, packState, resetGame, setTarget, step, viewToWorld} from "./airhockey-physics.js";
import {lobbyStub} from "./airhockey-lobby.js";

const GRACE_MS = 15000;
const WAIT_MS = 45000;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {status, headers: {"Content-Type": "application/json"}});
}

export class AirHockeyMatch {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sockets = {south: null, north: null};
    this.gone = {south: 0, north: 0};
    this.joinedAt = {south: 0, north: 0};
    this.ready = {south: false, north: false};
    this.pending = [];
    this.tickN = 0;
    this.loop = null;
    this.meta = null;
    this.game = null;
    this.recordedGame = 0;
    this.forfeitFlag = false;
    this.recording = false;
    this.otDecider = null;
    this.wentOt = false;
    this.lastRecords = null;
    this.lastPhase = "";
    ctx.blockConcurrencyWhile(async () => {
      this.meta = await ctx.storage.get("meta") || null;
      const saved = await ctx.storage.get("game");
      const book = await ctx.storage.get("book");
      if (saved) this.restore(saved);
      if (book) {
        this.recordedGame = book.recordedGame || 0;
        this.forfeitFlag = !!book.forfeitFlag;
        this.ready = book.ready || this.ready;
        this.lastRecords = book.lastRecords || null;
        this.wentOt = !!book.wentOt;
      }
      if (this.game && this.game.phase !== "waiting" && this.game.phase !== "over" && this.game.phase !== "abandoned") {
        const now = Date.now();
        this.gone.south = now;
        this.gone.north = now;
        this.game.paused = true;
        await ctx.storage.setAlarm(now + 1000);
      }
    });
  }

  restore(raw) {
    const game = createGame();
    Object.assign(game, raw);
    game.score = {south: raw.score.south | 0, north: raw.score.north | 0};
    game.puck = {...raw.puck};
    game.south = {...raw.south, bottom: true};
    game.north = {...raw.north, bottom: false};
    game.rng = Math.random;
    this.game = game;
    this.lastPhase = game.phase;
  }

  snapshot() {
    const g = this.game;
    return {
      phase: g.phase, timer: g.timer, score: {...g.score}, winner: g.winner, lastGoal: g.lastGoal, tie: !!g.tie,
      clock: g.clock, period: g.period, regMs: g.regMs, otMs: g.otMs,
      puck: {...g.puck}, south: {...g.south}, north: {...g.north},
      goals: g.goals, time: g.time, stillTime: g.stillTime, regionTime: g.regionTime,
      regionX: g.regionX, regionY: g.regionY, laneTime: g.laneTime, paused: g.paused, gameNo: g.gameNo,
    };
  }

  async persist() {
    if (!this.meta || !this.game) return;
    await this.ctx.storage.put("meta", this.meta);
    await this.ctx.storage.put("game", this.snapshot());
    await this.ctx.storage.put("book", {recordedGame: this.recordedGame, forfeitFlag: this.forfeitFlag, ready: this.ready, lastRecords: this.lastRecords, wentOt: this.wentOt});
  }

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch { /* already closed */ }
  }

  broadcast(obj) {
    for (const seat of ["south", "north"]) {
      const ws = this.sockets[seat];
      if (ws && ws.readyState === 1) this.send(ws, obj);
    }
  }

  bothHere() {
    return ["south", "north"].every(seat => this.sockets[seat] && this.sockets[seat].readyState === 1);
  }

  refreshPause() {
    if (!this.game || this.game.phase === "waiting" || this.game.phase === "over" || this.game.phase === "abandoned") return;
    this.game.paused = !!(this.gone.south || this.gone.north);
  }

  ensureLoop() {
    if (this.loop || !this.game) return;
    if (this.game.phase === "over" || this.game.phase === "abandoned") return;
    this.loop = setInterval(() => this.tick(), 1000 / 60);
  }

  stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  tick() {
    if (!this.game) return;
    const events = [];
    if (!this.game.paused && this.game.phase !== "waiting") {
      const before = this.game.phase;
      step(this.game, 1 / 120, events);
      if (this.game.phase === "playing" || this.game.phase === "goal" || this.game.phase === "faceoff") step(this.game, 1 / 120, events);
      if (before === "playing" && this.game.phase === "playing") this.game.clock -= 1000 / 60;
      if (this.game.period === "ot" && events.some(ev => ev.k === "g")) this.otDecider = this.game.lastGoal;
      if (this.otDecider && this.game.phase !== "goal") {
        this.game.winner = this.otDecider;
        this.game.tie = false;
        this.game.phase = "over";
        this.otDecider = null;
      } else if (this.game.phase === "playing" && this.game.clock <= 0) {
        if (expireClock(this.game) === "ot") this.wentOt = true;
      }
    }
    if (events.length) this.pending.push(...events);
    this.tickN++;
    const phaseChanged = this.game.phase !== this.lastPhase;
    if (phaseChanged) {
      this.lastPhase = this.game.phase;
      if (this.game.phase === "over") void this.finish(this.forfeitFlag);
      void this.persist();
    }
    if (phaseChanged || this.tickN % 2 === 0) {
      const ev = this.pending.splice(0, 8);
      this.pending.length = 0;
      this.broadcastState(ev);
    }
    if (this.game.phase === "over" || this.game.phase === "abandoned") this.stopLoop();
  }

  broadcastState(events) {
    if (!this.game || !this.meta) return;
    const named = events.map(ev => ev.k === "g" ? {...ev, n: this.meta[ev.s === "s" ? "south" : "north"].name} : ev);
    const msg = packState(this.game, named);
    msg.n = this.tickN;
    this.broadcast(msg);
  }

  checkGrace(now) {
    if (!this.game || this.game.phase === "over" || this.game.phase === "abandoned") return;
    if (this.game.phase === "waiting") {
      const southWait = this.joinedAt.south && !this.sockets.north && now - this.joinedAt.south > WAIT_MS;
      const northWait = this.joinedAt.north && !this.sockets.south && now - this.joinedAt.north > WAIT_MS;
      if (southWait || northWait) this.abandon();
      return;
    }
    for (const seat of ["south", "north"]) {
      if (!this.gone[seat] || now - this.gone[seat] < GRACE_MS) continue;
      const other = seat === "south" ? "north" : "south";
      if (!this.gone[other]) { this.forfeit(seat); return; }
    }
    if (this.gone.south && this.gone.north && now - Math.max(this.gone.south, this.gone.north) >= GRACE_MS) this.abandon();
  }

  abandon() {
    if (!this.game || this.game.phase === "over" || this.game.phase === "abandoned") return;
    this.game.phase = "abandoned";
    this.game.paused = true;
    this.lastPhase = "abandoned";
    this.broadcast({t: "abandoned"});
    this.stopLoop();
    void this.persist();
  }

  forfeit(seat) {
    if (!this.game || this.game.phase === "over" || this.game.phase === "abandoned") return;
    if (this.game.phase === "waiting") { this.abandon(); return; }
    this.game.winner = seat === "south" ? "north" : "south";
    this.game.phase = "over";
    this.game.paused = true;
    this.forfeitFlag = true;
    this.lastPhase = "over";
    this.broadcastState([]);
    void this.finish(true);
    this.stopLoop();
  }

  lengths() {
    const reg = Math.min(600, Math.max(5, +this.env.AIRHOCKEY_REG_SEC || 120));
    const ot = Math.min(300, Math.max(5, +this.env.AIRHOCKEY_OT_SEC || 60));
    return {regMs: reg * 1000, otMs: ot * 1000};
  }

  applyLengths(resetClock) {
    if (!this.game) return;
    const len = this.lengths();
    this.game.regMs = len.regMs;
    this.game.otMs = len.otMs;
    if (resetClock) this.game.clock = len.regMs;
  }

  durationSec() {
    const reg = (this.game.regMs || 120000) / 1000;
    const ot = (this.game.otMs || 60000) / 1000;
    const left = Math.max(0, this.game.clock) / 1000;
    if (this.game.period === "ot" || this.wentOt) return Math.round(reg + Math.max(0, ot - left));
    return Math.round(Math.max(0, reg - left));
  }

  async finish(forfeit) {
    if (!this.meta || !this.game || (!this.game.winner && !this.game.tie)) return;
    if (this.recordedGame === this.game.gameNo) {
      this.broadcast(this.overMessage());
      return;
    }
    if (this.recording) return;
    this.recording = true;
    try {
      const tie = !!this.game.tie && !this.game.winner;
      const winnerSeat = tie ? null : this.game.winner;
      const lobby = lobbyStub(this.env);
      const res = await lobby.fetch("https://lobby.internal/result", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          matchId: this.meta.matchId, gameNo: this.game.gameNo,
          southId: this.meta.south.id, southName: this.meta.south.name, southScore: this.game.score.south,
          northId: this.meta.north.id, northName: this.meta.north.name, northScore: this.game.score.north,
          winnerId: winnerSeat ? this.meta[winnerSeat].id : null,
          tie, ot: !!this.wentOt, forfeit: !!forfeit, durationSec: this.durationSec(),
        })});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "result failed");
      this.recordedGame = this.game.gameNo;
      this.lastRecords = data.records;
      for (const seat of ["south", "north"]) {
        const rec = data.records[this.meta[seat].id];
        if (rec) this.meta[seat].rating = rec.rating;
      }
      this.broadcast(this.overMessage());
      await this.persist();
    } catch (e) {
      console.log("airhockey result", String(e));
    } finally {
      this.recording = false;
    }
  }

  overMessage() {
    return {
      t: "over", w: this.game.winner === "south" ? "s" : this.game.winner === "north" ? "n" : null,
      tie: this.game.tie ? 1 : 0, ot: this.wentOt ? 1 : 0, forfeit: this.forfeitFlag ? 1 : 0,
      sc: [this.game.score.south, this.game.score.north], gn: this.game.gameNo, clk: Math.max(0, Math.round(this.game.clock || 0)),
      records: this.lastRecords,
    };
  }

  rematch(seat) {
    if (!this.game || this.game.phase !== "over" || !this.bothHere()) return;
    this.ready[seat] = true;
    this.broadcast({t: "rematch", south: this.ready.south ? 1 : 0, north: this.ready.north ? 1 : 0});
    if (!this.ready.south || !this.ready.north) return;
    resetGame(this.game);
    this.applyLengths(true);
    this.ready = {south: false, north: false};
    this.forfeitFlag = false;
    this.otDecider = null;
    this.wentOt = false;
    this.lastRecords = null;
    this.lastPhase = this.game.phase;
    this.pending = [];
    this.ensureLoop();
    this.broadcast({t: "go", gn: this.game.gameNo});
    this.broadcastState([]);
    void this.persist();
  }

  onMessage(ws, seat, rate, data) {
    const text = typeof data === "string" ? data : "";
    if (!text || text.length > 400) {
      try { ws.close(1009, "too big"); } catch { /* ignore */ }
      return;
    }
    const now = Date.now();
    rate.tokens = Math.min(45, rate.tokens + (now - rate.last) / 1000 * 40);
    rate.last = now;
    if (rate.tokens < 1) {
      rate.strikes++;
      if (rate.strikes > 30) try { ws.close(1008, "slow down"); } catch { /* ignore */ }
      return;
    }
    rate.tokens -= 1;
    rate.strikes = 0;
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "p") {
      const x = +msg.x, y = +msg.y;
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 4000 || Math.abs(y) > 4000) return;
      const world = viewToWorld(seat, x, y);
      setTarget(this.game, seat, world.x, world.y);
    } else if (msg.t === "quit") {
      this.forfeit(seat);
      try { ws.close(1000, "quit"); } catch { /* ignore */ }
    } else if (msg.t === "rematch") this.rematch(seat);
  }

  onClose(ws, seat) {
    if (this.sockets[seat] !== ws) return;
    this.sockets[seat] = null;
    if (!this.game || this.game.phase === "abandoned") return;
    if (this.game.phase === "over") {
      this.ready[seat] = false;
      this.broadcast({t: "left", seat: seat === "south" ? "s" : "n"});
      return;
    }
    this.gone[seat] = Date.now();
    this.ready[seat] = false;
    this.refreshPause();
    this.broadcast({t: "disc", seat: seat === "south" ? "s" : "n", ms: GRACE_MS});
    void this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  attach(ws, auth) {
    const seat = auth.seat;
    const prev = this.sockets[seat];
    this.sockets[seat] = ws;
    if (prev && prev !== ws) {
      try { prev.close(4000, "replaced"); } catch { /* ignore */ }
    }
    this.gone[seat] = 0;
    if (!this.joinedAt[seat]) this.joinedAt[seat] = Date.now();
    const rate = {tokens: 30, last: Date.now(), strikes: 0};
    ws.addEventListener("message", ev => this.onMessage(ws, seat, rate, ev.data));
    ws.addEventListener("close", () => this.onClose(ws, seat));
    ws.addEventListener("error", () => this.onClose(ws, seat));
    if (this.game.phase === "waiting" && this.bothHere()) {
      this.applyLengths(true);
      this.game.phase = "faceoff";
      this.game.timer = 0.9;
      this.game.paused = false;
      this.lastPhase = "faceoff";
    }
    this.refreshPause();
    this.ensureLoop();
    void this.ctx.storage.setAlarm(Date.now() + 2000);
    this.send(ws, {
      t: "hello", seat: seat === "south" ? "s" : "n", you: auth.username, opp: auth.opponent,
      rating: auth.rating, wins: auth.wins, losses: auth.losses, ties: auth.ties || 0, otl: auth.otl || 0,
      gp: auth.gp || 0, gf: auth.gf || 0, ga: auth.ga || 0, reg: Math.round((this.game.regMs || 120000) / 1000), gn: this.game.gameNo,
    });
    const msg = packState(this.game, []);
    msg.n = this.tickN;
    this.send(ws, msg);
    if (this.bothHere()) this.broadcast({t: "back"});
  }

  async init(body) {
    if (!body || body.south?.id == null || body.north?.id == null || typeof body.matchId !== "string") return json({error: "bad match"}, 400);
    if (this.meta && this.meta.matchId === body.matchId) return json({ok: true, exists: true});
    this.meta = {
      matchId: body.matchId,
      south: {id: body.south.id, name: String(body.south.name || "").slice(0, 16), rating: body.south.rating | 0},
      north: {id: body.north.id, name: String(body.north.name || "").slice(0, 16), rating: body.north.rating | 0},
    };
    this.game = createGame();
    this.applyLengths(true);
    this.lastPhase = "waiting";
    this.recordedGame = 0;
    this.forfeitFlag = false;
    this.otDecider = null;
    this.wentOt = false;
    await this.persist();
    return json({ok: true});
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/init") {
      if (req.headers.get("X-Cbn-Internal") !== "1") return new Response("forbidden", {status: 403});
      return this.init(await req.json());
    }
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", {status: 426});
    if (!this.meta || !this.game) return new Response("not found", {status: 404});
    const token = url.searchParams.get("token") || "";
    const lobby = lobbyStub(this.env);
    if (!lobby) return new Response("unavailable", {status: 503});
    const authRes = await lobby.fetch("https://lobby.internal/auth-ws", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({token, matchId: this.meta.matchId})});
    const auth = await authRes.json().catch(() => ({}));
    if (!authRes.ok) return new Response(auth.error || "unauthorized", {status: authRes.status});
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.attach(server, auth);
    return new Response(null, {status: 101, webSocket: client});
  }

  async alarm() {
    if (!this.game || !this.meta) return;
    const now = Date.now();
    this.checkGrace(now);
    if (this.game.phase === "over" && this.recordedGame !== this.game.gameNo) await this.finish(this.forfeitFlag);
    const live = this.game.phase !== "over" && this.game.phase !== "abandoned";
    const someone = this.sockets.south || this.sockets.north || this.gone.south || this.gone.north;
    if (live && someone) {
      if (!this.loop) this.ensureLoop();
      await this.persist();
      await this.ctx.storage.setAlarm(now + 2000);
    }
  }
}
