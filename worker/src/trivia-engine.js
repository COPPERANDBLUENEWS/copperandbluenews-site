// Server-owned duel. Both players get the same 10 questions. The clock is the server clock.
// A question closes when both have answered or when 15 seconds run out. The reveal holds for
// a few seconds, then the next question starts. The higher total wins. A tie stays a tie.
import {GRACE_MS, QUESTION_MS, REVEAL_MS, WAIT_MS, scoreAnswer} from "./trivia-score.js";

export const ROUNDS = 10;

export function createMatch({id, south, north, questions, now}) {
  if (!id || !south || !north || !Array.isArray(questions) || questions.length !== ROUNDS) {
    throw new Error("bad match");
  }
  return {
    id,
    phase: "waiting",
    south: {id: south.id, name: south.name},
    north: {id: north.id, name: north.name},
    questions: questions.map(item => ({id: item.id, answer: item.answer})),
    qIndex: 0,
    questionStartedAt: 0,
    revealUntil: 0,
    createdAt: now,
    seen: {south: false, north: false},
    current: {south: null, north: null},
    streaks: {south: 0, north: 0},
    totals: {south: 0, north: 0},
    correct: {south: 0, north: 0},
    answered: {south: 0, north: 0},
    bestStreak: {south: 0, north: 0},
    log: {south: [], north: []},
    lastReveal: null,
    winnerId: null,
    tie: false,
    forfeit: false,
    finished: false,
    recorded: false,
  };
}

function miss(streak) {
  return Object.assign(scoreAnswer({correct: false, elapsedMs: QUESTION_MS, streak}), {choice: null});
}

function closeQuestion(state, now) {
  for (const seat of ["south", "north"]) {
    if (!state.current[seat]) state.current[seat] = miss(state.streaks[seat]);
    const row = state.current[seat];
    state.streaks[seat] = row.streak;
    state.totals[seat] += row.points;
    state.answered[seat] += 1;
    if (row.correct) state.correct[seat] += 1;
    if (row.streak > state.bestStreak[seat]) state.bestStreak[seat] = row.streak;
    state.log[seat].push({
      id: state.questions[state.qIndex].id,
      choice: row.choice,
      correct: row.correct,
      points: row.points,
      base: row.base,
      time: row.time,
      streakBonus: row.streakBonus,
      streak: row.streak,
      total: state.totals[seat],
    });
  }
  state.lastReveal = {
    qIndex: state.qIndex,
    id: state.questions[state.qIndex].id,
    correctIndex: state.questions[state.qIndex].answer,
    south: state.log.south[state.log.south.length - 1],
    north: state.log.north[state.log.north.length - 1],
  };
  state.current = {south: null, north: null};
  state.phase = "reveal";
  state.revealUntil = now + REVEAL_MS;
}

function finish(state, now) {
  state.phase = "done";
  state.finished = true;
  state.revealUntil = now;
  if (state.forfeit) return;
  if (state.totals.south === state.totals.north) {
    state.tie = true;
    state.winnerId = null;
  } else {
    state.tie = false;
    state.winnerId = state.totals.south > state.totals.north ? state.south.id : state.north.id;
  }
}

export function advance(state, now) {
  if (!state || state.finished) return state;
  if (state.phase === "waiting") {
    if (state.seen.south && state.seen.north) {
      state.phase = "question";
      state.qIndex = 0;
      state.questionStartedAt = now;
      return state;
    }
    if (now - state.createdAt >= WAIT_MS && state.seen.south !== state.seen.north) {
      const seat = state.seen.south ? "south" : "north";
      state.forfeit = true;
      state.tie = false;
      state.winnerId = state[seat].id;
      finish(state, now);
    }
    return state;
  }
  if (state.phase === "question") {
    const both = state.current.south && state.current.north;
    if (both || now >= state.questionStartedAt + QUESTION_MS + GRACE_MS) closeQuestion(state, now);
    return state;
  }
  if (state.phase === "reveal" && now >= state.revealUntil) {
    if (state.qIndex + 1 >= ROUNDS) finish(state, now);
    else {
      state.qIndex += 1;
      state.phase = "question";
      state.questionStartedAt = now;
      state.current = {south: null, north: null};
    }
  }
  return state;
}

export function markSeen(state, seat, now) {
  if (seat !== "south" && seat !== "north") return {error: "bad seat"};
  state.seen[seat] = true;
  advance(state, now);
  return {ok: true};
}

