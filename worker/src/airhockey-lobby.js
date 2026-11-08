// One SQLite Durable Object for AirHockey accounts, the quick-match queue, friend rooms, and the leaderboard.
// Email is a nullable column so a later login can attach one without a new table.
// GameAlerts is a different class and is not used here.
import {validateUsername} from "./airhockey-names.js";
import {eloPoints, START_RATING} from "./airhockey-elo.js";

const LOBBY_NAME = "airhockey-lobby";
const SIGNUP_LIMIT = 6, SIGNUP_WINDOW = 3600;
const MATCH_LIMIT = 20, MATCH_WINDOW = 600;
const LOGIN_LIMIT = 20, LOGIN_WINDOW = 600;
const ROOM_TTL = 30 * 60 * 1000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// Long enough for two people who tap Quick Match a few seconds apart to pair.
// Short enough that a solo player is not left on the queue. Not an env override.
export const QUICK_WAIT_MS = 8000;

export function lobbyStub(env) {
  if (!env.AIRHOCKEY_LOBBY) return null;
  return env.AIRHOCKEY_LOBBY.get(env.AIRHOCKEY_LOBBY.idFromName(LOBBY_NAME));
}

const te = new TextEncoder();
export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", te.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}
function roomCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}
function matchId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "m_" + [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
function recoveryCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12);
}
export function normalizeRecovery(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {status, headers: {"Content-Type": "application/json"}});
}
const fail = (status, error) => json({error}, status);

function career(row) {
  const gp = row.gp || 0, gf = row.gf || 0, ga = row.ga || 0;
  return {
    id: row.id, username: row.username, email: row.email || null,
    gp, wins: row.wins || 0, losses: row.losses || 0, ties: row.ties || 0, otl: row.otl || 0,
    gf, ga, diff: gf - ga, gpg: gp ? Math.round((gf / gp) * 100) / 100 : 0, rating: row.rating,
  };
}

