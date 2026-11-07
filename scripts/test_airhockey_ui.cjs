// UI-controller tests in a synthetic DOM. No browser automation, rendering engine, accounts or real sharing.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/play.js'),'utf8');
function setup({search='',storageDenied=false}={}) {
 const events={},windowEvents={},frames=new Map(),nodes={},writes=[],shares=[];let seq=0,draws=0,time=1;
 const list=()=>{const s=new Set();return {add:k=>s.add(k),remove:k=>s.delete(k),contains:k=>s.has(k)};};
 const gradient={addColorStop(){}};
 const ctx=new Proxy({},{get(_,k){if(k==='createLinearGradient'||k==='createRadialGradient')return()=>gradient;if(k==='drawImage')return()=>draws++;return()=>{};},set(){return true;}});
 const document={hidden:false,fullscreenElement:null,body:{classList:list()},documentElement:{classList:list()},activeElement:null,
  addEventListener(k,fn){(events[k]??=[]).push(fn);},getElementById(id){return nodes[id]??=node(id);},createElement(){return {width:1,height:1,getContext:()=>ctx};}};
 function node(id){return {id,hidden:['pongArena','pongPanel','newGame','shareGame'].includes(id),textContent:'',value:id==='playMood'?'normal':'',disabled:false,style:{},listeners:{},
  getContext:()=>ctx,getBoundingClientRect:()=>({width:400,height:660,left:10,top:80}),setAttribute(){},focus(){document.activeElement=this;},setPointerCapture(){},
  addEventListener(k,fn){this.listeners[k]=fn;},querySelectorAll(){return ['resumeGame','againGame','shareGame','panelExit'].map(id=>document.getElementById(id));}};}
 const c={document,location:{search},navigator:{clipboard:{async writeText(text){shares.push(text);}}},screen:{orientation:{lock:()=>Promise.reject(Error('unsupported')),unlock(){}}},
  localStorage:{getItem(){if(storageDenied)throw Error('storage denied');return null;},setItem(k,v){if(storageDenied)throw Error('storage denied');writes.push({k,v});}},
  devicePixelRatio:3,scrollY:12,scrollTo(){},URLSearchParams,console,
  requestAnimationFrame(fn){const id=++seq;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);},
  addEventListener(k,fn){(windowEvents[k]??=[]).push(fn);},ResizeObserver:class{observe(){}}};
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
 console.log('AIRHOCKEY UI PASS: DPR, immersive fallback, native-fullscreen exit, Esc, pause/resume/restart, hidden-tab stop with explicit resume, zero idle RAF, genuine win/loss screens, exact share text, denied-storage recovery and best-win/streak persistence logic.');
})().catch(e=>{console.error(e);process.exitCode=1;});
