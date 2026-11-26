// One SQLite Durable Object per trivia duel. Both seats share the question list and the clock.
// Clients poll. Hibernation is not required: a duel is a handful of reads, not a 60 Hz loop.
import {questionById} from "./trivia-bank.js";
import {applyAnswer, createMatch, markSeen, resultPayload, view} from "./trivia-engine.js";
import {lobbyStub} from "./trivia-lobby.js";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {status, headers: {"Content-Type": "application/json"}});
}

export class TriviaMatch {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    ctx.blockConcurrencyWhile(async () => this.boot());
  }

  now() { return Date.now(); }

  sql(query, ...args) { return this.ctx.storage.sql.exec(query, ...args); }
  one(query, ...args) { return this.sql(query, ...args).toArray()[0] || null; }

  boot() {
    this.sql(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    const row = this.one("SELECT v FROM kv WHERE k = 'state'");
    this.state = row ? JSON.parse(row.v) : null;
  }

  save() {
    this.sql("INSERT OR REPLACE INTO kv (k, v) VALUES ('state', ?)", JSON.stringify(this.state));
  }

  questions() {
    return (this.state.questions || []).map(item => questionById(item.id)).filter(Boolean);
  }

  async record() {
    if (!this.state || !this.state.finished || this.state.recorded) return;
    const lobby = lobbyStub(this.env);
    if (!lobby) return;
    try {
      const res = await lobby.fetch("https://lobby.internal/duel-result", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(resultPayload(this.state)),
      });
      if (res.ok) {
        this.state.recorded = true;
        this.save();
      }
    } catch (e) {
      console.log("trivia result", String(e));
    }
  }

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === "/init" && req.method === "POST") {
        if (this.state) return json({ok: true});
        const body = await req.json();
        const questions = (body.questionIds || []).map(id => questionById(id));
        if (questions.some(item => !item)) return json({error: "bad questions"}, 400);
        this.state = createMatch({
          id: body.matchId,
          south: body.south,
          north: body.north,
          questions,
          now: this.now(),
        });
        this.save();
        return json({ok: true});
      }
      if (!this.state) return json({error: "Duel not found."}, 404);
      const now = this.now();
      if (path === "/state" && req.method === "GET") {
        const userId = url.searchParams.get("userId") || "";
        const seat = this.state.south.id === userId ? "south" : this.state.north.id === userId ? "north" : null;
        if (!seat) return json({error: "You're not in this duel."}, 403);
        markSeen(this.state, seat, now);
        const payload = view(this.state, userId, this.questions(), now);
        this.save();
        await this.record();
        return json(payload);
      }
      if (path === "/answer" && req.method === "POST") {
        const body = await req.json();
        const userId = body.userId || "";
        const seat = this.state.south.id === userId ? "south" : this.state.north.id === userId ? "north" : null;
        if (!seat) return json({error: "You're not in this duel."}, 403);
        markSeen(this.state, seat, now);
        applyAnswer(this.state, seat, Number.isInteger(body.choice) ? body.choice : -1, now);
        const payload = view(this.state, userId, this.questions(), now);
        this.save();
        await this.record();
        return json(payload);
      }
      return json({error: "not found"}, 404);
    } catch (e) {
      console.log("trivia match", e && e.stack || String(e));
      return json({error: "server error"}, 500);
    }
  }
}
