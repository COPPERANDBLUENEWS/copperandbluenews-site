// The Copper & Blue News: Game alerts Worker (Cloudflare Workers + D1 [+ Queues]).
//   POST /subscribe    {subscription, prefs, email?}            (browser, CORS: copperandbluenews.com + www)
//   POST /unsubscribe  {endpoint}                               (browser, CORS)
//   POST /notify       {id?, type, title, body, url}            Authorization: Bearer NOTIFY_SECRET (GitHub Actions)
//   GET  /export       sign-up list as CSV                      Authorization: Bearer ADMIN_SECRET (Mac)
//   GET  /health
// Fan-out: with the PUSH_QUEUE binding, /notify enqueues batches of subscribers and the queue consumer
// sends them (each consumer run gets its own subrequest budget, so this scales on the Free plan's
// 50-subrequest limit). Without the binding it sends inline (fine for small lists or Workers Paid).
import {sendPush} from "./webpush.js";

const TYPES = ["puck_drop", "goal", "period_end", "final", "lineup"]; // == D1 column names (whitelist)
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
  return {"Access-Control-Allow-Origin": o, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type",
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
  const prefs = Object.fromEntries(TYPES.map(t => [t, b.prefs && typeof b.prefs[t] === "boolean" ? b.prefs[t] : true]));
  let email = typeof b.email === "string" ? b.email.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 120) : "";
  const id = await subId(endpoint), t = nowIso();
  await env.DB.prepare(
    `INSERT INTO subscribers (id, endpoint, p256dh, auth, email, ${TYPES.join(", ")}, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
     ON CONFLICT(id) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, email = excluded.email,
       ${TYPES.map(c => `${c} = excluded.${c}`).join(", ")}, updated_at = excluded.updated_at, fail_count = 0`
  ).bind(id, endpoint, keys.p256dh, keys.auth, email || null, ...TYPES.map(k => prefs[k] ? 1 : 0), t).run();
  return {ok: true, prefs};
}

async function unsubscribe(req, env) {
  const b = await readJson(req);
  if (typeof b.endpoint !== "string" || b.endpoint.length > 1024) throw new HttpError(400, "endpoint required");
  await env.DB.prepare("DELETE FROM subscribers WHERE id = ?1").bind(await subId(b.endpoint)).run();
  return {ok: true}; // same answer whether or not it existed
}

function vapid(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new HttpError(500, "VAPID keys not configured");
  return {publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || "https://copperandbluenews.com"};
}

/** Send one alert to a list of subscriber rows; deletes dead (404/410) subscriptions. */
async function deliver(env, subs, payload) {
  const v = vapid(env), stats = {sent: 0, gone: 0, failed: 0};
  const dead = [];
  // at most 6 simultaneous outgoing connections per Worker invocation
  for (let i = 0; i < subs.length; i += 6) {
    await Promise.all(subs.slice(i, i + 6).map(async s => {
      try {
        const r = await sendPush(s, payload, v, {ttl: payload.type === "lineup" ? 3 * 3600 : 1800, urgency: "high"});
        if (r.ok) stats.sent++;
        else if (r.gone) { stats.gone++; dead.push(s.id); }
        else { stats.failed++; console.log("push failed", r.status, new URL(s.endpoint).host); }
      } catch (e) { stats.failed++; console.log("push error", String(e)); }
    }));
  }
  if (dead.length) {
    await env.DB.batch(dead.map(id => env.DB.prepare("DELETE FROM subscribers WHERE id = ?1").bind(id)));
  }
  return stats;
}

async function notify(req, env, ctx) {
  if (!(await safeEqual(bearer(req), env.NOTIFY_SECRET))) throw new HttpError(401, "unauthorized");
  const b = await readJson(req);
  if (!TYPES.includes(b.type)) throw new HttpError(400, `type must be one of ${TYPES.join(", ")}`);
  if (typeof b.title !== "string" || !b.title.trim()) throw new HttpError(400, "title required");
  const id = typeof b.id === "string" && b.id ? b.id.slice(0, 120) : null;
  const url = typeof b.url === "string" && b.url.startsWith("/") && !b.url.startsWith("//") ? b.url.slice(0, 300) : "/tracker.html";
  const payload = {type: b.type, title: b.title.slice(0, 120), body: typeof b.body === "string" ? b.body.slice(0, 300) : "", url, id, ts: Date.now()};
  if (id) { // never fan out the same event twice
    const r = await env.DB.prepare("INSERT OR IGNORE INTO sent_events (id, type, title, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(id, b.type, payload.title, nowIso()).run();
    if (!r.meta.changes) return {ok: true, duplicate: true};
  }
  const {results: subs} = await env.DB.prepare(`SELECT id, endpoint, p256dh, auth FROM subscribers WHERE ${b.type} = 1`).all();
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
    out = {ok: true, recipients: subs.length, ...stats, ...(subs.length > list.length ? {skipped: subs.length - list.length, hint: "add the PUSH_QUEUE binding"} : {})};
  }
  if (id) ctx.waitUntil(env.DB.prepare("UPDATE sent_events SET recipients = ?2 WHERE id = ?1").bind(id, subs.length).run());
  return out;
}

const csvCell = v => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep spreadsheet apps from running formulas from user input
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
async function exportCsv(req, env) {
  if (!(await safeEqual(bearer(req), env.ADMIN_SECRET))) throw new HttpError(401, "unauthorized");
  const cols = ["id", "email", ...TYPES, "created_at", "updated_at", "endpoint", "p256dh", "auth"];
  const {results} = await env.DB.prepare(`SELECT ${cols.join(", ")} FROM subscribers ORDER BY created_at`).all();
  const csv = [cols.join(","), ...results.map(r => cols.map(c => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
  return new Response(csv, {headers: {"Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="cbn-alerts-signups-${new Date().toISOString().slice(0, 10)}.csv"`}});
}

export default {
  async fetch(req, env, ctx) {
    const {pathname} = new URL(req.url);
    const c = cors(req, env);
    const browserRoute = pathname === "/subscribe" || pathname === "/unsubscribe";
    try {
      if (req.method === "OPTIONS") {
        if (browserRoute && c["Access-Control-Allow-Origin"]) return new Response(null, {status: 204, headers: c});
        return new Response(null, {status: 403});
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
      if (pathname === "/health") return json({ok: true});
      return json({error: "not found"}, 404);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.log("error", e && e.stack || String(e));
      return json({error: status === 500 ? "server error" : e.message}, status, browserRoute ? c : {});
    }
  },

  // Queue consumer: each message = {payload, subs[<=40]}.
  async queue(batch, env) {
    for (const msg of batch.messages) {
      try {
        const stats = await deliver(env, msg.body.subs || [], msg.body.payload);
        console.log("queue batch", msg.body.payload && msg.body.payload.id, JSON.stringify(stats));
      } catch (e) { console.log("queue error", String(e)); }
      msg.ack(); // never retry a batch: a retry would re-send to everyone who already got the alert
    }
  },
};
