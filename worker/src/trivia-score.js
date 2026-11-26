// Speed + accuracy scoring for Oilers Trivia. Pure function, shared by solo runs and duels.
// A correct answer is 100, plus up to 50 for time left, plus 15 for each correct answer already
// on the streak (capped at five, so +75). A miss or a late answer scores 0 and resets the streak.
export const QUESTION_MS = 15000;
export const REVEAL_MS = 4500;
export const WAIT_MS = 40000;
export const GRACE_MS = 400;
export const BASE_POINTS = 100;
export const MAX_TIME_BONUS = 50;
export const STREAK_STEP = 15;
export const STREAK_CAP = 5;

export function scoreAnswer({correct, elapsedMs, streak}) {
  const prior = Math.max(0, streak | 0);
  const elapsed = Math.max(0, elapsedMs | 0);
  if (!correct || elapsed > QUESTION_MS + GRACE_MS) {
    return {correct: false, points: 0, base: 0, time: 0, streakBonus: 0, streak: 0, elapsedMs: elapsed};
  }
  const used = Math.min(QUESTION_MS, elapsed);
  const time = Math.round(MAX_TIME_BONUS * (QUESTION_MS - used) / QUESTION_MS);
  const streakBonus = Math.min(prior, STREAK_CAP) * STREAK_STEP;
  return {
    correct: true,
    points: BASE_POINTS + time + streakBonus,
    base: BASE_POINTS,
    time,
    streakBonus,
    streak: prior + 1,
    elapsedMs: used,
  };
}
