// Oilers Trivia: question bank, scoring, duel clock, solo runs, matchmaking, leaderboard.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {QUESTIONS, assertBank, pickQuestionIds, questionById} from "../src/trivia-bank.js";
import {GRACE_MS, QUESTION_MS, REVEAL_MS, scoreAnswer} from "../src/trivia-score.js";
import {applyAnswer, createMatch, markSeen, view} from "../src/trivia-engine.js";
import {QUICK_WAIT_MS, TriviaLobby} from "../src/trivia-lobby.js";
import {TriviaMatch} from "../src/trivia-match.js";

assertBank();
assert.ok(QUESTIONS.length >= 80, "need at least 80 questions, got " + QUESTIONS.length);
for (const cat of ["History", "Franchise Records", "Legends", "Modern Era", "By the Numbers"]) {
  assert.ok(QUESTIONS.filter(item => item.category === cat).length >= 10, cat);
}
const ids = pickQuestionIds(10, () => 0.2);
assert.equal(ids.length, 10);
assert.equal(new Set(ids).size, 10);
assert.ok(new Set(ids.map(id => questionById(id).category)).size >= 5);

const chase = JSON.parse(readFileSync(new URL("../../data/mcdavid.json", import.meta.url), "utf8"));
const through = chase.games.find(game => game.date === "2026-11-24");
assert.equal(through.gp, 27);
assert.equal(through.cum, 59);
assert.equal(chase.games.reduce((sum, game) => sum + game.g, 0), 14);
assert.equal(chase.games.reduce((sum, game) => sum + game.a, 0), 45);
const live = QUESTIONS.find(item => item.id === "n-live-59");
const gretzky = QUESTIONS.find(item => item.id === "n-gretzky-27");
const best = QUESTIONS.find(item => item.id === "n-best-27");
assert.equal(live.choices[live.answer], "59");
assert.equal(chase.summary.gretzkyThrough, 64);
assert.equal(gretzky.choices[gretzky.answer], "64");
assert.equal(chase.summary.careerBestThrough, 52);
assert.equal(best.choices[best.answer], "52");
const season = chase.seasons.find(item => item.season === "2025-26");
assert.equal(season.g, 48);
assert.equal(season.a, 90);
assert.equal(season.p, 138);
const ross = QUESTIONS.find(item => item.id === "n-sixth-ross");
assert.ok(ross.choices[ross.answer].includes("138"));
assert.ok(ross.choices[ross.answer].includes("48"));

assert.equal(scoreAnswer({correct: true, elapsedMs: 0, streak: 0}).points, 150);
assert.equal(scoreAnswer({correct: true, elapsedMs: 7500, streak: 0}).points, 125);
assert.equal(scoreAnswer({correct: true, elapsedMs: 0, streak: 1}).points, 165);
assert.equal(scoreAnswer({correct: true, elapsedMs: 0, streak: 6}).streakBonus, 75);
assert.equal(scoreAnswer({correct: true, elapsedMs: QUESTION_MS, streak: 2}).points, 130);
assert.equal(scoreAnswer({correct: true, elapsedMs: QUESTION_MS + GRACE_MS, streak: 0}).points, 100);
assert.equal(scoreAnswer({correct: true, elapsedMs: QUESTION_MS + GRACE_MS + 1, streak: 4}).points, 0);
assert.equal(scoreAnswer({correct: false, elapsedMs: 10, streak: 4}).streak, 0);

const deck = QUESTIONS.slice(0, 10);
let now = 5_000_000;
const duel = createMatch({id: "t_test", south: {id: "a", name: "Ace"}, north: {id: "b", name: "Bay"}, questions: deck, now});
markSeen(duel, "south", now);
let seen = view(duel, "a", deck, now);
assert.equal(seen.phase, "waiting");
assert.equal(seen.question, null);
now += 1000;
markSeen(duel, "north", now);
seen = view(duel, "a", deck, now);
assert.equal(seen.phase, "question");
assert.equal(seen.question.id, deck[0].id);
assert.equal(Object.hasOwn(seen.question, "answer"), false);
assert.equal(JSON.stringify(seen).includes("correctIndex"), false);

