// Workers KV storage for Game alerts (binding: ALERTS_KV).
//   sub:<id>  one sign-up. The whole record also rides in the key's metadata (compact keys, < 1024 bytes),
//             so fan-out and /export only need list() calls (1000 keys per call, paged with a cursor)
//             instead of one read per subscriber. Oversized records fall back to reading the value.
//   evt:<id>  an event id that was already fanned out (dedupe), kept 45 days.
// KV is eventually consistent (a write can take up to ~60 s to show everywhere). Dedupe retries from
// GitHub Actions come minutes apart, and the pipeline keeps its own sent-id state too.
export const TYPES = ["puck_drop", "goal", "period_end", "final", "lineup"];
const SUB = "sub:", EVT = "evt:";
const META_MAX = 1000;

const toMask = prefs => TYPES.reduce((m, t, i) => m | (prefs[t] ? 1 << i : 0), 0);
const fromMask = m => Object.fromEntries(TYPES.map((t, i) => [t, !!(m & (1 << i))]));
const compact = r => ({e: r.endpoint, k: r.p256dh, a: r.auth, m: toMask(r.prefs), n: r.email || "", c: r.created_at, u: r.updated_at});
const expand = (id, x) => ({id, endpoint: x.e, p256dh: x.k, auth: x.a, prefs: fromMask(x.m), email: x.n || null, created_at: x.c, updated_at: x.u});

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
export const markEvent = (env, id, info) => env.ALERTS_KV.put(EVT + id, JSON.stringify(info), {expirationTtl: 45 * 86400});
