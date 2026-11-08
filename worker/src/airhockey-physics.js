// Authoritative rink. Same table as js/play.js (360×620, first to 7, circular mallets).
// The Durable Object ticks at 60 Hz and runs two 120 Hz substeps so a fast puck cannot tunnel the goal line.
export const W = 360, H = 620, WALL = 14, GOAL = 176, PR = 34, R = 8, MAX = 930, STEP = 1 / 120;
export const WIN = 7, PADDLE_SPEED = 890;
export const REG_MS = 120000, OT_MS = 60000;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function paddle(y, bottom) {
  return {x: W / 2, y, bottom, vx: 0, vy: 0, tx: W / 2, ty: y};
}

export function createGame(rng = Math.random) {
  return {
    phase: "waiting", timer: 0.9, score: {south: 0, north: 0}, winner: null, lastGoal: null,
    puck: {x: W / 2, y: H / 2, vx: 0, vy: 0}, south: paddle(H - 132, true), north: paddle(132, false),
    goals: 0, time: 0, stillTime: 0, regionTime: 0, regionX: W / 2, regionY: H / 2, laneTime: 0,
    paused: false, gameNo: 1, rng, clock: REG_MS, period: "reg", tie: false, regMs: REG_MS, otMs: OT_MS, winAt: 0,
  };
}

export function viewToWorld(seat, x, y) {
  if (seat === "south") return {x, y};
  return {x: W - x, y: H - y};
}

export function setTarget(state, seat, x, y) {
  const p = state[seat];
  if (!p) return;
  const bottom = seat === "south";
  p.tx = clamp(x, WALL + PR, W - WALL - PR);
  p.ty = clamp(y, bottom ? H / 2 + PR + 10 : WALL + PR + 10, bottom ? H - WALL - PR - 10 : H / 2 - PR - 10);
}

function withinRink(x, y, pad = R) {
  if (x < WALL + pad || x > W - WALL - pad) return false;
  if (Math.abs(x - W / 2) < GOAL / 2 - pad) return true;
  if (y < WALL + pad || y > H - WALL - pad) return false;
  const radius = 25, cx = x < WALL + radius ? WALL + radius : x > W - WALL - radius ? W - WALL - radius : null;
  const cy = y < WALL + radius ? WALL + radius : y > H - WALL - radius ? H - WALL - radius : null;
  return cx === null || cy === null || Math.hypot(x - cx, y - cy) <= radius - pad + 0.001;
}

function resetPositions(state) {
  Object.assign(state.puck, {x: W / 2, y: H / 2, vx: 0, vy: 0});
  state.regionTime = 0; state.regionX = W / 2; state.regionY = H / 2; state.laneTime = 0; state.stillTime = 0;
  Object.assign(state.south, paddle(H - 132, true));
  Object.assign(state.north, paddle(132, false));
}

function serve(state) {
  const rng = state.rng || Math.random;
  const angle = (rng() - 0.5) * 1.2, dir = rng() < 0.5 ? -1 : 1;
  state.puck.vx = Math.sin(angle) * 280;
  state.puck.vy = Math.cos(angle) * 280 * dir;
  state.phase = "playing";
}

function move(p, speed, dt, bottom) {
  p.tx = clamp(p.tx, WALL + PR, W - WALL - PR);
  p.ty = clamp(p.ty, bottom ? H / 2 + PR + 10 : WALL + PR + 10, bottom ? H - WALL - PR - 10 : H / 2 - PR - 10);
  const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
  const s = d ? Math.min(speed, d / dt) / d : 0;
  p.vx = dx * s; p.vy = dy * s; p.x += p.vx * dt; p.y += p.vy * dt;
}

function cap(q) {
  const s = Math.hypot(q.vx, q.vy);
  if (s > MAX) { q.vx *= MAX / s; q.vy *= MAX / s; }
}