applyAnswer(duel, "south", deck[0].answer, now);
seen = view(duel, "a", deck, now);
assert.equal(seen.phase, "question", "the other player still has the rest of the clock");
assert.equal(seen.you.total, 0);
applyAnswer(duel, "north", (deck[0].answer + 1) % 4, now + 3000);
seen = view(duel, "b", deck, now + 3000);
assert.equal(seen.phase, "reveal");
assert.equal(seen.reveal.correctIndex, deck[0].answer);
assert.equal(seen.reveal.fact, deck[0].fact);
assert.equal(seen.reveal.opponent.correct, true);
assert.equal(seen.reveal.you.correct, false);
assert.ok(seen.reveal.opponent.points > seen.reveal.you.points);
const southAfter = seen.reveal.opponent.points;

now = duel.revealUntil;
view(duel, "a", deck, now);
assert.equal(duel.phase, "question");
assert.equal(duel.qIndex, 1);
const started = duel.questionStartedAt;
view(duel, "a", deck, started + QUESTION_MS + GRACE_MS);
assert.equal(duel.phase, "reveal");
assert.equal(duel.log.south[1].points, 0);
assert.equal(duel.log.north[1].points, 0);
assert.equal(duel.streaks.south, 0);

function playRest(state, winnerSeat) {
  while (!state.finished) {
    if (state.phase === "reveal") view(state, "a", deck, state.revealUntil);
    else if (state.phase === "question") {
      const q = state.questions[state.qIndex];
      const t = state.questionStartedAt;
      applyAnswer(state, "south", winnerSeat === "south" ? q.answer : (q.answer + 1) % 4, t + 100);
      applyAnswer(state, "north", winnerSeat === "north" ? q.answer : (q.answer + 1) % 4, t + 100);
    } else break;
  }
}
playRest(duel, "south");
assert.equal(duel.finished, true);
assert.equal(duel.tie, false);
assert.equal(duel.winnerId, "a");
assert.ok(duel.totals.south > southAfter);
assert.equal(duel.answered.south, 10);
const finalView = view(duel, "a", deck, duel.revealUntil + REVEAL_MS);
assert.equal(finalView.result.youWon, true);
assert.equal(finalView.reveal.fact.length > 10, true);

const forfeited = createMatch({id: "t_forfeit", south: {id: "a", name: "Ace"}, north: {id: "b", name: "Bay"}, questions: deck, now});
markSeen(forfeited, "south", now);
view(forfeited, "a", deck, now + 40000);
assert.equal(forfeited.forfeit, true);
assert.equal(forfeited.winnerId, "a");
assert.equal(forfeited.totals.south, 0);

const tied = createMatch({id: "t_tie", south: {id: "a", name: "Ace"}, north: {id: "b", name: "Bay"}, questions: deck, now});
markSeen(tied, "south", now);
markSeen(tied, "north", now);
playRest(tied, "both");
assert.equal(tied.tie, true);
assert.equal(tied.winnerId, null);
assert.equal(tied.totals.south, tied.totals.north);

function makeCtx(db) {
  let boot;
  const ctx = {
    storage: {
      sql: {
        exec(query, ...args) {
          const stmt = db.prepare(query);
          if (/^\s*(SELECT|PRAGMA)/i.test(query)) return {toArray: () => stmt.all(...args)};
          stmt.run(...args);
          return {toArray: () => []};
        },
      },
      transactionSync(fn) {
        db.exec("BEGIN");
        try { fn(); db.exec("COMMIT"); }
        catch (e) { db.exec("ROLLBACK"); throw e; }
      },
    },
    blockConcurrencyWhile(fn) { boot = fn(); return boot; },
  };
  return {ctx, boot: () => boot};
}

const lobbyDb = new DatabaseSync(":memory:");
const lobbyParts = makeCtx(lobbyDb);
const matches = new Map();
let lobby;
function asRequest(input, init) {
  return input instanceof Request ? input : new Request(input, init);
}
const env = {
  TRIVIA_LOBBY: {
    idFromName() { return "lobby"; },
    get() { return {fetch: (input, init) => lobby.fetch(asRequest(input, init))}; },
  },
  TRIVIA_MATCH: {
    idFromName(name) { return name; },
    get(id) {
      if (!matches.has(id)) {
        const db = new DatabaseSync(":memory:");
        const parts = makeCtx(db);
        const match = new TriviaMatch(parts.ctx, env);
        matches.set(id, {match, boot: parts.boot});
      }
      const entry = matches.get(id);
      return {async fetch(input, init) { await entry.boot(); return entry.match.fetch(asRequest(input, init)); }};
    },
  },
};
lobby = new TriviaLobby(lobbyParts.ctx, env);
await lobbyParts.boot();
let clock = 1_700_000_000_000;
lobby.now = () => clock;

