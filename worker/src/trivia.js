// HTTP front for Oilers Trivia accounts, solo runs, and duel matchmaking.
// WebSocket upgrades are not used. Duel clients poll the match Durable Object.
// Alert, live, newsletter, pick'em, first-goal, and AirHockey routes do not come through here.
import {lobbyStub} from "./trivia-lobby.js";

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
  if (!env.TRIVIA_LOBBY || !env.TRIVIA_MATCH) return json({error: "Trivia is not set up on this server yet."}, 503, cors);

  const lobby = lobbyStub(env);
  const token = bearer(req);
  const ip = clientIp(req);
  let body = {};
  if (req.method === "POST") {
    body = await readBody(req);
    if (body.error && body.status) return json({error: body.error}, body.status, cors);
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

  if (path === "/trivia/signup" && req.method === "POST") return send("/signup", "POST", {...body, ip});
  if (path === "/trivia/login" && req.method === "POST") return send("/login", "POST", {...body, ip});
  if (path === "/trivia/me" && req.method === "GET") return send("/me?token=" + encodeURIComponent(token), "GET");
  if (path === "/trivia/leaderboard" && req.method === "GET") {
    const sort = url.searchParams.get("sort") || "points";
    const limit = url.searchParams.get("limit") || "25";
    return send("/leaderboard?token=" + encodeURIComponent(token) + "&sort=" + encodeURIComponent(sort) + "&limit=" + encodeURIComponent(limit), "GET");
  }
  if (path === "/trivia/quick" && req.method === "POST") return send("/quick", "POST", {token, ip});
  if (path === "/trivia/quick" && req.method === "GET") return send("/quick?token=" + encodeURIComponent(token), "GET");
  if (path === "/trivia/quick" && req.method === "DELETE") return send("/quick?token=" + encodeURIComponent(token), "DELETE");
  if (path === "/trivia/room" && req.method === "POST") return send("/room", "POST", {token, ip});
  if (path === "/trivia/room" && req.method === "GET") return send("/room?token=" + encodeURIComponent(token) + "&code=" + encodeURIComponent(url.searchParams.get("code") || ""), "GET");
  if (path === "/trivia/room" && req.method === "DELETE") return send("/room?token=" + encodeURIComponent(token) + "&code=" + encodeURIComponent(url.searchParams.get("code") || ""), "DELETE");
  if (path === "/trivia/join" && req.method === "POST") return send("/join", "POST", {...body, token, ip});
  if (path === "/trivia/solo" && req.method === "POST") return send("/solo", "POST", {token, ip});
  if (path === "/trivia/solo" && req.method === "GET") return send("/solo?token=" + encodeURIComponent(token), "GET");
  if (path === "/trivia/solo/answer" && req.method === "POST") return send("/solo/answer", "POST", {...body, token});
  if (path === "/trivia/solo/next" && req.method === "POST") return send("/solo/next", "POST", {...body, token});

  if (path === "/trivia/duel" && req.method === "GET" || path === "/trivia/duel/answer" && req.method === "POST") {
    const matchId = (path === "/trivia/duel" ? url.searchParams.get("match") : body.matchId) || "";
    if (!/^t_[a-f0-9]{16}$/.test(matchId)) return json({error: "bad duel"}, 400, cors);
    const authRes = await lobby.fetch("https://lobby.internal/auth-match", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({token, matchId}),
    });
    const auth = await authRes.json().catch(() => ({error: "server error"}));
    if (!authRes.ok) return json(auth, authRes.status, cors);
    const stub = env.TRIVIA_MATCH.get(env.TRIVIA_MATCH.idFromName(matchId));
    const forwarded = path === "/trivia/duel"
      ? await stub.fetch("https://match.internal/state?userId=" + encodeURIComponent(auth.userId))
      : await stub.fetch("https://match.internal/answer", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({userId: auth.userId, choice: body.choice}),
      });
    const out = await forwarded.json().catch(() => ({error: "server error"}));
    return json(out, forwarded.status, cors);
  }
  return json({error: "not found"}, 404, cors);
}
