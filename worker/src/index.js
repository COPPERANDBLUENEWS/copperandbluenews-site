// The Copper & Blue News: Game alerts Worker (Cloudflare Workers + Workers KV [+ Queues]).
//   POST /subscribe    {subscription, prefs, email?}            (browser, CORS: copperandbluenews.com + www)
//   POST /unsubscribe  {endpoint}                               (browser, CORS)
//   POST /notify       {id?, type, title, body, url, to?, alt?}       Authorization: Bearer NOTIFY_SECRET (GitHub Actions; to = one subscriber id)
//   GET  /export       sign-up list as CSV                      Authorization: Bearer ADMIN_SECRET (Mac)
//   GET  /stats?hours=24  subscriber counts + alerts sent (JSON)  Authorization: Bearer ADMIN_SECRET (morning report)
//   POST /pickem {game, voter, edm, opp} / GET /pickem?game=ID   score predictions (browser, CORS), see pickem.js
//   POST /fgs {game, voter, player} / GET /fgs?game=ID          first-goal poll (browser, CORS), see fgs.js
//   POST /newsletter {email, consent, source, website(honeypot)}  game day email sign-up (browser, CORS), see newsletter.js
//   GET  /newsletter/unsubscribe?token=TOKEN   one-click unsubscribe; GET /export?list=newsletter for the email list CSV
//   GET  /alerts/log   newest-first list of sent alerts (public, read-only, site CORS)
//   GET  /health
//   POST /airhockey/signup|login|quick|room|join   username accounts and matchmaking (browser, CORS)
//   GET  /airhockey/me|leaderboard|quick|room      session, top 25, queue / room poll
//   GET  /airhockey/ws/:matchId                    WebSocket for one AirHockeyMatch Durable Object
// Fan-out: with the PUSH_QUEUE binding, /notify enqueues batches of subscribers and the queue consumer
// sends them (each consumer run gets its own subrequest budget, so this scales on the Free plan's
// 50-subrequest limit). Without the binding it sends inline (fine for small lists or Workers Paid).
import {deliver} from "./delivery.js";
import {gameStub} from "./game-alerts.js";
import {GAME_TYPES} from "./game-events.js";
import {PREGAME_TYPES} from "./pregame.js";
import {CLOSE_GAME_TYPE} from "./close-game.js";
import {SPECIAL_TEAMS_TYPE} from "./special-teams.js";
export {GameAlerts} from "./game-alerts.js";
export {AirHockeyLobby} from "./airhockey-lobby.js";
export {AirHockeyMatch} from "./airhockey-match.js";
import * as airhockey from "./airhockey.js";
import * as store from "./store.js";
import * as pickem from "./pickem.js";
import * as fgs from "./fgs.js";
import * as live from "./live.js";
import * as newsletter from "./newsletter.js";

const TYPES = store.TYPES; // puck_drop, goal, period_end, final, lineup, odds, gameday, pregame_60, pregame_15, close_game, special_teams
const ORIGINS = ["https://copperandbluenews.com", "https://www.copperandbluenews.com"];
// Known browser push services. Anything else is refused so the Worker can't be used to POST to arbitrary URLs.
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.api\.chromium\.org$/];
const PER_MESSAGE = 40;        // subscribers per queue message (Free plan: 50 external subrequests per invocation)
const INLINE_MAX = 45;         // inline sends allowed per request when there is no queue on the Free plan

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {status, headers: {"Content-Type": "application/json", ...extra}});
const nowIso = () => new Date().toISOString();