async function body(res) {
  const data = await res.json();
  data._status = res.status;
  return data;
}
async function signup(name) {
  const res = await body(await lobby.signup({username: name, ip: "ip-" + name}));
  assert.equal(res.ok, true, res.error || name);
  return res;
}

const ace = await signup("Trivia_Ace");
const bay = await signup("Trivia_Bay");
assert.equal(ace.user.points, 0);
assert.ok(ace.token && ace.recoveryCode);

const taken = await body(await lobby.signup({username: "trivia_ace", ip: "other"}));
assert.equal(taken._status, 409);

let run = await body(await lobby.soloStart({token: ace.token, ip: "solo-ace"}));
assert.equal(run.phase, "question");
assert.equal(run.question.choices.length, 4);
assert.equal(Object.hasOwn(run.question, "answer"), false);
assert.equal(JSON.stringify(run).includes("correctIndex"), false);
const first = questionById(run.question.id);
const fast = await body(await lobby.soloAnswer({token: ace.token, runId: run.runId, choice: first.answer}));
assert.equal(fast.phase, "reveal");
assert.equal(fast.reveal.you.correct, true);
assert.equal(fast.reveal.you.points, 150);
assert.equal(fast.reveal.correctIndex, first.answer);
assert.ok(fast.reveal.fact);
assert.equal(fast.score, 150);
const again = await body(await lobby.soloAnswer({token: ace.token, runId: run.runId, choice: 0}));
assert.equal(again.score, 150, "a second tap does not score twice");

run = fast;
let guard = 0;
while (!run.done && guard < 20) {
  guard++;
  if (run.phase === "reveal") {
    run = await body(await lobby.soloNext({token: ace.token, runId: run.runId}));
    continue;
  }
  if (run.phase !== "question") break;
  const item = questionById(run.question.id);
  run = await body(await lobby.soloAnswer({token: ace.token, runId: run.runId, choice: item.answer}));
}
assert.equal(run.done, true);
assert.equal(run.score > 150, true);
assert.equal(run.personalBest, true);
const me = await body(await lobby.me(new URL("https://lobby.internal/me?token=" + encodeURIComponent(ace.token))));
assert.equal(me.user.points, run.score);
assert.equal(me.user.soloRuns, 1);
assert.equal(me.user.bestSolo, run.score);
assert.equal(me.user.correct, 10);
assert.ok(me.user.bestStreak >= 2);
assert.equal(me.user.accuracy, 100);

const slow = await body(await lobby.soloStart({token: bay.token, ip: "solo-bay"}));
assert.equal(slow.phase, "question");
clock += QUESTION_MS + GRACE_MS + 50;
const late = await body(await lobby.soloGet(new URL("https://lobby.internal/solo?token=" + encodeURIComponent(bay.token))));
assert.equal(late.phase === "reveal" || late.phase === "done", true);
assert.equal(late.reveal.you.points, 0);
assert.equal(late.score, 0);

const board = await body(await lobby.leaderboard(new URL("https://lobby.internal/leaderboard?token=" + encodeURIComponent(ace.token) + "&sort=points")));
assert.equal(board.top[0].username, "Trivia_Ace");
assert.equal(board.you.rank, 1);
assert.equal(board.top[0].email, undefined);
const byStreak = await body(await lobby.leaderboard(new URL("https://lobby.internal/leaderboard?sort=streak&token=" + encodeURIComponent(bay.token))));
assert.equal(byStreak.you.username, "Trivia_Bay");

let qa = await body(await lobby.quick({token: ace.token, ip: "net-a"}));
assert.equal(qa.status, "queued");
assert.equal(qa.waitMs, QUICK_WAIT_MS);
clock += 5000;
const qb = await body(await lobby.quick({token: bay.token, ip: "net-b"}));
assert.equal(qb.status, "matched");
assert.equal(qb.seat, "north");
assert.equal(qb.opponent, "Trivia_Ace");
qa = await body(await lobby.quickPoll(new URL("https://lobby.internal/quick?token=" + encodeURIComponent(ace.token))));
assert.equal(qa.status, "matched");
assert.equal(qa.matchId, qb.matchId);
assert.equal(qa.seat, "south");
const match = matches.get(qb.matchId).match;
assert.equal(match.state.questions.length, 10);
assert.equal(match.state.questions[0].answer, questionById(match.state.questions[0].id).answer);

