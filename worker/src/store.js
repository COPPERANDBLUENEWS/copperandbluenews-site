// Workers KV storage for Game alerts (binding: ALERTS_KV).
//   sub:<id>  one sign-up. The whole record also rides in the key's metadata (compact keys, < 1024 bytes),
//             so fan-out and /export only need list() calls (1000 keys per call, paged with a cursor)
//             instead of one read per subscriber. Oversized records fall back to reading the value.
//   evt:<id>  an event id that was already fanned out (dedupe), kept 45 days. Metadata {t, at, r} feeds /stats.
//   snd:<ms>:<rand>  send stats for one delivery batch (one queue message or one inline send): metadata
//             {i: event id, t: type, n: attempts, s: sent, g: gone, f: failed}, kept 8 days. One KV write per
//             batch of up to 40 subscribers, so a game night stays far under the Free plan's 1,000 writes/day.
//   alog:<id>        append-only copy of one sent alert (never rewritten once present).
//   alerts:log       newest-first JSON array, capped, that GET /alerts/log returns in one read.
//                    The GameAlerts actor serializes updates. A retry that finds alog:<id> already written
//                    still makes sure that id is in the array, so a crash between the two puts can heal.
// KV is eventually consistent (a write can take up to ~60 s to show everywhere). Dedupe retries from
// GitHub Actions come minutes apart, and the pipeline keeps its own sent-id state too.
export const TYPES = ["puck_drop", "goal", "period_end", "final", "lineup", "odds", "gameday", "pregame_60", "pregame_15", "close_game", "special_teams"];
// Defaults when a sign-up doesn't say: betting odds are opt-in (off), everything else on.
export const DEFAULTS = {puck_drop: true, goal: true, period_end: true, final: true, lineup: true, odds: false, gameday: true, pregame_60: true, pregame_15: true, close_game: true, special_teams: true};
const SUB = "sub:", EVT = "evt:", SND = "snd:", ALOG = "alog:", ALERTS = "alerts:log";
const LOG_MAX = 400;
const META_MAX = 1000;
// Added after a given mask version. Older masks have no bits for them, so those sign-ups stay opted in until they save again.
const ADDED_ON = {pregame_60: 3, pregame_15: 3, close_game: 4, special_teams: 4};

const toMask = prefs => TYPES.reduce((m, t, i) => m | (prefs[t] ? 1 << i : 0), 0);
// v1 records (before Nov 5, 2026) only had the first 5 bits: they get gameday ON (core game alert) and odds OFF.
// v2 records predate the pre-game reminders: those two default ON. v3 predates close-game and special-teams
// alerts: those two default ON. v4 stores the checkbox the fan saved.
const fromMask = (m, v) => Object.fromEntries(TYPES.map((t, i) => {
  if (!v && t === "gameday") return [t, true];
  if ((v || 0) < (ADDED_ON[t] || 0)) return [t, true];
  return [t, !!(m & (1 << i))];
}));
const compact = r => ({v: 4, e: r.endpoint, k: r.p256dh, a: r.auth, m: toMask(r.prefs), n: r.email || "", c: r.created_at, u: r.updated_at});
const expand = (id, x) => ({id, endpoint: x.e, p256dh: x.k, auth: x.a, prefs: fromMask(x.m, x.v), email: x.n || null, created_at: x.c, updated_at: x.u});

export async function putSub(env, id, rec, now) {
  const old = await getSub(env, id);
  const full = {...rec, created_at: old?.created_at || now, updated_at: now};
  const c = compact(full), meta = JSON.stringify(c).length <= META_MAX ? c : {m: c.m, big: 1};
  await env.ALERTS_KV.put(SUB + id, JSON.stringify(c), {metadata: meta});
  return full;
}
export async function getSub(env, id) {
  const v = await env.ALERTS_KV.get(SUB + id, "json");
  return v ? expand(id, v) : null;
}
export const deleteSub = (env, id) => env.ALERTS_KV.delete(SUB + id);

