// Simple Elo. New accounts start at 1000. K=32, floored so a long skid stays on the board.
export const START_RATING = 1000;
export const K_FACTOR = 32;

export function elo(winner, loser, k = K_FACTOR) {
  const next = eloPoints(winner, loser, 1, k);
  return {winner: next.a, loser: next.b};
}

// scoreA is 1 (A won), 0.5 (tie), or 0 (A lost).
export function eloPoints(a, b, scoreA, k = K_FACTOR) {
  const expected = 1 / (1 + 10 ** ((b - a) / 400));
  return {
    a: Math.max(100, Math.round(a + k * (scoreA - expected))),
    b: Math.max(100, Math.round(b + k * ((1 - scoreA) - (1 - expected)))),
  };
}
