// Workers KV storage for Game alerts (binding: ALERTS_KV).
//   sub:<id>  one sign-up. The whole record also rides in the key's metadata (compact keys, < 1024 bytes),
//             so fan-out and /export only need list() calls (1000 keys per call, paged with a cursor)
//             instead of one read per subscriber. Oversized records fall back to reading the value.
//   evt:<id>  an event id that was already fanned out (dedupe), kept 45 days. Metadata {t, at, r} feeds /stats.
//   snd:<ms>:<rand>  send stats for one delivery batch (one queue message or one inline send): metadata
//             {i: event id, t: type, n: attempts, s: sent, g: gone, f: failed}, kept 8 days. One KV write per
//             batch of up to 40 subscribers, so a game night stays far under the Free plan's 1,000 writes/day.
// KV is eventually consistent (a write can take up to ~60 s to show everywhere). Dedupe retries from
// GitHub Actions come minutes apart, and the pipeline keeps its own sent-id state too.
export const TYPES = ["puck_drop", "goal", "period_end", "final", "lineup", "odds", "gameday"];
// Defaults when a sign-up doesn't say: betting odds are opt-in (off), everything else on.
export const DEFAULTS = {puck_drop: true, goal: true, period_end: true, final: true, lineup: true, odds: false, gameday: true};
const SUB = "sub:", EVT = "evt:", SND = "snd:";
const META_MAX = 1000;

const toMask = prefs => TYPES.reduce((m, t, i) => m | (prefs[t] ? 1 << i : 0), 0);
// v1 records (before Nov 5, 2026) only had the first 5 bits: they get gameday ON (core game alert) and odds OFF.
const fromMask = (m, v) => Object.fromEntries(TYPES.map((t, i) => [t, !v && t === "gameday" ? true : !!(m & (1 << i))]));
const compact = r => ({v: 2, e: r.endpoint, k: r.p256dh, a: r.auth, m: toMask(r.prefs), n: r.email || "", c: r.created_at, u: r.updated_at});
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
