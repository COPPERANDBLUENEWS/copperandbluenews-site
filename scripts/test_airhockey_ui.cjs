// UI-controller tests in a synthetic DOM. No browser automation, rendering engine, accounts or real sharing.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/play.js'),'utf8');
function setup({search='',storageDenied=false,storage=null,AudioContext=null,media=false}={}) {
 const events={},windowEvents={},frames=new Map(),nodes={},writes=[],shares=[];let seq=0,draws=0,time=1;
 const list=()=>{const s=new Set();return {add:k=>s.add(k),remove:k=>s.delete(k),contains:k=>s.has(k)};};
 const gradient={addColorStop(){}};
 const ctx=new Proxy({},{get(_,k){if(k==='createLinearGradient'||k==='createRadialGradient')return()=>gradient;if(k==='drawImage')return()=>draws++;return()=>{};},set(){return true;}});
 const document={hidden:false,fullscreenElement:null,body:{classList:list()},documentElement:{classList:list()},activeElement:null,
  addEventListener(k,fn){(events[k]??=[]).push(fn);},getElementById(id){return nodes[id]??=node(id);},createElement(){return {width:1,height:1,getContext:()=>ctx};}};
 function node(id){const n={id,hidden:['pongArena','pongPanel','newGame','shareGame'].includes(id),textContent:'',value:id==='playMood'?'normal':'',disabled:false,style:{},listeners:{},
  getContext:()=>ctx,getBoundingClientRect:()=>({width:400,height:660,left:10,top:80}),attrs:{},setAttribute(k,v){this.attrs[k]=v;},focus(){document.activeElement=this;},setPointerCapture(){},
  addEventListener(k,fn){this.listeners[k]=fn;},querySelectorAll(){return ['resumeGame','againGame','shareGame','panelExit'].map(id=>document.getElementById(id));}};
  if(media&&['goalHorn','copperAww','puckClack','boardThud'].includes(id)){n.plays=[];n.volume=1;n.currentTime=0;n.muted=false;n.src='audio/'+id+'.wav';n.play=function(){this.plays.push({muted:this.muted,volume:this.volume});return Promise.resolve();};n.pause=function(){};}
  return n;}
 const c={document,location:{search},screen:{orientation:{lock:()=>Promise.reject(Error('unsupported')),unlock(){}}},
  localStorage:{getItem(k){if(storageDenied)throw Error('storage denied');if(!storage||!Object.prototype.hasOwnProperty.call(storage,k))return null;return storage[k];},setItem(k,v){if(storageDenied)throw Error('storage denied');writes.push({k,v});if(storage)storage[k]=String(v);}},
  navigator:{clipboard:{async writeText(text){shares.push(text);}},audioSession:{type:'ambient'}},
  devicePixelRatio:3,scrollY:12,scrollTo(){},URLSearchParams,console,
  requestAnimationFrame(fn){const id=++seq;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);},
  addEventListener(k,fn){(windowEvents[k]??=[]).push(fn);},ResizeObserver:class{observe(){}},AudioContext,webkitAudioContext:AudioContext};
 c.window=c;vm.runInNewContext(source,c);
 const click=id=>nodes[id].listeners.click({}),emit=(type,data={})=>(events[type]||[]).forEach(fn=>fn({preventDefault(){},...data}));
 function pump(n=1){for(let i=0;i<n;i++){const item=frames.entries().next().value;if(!item)break;frames.delete(item[0]);time+=1000/60;item[1](time);}}
 return {c,nodes,writes,shares,click,emit,pump,frames,get draws(){return draws;}};
}
(async()=>{
 let t=setup();assert.equal(t.nodes.pongArena.hidden,true);t.click('startGame');assert.equal(t.nodes.pongArena.hidden,false);assert.ok(t.c.document.body.classList.contains('rink-immersive'));assert.ok(t.c.document.documentElement.classList.contains('rink-lock'));assert.ok(t.nodes.pongCanvas.width>600,'DPR scaling applied');t.pump(180);assert.ok(t.draws>150);
 t.click('pauseGame');assert.equal(t.nodes.pongPanel.hidden,false);t.pump(2);assert.equal(t.frames.size,0,'paused match stops render loop');t.click('resumeGame');assert.equal(t.nodes.pongPanel.hidden,true);assert.equal(t.frames.size,1);t.pump(2);
 t.c.document.hidden=true;t.emit('visibilitychange');assert.equal(t.frames.size,0);assert.equal(t.nodes.pongPanel.hidden,false);t.c.document.hidden=false;t.emit('visibilitychange');t.pump(1);assert.equal(t.nodes.pongPanel.hidden,false,'visible again does not auto-resume');t.click('resumeGame');assert.equal(t.frames.size,1);
 t.emit('keydown',{key:'Escape'});assert.ok(!t.c.document.body.classList.contains('rink-immersive'));assert.equal(t.nodes.pongArena.hidden,true);assert.equal(t.frames.size,0);assert.equal(t.nodes.startGame.textContent,'Resume match');assert.equal(t.writes.length,0);
 t.click('startGame');assert.equal(t.nodes.pongPanel.hidden,false);t.click('resumeGame');t.click('restartGame');assert.equal(t.nodes.panelTitle.textContent,'Fresh ice?');t.click('againGame');assert.equal(t.nodes.youScore.textContent,0);assert.equal(t.nodes.copperScore.textContent,0);assert.equal(t.nodes.pongPanel.hidden,true);
 // Native fullscreen exit also restores the site and pauses. The iPhone fallback above needs no API.
 t.c.document.fullscreenElement=t.nodes.pongArena;t.emit('fullscreenchange');t.c.document.fullscreenElement=null;t.emit('fullscreenchange');assert.equal(t.nodes.pongArena.hidden,true);
 // A genuine deterministic demo win exercises the result screen/share text, but never stores a fabricated user record.
 t=setup({search:'?demo=1&seed=2&at=300',storageDenied:true});assert.equal(t.nodes.youScore.textContent,7);assert.equal(t.nodes.copperScore.textContent,5);assert.equal(t.nodes.panelTitle.textContent,'You beat Copper!');assert.equal(t.nodes.shareGame.hidden,false);assert.equal(t.writes.length,0);t.pump(1);assert.equal(t.frames.size,0,'finished matches stop render loop');await t.click('shareGame');assert.equal(t.shares[0],'I beat Copper 7-5 in AirHockey with Copper on copperandbluenews.com 🏒');assert.equal(t.nodes.shareStatus.textContent,'Score copied!');
 // CPU loss screen is also a real simulated result (seed 1), not a forced score.
 t=setup({search:'?demo=1&seed=1&at=300'});assert.equal(t.nodes.copperScore.textContent,7);assert.equal(t.nodes.panelTitle.textContent,'Copper takes this one!');assert.equal(t.writes.length,0);
 const {updateRecord}=require('../js/play.js');let r={wins:0,losses:0,streak:0,bestStreak:0,bestWin:null};
 r=updateRecord(r,{you:7,copper:3},'you','normal');assert.equal(r.wins,1);assert.equal(r.bestWin.copper,3);r=updateRecord(r,{you:7,copper:1},'you','hard');assert.equal(r.streak,2);assert.equal(r.bestStreak,2);assert.equal(r.bestWin.copper,1);r=updateRecord(r,{you:4,copper:7},'copper','hard');assert.equal(r.streak,0);assert.equal(r.bestStreak,2);assert.equal(r.losses,1);
 function makeAudio(){
  const oscs=[];
  class Param{constructor(){this.value=0;this.events=[];}setValueAtTime(v,t){this.value=v;this.events.push(v);}linearRampToValueAtTime(v){this.events.push(v);}exponentialRampToValueAtTime(v){this.events.push(v);}cancelScheduledValues(){}}
  class Node{connect(){return this;}disconnect(){}}
  class Gain extends Node{constructor(){super();this.gain=new Param();}}
  class Filter extends Node{constructor(){super();this.frequency=new Param();this.Q=new Param();}}
  class Osc extends Node{constructor(){super();this.frequency=new Param();this.type='sine';oscs.push(this);}start(t){this.t0=t;}stop(t){this.t1=t;}}
  function Ctx(){this.state='suspended';this.currentTime=0;this.sampleRate=44100;this.destination={};this.resumed=0;this.oscs=oscs;Ctx.latest=this;}
  Ctx.prototype.resume=function(){this.resumed++;this.state='running';return Promise.resolve();};
  Ctx.prototype.createGain=()=>new Gain();
  Ctx.prototype.createOscillator=()=>new Osc();
  Ctx.prototype.createBiquadFilter=()=>new Filter();
  Ctx.prototype.createWaveShaper=()=>new Node();
  Ctx.prototype.createDelay=()=>Object.assign(new Node(),{delayTime:new Param()});
  Ctx.prototype.createBuffer=()=>({});
  Ctx.prototype.createBufferSource=()=>({connect(){},start(){},buffer:null});
  return {Ctx,oscs};
 }
 const heard=makeAudio();
 t=setup({search:'?demo=1&seed=2&at=3.4&hold=1',AudioContext:heard.Ctx});
 assert.equal(t.frames.size,0,'hold freezes the demo frame');
 assert.equal(t.nodes.youScore.textContent,1);assert.equal(t.nodes.copperScore.textContent,0);
 assert.equal(t.nodes.goalBanner.hidden,false);assert.equal(t.nodes.goalBanner.className,'goal-banner goal-flash');
 assert.equal(t.nodes.soundLabel.textContent,'Mute');assert.equal(t.nodes.soundGame.attrs['aria-pressed'],'true');
 assert.equal(heard.oscs.length,6,'player goal plays the six-layer horn');
 for(const o of heard.oscs){assert.ok(o.frequency.value>=100&&o.frequency.value<=200);assert.ok(o.t1-o.t0>2.5&&o.t1-o.t0<3.05);}
 assert.ok(heard.oscs.some(o=>o.type==='sawtooth')&&heard.oscs.some(o=>o.type==='square'));
 t.click('soundGame');assert.equal(t.nodes.soundLabel.textContent,'Unmute');assert.equal(t.writes.at(-1).k,'cbn-airhockey-horn');assert.equal(t.writes.at(-1).v,'off');
 assert.equal(t.nodes.soundGame.attrs['aria-label'],'Unmute rink sounds');
 assert.equal(heard.Ctx.latest.state,'running');assert.equal(heard.Ctx.latest._cbnPrimed,true);
 const copper=makeAudio();
 t=setup({search:'?demo=1&seed=2&at=7.2',AudioContext:copper.Ctx});
 const long=copper.oscs.filter(o=>o.t1-o.t0>2.5),short=copper.oscs.filter(o=>o.t1-o.t0<1);
 assert.equal(long.length,6,'only the player goal gets the long horn');assert.equal(short.length,1,'Copper gets one short low tone');
 assert.equal(short[0].type,'triangle');assert.ok(short[0].frequency.value<=180&&short[0].frequency.value>=90);
 assert.equal(t.nodes.goalBanner.hidden,true,'Copper goals do not raise the player banner');
 const saved={'cbn-airhockey-horn':'off'};
 const muted=makeAudio();
 t=setup({search:'?demo=1&seed=2&at=3.4&hold=1',storage:saved,AudioContext:muted.Ctx});
 assert.equal(muted.oscs.length,0,'a remembered mute skips the horn');
 assert.equal(t.nodes.soundLabel.textContent,'Unmute');assert.equal(t.nodes.goalBanner.hidden,false);
 t.click('soundGame');assert.equal(saved['cbn-airhockey-horn'],'on');assert.equal(t.nodes.soundLabel.textContent,'Mute');
 const again=setup({storage:saved});assert.equal(again.nodes.soundLabel.textContent,'Mute');
 function loud(node){return (node.plays||[]).filter(p=>!p.muted);}
 const ios=setup({search:'?demo=1&seed=2&at=3.4&hold=1',media:true});
 assert.equal(ios.c.navigator.audioSession.type,'playback');
 assert.equal(ios.nodes.soundLabel.textContent,'Mute','horn stays on unless the player mutes it');
 assert.equal(loud(ios.nodes.goalHorn).length,1,'a player goal plays the HTML horn');
 assert.ok(loud(ios.nodes.goalHorn)[0].volume>=.7&&loud(ios.nodes.goalHorn)[0].volume<=.9);
 assert.ok(loud(ios.nodes.puckClack).length>=1&&loud(ios.nodes.puckClack).length<=4,'paddle clacks are throttled');
 assert.ok(loud(ios.nodes.boardThud).length>=1&&loud(ios.nodes.boardThud).length<=4,'board thuds are throttled');
 for(const p of loud(ios.nodes.puckClack))assert.ok(p.volume>=.16&&p.volume<=.72);
 for(const p of loud(ios.nodes.boardThud))assert.ok(p.volume>=.1&&p.volume<=.4);
 let prevented=false;
 ios.nodes.pongCanvas.listeners.touchstart({preventDefault(){prevented=true;}});
 assert.equal(prevented,false,'rink touchstart does not cancel the gesture');
 prevented=false;
 ios.nodes.pongCanvas.listeners.pointerdown({pointerType:'touch',pointerId:3,button:0,clientX:20,clientY:30,preventDefault(){prevented=true;}});
 assert.equal(prevented,false,'touch pointerdown does not call preventDefault');
 prevented=false;
 ios.nodes.pongCanvas.listeners.pointerdown({pointerType:'mouse',pointerId:4,button:0,clientX:20,clientY:30,preventDefault(){prevented=true;}});
 assert.equal(prevented,true);
 assert.equal(typeof ios.nodes.startGame.listeners.touchstart,'function');
 assert.equal(typeof ios.nodes.pongArena.listeners.touchstart,'function');
 const copperTone=setup({search:'?demo=1&seed=2&at=7.2&hold=1',media:true});
 assert.ok(loud(copperTone.nodes.copperAww).length>=1);
 assert.equal(copperTone.nodes.goalBanner.hidden,true);
 const quiet=setup({search:'?demo=1&seed=2&at=3.4&hold=1',media:true,storage:{'cbn-airhockey-horn':'off'}});
 assert.equal(loud(quiet.nodes.goalHorn).length,0);
 assert.equal(loud(quiet.nodes.puckClack).length,0);
 assert.equal(loud(quiet.nodes.boardThud).length,0);
 assert.equal(loud(quiet.nodes.copperAww).length,0);
 const fallback=setup();
 assert.equal(typeof fallback.c.CopperAirHockey.playCopper,'function');
 assert.equal(fallback.nodes.pongArena.hidden,true);
 assert.equal(fallback.c.CopperAirHockey.playCopper('No one else is online. This is Copper, the computer. It does not change your online record.'),true);
 assert.equal(fallback.nodes.pongArena.hidden,false);
 assert.match(fallback.nodes.arenaMood.textContent,/computer/);
 assert.match(fallback.nodes.arenaComment.textContent,/Copper, the computer/);
 assert.match(fallback.nodes.gameLive.textContent,/online record/);
 assert.equal(fallback.nodes.oppLabel.textContent,'COPPER');
 assert.equal(fallback.nodes.youLabel.textContent,'YOU');
 assert.equal(fallback.nodes.scoreClock.hidden,true);
 assert.equal(fallback.c.document.body.classList.contains('ah-online'),false);
 assert.equal(fallback.c.CopperAirHockey.playCopper('again'),false,'a Copper game already on the ice is not started twice');
 console.log('AIRHOCKEY UI PASS: DPR, immersive fallback, native-fullscreen exit, Esc, pause/resume/restart, hidden-tab stop with explicit resume, zero idle RAF, genuine win/loss screens, exact share text, denied-storage recovery, best-win/streak persistence, goal horn, Copper tone, mute memory and goal banner.');
})().catch(e=>{console.error(e);process.exitCode=1;});