function allowedOrigins(env) {
  return ORIGINS.concat((env.EXTRA_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean));
}
function cors(req, env) {
  const o = req.headers.get("Origin");
  if (!o || !allowedOrigins(env).includes(o)) return {};
  return {"Access-Control-Allow-Origin": o, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400", Vary: "Origin"};
}
async function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  const te = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", te.encode(a)), crypto.subtle.digest("SHA-256", te.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}
const bearer = req => (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
async function readJson(req, max = 8192) {
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, "payload too large");
  try { return JSON.parse(text); } catch { throw new HttpError(400, "invalid JSON"); }
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function subId(endpoint) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  return [...h.slice(0, 16)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const isB64u = (s, len) => typeof s === "string" && /^[A-Za-z0-9_-]+=*$/.test(s) && s.length >= len && s.length <= len + 4;

function validEndpoint(endpoint, env) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (env.ALLOW_ANY_PUSH_HOST === "1") return u.protocol === "https:" || u.protocol === "http:"; // local testing only
  return u.protocol === "https:" && endpoint.length <= 1024 && PUSH_HOSTS.some(r => r.test(u.hostname));
}

async function subscribe(req, env) {
  const b = await readJson(req);
  const s = b.subscription || {};
  const endpoint = s.endpoint, keys = s.keys || {};
  if (typeof endpoint !== "string" || !validEndpoint(endpoint, env)) throw new HttpError(400, "unsupported push endpoint");
  if (!isB64u(keys.p256dh, 86) || !isB64u(keys.auth, 22)) throw new HttpError(400, "bad subscription keys");
  const prefs = Object.fromEntries(TYPES.map(t => [t, b.prefs && typeof b.prefs[t] === "boolean" ? b.prefs[t] : store.DEFAULTS[t]]));
  let email = typeof b.email === "string" ? b.email.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 120) : "";
  await store.putSub(env, await subId(endpoint), {endpoint, p256dh: keys.p256dh, auth: keys.auth, email: email || null, prefs}, nowIso());
  return {ok: true, prefs};
}

async function unsubscribe(req, env) {
  const b = await readJson(req);
  if (typeof b.endpoint !== "string" || b.endpoint.length > 1024) throw new HttpError(400, "endpoint required");
  await store.deleteSub(env, await subId(b.endpoint));
  return {ok: true}; // same answer whether or not it existed
}

async function notify(req, env, ctx) {
  if (!(await safeEqual(bearer(req), env.NOTIFY_SECRET))) throw new HttpError(401, "unauthorized");
  const b = await readJson(req);
  if (env.GAME_ALERTS_ENABLED === "1" && (GAME_TYPES.includes(b.type) || PREGAME_TYPES.includes(b.type) || b.type === CLOSE_GAME_TYPE || b.type === SPECIAL_TEAMS_TYPE)) return {ok: true, ignored: true, reason: "Worker owns game events"};
  if (!TYPES.includes(b.type)) throw new HttpError(400, `type must be one of ${TYPES.join(", ")}`);
  if (typeof b.title !== "string" || !b.title.trim()) throw new HttpError(400, "title required");
  const id = typeof b.id === "string" && b.id ? b.id.slice(0, 120) : null;
  const url = typeof b.url === "string" && b.url.startsWith("/") && !b.url.startsWith("//") ? b.url.slice(0, 300) : "/tracker.html";
  const payload = {type: b.type, title: b.title.slice(0, 120), body: typeof b.body === "string" ? b.body.slice(0, 300) : "", url, id, ts: Date.now()};
  // Optional per-subscriber variant: {alt: {pref, body}} -> subscribers who also opted into "pref" get that body.
  const alt = b.alt && TYPES.includes(b.alt.pref) && typeof b.alt.body === "string" ? {pref: b.alt.pref, body: b.alt.body.slice(0, 300)} : null;
  if (id) { // never fan out the same event twice
    if (await store.eventSeen(env, id)) return {ok: true, duplicate: true};
    await store.markEvent(env, id, {type: b.type, title: payload.title, at: nowIso()});
  }
  // Optional "to": one subscriber id (from /export) gets the alert, e.g. a test to your own device.
  const only = typeof b.to === "string" && b.to ? b.to : null;
  const pool = only ? [await store.getSub(env, only)].filter(Boolean) : await store.listSubs(env);
  const subs = pool.filter(s => only || s.prefs[b.type])
    .map(({id, endpoint, p256dh, auth, prefs}) => ({id, endpoint, p256dh, auth, ...(alt && prefs[alt.pref] ? {altBody: alt.body} : {})}));
  let out;
  if (env.PUSH_QUEUE && subs.length) {
    const msgs = [];
    for (let i = 0; i < subs.length; i += PER_MESSAGE) msgs.push({body: {payload, subs: subs.slice(i, i + PER_MESSAGE)}});
    for (let i = 0; i < msgs.length; i += 100) await env.PUSH_QUEUE.sendBatch(msgs.slice(i, i + 100));
    out = {ok: true, recipients: subs.length, queued: msgs.length};
  } else {
    const cap = env.INLINE_LIMIT ? +env.INLINE_LIMIT : INLINE_MAX;
    const list = subs.slice(0, cap);
    const stats = await deliver(env, list, payload);
    if (list.length) ctx.waitUntil(store.recordSend(env, id, payload.type, stats, list.length).catch(() => {}));
    out = {ok: true, recipients: subs.length, ...stats, ...(subs.length > list.length ? {skipped: subs.length - list.length, hint: "add the PUSH_QUEUE binding"} : {})};
  }
  if (id) ctx.waitUntil(store.markEvent(env, id, {type: b.type, title: payload.title, at: nowIso(), recipients: subs.length}));
  // Inbox log is separate from the push. Lineup and final `url` values are copied through unchanged.
  if (id) ctx.waitUntil(recordAlert(env, {...payload, matchup: typeof b.matchup === "string" ? b.matchup : "",
    away: typeof b.away === "string" ? b.away : "", home: typeof b.home === "string" ? b.home : "",
    detail: b.detail || null, game: /^\d{10}/.test(id) ? id.split(":")[0] : null}).catch(e => console.log("alert log failed", String(e))));
  return out;
}

async function recordAlert(env, entry) {
  if (env.GAME_ALERTS) {
    try {
      const r = await gameStub(env).fetch("https://game-alerts.internal/log", {method: "POST", body: JSON.stringify(entry)});
      if (r.ok) return;
    } catch (e) { console.log("alert log actor failed", String(e)); }
  }
  await store.appendAlert(env, entry);
}

const csvCell = v => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep spreadsheet apps from running formulas from user input
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
async function exportCsv(req, env) {
  if (!(await safeEqual(bearer(req), env.ADMIN_SECRET))) throw new HttpError(401, "unauthorized");
  if (new URL(req.url).searchParams.get("list") === "newsletter") {
    const cols = ["id", "email", "ts", "source", "consent_ts", "consent_version", "consent_text", "consent_method", "unsubscribe_url"];
    const rows = await newsletter.rows(env);
    const lines = [];
    for (const row of rows.sort((a,b)=>a.ts.localeCompare(b.ts))) {
      row.unsubscribe_url = "https://cbn-alerts.copperandbluenews.workers.dev/newsletter/unsubscribe?token=" + await newsletter.unsubscribeToken(env, row.id, row.ts);
      lines.push(cols.map(c=>csvCell(row[c])).join(","));
    }
    return new Response([cols.join(","), ...lines].join("\r\n") + "\r\n", {headers:{"Content-Type":"text/csv; charset=utf-8", "Cache-Control":"no-store",
      "Content-Disposition": `attachment; filename="cbn-newsletter-${new Date().toISOString().slice(0,10)}.csv"`}});
  }
  const cols = ["id", "email", ...TYPES, "created_at", "updated_at", "endpoint", "p256dh", "auth"];
  const rows = (await store.listSubs(env)).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""))
    .map(r => ({...r, ...Object.fromEntries(TYPES.map(t => [t, r.prefs[t] ? 1 : 0]))}));
  const csv = [cols.join(","), ...rows.map(r => cols.map(c => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
  return new Response(csv, {headers: {"Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="cbn-alerts-signups-${new Date().toISOString().slice(0, 10)}.csv"`}});
}

async function stats(req, env) {
  if (!(await safeEqual(bearer(req), env.ADMIN_SECRET))) throw new HttpError(401, "unauthorized");
  const hours = Math.min(Math.max(+(new URL(req.url).searchParams.get("hours")) || 24, 1), 192);
  const since = Date.now() - hours * 3600e3, sinceIso = new Date(since).toISOString();
  const [subs, events, sends, nlCounts] = await Promise.all([store.listSubs(env), store.listEvents(env), store.listSends(env), newsletter.counts(env)]);
  const perType = Object.fromEntries(TYPES.map(t => [t, subs.filter(s => s.prefs[t]).length]));
  const evs = events.filter(e => e.at && e.at >= sinceIso), snd = sends.filter(x => x.ts >= since);
  const byType = {};
  for (const e of evs) byType[e.t] = (byType[e.t] || 0) + 1;
  const sum = k => snd.reduce((a, x) => a + (+x[k] || 0), 0);
  return {
    generated_at: nowIso(), hours, newsletter: nlCounts,
    subscribers: {total: subs.length, new: subs.filter(s => (s.created_at || "") >= sinceIso).length, per_type: perType},
    alerts: {events: evs.length, events_by_type: byType, push_attempts: sum("n"), sent: sum("s"), failed: sum("f"),
      expired_removed: sum("g"), test_sends: snd.filter(x => !x.i).length},
  };
}

export default {
  async scheduled(controller, env, ctx) {
    if (env.GAME_ALERTS_ENABLED !== "1") return;
    ctx.waitUntil((async () => {
      const r = await gameStub(env).fetch("https://game-alerts.internal/tick", {method: "POST",
        body: JSON.stringify({scheduledTime: controller.scheduledTime})});
      if (!r.ok) throw new Error("Game alerts scheduler failed: " + r.status);
      console.log("game-alerts cron", await r.text());
    })());
  },
  async fetch(req, env, ctx) {
    const {pathname} = new URL(req.url);
    if (pathname === "/airhockey" || pathname.startsWith("/airhockey/")) return airhockey.handle(req, env);
    const c = cors(req, env);
    const browserRoute = pathname === "/subscribe" || pathname === "/unsubscribe" || pathname === "/pickem" || pathname === "/fgs" || pathname === "/live/pbp" || pathname === "/live/now" || pathname === "/alerts/log" || pathname === "/newsletter" || pathname === "/newsletter/unsubscribe";
    try {
      if (req.method === "OPTIONS") {
        if (browserRoute && c["Access-Control-Allow-Origin"]) return new Response(null, {status: 204, headers: c});
        return new Response(null, {status: 403});
      }
      if (pathname === "/newsletter/unsubscribe") {
        if (req.method !== "GET") throw new HttpError(405, "method not allowed");
        if (req.headers.get("Origin") && !c["Access-Control-Allow-Origin"]) throw new HttpError(403, "origin not allowed");
        let ok = false;
        try { await newsletter.unsubscribe(new URL(req.url).searchParams.get("token"), env); ok = true; }
        catch (e) { if (!(e instanceof newsletter.NewsletterError) || e.status !== 400) throw e; }
        return new Response(newsletter.unsubscribePage(ok), {status:ok ? 200 : 400, headers:{...c,
          "Content-Type":"text/html; charset=utf-8", "Cache-Control":"no-store", "Referrer-Policy":"no-referrer", "X-Frame-Options":"DENY",
          "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"}});
      }
      if (pathname === "/newsletter") {
        if (req.method !== "POST") throw new HttpError(405, "method not allowed");
        if (req.headers.get("Origin") && !c["Access-Control-Allow-Origin"]) throw new HttpError(403, "origin not allowed");
        const out = await newsletter.subscribe(await readJson(req, 2048), req, env);
        return json(out, 200, {...c, "Cache-Control":"no-store"});
      }
      if (pathname === "/alerts/log") {
        if (req.method !== "GET") throw new HttpError(405, "method not allowed");
        if (req.headers.get("Origin") && !c["Access-Control-Allow-Origin"]) throw new HttpError(403, "origin not allowed");
        return json({updated: nowIso(), alerts: await store.readAlertLog(env)}, 200, {...c, "Cache-Control": "public, max-age=15"});
      }
      if (pathname === "/live/pbp" || pathname === "/live/now") {
        if (req.method !== "GET") throw new HttpError(405, "method not allowed");
        if (req.headers.get("Origin") && !c["Access-Control-Allow-Origin"]) throw new HttpError(403, "origin not allowed");
        const u = new URL(req.url);
        const out = pathname === "/live/pbp" ? await live.pbp(u.searchParams.get("id") || "", u.origin, ctx)
          : await live.now(u.origin, ctx);
        return json(out, 200, {...c, "Cache-Control": "no-store"});
      }
      if (pathname === "/pickem" || pathname === "/fgs") {
        const game = new URL(req.url).searchParams.get("game") || "";
        if (req.method === "GET") {
          const out = pathname === "/fgs" ? await fgs.results(game, env) : await pickem.results(game, env);
          const ttl = pathname === "/fgs" && out.locked !== false ? 15 : 60;
          return json(out, 200, {...c, "Cache-Control": `public, max-age=${ttl}`});
        }
        if (req.method !== "POST") throw new HttpError(405, "method not allowed");
        // Browsers always send Origin on cross-site POSTs: refuse other sites.
        const origin = req.headers.get("Origin");
        if (origin && !c["Access-Control-Allow-Origin"]) throw new HttpError(403, "origin not allowed");
        const body = await readJson(req, 1024);
        const out = pathname === "/fgs" ? await fgs.vote(body, env) : await pickem.vote(body, env);
        return json(out, 200, c);
      }
      if (browserRoute) {
        if (req.method !== "POST") throw new HttpError(405, "method not allowed");
        // Browsers always send Origin on cross-site POSTs: refuse other sites.
        const origin = req.headers.get("Origin");
        if (origin && !c["Access-Control-Allow-Origin"]) throw new HttpError(403, "origin not allowed");
        const out = pathname === "/subscribe" ? await subscribe(req, env) : await unsubscribe(req, env);
        return json(out, 200, c);
      }
      if (pathname === "/notify" && req.method === "POST") return json(await notify(req, env, ctx));
      if (pathname === "/export" && req.method === "GET") return await exportCsv(req, env);
      if (pathname === "/stats" && req.method === "GET") return json(await stats(req, env), 200, {"Cache-Control": "no-store"});
      if (pathname === "/health") return json({ok: true});
      return json({error: "not found"}, 404);
    } catch (e) {
      const status = e instanceof HttpError || e instanceof pickem.PickemError || e instanceof fgs.FgsError || e instanceof live.LiveError || e instanceof newsletter.NewsletterError ? e.status : 500;
      if (status === 500) console.log("error", e && e.stack || String(e));
      return json({error: status === 500 ? "server error" : e.message}, status, browserRoute ? {...c, "Cache-Control":"no-store", ...(status === 429 ? {"Retry-After":"60"} : {})} : {});
    }
  },

  // Queue consumer: each message = {payload, subs[<=40]}.
  async queue(batch, env) {
    for (const msg of batch.messages) {
      if (msg.body.gameAlert) {
        try {
          const r = await gameStub(env).fetch("https://game-alerts.internal/deliver", {method: "POST", body: JSON.stringify(msg.body.gameAlert)});
          const out = await r.json();
          if (r.ok && out.ok) msg.ack(); else msg.retry({delaySeconds: 30});
        } catch (e) { console.log("game queue retry", String(e)); msg.retry({delaySeconds: 30}); }
        continue;
      }
      try {
        const subs = msg.body.subs || [], p = msg.body.payload || {};
        const stats = await deliver(env, subs, p);
        await store.recordSend(env, p.id, p.type, stats, subs.length).catch(e => console.log("stats write failed", String(e)));
        console.log("queue batch", msg.body.payload && msg.body.payload.id, JSON.stringify(stats));
      } catch (e) { console.log("queue error", String(e)); }
      msg.ack(); // never retry a batch: a retry would re-send to everyone who already got the alert
    }
  },
};
