import {sendPush} from "./webpush.js";
import * as store from "./store.js";

export function vapid(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error("VAPID keys not configured");
  return {publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || "https://copperandbluenews.com"};
}

/** Send one alert to a list of subscriber rows; deletes dead (404/410) subscriptions. */
export async function deliver(env, subs, payload, {afterEach} = {}) {
  const v = vapid(env), stats = {sent: 0, gone: 0, failed: 0};
  const dead = [];
  // at most 6 simultaneous outgoing connections per Worker invocation
  for (let i = 0; i < subs.length; i += 6) {
    await Promise.all(subs.slice(i, i + 6).map(async s => {
      let result;
      try {
        const p = s.altBody ? {...payload, body: s.altBody} : payload;
        const ttl = payload.type === "pregame_60" || payload.type === "pregame_15" ? 120
          : ["lineup", "gameday", "odds"].includes(payload.type) ? 3 * 3600 : 1800;
        const r = await sendPush(s, p, v, {ttl, urgency: "high", topic: payload.topic});
        result = r;
        if (r.ok) stats.sent++;
        else if (r.gone) { stats.gone++; dead.push(s.id); }
        else { stats.failed++; console.log("push failed", r.status, new URL(s.endpoint).host); }
      } catch (e) { result = {ok: false, gone: false}; stats.failed++; console.log("push error", String(e)); }
      if (afterEach) await afterEach(s, result);
    }));
  }
  for (const id of dead) await store.deleteSub(env, id);
  return stats;
}

// Shared preference selection/payload construction for HTTP notify and durable game outbox.
export async function notificationPlan(env, b) {
  const payload = {type: b.type, title: b.title.slice(0, 120), body: (b.body || "").slice(0, 300), url: b.url,
    id: b.id, ts: Date.now(), ...(b.topic ? {topic: b.topic, renotify: false} : {})};
  const only = b.to || null;
  const pool = only ? [await store.getSub(env, only)].filter(Boolean) : await store.listSubs(env);
  const subs = pool.filter(s => only || s.prefs[b.type]).map(({id, endpoint, p256dh, auth, prefs}) =>
    ({id, endpoint, p256dh, auth, ...(b.alt && prefs[b.alt.pref] ? {altBody: b.alt.body.slice(0, 300)} : {})}));
  return {payload, subs};
}