/** Every subscriber, paging list() with its cursor. */
export async function listSubs(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.ALERTS_KV.list({prefix: SUB, cursor, limit: 1000});
    for (const k of page.keys) {
      const id = k.name.slice(SUB.length), m = k.metadata;
      if (m && !m.big && m.e) out.push(expand(id, m));
      else { const r = await getSub(env, id); if (r) out.push(r); }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

export async function eventSeen(env, id) { return (await env.ALERTS_KV.get(EVT + id)) !== null; }
export const markEvent = (env, id, info) => env.ALERTS_KV.put(EVT + id, JSON.stringify(info),
  {expirationTtl: 45 * 86400, metadata: {t: info.type, at: info.at, ...(info.recipients != null ? {r: info.recipients} : {})}});

/** List every key under a prefix with its metadata. */
async function listAll(env, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await env.ALERTS_KV.list({prefix, cursor, limit: 1000});
    out.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}
export const listEvents = env => listAll(env, EVT).then(ks => ks.map(k => ({id: k.name.slice(EVT.length), ...(k.metadata || {})})));

export function recordSend(env, id, type, stats, attempts) {
  const key = SND + String(Date.now()).padStart(13, "0") + ":" + Math.random().toString(36).slice(2, 8);
  return env.ALERTS_KV.put(key, "", {expirationTtl: 8 * 86400,
    metadata: {i: id || "", t: type, n: attempts, s: stats.sent, g: stats.gone, f: stats.failed}});
}
export const listSends = env => listAll(env, SND).then(ks => ks.map(k => ({ts: +k.name.slice(SND.length, SND.length + 13), ...(k.metadata || {})})));

function cleanDetail(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,24}$/.test(k) || Object.keys(out).length >= 24) continue;
    if (typeof v === "string") out[k] = v.slice(0, 180);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter(x => typeof x === "string").slice(0, 6).map(s => s.slice(0, 80));
  }
  return Object.keys(out).length ? out : null;
}

function asAlert(entry) {
  if (!entry || typeof entry.id !== "string" || !entry.id.trim()) return null;
  if (!TYPES.includes(entry.type)) return null;
  const id = entry.id.trim().slice(0, 120);
  const url = typeof entry.url === "string" && entry.url.startsWith("/") && !entry.url.startsWith("//") ? entry.url.slice(0, 300) : "/tracker.html";
  const at = typeof entry.at === "string" && /^\d{4}-\d{2}-\d{2}T/.test(entry.at) ? entry.at.slice(0, 40) : new Date().toISOString();
  const fromId = /^\d{10}/.test(id) ? id.split(":")[0] : "";
  const game = typeof entry.game === "string" && /^\d{10}$/.test(entry.game) ? entry.game : (fromId.length === 10 ? fromId : null);
  return {
    id, type: entry.type, title: String(entry.title || "").slice(0, 160), body: String(entry.body || "").slice(0, 400),
    url, at, game, matchup: String(entry.matchup || "").slice(0, 80), away: String(entry.away || "").slice(0, 8),
    home: String(entry.home || "").slice(0, 8), detail: cleanDetail(entry.detail),
  };
}

async function ensureInList(env, rec) {
  const cur = await env.ALERTS_KV.get(ALERTS, "json");
  const list = Array.isArray(cur) ? cur.filter(x => x && x.id && x.id !== rec.id) : [];
  list.unshift(rec);
  list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const next = list.slice(0, LOG_MAX);
  if (Array.isArray(cur) && cur.length === next.length && cur.every((x, i) => x.id === next[i].id)) return;
  await env.ALERTS_KV.put(ALERTS, JSON.stringify(next));
}

/** Append one sent alert. The per-id key is write-once; the public array is the read model. */
export async function appendAlert(env, entry) {
  if (!env?.ALERTS_KV) return {ok: false};
  const rec = asAlert(entry);
  if (!rec) return {ok: false};
  const prev = await env.ALERTS_KV.get(ALOG + rec.id);
  if (prev) {
    try { await ensureInList(env, JSON.parse(prev)); } catch { /* keep the original record */ }
    return {ok: true, duplicate: true};
  }
  await env.ALERTS_KV.put(ALOG + rec.id, JSON.stringify(rec));
  await ensureInList(env, rec);
  return {ok: true};
}

export async function readAlertLog(env) {
  const list = await env.ALERTS_KV.get(ALERTS, "json");
  return Array.isArray(list) ? list : [];
}