export class AirHockeyLobby {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        username_key TEXT NOT NULL UNIQUE,
        token_hash TEXT NOT NULL,
        recovery_hash TEXT NOT NULL,
        email TEXT,
        email_verified_at TEXT,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        rating INTEGER NOT NULL DEFAULT 1000,
        gp INTEGER NOT NULL DEFAULT 0,
        ties INTEGER NOT NULL DEFAULT 0,
        otl INTEGER NOT NULL DEFAULT 0,
        gf INTEGER NOT NULL DEFAULT 0,
        ga INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      for (const [name, ddl] of [["gp", "INTEGER NOT NULL DEFAULT 0"], ["ties", "INTEGER NOT NULL DEFAULT 0"], ["otl", "INTEGER NOT NULL DEFAULT 0"], ["gf", "INTEGER NOT NULL DEFAULT 0"], ["ga", "INTEGER NOT NULL DEFAULT 0"]]) {
        const cols = sql.exec("PRAGMA table_info(users)").toArray();
        if (!cols.some(c => c.name === name)) sql.exec(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`);
      }
      sql.exec(`CREATE TABLE IF NOT EXISTS rates (k TEXT PRIMARY KEY, n INTEGER NOT NULL, reset_at INTEGER NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS queue (
        user_id TEXT PRIMARY KEY, username TEXT NOT NULL, rating INTEGER NOT NULL, enqueued_at INTEGER NOT NULL
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS notices (
        user_id TEXT PRIMARY KEY, match_id TEXT NOT NULL, seat TEXT NOT NULL, opponent TEXT NOT NULL, created_at INTEGER NOT NULL
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY, host_id TEXT NOT NULL, host_name TEXT NOT NULL, host_rating INTEGER NOT NULL,
        match_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL,
        south_id TEXT NOT NULL, south_name TEXT NOT NULL, south_rating INTEGER NOT NULL,
        north_id TEXT NOT NULL, north_name TEXT NOT NULL, north_rating INTEGER NOT NULL,
        status TEXT NOT NULL, created_at INTEGER NOT NULL
      )`);
      const resultCols = sql.exec("PRAGMA table_info(results)").toArray();
      if (resultCols.length && !resultCols.some(c => c.name === "south_name")) sql.exec("DROP TABLE results");
      sql.exec(`CREATE TABLE IF NOT EXISTS results (
        match_id TEXT NOT NULL, game_no INTEGER NOT NULL,
        south_id TEXT NOT NULL, south_name TEXT NOT NULL, south_score INTEGER NOT NULL,
        north_id TEXT NOT NULL, north_name TEXT NOT NULL, north_score INTEGER NOT NULL,
        winner_id TEXT, tie INTEGER NOT NULL, ot INTEGER NOT NULL, forfeit INTEGER NOT NULL,
        duration_sec INTEGER NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (match_id, game_no)
      )`);
    });
  }

  now() { return Date.now(); }

  sql(query, ...args) {
    return this.ctx.storage.sql.exec(query, ...args);
  }
  one(query, ...args) {
    const rows = this.sql(query, ...args).toArray();
    return rows[0] || null;
  }

  rateOk(key, limit, windowMs) {
    const now = Date.now();
    const row = this.one("SELECT n, reset_at FROM rates WHERE k = ?", key);
    if (!row || row.reset_at <= now) {
      this.sql("INSERT OR REPLACE INTO rates (k, n, reset_at) VALUES (?, 1, ?)", key, now + windowMs);
      return true;
    }
    if (row.n >= limit) return false;
    this.sql("UPDATE rates SET n = n + 1 WHERE k = ?", key);
    return true;
  }

  async userFromToken(token) {
    if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
    const hash = await sha256("token:" + token);
    return this.one("SELECT * FROM users WHERE token_hash = ?", hash);
  }

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === "/signup" && req.method === "POST") return await this.signup(await req.json());
      if (path === "/login" && req.method === "POST") return await this.login(await req.json());
      if (path === "/me" && req.method === "GET") return await this.me(url);
      if (path === "/leaderboard" && req.method === "GET") return await this.leaderboard(url);
      if (path === "/quick" && req.method === "POST") return await this.quick(await req.json());
      if (path === "/quick" && req.method === "GET") return await this.quickPoll(url);
      if (path === "/quick" && req.method === "DELETE") return await this.quickLeave(url);
      if (path === "/room" && req.method === "POST") return await this.createRoom(await req.json());
      if (path === "/room" && req.method === "GET") return await this.roomPoll(url);
      if (path === "/room" && req.method === "DELETE") return await this.roomCancel(url);
      if (path === "/join" && req.method === "POST") return await this.joinRoom(await req.json());
      if (path === "/auth-ws" && req.method === "POST") return await this.authWs(await req.json());
      if (path === "/result" && req.method === "POST") return await this.result(await req.json());
      return fail(404, "not found");
    } catch (e) {
      console.log("airhockey lobby", e && e.stack || String(e));
      return fail(500, "server error");
    }
  }

  async signup(body) {
    const ip = await sha256("ip:" + String(body.ip || "0"));
    if (!this.rateOk("su:" + ip.slice(0, 24), SIGNUP_LIMIT, SIGNUP_WINDOW * 1000)) return fail(429, "Too many sign-ups from this network. Try again in a bit.");
    const parsed = validateUsername(body.username);
    if (parsed.error) return fail(400, parsed.error);
    if (this.one("SELECT id FROM users WHERE username_key = ?", parsed.key)) return fail(409, "That username is taken.");
    const token = randomToken(), recovery = recoveryCode();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    try {
      this.sql(`INSERT INTO users (id, username, username_key, token_hash, recovery_hash, email, email_verified_at, wins, losses, rating, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, 0, ?, ?, ?)`,
        id, parsed.username, parsed.key, await sha256("token:" + token), await sha256("recovery:" + normalizeRecovery(recovery)), START_RATING, now, now);
    } catch (e) {
      if (String(e).includes("UNIQUE")) return fail(409, "That username is taken.");
      throw e;
    }
    const row = this.one("SELECT * FROM users WHERE id = ?", id);
    return json({ok: true, user: career(row), token, recoveryCode: recovery});
  }

  async login(body) {
    const ip = await sha256("ip:" + String(body.ip || "0"));
    if (!this.rateOk("li:" + ip.slice(0, 24), LOGIN_LIMIT, LOGIN_WINDOW * 1000)) return fail(429, "Too many sign-in attempts. Try again in a bit.");
    const parsed = validateUsername(body.username || "");
    if (parsed.error) return fail(401, "That username and secret don't match.");
    const row = this.one("SELECT * FROM users WHERE username_key = ?", parsed.key);
    if (!row) return fail(401, "That username and secret don't match.");
    if (typeof body.token === "string" && body.token) {
      const hash = await sha256("token:" + body.token);
      if (hash !== row.token_hash) return fail(401, "That username and secret don't match.");
      return json({ok: true, user: career(row), token: body.token});
    }
    const recovery = normalizeRecovery(body.recoveryCode);
    if (recovery.length < 8) return fail(401, "That username and secret don't match.");
    const hash = await sha256("recovery:" + recovery);
    if (hash !== row.recovery_hash) return fail(401, "That username and secret don't match.");
    const token = randomToken();
    const now = new Date().toISOString();
    this.sql("UPDATE users SET token_hash = ?, updated_at = ? WHERE id = ?", await sha256("token:" + token), now, row.id);
    const next = this.one("SELECT * FROM users WHERE id = ?", row.id);
    return json({ok: true, user: career(next), token, replaced: true});
  }

  async me(url) {
    const row = await this.userFromToken(url.searchParams.get("token") || "");
    if (!row) return fail(401, "Sign in again.");
    return json({ok: true, user: career(row)});
  }

  async leaderboard(url) {
    const sort = ["rating", "wins", "gf", "diff"].includes(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "rating";
    const limit = Math.min(25, Math.max(1, +url.searchParams.get("limit") || 25));
    const order = {
      rating: "rating DESC, wins DESC, gf DESC, username COLLATE NOCASE ASC",
      wins: "wins DESC, rating DESC, gf DESC, username COLLATE NOCASE ASC",
      gf: "gf DESC, rating DESC, wins DESC, username COLLATE NOCASE ASC",
      diff: "(gf - ga) DESC, rating DESC, gf DESC, username COLLATE NOCASE ASC",
    }[sort];
    const top = this.sql(`SELECT * FROM users ORDER BY ${order} LIMIT ?`, limit).toArray().map((row, i) => {
      const stats = career(row);
      delete stats.email;
      delete stats.id;
      return {rank: i + 1, ...stats};
    });
    let you = null;
    const row = await this.userFromToken(url.searchParams.get("token") || "");
    if (row) {
      const gf = row.gf || 0, diff = gf - (row.ga || 0), u = row.username;
      const rankSql = {
        wins: ["wins > ? OR (wins = ? AND rating > ?) OR (wins = ? AND rating = ? AND gf > ?) OR (wins = ? AND rating = ? AND gf = ? AND username COLLATE NOCASE < ?)",
          [row.wins, row.wins, row.rating, row.wins, row.rating, gf, row.wins, row.rating, gf, u]],
        gf: ["gf > ? OR (gf = ? AND rating > ?) OR (gf = ? AND rating = ? AND wins > ?) OR (gf = ? AND rating = ? AND wins = ? AND username COLLATE NOCASE < ?)",
          [gf, gf, row.rating, gf, row.rating, row.wins, gf, row.rating, row.wins, u]],
        diff: ["(gf - ga) > ? OR ((gf - ga) = ? AND rating > ?) OR ((gf - ga) = ? AND rating = ? AND gf > ?) OR ((gf - ga) = ? AND rating = ? AND gf = ? AND username COLLATE NOCASE < ?)",
          [diff, diff, row.rating, diff, row.rating, gf, diff, row.rating, gf, u]],
        rating: ["rating > ? OR (rating = ? AND wins > ?) OR (rating = ? AND wins = ? AND gf > ?) OR (rating = ? AND wins = ? AND gf = ? AND username COLLATE NOCASE < ?)",
          [row.rating, row.rating, row.wins, row.rating, row.wins, gf, row.rating, row.wins, gf, u]],
      }[sort];
      const ahead = this.one(`SELECT COUNT(*) AS n FROM users WHERE ${rankSql[0]}`, ...rankSql[1]);
      const mine = career(row);
      delete mine.email;
      you = {rank: (ahead ? ahead.n : 0) + 1, ...mine};
    }
    return json({ok: true, sort, top, you});
  }

  dropExpired(exceptId, now) {
    const cutoff = now - QUICK_WAIT_MS;
    if (exceptId) this.sql("DELETE FROM queue WHERE enqueued_at <= ? AND user_id != ?", cutoff, exceptId);
    else this.sql("DELETE FROM queue WHERE enqueued_at <= ?", cutoff);
  }

  queuedReply(row, now) {
    const age = now - row.enqueued_at;
    if (age >= QUICK_WAIT_MS) {
      this.sql("DELETE FROM queue WHERE user_id = ?", row.user_id);
      return {ok: true, status: "copper", opponent: "Copper", computer: true};
    }
    return {ok: true, status: "queued", waitMs: QUICK_WAIT_MS - age};
  }

  async quick(body) {
    const row = await this.userFromToken(body.token || "");
    if (!row) return fail(401, "Sign in again.");
    const ip = await sha256("ip:" + String(body.ip || "0"));
    if (!this.rateOk("mk:" + ip.slice(0, 24), MATCH_LIMIT, MATCH_WINDOW * 1000)) return fail(429, "Too many matches from this network. Try again in a bit.");
    const now = this.now();
    const notice = this.freshNotice(row.id);
    if (notice) return json(notice);
    // Drop searches whose owners never claimed Copper, so a later player cannot join a ghost.
    this.dropExpired(row.id, now);
    const waiting = this.one("SELECT * FROM queue WHERE user_id != ? ORDER BY enqueued_at ASC LIMIT 1", row.id);
    if (waiting) {
      this.sql("DELETE FROM queue WHERE user_id IN (?, ?)", waiting.user_id, row.id);
      const match = await this.openMatch("quick",
        {id: waiting.user_id, name: waiting.username, rating: waiting.rating},
        {id: row.id, name: row.username, rating: row.rating});
      if (match.error) return fail(match.status || 503, match.error);
      this.sql("INSERT OR REPLACE INTO notices (user_id, match_id, seat, opponent, created_at) VALUES (?, ?, 'south', ?, ?)",
        waiting.user_id, match.id, row.username, now);
      return json({ok: true, status: "matched", matchId: match.id, seat: "north", you: row.username, opponent: waiting.username});
    }
    const mine = this.one("SELECT * FROM queue WHERE user_id = ?", row.id);
    if (mine) return json(this.queuedReply(mine, now));
    this.sql("INSERT INTO queue (user_id, username, rating, enqueued_at) VALUES (?, ?, ?, ?)", row.id, row.username, row.rating, now);
    this.sql("DELETE FROM notices WHERE user_id = ?", row.id);
    return json({ok: true, status: "queued", waitMs: QUICK_WAIT_MS});
  }

  freshNotice(userId) {
    const notice = this.one("SELECT * FROM notices WHERE user_id = ?", userId);
    if (!notice || this.now() - notice.created_at > 3 * 60 * 1000) {
      if (notice) this.sql("DELETE FROM notices WHERE user_id = ?", userId);
      return null;
    }
    const match = this.one("SELECT * FROM matches WHERE id = ?", notice.match_id);
    if (!match || match.status !== "live") {
      this.sql("DELETE FROM notices WHERE user_id = ?", userId);
      return null;
    }
    return {ok: true, status: "matched", matchId: notice.match_id, seat: notice.seat, you: notice.seat === "south" ? match.south_name : match.north_name, opponent: notice.opponent};
  }

  async quickPoll(url) {
    const row = await this.userFromToken(url.searchParams.get("token") || "");
    if (!row) return fail(401, "Sign in again.");
    const now = this.now();
    const notice = this.freshNotice(row.id);
    if (notice) return json(notice);
    const mine = this.one("SELECT * FROM queue WHERE user_id = ?", row.id);
    if (mine) return json(this.queuedReply(mine, now));
    this.dropExpired(null, now);
    return json({ok: true, status: "idle"});
  }

  async quickLeave(url) {
    const row = await this.userFromToken(url.searchParams.get("token") || "");
    if (!row) return fail(401, "Sign in again.");
    this.sql("DELETE FROM queue WHERE user_id = ?", row.id);
    return json({ok: true});
  }

  async createRoom(body) {
    const row = await this.userFromToken(body.token || "");
    if (!row) return fail(401, "Sign in again.");
    const ip = await sha256("ip:" + String(body.ip || "0"));
    if (!this.rateOk("mk:" + ip.slice(0, 24), MATCH_LIMIT, MATCH_WINDOW * 1000)) return fail(429, "Too many matches from this network. Try again in a bit.");
    const now = Date.now();
    this.sql("DELETE FROM rooms WHERE host_id = ? AND match_id IS NULL", row.id);
    let code = "";
    for (let i = 0; i < 6; i++) {
      code = roomCode();
      if (!this.one("SELECT code FROM rooms WHERE code = ?", code)) break;
      code = "";
    }
    if (!code) return fail(503, "Couldn't open a room. Try again.");
    this.sql("INSERT INTO rooms (code, host_id, host_name, host_rating, match_id, created_at, expires_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
      code, row.id, row.username, row.rating, now, now + ROOM_TTL);
    return json({ok: true, code, path: "play.html?room=" + code});
  }

  liveRoom(code) {
    const room = this.one("SELECT * FROM rooms WHERE code = ?", code);
    if (!room) return null;
    if (room.expires_at <= Date.now() && !room.match_id) {
      this.sql("DELETE FROM rooms WHERE code = ?", code);
      return null;
    }
    return room;
  }

  async roomPoll(url) {
    const row = await this.userFromToken(url.searchParams.get("token") || "");
    if (!row) return fail(401, "Sign in again.");
    const code = String(url.searchParams.get("code") || "").toUpperCase();
    const room = this.liveRoom(code);
    if (!room || room.host_id !== row.id) return fail(404, "That room has expired.");
    if (!room.match_id) return json({ok: true, status: "waiting", code});
    const match = this.one("SELECT * FROM matches WHERE id = ?", room.match_id);
    if (!match) return json({ok: true, status: "waiting", code});
    return json({ok: true, status: "matched", code, matchId: match.id, seat: "south", you: match.south_name, opponent: match.north_name});
  }

  async roomCancel(url) {
    const row = await this.userFromToken(url.searchParams.get("token") || "");
    if (!row) return fail(401, "Sign in again.");
    const code = String(url.searchParams.get("code") || "").toUpperCase();
    this.sql("DELETE FROM rooms WHERE code = ? AND host_id = ? AND match_id IS NULL", code, row.id);
    return json({ok: true});
  }

  async joinRoom(body) {
    const row = await this.userFromToken(body.token || "");
    if (!row) return fail(401, "Sign in again.");
    const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)) return fail(400, "That room code doesn't look right.");
    const ip = await sha256("ip:" + String(body.ip || "0"));
    const room = this.liveRoom(code);
    if (!room) return fail(404, "That room has expired.");
    if (room.host_id === row.id) {
      if (!room.match_id) return json({ok: true, status: "waiting", code, seat: "south", you: row.username});
      const match = this.one("SELECT * FROM matches WHERE id = ?", room.match_id);
      return json({ok: true, status: "matched", code, matchId: room.match_id, seat: "south", you: row.username, opponent: match ? match.north_name : ""});
    }
    if (room.match_id) {
      const match = this.one("SELECT * FROM matches WHERE id = ?", room.match_id);
      if (match && match.north_id === row.id) return json({ok: true, status: "matched", code, matchId: match.id, seat: "north", you: row.username, opponent: match.south_name});
      return fail(409, "That room is already full.");
    }
    if (!this.rateOk("mk:" + ip.slice(0, 24), MATCH_LIMIT, MATCH_WINDOW * 1000)) return fail(429, "Too many matches from this network. Try again in a bit.");
    const match = await this.openMatch("room",
      {id: room.host_id, name: room.host_name, rating: room.host_rating},
      {id: row.id, name: row.username, rating: row.rating});
    if (match.error) return fail(match.status || 503, match.error);
    this.sql("UPDATE rooms SET match_id = ? WHERE code = ?", match.id, code);
    return json({ok: true, status: "matched", code, matchId: match.id, seat: "north", you: row.username, opponent: room.host_name});
  }

  async openMatch(kind, south, north) {
    const id = matchId();
    const now = Date.now();
    this.sql(`INSERT INTO matches (id, kind, south_id, south_name, south_rating, north_id, north_name, north_rating, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'live', ?)`,
      id, kind, south.id, south.name, south.rating, north.id, north.name, north.rating, now);
    try {
      const stub = this.env.AIRHOCKEY_MATCH.get(this.env.AIRHOCKEY_MATCH.idFromName(id));
      const res = await stub.fetch("https://match.internal/init", {method: "POST", headers: {"Content-Type": "application/json", "X-Cbn-Internal": "1"},
        body: JSON.stringify({matchId: id, south, north})});
      if (!res.ok) throw new Error("init " + res.status);
    } catch (e) {
      this.sql("DELETE FROM matches WHERE id = ?", id);
      console.log("airhockey match init", String(e));
      return {error: "Couldn't start the match. Try again.", status: 503};
    }
    return {id};
  }

  async authWs(body) {
    const row = await this.userFromToken(body.token || "");
    if (!row) return fail(401, "Sign in again.");
    const match = this.one("SELECT * FROM matches WHERE id = ?", String(body.matchId || ""));
    if (!match) return fail(404, "Match not found.");
    let seat = null;
    if (match.south_id === row.id) seat = "south";
    else if (match.north_id === row.id) seat = "north";
    else return fail(403, "You're not in this match.");
    const opp = seat === "south" ? match.north_name : match.south_name;
    const oppId = seat === "south" ? match.north_id : match.south_id;
    const oppRow = oppId ? this.one("SELECT * FROM users WHERE id = ?", oppId) : null;
    const stats = career(row);
    const oppStats = oppRow ? career(oppRow) : {id: oppId, username: opp, wins: 0, losses: 0, ties: 0, otl: 0, gp: 0, rating: 1000};
    return json({ok: true, userId: row.id, username: row.username, seat, opponent: opp, ...stats, oppStats});
  }

  recompute(id) {
    const rows = this.sql("SELECT * FROM results WHERE south_id = ? OR north_id = ?", id, id).toArray();
    let gp = 0, wins = 0, losses = 0, ties = 0, otl = 0, gf = 0, ga = 0;
    for (const r of rows) {
      gp++;
      const mine = r.south_id === id ? r.south_score : r.north_score;
      const opp = r.south_id === id ? r.north_score : r.south_score;
      gf += mine; ga += opp;
      if (r.tie) ties++;
      else if (r.winner_id === id) wins++;
      else if (r.ot) otl++;
      else losses++;
    }
    this.sql("UPDATE users SET gp = ?, wins = ?, losses = ?, ties = ?, otl = ?, gf = ?, ga = ?, updated_at = ? WHERE id = ?",
      gp, wins, losses, ties, otl, gf, ga, new Date().toISOString(), id);
  }

  async result(body) {
    const match = this.one("SELECT * FROM matches WHERE id = ?", String(body.matchId || ""));
    if (!match) return fail(404, "Match not found.");
    const gameNo = body.gameNo | 0;
    if (gameNo < 1 || gameNo > 50) return fail(400, "bad game");
    if (body.southId !== match.south_id || body.northId !== match.north_id) return fail(400, "bad players");
    const tie = !!body.tie;
    if (!tie && body.winnerId !== match.south_id && body.winnerId !== match.north_id) return fail(400, "bad result");
    const southScore = body.southScore | 0, northScore = body.northScore | 0;
    if (southScore < 0 || northScore < 0 || southScore > 99 || northScore > 99) return fail(400, "bad score");
    const existing = this.one("SELECT match_id FROM results WHERE match_id = ? AND game_no = ?", match.id, gameNo);
    if (!existing) {
      const south = this.one("SELECT * FROM users WHERE id = ?", match.south_id);
      const north = this.one("SELECT * FROM users WHERE id = ?", match.north_id);
      if (!south || !north) return fail(404, "player missing");
      const scoreA = tie ? 0.5 : body.winnerId === south.id ? 1 : 0;
      const next = eloPoints(south.rating, north.rating, scoreA);
      const now = new Date().toISOString();
      const duration = Math.max(0, Math.min(3600, body.durationSec | 0));
      this.ctx.storage.transactionSync(() => {
        this.sql(`INSERT INTO results (match_id, game_no, south_id, south_name, south_score, north_id, north_name, north_score, winner_id, tie, ot, forfeit, duration_sec, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          match.id, gameNo, south.id, String(body.southName || south.username).slice(0, 16), southScore,
          north.id, String(body.northName || north.username).slice(0, 16), northScore,
          tie ? null : body.winnerId, tie ? 1 : 0, body.ot ? 1 : 0, body.forfeit ? 1 : 0, duration, now);
        this.sql("UPDATE users SET rating = ? WHERE id = ?", next.a, south.id);
        this.sql("UPDATE users SET rating = ? WHERE id = ?", next.b, north.id);
        this.recompute(south.id);
        this.recompute(north.id);
      });
    }
    const records = {};
    for (const id of [match.south_id, match.north_id]) {
      const row = this.one("SELECT * FROM users WHERE id = ?", id);
      records[id] = career(row);
    }
    return json({ok: true, records});
  }
}
