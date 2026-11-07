// Pure Node tests: real circular physics, no network, browser accounts or user storage.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');const {create,seeded,MOODS,withinRink,pointerTarget,constants:C}=require('../js/play.js');
const tick=g=>g.step(C.STEP),active=(opts={})=>{const g=create({rng:seeded(42),...opts});g.state.phase='playing';return g;};
let g=create({rng:seeded(42)});assert.equal(g.state.phase,'faceoff');for(let i=0;i<120;i++)tick(g);assert.equal(g.state.phase,'playing');assert.ok(Math.hypot(g.state.puck.vx,g.state.puck.vy)>200);
assert.equal(C.PR,34);assert.ok(C.PR/21>=1.5&&C.PR/21<=1.75,'round paddles 1.5–1.75x the original radius');
g.target(-500,-500);for(let i=0;i<120;i++)tick(g);assert.ok(g.state.you.x>=C.WALL+C.PR);assert.ok(g.state.you.y>=C.H/2+C.PR);
g.target(10000,10000);for(let i=0;i<120;i++)tick(g);assert.ok(g.state.you.x<=C.W-C.WALL-C.PR);assert.ok(g.state.you.y<=C.H-C.WALL-C.PR);
// Gentle 24 CSS px finger offset replaces the stick-only 38px offset; mouse is direct.
const box={left:0,top:0,width:C.W,height:C.H};assert.deepEqual(pointerTarget(180,500,box,true),{x:180,y:476});assert.deepEqual(pointerTarget(180,500,box,false),{x:180,y:500});
// Boards, end walls, and the actual rounded corners all reflect. Outside the mouth never counts.
g=active();Object.assign(g.state.puck,{x:23,y:310,vx:-400,vy:0});tick(g);assert.ok(g.state.puck.vx>0);assert.equal(g.state.goals,0);
g=active();Object.assign(g.state.puck,{x:60,y:23,vx:0,vy:-400});tick(g);assert.ok(g.state.puck.vy>0);assert.equal(g.state.goals,0);
g=active();Object.assign(g.state.puck,{x:330,y:590,vx:140,vy:900});tick(g);assert.ok(g.state.puck.vx < -500,'rounded corner redirects vertical board corridor');assert.ok(withinRink(g.state.puck.x,g.state.puck.y));
// Circular perimeter: both head-on and side contacts match the visible 34-unit radius.
g=active();Object.assign(g.state.puck,{x:180,y:g.state.you.y-C.PR-C.R+1,vx:0,vy:300});tick(g);assert.ok(g.state.puck.vy<0);
let paddleHits=[];g=active({onPaddle(s){paddleHits.push(s);}});Object.assign(g.state.puck,{x:180,y:g.state.you.y-C.PR-C.R+1,vx:0,vy:140});tick(g);const soft=paddleHits[0];
paddleHits=[];g=active({onPaddle(s){paddleHits.push(s);}});Object.assign(g.state.puck,{x:180,y:g.state.you.y-C.PR-C.R+1,vx:0,vy:700});tick(g);assert.ok(soft>30&&paddleHits[0]>soft,'harder contact reports a higher hit speed');
let boardHits=[];g=active({onBoard(s){boardHits.push(s);}});Object.assign(g.state.puck,{x:23,y:310,vx:-520,vy:0});tick(g);assert.ok(boardHits[0]>400,'board hits report incoming speed');
g=active();Object.assign(g.state.puck,{x:g.state.you.x+C.PR+C.R-1,y:g.state.you.y,vx:-300,vy:0});tick(g);assert.ok(g.state.puck.vx>0,'side perimeter collides');
// A diagonal outside the circle does not hit an invisible square or legacy stick shaft.
g=active();Object.assign(g.state.puck,{x:g.state.you.x+36,y:g.state.you.y-36,vx:0,vy:150});tick(g);assert.ok(g.state.puck.vy>0,'no square collision outside the circular outline');
g=active();Object.assign(g.state.puck,{x:g.state.you.x-20,y:g.state.you.y+60,vx:0,vy:-180});tick(g);assert.ok(g.state.puck.vy<0,'legacy stick shaft is gone');
// Centre-overlap recovery is finite and separates beyond the circular radius.
g=active();Object.assign(g.state.puck,{x:g.state.you.x,y:g.state.you.y,vx:0,vy:100});tick(g);assert.ok(Math.hypot(g.state.puck.x-g.state.you.x,g.state.puck.y-g.state.you.y)>=C.PR+C.R);
// A moving mallet imparts extra velocity, with the original max-speed cap.
const a=active(),b=active();for(const v of [a,b])Object.assign(v.state.puck,{x:180,y:v.state.you.y-C.PR-C.R-2,vx:0,vy:300});b.target(180,b.state.you.y-80);for(let i=0;i<3;i++){tick(a);tick(b);}assert.ok(Math.abs(b.state.puck.vy)>Math.abs(a.state.puck.vy));
let goals=0,finishes=0;g=active({onGoal(){goals++;},onFinish(){finishes++;}});Object.assign(g.state.puck,{x:180,y:7,vx:0,vy:-400});tick(g);assert.equal(g.state.score.you,1);assert.equal(goals,1);for(let i=0;i<80;i++)tick(g);assert.equal(goals,1);
g=active();Object.assign(g.state.puck,{x:180,y:C.H-7,vx:0,vy:400});tick(g);assert.equal(g.state.score.copper,1);
g=active({onFinish(){finishes++;}});g.state.score.you=6;Object.assign(g.state.puck,{x:180,y:7,vx:0,vy:-400});tick(g);assert.equal(g.state.phase,'over');assert.equal(g.state.winner,'you');assert.equal(finishes,1);for(let i=0;i<200;i++)tick(g);assert.equal(g.state.score.you,7);assert.equal(finishes,1);
g=active();g.pause(true);const before=JSON.stringify(g.state);for(let i=0;i<600;i++)tick(g);assert.equal(JSON.stringify(g.state),before);g.pause(false);
// A mathematically flat centre-lane orbit gets a neutral faceoff, not a fabricated goal.
let frozen=0;g=active({onFreeze(){frozen++;}});Object.assign(g.state.puck,{x:180,y:C.H/2,vx:130,vy:0});for(let i=0;i<360;i++)tick(g);assert.ok(frozen>0);assert.equal(g.state.goals,0);
const wins={easy:0,normal:0,hard:0},durations=[],seeds=80;let neutralFaceoffs=0;
for(const difficulty of Object.keys(MOODS))for(let seed=1;seed<=seeds;seed++){
 let emitted=0,ended=0;const match=create({difficulty,demo:true,rng:seeded(seed),onGoal(){emitted++;},onFinish(){ended++;},onFreeze(){neutralFaceoffs++;}});
 for(let i=0;i<120*600&&match.state.phase!=='over';i++){
  tick(match);const s=match.state,p=s.puck;
  assert.ok(Number.isFinite(p.x+p.y+p.vx+p.vy));assert.ok(Math.hypot(p.vx,p.vy)<=C.MAX+.001);
  assert.ok(s.you.y>=C.H/2+C.PR&&s.copper.y<=C.H/2-C.PR);
  assert.ok(s.you.x>=C.WALL+C.PR&&s.you.x<=C.W-C.WALL-C.PR);
  if(s.phase==='playing')assert.ok(withinRink(p.x,p.y),`${difficulty} ${seed} puck stays inside curved boards`);
  for(const body of [s.you,s.copper]){
    assert.ok(body.x-C.PR>=C.WALL-.01&&body.x+C.PR<=C.W-C.WALL+.01);
    assert.ok(body.bottom?body.y-C.PR>=C.H/2:body.y+C.PR<=C.H/2,'whole circle stays in its half');
  }
 }
 const s=match.state;assert.equal(s.phase,'over',`${difficulty} seed ${seed} must finish without a stuck puck`);assert.equal(Math.max(s.score.you,s.score.copper),7);assert.equal(ended,1);assert.equal(emitted,s.score.you+s.score.copper);
 if(s.winner==='you')wins[difficulty]++;durations.push(s.time);
}
assert.ok(wins.easy>wins.normal&&wins.normal>wins.hard,'sensible difficulty spread');assert.ok(wins.hard>0,'Playoff Copper is beatable');
const html=fs.readFileSync(path.join(root,'play.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8'),js=fs.readFileSync(path.join(root,'js/play.js'),'utf8');
assert.match(html,/<h1>AirHockey with Copper<\/h1>/);assert.match(html,/YOU <b id="youScore"/);assert.match(html,/COPPER <b id="copperScore"/);assert.ok(!/Rink Pong/i.test(html+js));
assert.ok(js.includes(' in AirHockey with Copper on copperandbluenews.com 🏒'));assert.ok(js.includes('requestFullscreen'));assert.ok(js.includes('visibilitychange'));assert.ok(js.includes('screen.orientation'));
const version=sw.match(/const VERSION = "cbn-v(\d+)"/)[1];assert.ok(sw.includes('"/play.html"')&&sw.includes(`"/js/play.js?v=${version}"`)&&sw.includes(`"/copper.svg?v=${version}"`));
for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.html'))){const s=fs.readFileSync(path.join(root,file),'utf8');assert.ok(s.includes('href="play.html">AirHockey</a>'),file+' More link');for(const m of s.matchAll(/\?v=(\d+)/g))assert.equal(m[1],version,file+' current asset version');}
console.log(`AIRHOCKEY ROUND PADDLES PASS: ${seeds*3} real seeded matches all end at 7, one finish each; no NaNs/speed-cap/curved-board/half-rink violations. Normal-autoplay wins: Rookie ${wins.easy}/${seeds}, Copper ${wins.normal}/${seeds}, Playoff ${wins.hard}/${seeds}. Durations ${Math.round(Math.min(...durations))}–${Math.round(Math.max(...durations))}s; ${neutralFaceoffs} neutral pin-release faceoffs, never extra goals. Circular perimeter, no invisible square/stick, momentum transfer, pointer offset, pause and offline/nav tests pass.`);
for(const seed of [1,2,5]){const m=create({difficulty:'normal',demo:true,rng:seeded(seed)});for(let i=0;i<300/C.STEP&&m.state.phase!=='over';i++)tick(m);console.log('Capture seed='+seed+' at=300',JSON.stringify({phase:m.state.phase,score:m.state.score,winner:m.state.winner,time:Math.round(m.state.time)}));}
