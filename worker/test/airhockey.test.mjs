// Names, Elo, and authoritative physics. No network.
import assert from "node:assert/strict";
import {validateUsername, normalizeName} from "../src/airhockey-names.js";
import {elo, eloPoints, START_RATING} from "../src/airhockey-elo.js";
import {createGame, expireClock, packState, setTarget, step, viewToWorld, W, H, PR, WALL, PADDLE_SPEED, REG_MS, OT_MS} from "../src/airhockey-physics.js";

assert.equal(validateUsername("ab").error.includes("3–16"), true);
assert.equal(validateUsername("this_name_is_too_long").error.includes("3–16"), true);
assert.equal(validateUsername("bad name").error.includes("3–16"), true);
assert.equal(validateUsername("admin").error, "Pick a different username.");
assert.equal(validateUsername("OilersFan").error, "Pick a different username.");
assert.equal(validateUsername("copperandblue").error, "Pick a different username.");
assert.equal(validateUsername("a_dmin").error, "Pick a different username.");
assert.equal(validateUsername("f0ck").error, "Pick a different username.");
assert.equal(validateUsername("___").error.includes("3–16"), true);
const ok = validateUsername("Rink_Ace");
assert.equal(ok.username, "Rink_Ace");
assert.equal(ok.key, normalizeName("Rink_Ace"));

const even = elo(START_RATING, START_RATING);
assert.equal(even.winner, 1016);
assert.equal(even.loser, 984);
assert.ok(elo(100, 2000).loser >= 100);

const shot = createGame(() => 0.5);
shot.phase = "playing";
shot.puck.x = W / 2;
shot.puck.y = 30;
shot.puck.vx = 0;
shot.puck.vy = -500;
const events = [];
for (let i = 0; i < 40 && shot.score.south === 0; i++) step(shot, 1 / 60, events);
assert.equal(shot.score.south, 1);
assert.equal(events.some(e => e.k === "g" && e.s === "s"), true);

setTarget(shot, "south", 10, 10);
assert.ok(shot.south.ty >= H / 2 + PR + 10, "south paddle stays in the bottom half");
assert.ok(shot.south.tx >= WALL + PR);
const world = viewToWorld("north", 100, 500);
setTarget(shot, "north", world.x, world.y);
assert.ok(shot.north.ty <= H / 2 - PR - 10, "north paddle stays in the top half");

const speed = createGame();
speed.phase = "playing";
speed.south.tx = W - WALL - PR;
const before = speed.south.x;
step(speed, 1 / 60, []);
assert.ok(speed.south.x - before <= PADDLE_SPEED / 60 + 0.01);

assert.equal(REG_MS, 120000);
assert.equal(OT_MS, 60000);
const level = createGame();
level.phase = "playing";
level.score.south = 2;
level.score.north = 2;
level.clock = 0;
assert.equal(expireClock(level), "ot");
assert.equal(level.period, "ot");
assert.equal(level.clock, OT_MS);
assert.equal(level.phase, "faceoff");
level.phase = "playing";
level.clock = 0;
assert.equal(expireClock(level), "tie");
assert.equal(level.tie, true);
assert.equal(level.winner, null);
const ahead = createGame();
ahead.score.south = 3;
ahead.score.north = 1;
assert.equal(expireClock(ahead), "final");
assert.equal(ahead.winner, "south");
assert.equal(ahead.phase, "over");
const tied = eloPoints(1000, 1000, 0.5);
assert.equal(tied.a, 1000);
assert.equal(tied.b, 1000);
assert.equal(elo(1000, 1000).winner, 1016);

const intro = createGame();
intro.phase = "versus";
intro.timer = 3;
intro.clock = REG_MS;
let introT = 0;
while (intro.phase === "versus" && introT < 5) {
  step(intro, 1 / 120, []);
  step(intro, 1 / 120, []);
  introT += 1 / 60;
}
assert.ok(Math.abs(introT - 3) < 0.05, "VS intro is 3 seconds, got " + introT);
assert.equal(intro.phase, "faceoff");
assert.equal(intro.clock, REG_MS);
assert.equal(packState(intro, []).ph, "f");
intro.phase = "versus";
assert.equal(packState(intro, []).ph, "v");

console.log("airhockey unit pass");