function collide(state, p, events) {
  const q = state.puck, dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy), sum = PR + R;
  if (d >= sum) return;
  let nx = d ? dx / d : 0, ny = d ? dy / d : (p.bottom ? -1 : 1);
  let x = p.x + nx * (sum + 0.1), y = p.y + ny * (sum + 0.1);
  if (!withinRink(x, y)) {
    let best = Infinity;
    for (let i = 0; i < 48; i++) {
      const angle = i * Math.PI / 24, cx = p.x + Math.cos(angle) * (sum + 0.1), cy = p.y + Math.sin(angle) * (sum + 0.1);
      if (withinRink(cx, cy)) {
        const cost = (cx - q.x) ** 2 + (cy - q.y) ** 2;
        if (cost < best) { best = cost; x = cx; y = cy; nx = Math.cos(angle); ny = Math.sin(angle); }
      }
    }
  }
  q.x = x; q.y = y;
  const vn = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
  if (vn < 0) {
    const hit = -vn;
    q.vx -= 1.92 * vn * nx; q.vy -= 1.92 * vn * ny; q.vx += p.vx * 0.14; q.vy += p.vy * 0.14; cap(q);
    if (hit > 30) events.push({k: "c", sp: Math.round(hit)});
  }
}

function board(events, speed) { if (speed > 40) events.push({k: "b", sp: Math.round(speed)}); }

function post(state, events, x, y) {
  const q = state.puck, dx = q.x - x, dy = q.y - y, d = Math.hypot(dx, dy), sum = R + 3;
  if (!d || d >= sum) return;
  const nx = dx / d, ny = dy / d;
  q.x = x + nx * (sum + 0.05); q.y = y + ny * (sum + 0.05);
  const vn = q.vx * nx + q.vy * ny;
  if (vn < 0) { q.vx -= 1.96 * vn * nx; q.vy -= 1.96 * vn * ny; board(events, -vn); }
}

function goal(state, events, side) {
  state.score[side]++; state.goals++; state.puck.vx = state.puck.vy = 0;
  const cap = state.winAt || 0;
  state.phase = cap && state.score[side] >= cap ? "over" : "goal";
  state.timer = 1.05; state.lastGoal = side;
  if (state.phase === "over") state.winner = side;
  events.push({k: "g", s: side === "south" ? "s" : "n"});
}

export function resetGame(state) {
  state.phase = "faceoff"; state.timer = 0.9; state.score = {south: 0, north: 0};
  state.winner = null; state.lastGoal = null; state.tie = false; state.paused = false;
  state.period = "reg"; state.clock = state.regMs || REG_MS;
  state.gameNo = (state.gameNo || 1) + 1;
  state.goals = 0; state.time = 0;
  resetPositions(state);
}

// Regulation expiry: higher score wins. A tie starts sudden-death overtime.
// OT expiry with the score still level is a tie. The caller ends OT the moment a goal is scored.
export function expireClock(state) {
  state.clock = 0;
  if (state.period !== "ot") {
    if (state.score.south !== state.score.north) {
      state.phase = "over";
      state.winner = state.score.south > state.score.north ? "south" : "north";
      state.tie = false;
      return "final";
    }
    state.period = "ot";
    state.clock = state.otMs || OT_MS;
    state.phase = "faceoff";
    state.timer = 0.8;
    state.lastGoal = null;
    resetPositions(state);
    return "ot";
  }
  state.phase = "over";
  state.winner = null;
  state.tie = true;
  return "tie";
}

