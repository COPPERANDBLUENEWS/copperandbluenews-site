// Pure Node physics and markup tests. No network, subscribers, browser sessions or user storage.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');const {create,seeded,MOODS,constants:C}=require('../js/play.js');
const tick=g=>g.step(C.STEP),active=(opts={})=>{const g=create({rng:seeded(42),...opts});g.state.phase='playing';return g;};
// Centre serves, bounded paddles and half-rink enforcement.
let g=create({rng:seeded(42)});assert.equal(g.state.phase,'faceoff');for(let i=0;i<120;i++)tick(g);assert.equal(g.state.phase,'playing');assert.ok(Math.hypot(g.state.puck.vx,g.state.puck.vy)>200);
g.target(-500,-500);for(let i=0;i<120;i++)tick(g);assert.ok(g.state.you.x>=C.WALL+C.PR);assert.ok(g.state.you.y>=C.H/2+C.PR);
g.target(10000,10000);for(let i=0;i<120;i++)tick(g);assert.ok(g.state.you.x<=C.W-C.WALL-C.PR);assert.ok(g.state.you.y<=C.H-C.WALL-C.PR);
// Boards bounce, non-mouth end walls cannot count goals.
g=active();Object.assign(g.state.puck,{x:23,y:310,vx:-400,vy:0});tick(g);assert.ok(g.state.puck.vx>0);assert.equal(g.state.goals,0);
g=active();Object.assign(g.state.puck,{x:60,y:23,vx:0,vy:-400});tick(g);assert.ok(g.state.puck.vy>0);assert.equal(g.state.goals,0);
// Incoming puck reflects from a stationary human paddle; moving paddle transfers velocity.
g=active();Object.assign(g.state.puck,{x:180,y:g.state.you.y-28,vx:0,vy:300});tick(g);assert.ok(g.state.puck.vy<0);
const a=active(),b=active();for(const v of [a,b])Object.assign(v.state.puck,{x:180,y:v.state.you.y-32,vx:0,vy:300});b.target(180,b.state.you.y-80);for(let i=0;i<3;i++){tick(a);tick(b);}assert.ok(Math.abs(b.state.puck.vy)>Math.abs(a.state.puck.vy));
// Real mouth crossings count exactly once; freeze/faceoff prevents duplicate scores.
let goals=0,finishes=0;g=active({onGoal(){goals++;},onFinish(){finishes++;}});
Object.assign(g.state.puck,{x:180,y:7,vx:0,vy:-400});tick(g);assert.equal(g.state.score.you,1);assert.equal(goals,1);for(let i=0;i<80;i++)tick(g);assert.equal(goals,1);
g=active();Object.assign(g.state.puck,{x:180,y:C.H-7,vx:0,vy:400});tick(g);assert.equal(g.state.score.copper,1);
// First to seven is terminal, with one finish callback and no eighth goal.
g=active({onFinish(){finishes++;}});g.state.score.you=6;Object.assign(g.state.puck,{x:180,y:7,vx:0,vy:-400});tick(g);assert.equal(g.state.phase,'over');assert.equal(g.state.winner,'you');assert.equal(finishes,1);for(let i=0;i<200;i++)tick(g);assert.equal(g.state.score.you,7);assert.equal(finishes,1);
// Pause does not move anything, including timers, AI or score.
g=active();g.pause(true);const before=JSON.stringify(g.state);for(let i=0;i<600;i++)tick(g);assert.equal(JSON.stringify(g.state),before);g.pause(false);
// Reproduce the original corner-pin bug; puck stays in bounds and escapes rather than freezing.
g=active();Object.assign(g.state.copper,{x:35,y:35,tx:35,ty:35});Object.assign(g.state.puck,{x:22,y:22,vx:0,vy:-115});for(let i=0;i<240;i++)tick(g);assert.ok(Math.hypot(g.state.puck.x-22,g.state.puck.y-22)>10);
const wins={easy:0,normal:0,hard:0},durations=[],seeds=40;
for(const difficulty of Object.keys(MOODS))for(let seed=1;seed<=seeds;seed++){
 let emitted=0,ended=0;const match=create({difficulty,demo:true,rng:seeded(seed),onGoal(){emitted++;},onFinish(){ended++;}});
 for(let i=0;i<120*600&&match.state.phase!=='over';i++){
  tick(match);const s=match.state,p=s.puck;
  assert.ok(Number.isFinite(p.x+p.y+p.vx+p.vy));assert.ok(Math.hypot(p.vx,p.vy)<=C.MAX+.001);
  assert.ok(s.you.y>=C.H/2+C.PR && s.copper.y<=C.H/2-C.PR);
  assert.ok(s.you.x>=C.WALL+C.PR&&s.you.x<=C.W-C.WALL-C.PR);
 }
 const s=match.state;assert.equal(s.phase,'over',`${difficulty} seed ${seed} must finish without a stuck puck`);assert.equal(Math.max(s.score.you,s.score.copper),7);assert.equal(ended,1);assert.equal(emitted,s.score.you+s.score.copper);
 if(s.winner==='you')wins[difficulty]++;durations.push(s.time);
}
assert.ok(wins.easy>wins.hard,'hard is stronger than rookie');assert.ok(wins.hard>0,'hard is still beatable');
const html=fs.readFileSync(path.join(root,'play.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8'),js=fs.readFileSync(path.join(root,'js/play.js'),'utf8');
assert.match(html,/<h1>AirHockey with Copper<\/h1>/);assert.match(html,/YOU <b id="youScore"/);assert.match(html,/COPPER <b id="copperScore"/);assert.ok(!/Rink Pong/i.test(html+js));
assert.ok(js.includes(' in AirHockey with Copper on copperandbluenews.com 🏒'));assert.ok(js.includes('requestFullscreen'));assert.ok(js.includes('visibilitychange'));assert.ok(js.includes('screen.orientation'));
assert.ok(sw.includes('"/play.html"')&&sw.includes('"/js/play.js?v=37"')&&sw.includes('"/copper.svg?v=37"'));
for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.html'))){const s=fs.readFileSync(path.join(root,file),'utf8');assert.ok(s.includes('href="play.html">AirHockey</a>'),file+' More link');assert.ok(!s.includes('?v=36'),file+' bumped cache');}
console.log(`AIRHOCKEY PASS: ${seeds*3} seeded real matches end at 7, one finish each, no duplicated goals/NaNs/cap violations/stuck corners. Normal-autoplay wins: Rookie ${wins.easy}/${seeds}, Copper ${wins.normal}/${seeds}, Playoff ${wins.hard}/${seeds}. Match lengths ${Math.round(Math.min(...durations))}–${Math.round(Math.max(...durations))} simulated seconds. Board/mouth/paddle/velocity/pause/half-rink/nav/offline/name tests pass.`);
// Stable QA capture timestamps/score evidence, without fabricated scores.
for(const seconds of [8,15,180]){const m=create({difficulty:'normal',demo:true,rng:seeded(2)});for(let i=0;i<seconds/C.STEP&&m.state.phase!=='over';i++)tick(m);console.log('Demo seed=2 at='+seconds,JSON.stringify({phase:m.state.phase,score:m.state.score,winner:m.state.winner}));}