export function applyAnswer(state, seat, choice, now) {
  if (seat !== "south" && seat !== "north") return {error: "bad seat"};
  advance(state, now);
  if (state.phase !== "question") return {error: "not answering", phase: state.phase};
  if (state.current[seat]) return {ok: true, duplicate: true};
  const elapsed = now - state.questionStartedAt;
  const answer = state.questions[state.qIndex].answer;
  const picked = Number.isInteger(choice) ? choice : -1;
  const onTime = elapsed <= QUESTION_MS + GRACE_MS;
  const scored = scoreAnswer({correct: onTime && picked === answer, elapsedMs: elapsed, streak: state.streaks[seat]});
  scored.choice = picked >= 0 && picked <= 3 ? picked : null;
  state.current[seat] = scored;
  advance(state, now);
  return {ok: true};
}

function seatOf(state, userId) {
  if (state.south.id === userId) return "south";
  if (state.north.id === userId) return "north";
  return null;
}

function breakdown(row) {
  if (!row) return null;
  return {
    choice: row.choice,
    correct: !!row.correct,
    points: row.points,
    base: row.base,
    time: row.time,
    streakBonus: row.streakBonus,
    streak: row.streak,
    total: row.total,
  };
}

export function view(state, userId, fullQuestions, now) {
  advance(state, now);
  const seat = seatOf(state, userId);
  if (!seat) return {error: "not in this duel"};
  const opp = seat === "south" ? "north" : "south";
  const showing = state.phase === "question"
    ? fullQuestions.find(q => q.id === state.questions[state.qIndex].id)
    : null;
  const revealQ = state.lastReveal ? fullQuestions.find(q => q.id === state.lastReveal.id) : null;
  const question = showing ? {
    id: showing.id,
    category: showing.category,
    prompt: showing.prompt,
    choices: showing.choices.slice(),
    index: state.qIndex,
    total: ROUNDS,
    deadline: state.questionStartedAt + QUESTION_MS,
  } : null;
  let reveal = null;
  if ((state.phase === "reveal" || state.phase === "done") && state.lastReveal && revealQ) {
    const mine = seat === "south" ? state.lastReveal.south : state.lastReveal.north;
    const theirs = seat === "south" ? state.lastReveal.north : state.lastReveal.south;
    reveal = {
      id: revealQ.id,
      category: revealQ.category,
      prompt: revealQ.prompt,
      choices: revealQ.choices.slice(),
      correctIndex: state.lastReveal.correctIndex,
      fact: revealQ.fact,
      index: state.lastReveal.qIndex,
      total: ROUNDS,
      you: breakdown(mine),
      opponent: breakdown(theirs),
      until: state.phase === "reveal" ? state.revealUntil : now,
    };
  }
  return {
    ok: true,
    matchId: state.id,
    phase: state.phase,
    seat,
    serverNow: now,
    you: {name: state[seat].name, total: state.totals[seat], streak: state.streaks[seat], answered: !!state.current[seat]},
    opponent: {name: state[opp].name, total: state.totals[opp], streak: state.streaks[opp], answered: !!state.current[opp], connected: !!state.seen[opp]},
    question,
    reveal,
    result: state.finished ? {
      winnerId: state.winnerId,
      tie: state.tie,
      forfeit: state.forfeit,
      youScore: state.totals[seat],
      oppScore: state.totals[opp],
      youWon: !state.tie && state.winnerId === state[seat].id,
    } : null,
    round: state.phase === "waiting" ? 0 : Math.min(ROUNDS, state.qIndex + (state.phase === "done" ? 1 : 1)),
  };
}

export function resultPayload(state) {
  return {
    matchId: state.id,
    southId: state.south.id,
    northId: state.north.id,
    southName: state.south.name,
    northName: state.north.name,
    southScore: state.totals.south,
    northScore: state.totals.north,
    southCorrect: state.correct.south,
    northCorrect: state.correct.north,
    southAnswered: state.answered.south,
    northAnswered: state.answered.north,
    southBest: state.bestStreak.south,
    northBest: state.bestStreak.north,
    winnerId: state.winnerId,
    tie: state.tie,
    forfeit: state.forfeit,
  };
}

export {QUESTION_MS, REVEAL_MS, WAIT_MS, GRACE_MS};
