// Newsletter list only. No email delivery and no coupling to web-push subscriptions/preferences.
export const CONSENT_VERSION = '2026-11-06-v1';
export const CONSENT_TEXT = 'Game day previews and Oilers news from The Copper & Blue News. Unsubscribe anytime.';
const PREFIX = 'nl:', te = new TextEncoder();
export class NewsletterError extends Error {constructor(status, message) {super(message); this.status = status;}}
const fail = (status, message) => {throw new NewsletterError(status, message);};
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
let signingKey, signingSecret;
async function key(env) {
  if (!env.ADMIN_SECRET) fail(503, 'Email sign-up is temporarily unavailable. Please try again later.');
  if (signingSecret !== env.ADMIN_SECRET) {
    signingKey = await crypto.subtle.importKey('raw', te.encode(env.ADMIN_SECRET), {name:'HMAC', hash:'SHA-256'}, false, ['sign','verify']);
    signingSecret = env.ADMIN_SECRET;
  }
  return signingKey;
}
async function hmac(env, text) {return crypto.subtle.sign('HMAC', await key(env), te.encode(text));}
export function normalizeEmail(value) {
  if (typeof value !== 'string' || value.length > 320) fail(400, 'Please enter a valid email address.');
  const email = value.trim().toLowerCase(), [local, domain, extra] = email.split('@');
  if (extra !== undefined || !local || !domain || email.length > 254 || local.length > 64 ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(domain))
    fail(400, 'Please enter a valid email address.');
  return email;
}
export async function emailId(email) {return hex(await crypto.subtle.digest('SHA-256', te.encode(email)));}
export async function subscribe(body, req, env) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "Please enter a valid sign-up.");
  if (typeof body.website === 'string' && body.website.trim()) return {ok:true}; // honeypot: do not store or reveal it
  const email = normalizeEmail(body.email);
  if (body.consent !== true || body.consentVersion !== CONSENT_VERSION)
    fail(400, 'Please agree to receive the game day email before signing up.');
  // Native edge limiter avoids burning shared ALERTS_KV write quota on per-IP counters. Approximate, per location.
  if (!env.NEWSLETTER_RATE) fail(503, 'Email sign-up is temporarily unavailable. Please try again later.');
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const rateKey = hex(await hmac(env, 'cbn-newsletter-rate-v1:' + ip)); // no raw IP retained in the subscriber record
  if (!(await env.NEWSLETTER_RATE.limit({key:rateKey})).success)
    fail(429, 'Too many attempts. Please wait a minute and try again.');
  const id = await emailId(email), existing = await env.ALERTS_KV.get(PREFIX + id, 'json');
  if (!existing) {
    const ts = new Date().toISOString();
    const row = {email, ts, source:['home','news'].includes(body.source) ? body.source : 'site',
      consent_text:CONSENT_TEXT, consent_version:CONSENT_VERSION, consent_ts:ts, consent_method:'unchecked_checkbox_and_submit'};
    // Deterministic key: repeat submissions never create another list entry. Preserve the first consent record.
    await env.ALERTS_KV.put(PREFIX + id, JSON.stringify(row), {metadata:row});
  }
  return {ok:true}; // same response for new/existing addresses; never expose membership or the unsubscribe token
}
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const tokenMessage = (id, stamp) => `cbn-newsletter-unsubscribe-v1:${id}:${stamp}`;
export async function unsubscribeToken(env, id, ts) {
  const stamp = String(Date.parse(ts));
  return `v1.${id}.${stamp}.${b64(await hmac(env, tokenMessage(id, stamp)))}`;
}
async function verifyToken(token, env) {
  if (typeof token !== 'string' || token.length > 180) fail(400, 'This unsubscribe link is invalid.');
  const [v,id,stamp,sig,extra] = token.split('.');
  if (extra !== undefined || v !== 'v1' || !/^[a-f0-9]{64}$/.test(id || '') || !/^\d{13}$/.test(stamp || '') || !/^[A-Za-z0-9_-]{43}$/.test(sig || ''))
    fail(400, 'This unsubscribe link is invalid.');
  const bytes = Uint8Array.from(atob(sig.replace(/-/g,'+').replace(/_/g,'/')+'='), c=>c.charCodeAt(0));
  if (b64(bytes) !== sig || !(await crypto.subtle.verify('HMAC', await key(env), bytes, te.encode(tokenMessage(id, stamp)))))
    fail(400, 'This unsubscribe link is invalid.');
  return {id, stamp};
}
export async function unsubscribe(token, env) {
  const {id, stamp} = await verifyToken(token, env), row = await env.ALERTS_KV.get(PREFIX + id, 'json');
  // A link issued before a later explicit re-subscription must not remove that new consent.
  if (row && String(Date.parse(row.ts)) !== stamp) fail(400, 'This link is no longer current. Please use the latest email.');
  if (row) await env.ALERTS_KV.delete(PREFIX + id);
  return {ok:true}; // repeat valid unsubscribe links remain harmless
}
export function unsubscribePage(ok) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Newsletter | The Copper &amp; Blue News</title><style>body{background:#0b1a33;color:#ecf1fa;font:16px/1.6 system-ui;margin:0;padding:32px 20px}main{max-width:480px;margin:10vh auto;padding:24px;border:1px solid #c8763a;border-radius:16px}a{color:#f4b37c}h1{line-height:1.2}</style><main><p>The Copper &amp; Blue News</p><h1>${ok ? "You're unsubscribed." : 'This link is invalid or no longer current.'}</h1><p>${ok ? 'Your email has been removed from the newsletter list. Your game alerts are unchanged.' : 'Use the unsubscribe link in your latest email, or contact us through the Privacy page.'}</p><a href="https://copperandbluenews.com/${ok ? '' : 'privacy.html#newsletter'}">${ok ? 'Back to the site' : 'Privacy & contact'}</a></main></html>`;
}
export async function rows(env) {
  const out = []; let cursor;
  do {
    const page = await env.ALERTS_KV.list({prefix:PREFIX, limit:1000, ...(cursor ? {cursor} : {})});
    for (const k of page.keys) {
      const row = k.metadata?.email ? k.metadata : await env.ALERTS_KV.get(k.name, 'json');
      if (row) out.push({id:k.name.slice(PREFIX.length), ...row});
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}
export async function counts(env) {
  const list = await rows(env), since = Date.now() - 86400000;
  return {total:list.length, new_24h:list.filter(r=>Date.parse(r.ts) >= since).length};
}
