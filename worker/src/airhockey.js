// HTTP front for AirHockey accounts and matchmaking. WebSocket upgrades are forwarded to the match Durable Object.
// Existing alert, live, newsletter, pick'em, and first-goal routes do not come through here.
import {lobbyStub} from "./airhockey-lobby.js";

const SITE = ["https://copperandbluenews.com", "https://www.copperandbluenews.com"];

function clientIp(req) {
  return (req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For") || "0.0.0.0").split(",")[0].trim().slice(0, 64);
}
function localWorker(req) {
  const host = new URL(req.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}
function originAllowed(req, env) {
  const origin = req.headers.get("Origin");
  if (!origin) return true;
  if (SITE.includes(origin)) return true;
  const extra = String(env.EXTRA_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (extra.includes(origin)) return true;
  if (!localWorker(req)) return false;
  try {
    const u = new URL(origin);
    return (u.hostname === "localhost" || u.hostname === "127.0.0.1") && (u.protocol === "http:" || u.protocol === "https:");
  } catch { return false; }
}
function corsHeaders(req, env) {
  const origin = req.headers.get("Origin");
  if (!origin || !originAllowed(req, env)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {status, headers: {"Content-Type": "application/json", "Cache-Control": "no-store", ...cors}});
}
const bearer = req => (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();

async function readBody(req) {
  const text = await req.text();
  if (text.length > 4096) return {error: "payload too large", status: 413};
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {error: "invalid JSON", status: 400}; }
}

export async function handle(req, env) {
  const cors = corsHeaders(req, env);
  const url = new URL(req.url);
  const path = url.pathname;
  if (req.method === "OPTIONS") {
    if (!cors["Access-Control-Allow-Origin"]) return new Response(null, {status: 403});
    return new Response(null, {status: 204, headers: cors});
  }
  if (req.headers.get("Origin") && !cors["Access-Control-Allow-Origin"]) return json({error: "origin not allowed"}, 403, {});
  if (!env.AIRHOCKEY_LOBBY || !env.AIRHOCKEY_MATCH) return json({error: "Online play is not set up on this server yet."}, 503, cors);

  if (path.startsWith("/airhockey/ws/")) {
    if (req.headers.get("Upgrade") !== "websocket") return json({error: "expected websocket"}, 426, cors);
    const matchId = decodeURIComponent(path.slice("/airhockey/ws/".length));
    if (!/^m_[a-f0-9]{16}$/.test(matchId)) return json({error: "bad match"}, 400, cors);
    const stub = env.AIRHOCKEY_MATCH.get(env.AIRHOCKEY_MATCH.idFromName(matchId));
    return stub.fetch(req);
  }

  const lobby = lobbyStub(env);
  const token = bearer(req);
  const ip = clientIp(req);
  let body = {};
  if (req.method === "POST" || req.method === "DELETE" && req.headers.get("Content-Type")) {
    if (req.method === "POST") {
      body = await readBody(req);
      if (body.error && body.status) return json({error: body.error}, body.status, cors);
    }
  }
  const send = async (pathname, method, payload) => {
    const res = await lobby.fetch("https://lobby.internal" + pathname, {
      method,
      headers: {"Content-Type": "application/json"},
      body: payload == null ? undefined : JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({error: "server error"}));
    const headers = {...cors, "Cache-Control": "no-store"};
    if (res.status === 429) headers["Retry-After"] = "60";
    return new Response(JSON.stringify(out), {status: res.status, headers: {"Content-Type": "application/json", ...headers}});
  };

  if (path === "/airhockey/signup" && req.method === "POST") return send("/signup", "POST", {...body, ip});
  if (path === "/airhockey/login" && req.method === "POST") return send("/login", "POST", {...body, ip});
  if (path === "/airhockey/me" && req.method === "GET") return send("/me?token=" + encodeURIComponent(token), "GET");
  if (path === "/airhockey/leaderboard" && req.method === "GET") {
    const sort = url.searchParams.get("sort") || "rating";
    const limit = url.searchParams.get("limit") || "25";
    return send("/leaderboard?token=" + encodeURIComponent(token) + "&sort=" + encodeURIComponent(sort) + "&limit=" + encodeURIComponent(limit), "GET");
  }
  if (path === "/airhockey/quick" && req.method === "POST") return send("/quick", "POST", {token, ip});
  if (path === "/airhockey/quick" && req.method === "GET") return send("/quick?token=" + encodeURIComponent(token), "GET");
  if (path === "/airhockey/quick" && req.method === "DELETE") return send("/quick?token=" + encodeURIComponent(token), "DELETE");
  if (path === "/airhockey/room" && req.method === "POST") return send("/room", "POST", {token, ip});
  if (path === "/airhockey/room" && req.method === "GET") return send("/room?token=" + encodeURIComponent(token) + "&code=" + encodeURIComponent(url.searchParams.get("code") || ""), "GET");
  if (path === "/airhockey/room" && req.method === "DELETE") return send("/room?token=" + encodeURIComponent(token) + "&code=" + encodeURIComponent(url.searchParams.get("code") || ""), "DELETE");
  if (path === "/airhockey/join" && req.method === "POST") return send("/join", "POST", {...body, token, ip});
  return json({error: "not found"}, 404, cors);
}