const room = await body(await lobby.createRoom({token: ace.token, ip: "room-a"}));
assert.equal(room.ok, true);
assert.match(room.code, /^[A-Z0-9]{6}$/);
assert.equal(room.path, "trivia.html?room=" + room.code);
const waiting = await body(await lobby.roomPoll(new URL("https://lobby.internal/room?token=" + encodeURIComponent(ace.token) + "&code=" + room.code)));
assert.equal(waiting.status, "waiting");
const joined = await body(await lobby.joinRoom({token: bay.token, code: room.code, ip: "room-b"}));
assert.equal(joined.status, "matched");
assert.equal(joined.opponent, "Trivia_Ace");
const host = await body(await lobby.roomPoll(new URL("https://lobby.internal/room?token=" + encodeURIComponent(ace.token) + "&code=" + room.code)));
assert.equal(host.status, "matched");
assert.equal(host.matchId, joined.matchId);

const duelMatch = matches.get(joined.matchId).match;
duelMatch.now = () => clock;
let southView = await body(await duelMatch.fetch(new Request("https://match.internal/state?userId=" + ace.user.id)));
assert.equal(southView.phase, "waiting");
clock += 1000;
let northView = await body(await duelMatch.fetch(new Request("https://match.internal/state?userId=" + bay.user.id)));
assert.equal(northView.phase, "question");
const q0 = questionById(northView.question.id);
southView = await body(await duelMatch.fetch(new Request("https://match.internal/answer", {method: "POST", body: JSON.stringify({userId: ace.user.id, choice: q0.answer})})));
assert.equal(southView.phase, "question");
assert.equal(JSON.stringify(southView).includes("correctIndex"), false);
northView = await body(await duelMatch.fetch(new Request("https://match.internal/answer", {method: "POST", body: JSON.stringify({userId: bay.user.id, choice: (q0.answer + 1) % 4})})));
assert.equal(northView.phase, "reveal");
assert.equal(northView.reveal.you.correct, false);
assert.equal(northView.reveal.opponent.correct, true);
const before = (await body(await lobby.me(new URL("https://lobby.internal/me?token=" + encodeURIComponent(ace.token))))).user.points;
clock = duelMatch.state.revealUntil;
while (!duelMatch.state.finished) {
  if (duelMatch.state.phase === "reveal") clock = duelMatch.state.revealUntil;
  if (duelMatch.state.phase === "question") {
    const current = questionById(duelMatch.state.questions[duelMatch.state.qIndex].id);
    await duelMatch.fetch(new Request("https://match.internal/answer", {method: "POST", body: JSON.stringify({userId: ace.user.id, choice: current.answer})}));
    await duelMatch.fetch(new Request("https://match.internal/answer", {method: "POST", body: JSON.stringify({userId: bay.user.id, choice: current.answer})}));
  }
  await duelMatch.fetch(new Request("https://match.internal/state?userId=" + ace.user.id));
}
assert.equal(duelMatch.state.tie, false);
assert.equal(duelMatch.state.winnerId, ace.user.id);
assert.equal(duelMatch.state.recorded, true);
const aceAfter = await body(await lobby.me(new URL("https://lobby.internal/me?token=" + encodeURIComponent(ace.token))));
const bayAfter = await body(await lobby.me(new URL("https://lobby.internal/me?token=" + encodeURIComponent(bay.token))));
assert.equal(aceAfter.user.wins, 1);
assert.equal(aceAfter.user.ties, 0);
assert.equal(bayAfter.user.losses, 1);
assert.ok(aceAfter.user.points > before);
assert.equal(aceAfter.user.points - before, duelMatch.state.totals.south);
await duelMatch.fetch(new Request("https://match.internal/state?userId=" + ace.user.id));
const aceTwice = await body(await lobby.me(new URL("https://lobby.internal/me?token=" + encodeURIComponent(ace.token))));
assert.equal(aceTwice.user.points, aceAfter.user.points, "recording a finished duel twice does not add points again");
assert.equal(aceTwice.user.ties, 0);

const soloOnly = await signup("Solo_Only");
clock += QUICK_WAIT_MS;
let queued = await body(await lobby.quick({token: soloOnly.token, ip: "solo-q"}));
assert.equal(queued.status, "queued");
clock += QUICK_WAIT_MS;
queued = await body(await lobby.quickPoll(new URL("https://lobby.internal/quick?token=" + encodeURIComponent(soloOnly.token))));
assert.equal(queued.status, "solo");
assert.equal(lobby.one("SELECT COUNT(*) AS n FROM queue").n, 0);

console.log("trivia ok", QUESTIONS.length, "questions");
