// Web Push for Cloudflare Workers, WebCrypto only (no Node APIs, no npm deps):
//   RFC 8291 message encryption (aes128gcm, RFC 8188) + RFC 8292 VAPID (ES256 JWT).
const te = new TextEncoder();

export function b64uToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
export function bytesToB64u(b) {
  let s = "";
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({name: "HKDF", hash: "SHA-256", salt, info}, key, bytes * 8));
}

/** Encrypt `payload` (string or bytes) for one subscription ({p256dh, auth} base64url). Returns the aes128gcm body. */
export async function encryptPayload(payload, p256dh, auth) {
  const uaPublic = b64uToBytes(p256dh), authSecret = b64uToBytes(auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error("bad subscription keys");
  const plaintext = typeof payload === "string" ? te.encode(payload) : payload;
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, {name: "ECDH", namedCurve: "P-256"}, false, []);
  const as = await crypto.subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({name: "ECDH", public: uaKey}, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdhSecret, concat(te.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = concat(plaintext, new Uint8Array([2])); // single, last record: delimiter 0x02, no padding
  const ct = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv: nonce}, aes, record));
  const rs = 4096;
  const header = concat(salt, new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255, asPublic.length]), asPublic);
  return concat(header, ct);
}

let vapidKey = null, vapidKeySrc = "";
const jwtCache = new Map(); // audience -> {jwt, exp}

async function signingKey(publicKey, privateKey) {
  if (vapidKey && vapidKeySrc === publicKey + privateKey) return vapidKey;
  const pub = b64uToBytes(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY must be an uncompressed P-256 point (base64url)");
  const jwk = {kty: "EC", crv: "P-256", x: bytesToB64u(pub.slice(1, 33)), y: bytesToB64u(pub.slice(33, 65)), d: privateKey, ext: false};
  vapidKey = await crypto.subtle.importKey("jwk", jwk, {name: "ECDSA", namedCurve: "P-256"}, false, ["sign"]);
  vapidKeySrc = publicKey + privateKey;
  return vapidKey;
}

/** VAPID Authorization header value for a push endpoint. */
export async function vapidAuthorization(endpoint, {publicKey, privateKey, subject}) {
  const aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000);
  const hit = jwtCache.get(aud);
  if (hit && hit.exp - now > 3600) return `vapid t=${hit.jwt}, k=${publicKey}`;
  const exp = now + 12 * 3600;
  const enc = o => bytesToB64u(te.encode(JSON.stringify(o)));
  const unsigned = `${enc({typ: "JWT", alg: "ES256"})}.${enc({aud, exp, sub: subject})}`;
  const sig = await crypto.subtle.sign({name: "ECDSA", hash: "SHA-256"}, await signingKey(publicKey, privateKey), te.encode(unsigned));
  const jwt = `${unsigned}.${bytesToB64u(sig)}`; // WebCrypto ECDSA output is raw r||s, which is what JWS ES256 wants
  jwtCache.set(aud, {jwt, exp});
  return `vapid t=${jwt}, k=${publicKey}`;
}

/** Send one push. Returns {status, ok, gone} (gone = 404/410: subscription is dead, delete it). */
export async function sendPush(sub, payload, vapid, {ttl = 3600, urgency = "high", topic} = {}) {
  const body = await encryptPayload(typeof payload === "string" ? payload : JSON.stringify(payload), sub.p256dh, sub.auth);
  const headers = {
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(ttl),
    Urgency: urgency,
    Authorization: await vapidAuthorization(sub.endpoint, vapid),
  };
  if (topic) headers.Topic = topic;
  const res = await fetch(sub.endpoint, {method: "POST", headers, body});
  return {status: res.status, ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410};
}