export function step(state, dt, events) {
  if (!events) events = [];
  if (state.paused || state.phase === "over" || state.phase === "waiting" || state.phase === "abandoned" || !Number.isFinite(dt) || dt <= 0) return events;
  dt = Math.min(dt, 1 / 60);
  state.time += dt;
  if (state.phase !== "playing") {
    state.south.tx = W / 2; state.south.ty = H - 132;
    state.north.tx = W / 2; state.north.ty = 132;
  }
  move(state.south, PADDLE_SPEED, dt, true);
  move(state.north, PADDLE_SPEED, dt, false);
  if (state.phase === "versus") {
    state.timer -= dt;
    if (state.timer <= 0) { state.phase = "faceoff"; state.timer = 0.9; }
    return events;
  }
  if (state.phase !== "playing") {
    state.timer -= dt;
    if (state.timer <= 0) {
      if (state.phase === "goal") { resetPositions(state); state.phase = "faceoff"; state.timer = 0.8; }
      else serve(state);
    }
    return events;
  }
  const q = state.puck, oldX = q.x, oldY = q.y;
  q.x += q.vx * dt; q.y += q.vy * dt;
  if (q.x < WALL + R) { const hit = Math.abs(q.vx); q.x = WALL + R; q.vx = Math.abs(q.vx) * 0.99; board(events, hit); }
  if (q.x > W - WALL - R) { const hit = Math.abs(q.vx); q.x = W - WALL - R; q.vx = -Math.abs(q.vx) * 0.99; board(events, hit); }
  const mouth = Math.abs(q.x - W / 2) < GOAL / 2 - R;
  if (!mouth) {
    if (q.y < WALL + R) { const hit = Math.abs(q.vy); q.y = WALL + R; q.vy = Math.abs(q.vy) * 0.99; board(events, hit); }
    if (q.y > H - WALL - R) { const hit = Math.abs(q.vy); q.y = H - WALL - R; q.vy = -Math.abs(q.vy) * 0.99; board(events, hit); }
  }
  const cornerX = q.x < WALL + 25 ? WALL + 25 : q.x > W - WALL - 25 ? W - WALL - 25 : null;
  const cornerY = q.y < WALL + 25 ? WALL + 25 : q.y > H - WALL - 25 ? H - WALL - 25 : null;
  if (cornerX !== null && cornerY !== null) {
    const dx = q.x - cornerX, dy = q.y - cornerY, d = Math.hypot(dx, dy), radius = 25 - R;
    if (d > radius) {
      const nx = dx / d, ny = dy / d;
      q.x = cornerX + nx * radius; q.y = cornerY + ny * radius;
      const vn = q.vx * nx + q.vy * ny;
      if (vn > 0) { q.vx -= 1.98 * vn * nx; q.vy -= 1.98 * vn * ny; board(events, vn); }
    }
  }
  for (const x of [W / 2 - GOAL / 2, W / 2 + GOAL / 2]) { post(state, events, x, WALL); post(state, events, x, H - WALL); }
  collide(state, state.south, events); collide(state, state.north, events);
  if (Math.abs(q.x - W / 2) < GOAL / 2 - R) {
    if (q.y < WALL - R) { goal(state, events, "south"); return events; }
    if (q.y > H - WALL + R) { goal(state, events, "north"); return events; }
  }
  const drag = Math.exp(-0.075 * dt);
  q.vx *= drag; q.vy *= drag;
  const speed = Math.hypot(q.vx, q.vy);
  if (speed > 0 && speed < 115) { q.vx *= 115 / speed; q.vy *= 115 / speed; }
  cap(q);
  state.stillTime = Math.hypot(q.x - oldX, q.y - oldY) < 0.035 ? state.stillTime + dt : 0;
  if (Math.hypot(q.x - state.regionX, q.y - state.regionY) > 36) { state.regionTime = 0; state.regionX = q.x; state.regionY = q.y; }
  else state.regionTime += dt;
  state.laneTime = Math.abs(q.y - H / 2) < 3 && Math.abs(q.vy) < 4 ? state.laneTime + dt : 0;
  if (state.stillTime > 1.4 || state.regionTime > 2.2 || state.laneTime > 2.2) {
    resetPositions(state); state.stillTime = 0; state.phase = "faceoff"; state.timer = 0.8;
    events.push({k: "z"});
  }
  return events;
}

const r1 = v => Math.round(v * 10) / 10;
export function packState(state, events) {
  const ph = {waiting: "w", versus: "v", faceoff: "f", playing: "p", goal: "g", over: "o", abandoned: "a"}[state.phase] || "w";
  const q = state.puck, a = state.south, b = state.north;
  const msg = {
    t: "s", ph, sc: [state.score.south, state.score.north],
    k: [r1(q.x), r1(q.y), r1(q.vx), r1(q.vy)],
    a: [r1(a.x), r1(a.y)], b: [r1(b.x), r1(b.y)],
    lg: state.lastGoal === "south" ? "s" : state.lastGoal === "north" ? "n" : null,
    w: state.winner === "south" ? "s" : state.winner === "north" ? "n" : null,
    gn: state.gameNo || 1, paused: state.paused ? 1 : 0,
    clk: Math.max(0, Math.round(state.clock || 0)), per: state.period === "ot" ? "o" : "r", tie: state.tie ? 1 : 0,
  };
  if (events && events.length) msg.ev = events.slice(0, 8);
  return msg;
}
