// Checks the WebCrypto web-push code against an independent decrypter (http_ece) and verifies the VAPID JWT.
// Run: npm i --no-save http_ece && node test/webpush.test.mjs
import crypto from "node:crypto";
import assert from "node:assert/strict";
import ece from "http_ece";
import {encryptPayload, vapidAuthorization, b64uToBytes, bytesToB64u} from "../src/webpush.js";

// a fake browser subscription
const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
const authSecret = crypto.randomBytes(16);
const sub = {p256dh: bytesToB64u(ua.getPublicKey()), auth: bytesToB64u(authSecret)};
const msg = JSON.stringify({type: "goal", title: "🚨 OILERS GOAL! EDM 1, ANA 0", body: "C. McDavid (5) from Draisaitl · 1st 4:12", url: "/tracker.html"});
const body = Buffer.from(await encryptPayload(msg, sub.p256dh, sub.auth));
const plain = ece.decrypt(body, {version: "aes128gcm", privateKey: ua, authSecret});
assert.equal(plain.toString(), msg);
console.log("aes128gcm round-trip: ok (" + body.length + " bytes)");

// VAPID JWT signed with a throwaway key, verified with node:crypto
const k = crypto.createECDH("prime256v1"); k.generateKeys();
const v = {publicKey: bytesToB64u(k.getPublicKey()), privateKey: bytesToB64u(k.getPrivateKey()), subject: "https://copperandbluenews.com"};
const h = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", v);
const [, jwt, key] = h.match(/^vapid t=([^,]+), k=(.+)$/);
assert.equal(key, v.publicKey);
const [hd, pl, sig] = jwt.split(".");
const claims = JSON.parse(Buffer.from(pl, "base64url"));
assert.equal(claims.aud, "https://fcm.googleapis.com"); assert.equal(claims.sub, v.subject); assert.ok(claims.exp > Date.now() / 1000);
const pubKey = crypto.createPublicKey({key: {kty: "EC", crv: "P-256", x: bytesToB64u(k.getPublicKey().subarray(1, 33)), y: bytesToB64u(k.getPublicKey().subarray(33))}, format: "jwk"});
assert.ok(crypto.verify("sha256", Buffer.from(`${hd}.${pl}`), {key: pubKey, dsaEncoding: "ieee-p1363"}, Buffer.from(sig, "base64url")));
console.log("VAPID ES256 JWT: ok", JSON.stringify(claims));
