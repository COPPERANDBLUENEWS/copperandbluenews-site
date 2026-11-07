// One SQLite-backed Durable Object: strongly consistent journal + outbox, not an eventually-consistent KV lease.
// The cron Worker only makes one RPC; parsing, 15s polling and push crypto run under the DO CPU budget.
import {gameEvents, addOdds, oddsGame} from "./game-events.js";
import {notificationPlan, deliver} from "./delivery.js";
import {bytesToB64u} from "./webpush.js";
import {describeAlert, entryFromPending} from "./alert-log.js";
import * as store from "./store.js";
const API = "https://api-web.nhle.com/v1";
const FINAL = ["OFF", "FINAL"], LIVE = ["LIVE", "CRIT"], INTERVAL = 15000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function eligibleGame(g, since, now) {
  const start = Date.parse(g.startTimeUTC);
  return Number.isFinite(start) && start >= Date.parse(since) && g.gameScheduleState === "OK" &&
    (g.homeTeam?.abbrev === "EDM" || g.awayTeam?.abbrev === "EDM") &&
    now >= start - 5 * 60000 && now <= start + 8 * 3600000;
}
export function gameStub(env) { return env.GAME_ALERTS.get(env.GAME_ALERTS.idFromName("edm-game-alerts-v1")); }
export class GameAlerts {
  constructor(ctx, env) {
    this.ctx = ctx; this.storage = ctx.storage; this.env = env;
    this.producer = null; this.deliveries = new Map(); this.send = deliver; this.pause = sleep;
  }
  async nhl(path) {
    const r = await fetch(`${API}/${path}`, {headers: {"User-Agent": "copperandbluenews"},
      signal: AbortSignal.timeout(8000), cf: {cacheTtl: 0, cacheEverything: false}});
    if (!r.ok) throw new Error(`NHL feed HTTP ${r.status}`);
    return r.json();
  }
  async schedule() {
    const now = Date.now(), old = await this.storage.get("schedule");
    if (old && now - old.at < 300000) return old.games;
    const d = new Date(), y = d.getUTCFullYear() - (d.getUTCMonth() < 6 ? 1 : 0);
    const data = await this.nhl(`club-schedule-season/EDM/${y}${y + 1}`);
    if (!Array.isArray(data.games)) throw new Error("Invalid NHL schedule");
    await this.storage.put("schedule", {at: now, games: data.games});
    return data.games;
  }
  async stage(g) {
    if (!eligibleGame(g, this.env.GAME_ALERTS_SINCE, Date.now())) return 0;
    const candidates = gameEvents(g), fresh = [];
    for (const e of candidates) {
      if (await this.storage.get("seen:" + e.id)) continue;
      // Belt-and-suspenders compatibility with legacy KV; hard activation floor also excludes ALL old Actions cache IDs.
      if (await store.eventSeen(this.env, e.id)) {
        await this.storage.put("seen:" + e.id, {at: Date.now(), legacy: true}); continue;
      }
      fresh.push(e);
    }
    if (!fresh.length) return 0;
    const stateKey = "odds:" + g.id, state = await this.storage.get(stateKey) || {};
    if (fresh.some(e => ["puck_drop", "period_end"].includes(e.type))) {
      let odds = null;
      try { odds = oddsGame(await this.nhl("partner-game/CA/now"), g.id); } catch {} // odds are optional, as in Python
      addOdds(fresh, state, odds);
    }
    for (const e of fresh) {
      const {order, ...event} = e;
      // Topic coalesces retries that are still pending at a push service. Browser tag is the same stable event ID.
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(e.id));
      const plan = await notificationPlan(this.env, {...event, topic: bytesToB64u(new Uint8Array(digest).slice(0, 16))});
      const batches = [];
      for (let i = 0; i < plan.subs.length; i += 20) batches.push(plan.subs.slice(i, i + 20));
      let log = null;
      try { log = describeAlert(g, e); } catch (err) { console.log("alert detail failed", String(err)); }
      // One atomic commit: never mark seen unless the complete delivery plan is durably recoverable.
      // `log` is inbox-only. It is not part of the push payload, so titles, bodies and URLs stay the same.
      await this.storage.put({["seen:" + e.id]: {at: Date.now()}, [stateKey]: state,
        ["pending:" + e.id]: {payload: plan.payload, batches, completed: [], at: Date.now(), log}});
    }
    return fresh.length;
  }
  async flush() {
    const pending = await this.storage.list({prefix: "pending:"});
    for (const [key, row] of pending) {
      const id = key.slice(8), retryKey = "retry:" + id, now = Date.now();
      if ((await this.storage.get(retryKey) || 0) > now) continue;
      if (row.batches.length && row.batches.every(b => b.every(s => row.completed.includes(s.id)))) {
        await this.storage.delete([key, retryKey]); continue; // recover a crash after the final recipient checkpoint
      }
      if (!row.batches.length) {
        await store.markEvent(this.env, id, {type: row.payload.type, title: row.payload.title, at: new Date(row.at).toISOString(), recipients: 0});
        await this.remember(row, id);
        await this.storage.delete(key); continue;
      }
      if (!this.env.PUSH_QUEUE) throw new Error("PUSH_QUEUE required for durable game alerts");
      // Retry metadata is separate: never overwrite a delivery checkpoint with an old producer snapshot.
      await this.storage.put(retryKey, now + 60000);
      try {
        const msgs = row.batches.map((subs, batch) => ({body: {gameAlert: {id, batch}}}))
          .filter((m, batch) => row.batches[batch].some(s => !row.completed.includes(s.id)));
        for (let i = 0; i < msgs.length; i += 100) await this.env.PUSH_QUEUE.sendBatch(msgs.slice(i, i + 100));
        if (!(await this.storage.get("reported:" + id))) {
          await store.markEvent(this.env, id, {type: row.payload.type, title: row.payload.title,
            at: new Date(row.at).toISOString(), recipients: row.batches.reduce((n, b) => n + b.length, 0)});
          await this.storage.put("reported:" + id, true);
          await this.remember(row, id);
        }
      } catch (e) { await this.storage.put(retryKey, 0); throw e; }
    }
    return pending.size;
  }
  // Log writes share one chain so a lineup POST /log can't drop a game alert from the KV array.
  appendLog(entry) {
    if (!entry?.id) return Promise.resolve();
    const prev = this._logTail || Promise.resolve();
    const task = prev.catch(() => {}).then(() => store.appendAlert(this.env, entry));
    this._logTail = task;
    return task;
  }
  remember(row, id) {
    return this.appendLog(entryFromPending(row, id)).catch(e => console.log("alert log failed", String(e)));
  }
  // Event-scoped mutex persists across every awaited push/checkpoint; different batches of one event cannot race.
  async delivery(id, batch) {
    const previous = this.deliveries.get(id) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => this.deliverBatch(id, batch));
    this.deliveries.set(id, task);
    try { return await task; } finally { if (this.deliveries.get(id) === task) this.deliveries.delete(id); }
  }
  async deliverBatch(id, batch) {
    const key = "pending:" + id, row = await this.storage.get(key);
    if (!row) {
      if (await this.storage.get("seen:" + id)) return {ok: true, duplicate: true};
      throw new Error("Unknown game outbox event");
    }
    if (!Number.isInteger(batch) || !row.batches[batch]) throw new Error("Invalid game outbox batch");
    const remaining = row.batches[batch].filter(s => !row.completed.includes(s.id));
    if (!remaining.length) {
      if (row.batches.every(b => b.every(s => row.completed.includes(s.id)))) await this.storage.delete([key, "retry:" + id]);
      return {ok: true, duplicate: true};
    }
    const stats = await this.send(this.env, remaining, row.payload, {afterEach: async (sub, result) => {
      if (result.ok || result.gone) {
        row.completed.push(sub.id);
        await this.storage.put(key, row); // checkpoint EACH successful recipient, never retry already-accepted pushes
      }
    }});
    // Keep metrics failures from resending accepted pushes. The durable journal, not KV metrics, is authoritative.
    await store.recordSend(this.env, id, row.payload.type, stats, remaining.length).catch(e => console.log("game metrics write failed", String(e)));
    if (row.batches.every(b => b.every(s => row.completed.includes(s.id)))) {
      await this.storage.delete([key, "retry:" + id]);
      return {ok: true, ...stats};
    }
    await this.storage.setAlarm(Date.now() + 60000);
    return {ok: false, retry: true, ...stats};
  }
  async poll() {
    await this.flush();
    const games = await this.schedule(), now = Date.now();
    const game = games.find(g => eligibleGame(g, this.env.GAME_ALERTS_SINCE, now));
    if (!game || await this.storage.get("finished:" + game.id)) return {active: false, staged: 0};
    const g = await this.nhl(`gamecenter/${game.id}/play-by-play`);
    if (g.id !== game.id || !g.homeTeam || !g.awayTeam || !Array.isArray(g.plays)) throw new Error("Invalid NHL play-by-play");
    const staged = await this.stage(g);
    await this.flush();
    if (FINAL.includes(g.gameState) || g.plays.some(p => p.typeDescKey === "game-end")) {
      await this.storage.put("finished:" + game.id, true); return {active: false, staged};
    }
    return {active: LIVE.includes(g.gameState) || now >= Date.parse(game.startTimeUTC) - 5 * 60000, staged};
  }
  async run(scheduledTime = Date.now()) {
    if (this.producer) return {busy: true};
    // A singleton actor and this in-flight promise fence overlapping cron/alarm runs. No eventually-consistent lease.
    const task = this.loop(scheduledTime); this.producer = task;
    try { return await task; } finally { this.producer = null; }
  }
  async loop(scheduledTime) {
    if (this.env.GAME_ALERTS_ENABLED !== "1") return {disabled: true};
    if (!Number.isFinite(Date.parse(this.env.GAME_ALERTS_SINCE))) throw new Error("Activation floor required");
    // Persist recovery before external work. Cron remains an independent once/minute watchdog.
    await this.storage.setAlarm(Date.now() + 65000);
    const deadline = Math.min(scheduledTime + 55000, Date.now() + 55000);
    let polls = 0, staged = 0, active = false;
    do {
      const result = await this.poll(); polls++; staged += result.staged; active = result.active;
      if (!active || Date.now() + INTERVAL >= deadline) break;
      await this.pause(INTERVAL);
    } while (Date.now() < deadline);
    const pending = (await this.storage.list({prefix: "pending:", limit: 1})).size;
    if (active || pending) await this.storage.setAlarm(Date.now() + (active ? INTERVAL : 60000));
    else await this.storage.deleteAlarm();
    const result = {active, polls, staged, pending: !!pending};
    console.log("game-alerts tick", JSON.stringify(result)); return result;
  }
  async alarm() { await this.run(); }
  async fetch(req) {
    try {
      const b = await req.json(), path = new URL(req.url).pathname;
      const out = path === "/tick" ? await this.run(b.scheduledTime) : path === "/deliver" ? await this.delivery(b.id, b.batch)
        : path === "/log" ? await this.appendLog(b).then(() => ({ok: true})) : null;
      return Response.json(out || {error: "not found"}, {status: out ? 200 : 404});
    } catch (e) { console.log("game-alerts error", String(e)); return Response.json({error: String(e)}, {status: 500}); }
  }
}
