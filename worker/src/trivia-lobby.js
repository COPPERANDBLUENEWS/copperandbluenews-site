// One SQLite Durable Object for Oilers Trivia accounts, the duel queue, friend rooms,
// solo runs, and the leaderboard. AirHockeyLobby is a different class and is not used here.
// Accounts follow the same pattern: a username, a hashed device token, and a hashed recovery code.
import {validateUsername} from "./airhockey-names.js";
import {pickQuestionIds, publicQuestion, questionById} from "./trivia-bank.js";
import {GRACE_MS, QUESTION_MS, scoreAnswer} from "./trivia-score.js";

const LOBBY_NAME = "trivia-lobby";
const SIGNUP_LIMIT = 6, SIGNUP_WINDOW = 3600;
const MATCH_LIMIT = 20, MATCH_WINDOW = 600;
const LOGIN_LIMIT = 20, LOGIN_WINDOW = 600;
const SOLO_LIMIT = 30, SOLO_WINDOW = 3600;
const ROOM_TTL = 30 * 60 * 1000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const QUICK_WAIT_MS = 8000;
export const ROUNDS = 10;

export function lobbyStub(env) {
  if (!env.TRIVIA_LOBBY) return null;
  return env.TRIVIA_LOBBY.get(env.TRIVIA_LOBBY.idFromName(LOBBY_NAME));
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
function hexId(prefix) {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return prefix + [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
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
function cryptoRandom() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {status, headers: {"Content-Type": "application/json"}});
}
const fail = (status, error) => json({error}, status);

function career(row) {
  const answered = row.answered || 0, correct = row.correct || 0;
  return {
    id: row.id, username: row.username, email: row.email || null,
    points: row.points || 0,
    wins: row.duel_wins || 0, losses: row.duel_losses || 0, ties: row.duel_ties || 0,
    correct, answered,
    accuracy: answered ? Math.round((correct / answered) * 1000) / 10 : 0,
    bestStreak: row.best_streak || 0,
    bestSolo: row.best_solo || 0,
    soloRuns: row.solo_runs || 0,
  };
}
function publicCareer(row) {
  const stats = career(row);
  delete stats.email;
  delete stats.id;
  return stats;
}

export class TriviaLobby {
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
        points INTEGER NOT NULL DEFAULT 0,
        duel_wins INTEGER NOT NULL DEFAULT 0,
        duel_losses INTEGER NOT NULL DEFAULT 0,
        duel_ties INTEGER NOT NULL DEFAULT 0,
        correct INTEGER NOT NULL DEFAULT 0,
        answered INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        best_solo INTEGER NOT NULL DEFAULT 0,
        solo_runs INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS rates (k TEXT PRIMARY KEY, n INTEGER NOT NULL, reset_at INTEGER NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS queue (
        user_id TEXT PRIMARY KEY, username TEXT NOT NULL, enqueued_at INTEGER NOT NULL
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS notices (
        user_id TEXT PRIMARY KEY, match_id TEXT NOT NULL, seat TEXT NOT NULL, opponent TEXT NOT NULL, created_at INTEGER NOT NULL
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY, host_id TEXT NOT NULL, host_name TEXT NOT NULL,
        match_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL,
        south_id TEXT NOT NULL, south_name TEXT NOT NULL,
        north_id TEXT NOT NULL, north_name TEXT NOT NULL,
        question_ids TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS duel_results (
        match_id TEXT PRIMARY KEY,
        south_id TEXT NOT NULL, north_id TEXT NOT NULL,
        south_score INTEGER NOT NULL, north_score INTEGER NOT NULL,
        winner_id TEXT, tie INTEGER NOT NULL, forfeit INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL,
        state TEXT NOT NULL, updated_at INTEGER NOT NULL
      )`);
    });
  }

  now() { return Date.now(); }
  sql(query, ...args) { return this.ctx.storage.sql.exec(query, ...args); }
  one(query, ...args) { return this.sql(query, ...args).toArray()[0] || null; }

  rateOk(key, limit, windowMs) {
    const now = this.now();
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
    return this.one("SELECT * FROM users WHERE token_hash = ?", await sha256("token:" + token));
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
      if (path === "/solo" && req.method === "POST") return await this.soloStart(await req.json());
      if (path === "/solo" && req.method === "GET") return await this.soloGet(url);
      if (path === "/solo/answer" && req.method === "POST") return await this.soloAnswer(await req.json());
      if (path === "/solo/next" && req.method === "POST") return await this.soloNext(await req.json());
      if (path === "/auth-match" && req.method === "POST") return await this.authMatch(await req.json());
      if (path === "/duel-result" && req.method === "POST") return await this.duelResult(await req.json());
      return fail(404, "not found");
    } catch (e) {
      console.log("trivia lobby", e && e.stack || String(e));
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
      this.sql(`INSERT INTO users (
        id, username, username_key, token_hash, recovery_hash, email, email_verified_at,
        points, duel_wins, duel_losses, duel_ties, correct, answered, best_streak, best_solo, solo_runs, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
        id, parsed.username, parsed.key, await sha256("token:" + token), await sha256("recovery:" + normalizeRecovery(recovery)), now, now);
    } catch (e) {
      if (String(e).includes("UNIQUE")) return fail(409, "That username is taken.");
      throw e;
    }
    return json({ok: true, user: career(this.one("SELECT * FROM users WHERE id = ?", id)), token, recoveryCode: recovery});
  }

  async login(body) {
    const ip = await sha256("ip:" + String(body.ip || "0"));
    if (!this.rateOk("li:" + ip.slice(0, 24), LOGIN_LIMIT, LOGIN_WINDOW * 1000)) return fail(429, "Too many sign-in attempts. Try again in a bit.");
    const parsed = validateUsername(body.username || "");
    if (parsed.error) return fail(401, "That username and secret don't match.");
    const row = this.one("SELECT * FROM users WHERE username_key = ?", parsed.key);
    if (!row) return fail(401, "That username and secret don't match.");
    if (typeof body.token === "string" && body.token) {
      if (await sha256("token:" + body.token) !== row.token_hash) return fail(401, "That username and secret don't match.");
      return json({ok: true, user: career(row), token: body.token});
    }
    const recovery = normalizeRecovery(body.recoveryCode);
    if (recovery.length < 8) return fail(401, "That username and secret don't match.");
    if (await sha256("recovery:" + recovery) !== row.recovery_hash) return fail(401, "That username and secret don't match.");
    const token = randomToken();
    const now = new Date().toISOString();
    this.sql("UPDATE users SET token_hash = ?, updated_at = ? WHERE id = ?", await sha256("token:" + token), now, row.id);
    return json({ok: true, user: career(this.one("SELECT * FROM users WHERE id = ?", row.id)), token, replaced: true});
  }

  async me(url) {
    const row = await this.userFromToken(url.searchParams.get("token") || "");
    if (!row) return fail(401, "Sign in again.");
    return json({ok: true, user: career(row)});
  }

  async leaderboard(url) {
    const sort = ["points", "wins", "accuracy", "streak"].includes(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "points";
    const limit = Math.min(25, Math.max(1, +url.searchParams.get("limit") || 25));
    const acc = "CASE WHEN answered = 0 THEN -1 ELSE (correct * 10000 / answered) END";
    const order = {
      points: "points DESC, duel_wins DESC, best_streak DESC, username COLLATE NOCASE ASC",
      wins: "duel_wins DESC, points DESC, best_streak DESC, username COLLATE NOCASE ASC",
      accuracy: acc + " DESC, points DESC, username COLLATE NOCASE ASC",
      streak: "best_streak DESC, points DESC, username COLLATE NOCASE ASC",
    }[sort];
    const top = this.sql(`SELECT * FROM users ORDER BY ${order} LIMIT ?`, limit).toArray().map((row, i) => ({rank: i + 1, ...publicCareer(row)}));
    let you = null;
    const row = await this.userFromToken(url.searchParams.get("token") || "");
    if (row) {
      const mineAcc = row.answered ? Math.floor(row.correct * 10000 / row.answered) : -1;
      const rankSql = {
        points: ["points > ? OR (points = ? AND duel_wins > ?) OR (points = ? AND duel_wins = ? AND best_streak > ?) OR (points = ? AND duel_wins = ? AND best_streak = ? AND username COLLATE NOCASE < ?)",
          [row.points, row.points, row.duel_wins, row.points, row.duel_wins, row.best_streak, row.points, row.duel_wins, row.best_streak, row.username]],
        wins: ["duel_wins > ? OR (duel_wins = ? AND points > ?) OR (duel_wins = ? AND points = ? AND best_streak > ?) OR (duel_wins = ? AND points = ? AND best_streak = ? AND username COLLATE NOCASE < ?)",
          [row.duel_wins, row.duel_wins, row.points, row.duel_wins, row.points, row.best_streak, row.duel_wins, row.points, row.best_streak, row.username]],
        streak: ["best_streak > ? OR (best_streak = ? AND points > ?) OR (best_streak = ? AND points = ? AND username COLLATE NOCASE < ?)",
          [row.best_streak, row.best_streak, row.points, row.best_streak, row.points, row.username]],
        accuracy: [acc + " > ? OR (" + acc + " = ? AND points > ?) OR (" + acc + " = ? AND points = ? AND username COLLATE NOCASE < ?)",
          [mineAcc, mineAcc, row.points, mineAcc, row.points, row.username]],
      }[sort];
      const ahead = this.one(`SELECT COUNT(*) AS n FROM users WHERE ${rankSql[0]}`, ...rankSql[1]);
      you = {rank: (ahead ? ahead.n : 0) + 1, ...publicCareer(row)};
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
      return {ok: true, status: "solo"};
    }
    return {ok: true, status: "queued", waitMs: QUICK_WAIT_MS - age};
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

  async quick(body) {
    const row = await this.userFromToken(body.token || "");
    if (!row) return fail(401, "Sign in again.");
    const ip = await sha256("ip:" + String(body.ip || "0"));
    if (!this.rateOk("mk:" + ip.slice(0, 24), MATCH_LIMIT, MATCH_WINDOW * 1000)) return fail(429, "Too many matches from this network. Try again in a bit.");
    const now = this.now();
    const notice = this.freshNotice(row.id);
    if (notice) return json(notice);
    this.dropExpired(row.id, now);
    const waiting = this.one("SELECT * FROM queue WHERE user_id != ? ORDER BY enqueued_at ASC LIMIT 1", row.id);
    if (waiting) {
      this.sql("DELETE FROM queue WHERE user_id IN (?, ?)", waiting.user_id, row.id);
      const match = await this.openMatch("quick", {id: waiting.user_id, name: waiting.username}, {id: row.id, name: row.username});
      if (match.error) return fail(match.status || 503, match.error);
      this.sql("INSERT OR REPLACE INTO notices (user_id, match_id, seat, opponent, created_at) VALUES (?, ?, 'south', ?, ?)",
        waiting.user_id, match.id, row.username, now);
      return json({ok: true, status: "matched", matchId: match.id, seat: "north", you: row.username, opponent: waiting.username});
    }
    const mine = this.one("SELECT * FROM queue WHERE user_id = ?", row.id);
    if (mine) return json(this.queuedReply(mine, now));
    this.sql("INSERT INTO queue (user_id, username, enqueued_at) VALUES (?, ?, ?)", row.id, row.username, now);
    this.sql("DELETE FROM notices WHERE user_id = ?", row.id);
    return json({ok: true, status: "queued", waitMs: QUICK_WAIT_MS});
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
    const now = this.now();
    this.sql("DELETE FROM queue WHERE user_id = ?", row.id);
    this.sql("DELETE FROM rooms WHERE host_id = ? AND match_id IS NULL", row.id);
    let code = "";
    for (let i = 0; i < 6; i++) {
      code = roomCode();
      if (!this.one("SELECT code FROM rooms WHERE code = ?", code)) break;
      code = "";
    }
    if (!code) return fail(503, "Couldn't open a room. Try again.");
    this.sql("INSERT INTO rooms (code, host_id, host_name, match_id, created_at, expires_at) VALUES (?, ?, ?, NULL, ?, ?)",
      code, row.id, row.username, now, now + ROOM_TTL);
    return json({ok: true, code, path: "trivia.html?room=" + code});
  }
  liveRoom(code) {
    const room = this.one("SELECT * FROM rooms WHERE code = ?", code);
    if (!room) return null;
    if (room.expires_at <= this.now() && !room.match_id) {
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
    const ip = await sha256("ip:" + String(body.ip || "0"));
    if (!this.rateOk("mk:" + ip.slice(0, 24), MATCH_LIMIT, MATCH_WINDOW * 1000)) return fail(429, "Too many matches from this network. Try again in a bit.");
    const match = await this.openMatch("room", {id: room.host_id, name: room.host_name}, {id: row.id, name: row.username});
    if (match.error) return fail(match.status || 503, match.error);
    this.sql("UPDATE rooms SET match_id = ? WHERE code = ?", match.id, code);
    this.sql("DELETE FROM queue WHERE user_id IN (?, ?)", room.host_id, row.id);
    return json({ok: true, status: "matched", code, matchId: match.id, seat: "north", you: row.username, opponent: room.host_name});
  }

  async openMatch(kind, south, north) {
    if (!this.env.TRIVIA_MATCH) return {error: "Online play is not set up on this server yet.", status: 503};
    const ids = pickQuestionIds(ROUNDS, cryptoRandom);
    const id = hexId("t_");
    const now = this.now();
    this.sql(`INSERT INTO matches (id, kind, south_id, south_name, north_id, north_name, question_ids, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'live', ?)`,
      id, kind, south.id, south.name, north.id, north.name, JSON.stringify(ids), now);
    try {
      const stub = this.env.TRIVIA_MATCH.get(this.env.TRIVIA_MATCH.idFromName(id));
      const res = await stub.fetch("https://match.internal/init", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({matchId: id, south, north, questionIds: ids})});
      if (!res.ok) throw new Error("init " + res.status);
    } catch (e) {
      this.sql("DELETE FROM matches WHERE id = ?", id);
      console.log("trivia match init", String(e));
      return {error: "Couldn't start the duel. Try again.", status: 503};
    }
    return {id};
  }

  async authMatch(body) {
    const row = await this.userFromToken(body.token || "");
    if (!row) return fail(401, "Sign in again.");
    const match = this.one("SELECT * FROM matches WHERE id = ?", String(body.matchId || ""));
    if (!match || !/^t_[a-f0-9]{16}$/.test(match.id)) return fail(404, "Duel not found.");
    let seat = null;
    if (match.south_id === row.id) seat = "south";
    else if (match.north_id === row.id) seat = "north";
    else return fail(403, "You're not in this duel.");
    return json({ok: true, userId: row.id, username: row.username, seat, matchId: match.id});
  }

  bump(id, delta) {
    const row = this.one("SELECT * FROM users WHERE id = ?", id);
    if (!row) return;
    const best = Math.max(row.best_streak || 0, delta.best | 0);
    this.sql(`UPDATE users SET points = points + ?, correct = correct + ?, answered = answered + ?,
      best_streak = ?, duel_wins = duel_wins + ?, duel_losses = duel_losses + ?, duel_ties = duel_ties + ?, updated_at = ?
      WHERE id = ?`,
      delta.points | 0, delta.correct | 0, delta.answered | 0, best,
      delta.win ? 1 : 0, delta.loss ? 1 : 0, delta.tie ? 1 : 0, new Date().toISOString(), id);
  }

  async duelResult(body) {
    const match = this.one("SELECT * FROM matches WHERE id = ?", String(body.matchId || ""));
    if (!match) return fail(404, "Duel not found.");
    if (body.southId !== match.south_id || body.northId !== match.north_id) return fail(400, "bad players");
    const southScore = body.southScore | 0, northScore = body.northScore | 0;
    if (southScore < 0 || northScore < 0 || southScore > 5000 || northScore > 5000) return fail(400, "bad score");
    const tie = !!body.tie && !body.forfeit;
    if (!tie && body.winnerId !== match.south_id && body.winnerId !== match.north_id) return fail(400, "bad result");
    if (!this.one("SELECT match_id FROM duel_results WHERE match_id = ?", match.id)) {
      const now = new Date().toISOString();
      const southWin = !tie && body.winnerId === match.south_id;
      const northWin = !tie && body.winnerId === match.north_id;
      this.ctx.storage.transactionSync(() => {
        this.sql(`INSERT INTO duel_results (match_id, south_id, north_id, south_score, north_score, winner_id, tie, forfeit, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          match.id, match.south_id, match.north_id, southScore, northScore, tie ? null : body.winnerId, tie ? 1 : 0, body.forfeit ? 1 : 0, now);
        this.sql("UPDATE matches SET status = 'done' WHERE id = ?", match.id);
        this.bump(match.south_id, {
          points: southScore, correct: body.southCorrect | 0, answered: body.southAnswered | 0, best: body.southBest | 0,
          win: southWin, loss: !tie && !southWin, tie,
        });
        this.bump(match.north_id, {
          points: northScore, correct: body.northCorrect | 0, answered: body.northAnswered | 0, best: body.northBest | 0,
          win: northWin, loss: !tie && !northWin, tie,
        });
      });
    }
    const south = this.one("SELECT * FROM users WHERE id = ?", match.south_id);
    const north = this.one("SELECT * FROM users WHERE id = ?", match.north_id);
    return json({ok: true, south: south ? publicCareer(south) : null, north: north ? publicCareer(north) : null});
  }

  liveRun(row) {
    const run = this.one("SELECT * FROM runs WHERE user_id = ? AND status = 'live' ORDER BY updated_at DESC LIMIT 1", row.id);
    if (!run) return null;
    return {run, state: JSON.parse(run.state)};
  }
  saveRun(run, state, status) {
    this.sql("UPDATE runs SET state = ?, status = ?, updated_at = ? WHERE id = ?", JSON.stringify(state), status || run.status, this.now(), run.id);
  }
  questionPayload(state) {
    const item = questionById(state.ids[state.qIndex]);
    return Object.assign(publicQuestion(item), {index: state.qIndex, total: ROUNDS, deadline: state.startedAt + QUESTION_MS});
  }
  soloBody(run, state, extra) {
    const item = state.reveal ? questionById(state.reveal.id) : null;
    return {
      ok: true, runId: run.id, phase: state.phase, index: state.qIndex, total: ROUNDS,
      score: state.score, streak: state.streak, bestStreak: state.best,
      question: state.phase === "question" ? this.questionPayload(state) : null,
      reveal: state.reveal && item ? {
        id: item.id, category: item.category, prompt: item.prompt, choices: item.choices.slice(),
        correctIndex: item.answer, fact: item.fact, index: state.reveal.index,
        you: state.reveal.you, score: state.score,
      } : null,
      done: state.phase === "done",
      ...extra,
    };
  }
  applySolo(row, state, choice, now) {
    const item = questionById(state.ids[state.qIndex]);
    const elapsed = now - state.startedAt;
    const picked = Number.isInteger(choice) ? choice : -1;
    const onTime = elapsed <= QUESTION_MS + GRACE_MS && picked >= 0;
    const scored = scoreAnswer({correct: onTime && picked === item.answer, elapsedMs: onTime ? elapsed : QUESTION_MS, streak: state.streak});
    state.score += scored.points;
    state.streak = scored.streak;
    if (scored.streak > state.best) state.best = scored.streak;
    state.answered += 1;
    if (scored.correct) state.correct += 1;
    state.reveal = {
      id: item.id, index: state.qIndex,
      you: {choice: picked >= 0 && picked <= 3 ? picked : null, correct: scored.correct, points: scored.points, base: scored.base, time: scored.time, streakBonus: scored.streakBonus, streak: scored.streak},
    };
    const last = state.qIndex + 1 >= ROUNDS;
    state.phase = last ? "done" : "reveal";
    this.bump(row.id, {points: scored.points, correct: scored.correct ? 1 : 0, answered: 1, best: state.best});
    if (last) {
      this.sql("UPDATE users SET solo_runs = solo_runs + 1, best_solo = MAX(best_solo, ?), updated_at = ? WHERE id = ?",
        state.score, new Date().toISOString(), row.id);
    }
    return last;
  }

  async soloStart(body) {
    const row = await this.userFromToken(body.token || "");
    if (!row) return fail(401, "Sign in again.");
    const ip = await sha256("ip:" + String(body.ip || "0"));
    if (!this.rateOk("so:" + ip.slice(0, 24), SOLO_LIMIT, SOLO_WINDOW * 1000)) return fail(429, "Too many practice runs from this network. Try again in a bit.");
    this.sql("DELETE FROM queue WHERE user_id = ?", row.id);
    this.sql("UPDATE runs SET status = 'abandoned' WHERE user_id = ? AND status = 'live'", row.id);
    const ids = pickQuestionIds(ROUNDS, cryptoRandom);
    const id = hexId("r_");
    const now = this.now();
    const state = {ids, qIndex: 0, phase: "question", startedAt: now, score: 0, streak: 0, best: 0, correct: 0, answered: 0, reveal: null};
    this.sql("INSERT INTO runs (id, user_id, status, state, updated_at) VALUES (?, ?, 'live', ?, ?)", id, row.id, JSON.stringify(state), now);
    const run = {id, status: "live"};
    return json(this.soloBody(run, state));
  }
  async soloGet(url) {
    const row = await this.userFromToken(url.searchParams.get("token") || "");
    if (!row) return fail(401, "Sign in again.");
    const found = this.liveRun(row);
    if (!found) return json({ok: true, phase: "idle"});
    const now = this.now();
    if (found.state.phase === "question" && now > found.state.startedAt + QUESTION_MS + GRACE_MS) {
      const done = this.applySolo(row, found.state, null, now);
      this.saveRun(found.run, found.state, done ? "done" : "live");
    }
    return json(this.soloBody(found.run, found.state));
  }
  async soloAnswer(body) {
    const row = await this.userFromToken(body.token || "");
    if (!row) return fail(401, "Sign in again.");
    const found = this.liveRun(row);
    if (!found || found.run.id !== body.runId) return fail(404, "That practice run is over.");
    if (found.state.phase !== "question") return json(this.soloBody(found.run, found.state));
    const now = this.now();
    const previousBest = row.best_solo || 0;
    const done = this.applySolo(row, found.state, Number.isInteger(body.choice) ? body.choice : -1, now);
    this.saveRun(found.run, found.state, done ? "done" : "live");
    const fresh = this.one("SELECT * FROM users WHERE id = ?", row.id);
    return json(this.soloBody(found.run, found.state, {personalBest: done && found.state.score > previousBest, user: career(fresh)}));
  }
  async soloNext(body) {
    const row = await this.userFromToken(body.token || "");
    if (!row) return fail(401, "Sign in again.");
    const found = this.liveRun(row);
    if (!found || found.run.id !== body.runId) return fail(404, "That practice run is over.");
    if (found.state.phase === "done") return json(this.soloBody(found.run, found.state));
    if (found.state.phase !== "reveal") return fail(409, "Answer this question first.");
    found.state.qIndex += 1;
    found.state.phase = "question";
    found.state.startedAt = this.now();
    found.state.reveal = null;
    this.saveRun(found.run, found.state, "live");
    return json(this.soloBody(found.run, found.state));
  }
}
