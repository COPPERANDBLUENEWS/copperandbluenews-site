import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {gameEvents, addOdds, oddsGame} from '../src/game-events.js';
import {GameAlerts, eligibleGame} from '../src/game-alerts.js';
import * as store from '../src/store.js';
import worker from '../src/index.js';
const fixture = JSON.parse(fs.readFileSync(new URL('../../data/pbp/2026020260.json', import.meta.url)));
const snapshots = Array.from({length:fixture.plays.length+1}, (_, i) => ({...structuredClone(fixture),
  plays:fixture.plays.slice(0,i), gameState:i===0?'FUT':i===fixture.plays.length?fixture.gameState:'LIVE'}));
const pyImport = `import sys,json,importlib.util\nfrom pathlib import Path\np=Path('../scripts/notify_alerts.py').resolve();s=importlib.util.spec_from_file_location('notify',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n`;
const python = (code, data) => JSON.parse(execFileSync('python3',['-c',pyImport+code], {input:JSON.stringify(data),encoding:'utf8',maxBuffer:20*1024*1024}));
const expected = python('print(json.dumps([m.game_events(g) for g in json.load(sys.stdin)],ensure_ascii=False))', snapshots);
for(let i=0;i<snapshots.length;i++) assert.deepEqual(gameEvents(snapshots[i]),expected[i],'Python parity prefix '+i);
console.log('Python parity:',snapshots.length,'incremental real EDM PBP snapshots match exact titles, bodies, URLs and IDs');
class MemoryStorage {
  data=new Map();alarm=null;
  async get(k){return structuredClone(this.data.get(k));}
  async put(k,v){for(const [key,value] of typeof k==='object'?Object.entries(k):[[k,v]])this.data.set(key,structuredClone(value));}
  async delete(k){for(const key of Array.isArray(k)?k:[k])this.data.delete(key);}
  async list({prefix='',limit=Infinity}={}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).sort().slice(0,limit).map(([k,v])=>[k,structuredClone(v)]));}
  async setAlarm(t){this.alarm=t;} async deleteAlarm(){this.alarm=null;}
}
class KV {
  data=new Map();
  async get(k,type){const v=this.data.get(k)?.value??null;return type==='json'&&v!==null?JSON.parse(v):v;}
  async put(k,value,opts={}){this.data.set(k,{value,metadata:opts.metadata});}
  async delete(k){this.data.delete(k);}
  async list({prefix}){return {keys:[...this.data].filter(([k])=>k.startsWith(prefix)).map(([name,v])=>({name,metadata:v.metadata})),list_complete:true};}
}
const realNow=Date.now;let time=Date.parse(fixture.startTimeUTC)+3600000;Date.now=()=>time;
function setup(storage=new MemoryStorage(),kv=new KV()){
  const messages=[],accepted=[];
  const env={GAME_ALERTS_ENABLED:'1',GAME_ALERTS_SINCE:fixture.startTimeUTC,ALERTS_KV:kv,PUSH_QUEUE:{async sendBatch(ms){messages.push(...structuredClone(ms));}}};
  const actor=new GameAlerts({storage},env);
  actor.send=async(env,subs,payload,{afterEach})=>{for(const s of subs){accepted.push(s.id+':'+payload.id);await afterEach(s,{ok:true});}return {sent:subs.length,failed:0,gone:0};};
  actor.nhl=async()=>({games:[]}); // all sending/network is stubbed: no real pushes
  return {actor,storage,env,messages,accepted};
}
async function sub(env,id='fan',prefs={}){await store.putSub(env,id,{endpoint:'https://push.test/'+id,p256dh:'stub',auth:'stub',prefs:{...store.DEFAULTS,...prefs}},new Date(time).toISOString());}
async function drain(x){while(x.messages.length){const j=x.messages.shift().body.gameAlert;assert.equal((await x.actor.delivery(j.id,j.batch)).ok,true);}}
try{
  const x=setup();await sub(x.env);const seen=new Set(),wanted=[],actual=[];
  for(let i=0;i<snapshots.length;i++){
    await x.actor.stage(snapshots[i]);
    for(const [,row]of await x.storage.list({prefix:'pending:'})){const {topic,renotify,ts,...e}=row.payload;actual.push(e);}
    for(const {order,...e}of expected[i])if(!seen.has(e.id)){seen.add(e.id);wanted.push(e);}
    await x.actor.flush();await drain(x);
  }
  assert.deepEqual(actual,wanted);assert.equal(x.accepted.length,wanted.length);assert.equal(new Set(x.accepted).size,wanted.length);
  const logged = await x.env.ALERTS_KV.get('alerts:log','json');
  assert.equal(logged.length, wanted.length);
  const byLog = Object.fromEntries(logged.map(a => [a.id, a]));
  for (const e of wanted) { assert.equal(byLog[e.id].url, e.url); assert.equal(byLog[e.id].title, e.title); assert.equal(byLog[e.id].type, e.type); }
  const loggedGoal = logged.find(a => a.type==='goal');
  assert.equal(loggedGoal.detail.kind,'goal'); assert.ok(loggedGoal.detail.scorer); assert.ok(loggedGoal.detail.period); assert.ok(loggedGoal.detail.time); assert.ok(loggedGoal.detail.strength);
  assert.equal(typeof loggedGoal.detail.awayScore,'number'); assert.equal(typeof loggedGoal.detail.homeScore,'number');
  assert.match(logged.find(a => a.type==='final').url, /^\/game\.html\?id=\d+$/);
  assert.equal(logged.find(a => a.type==='puck_drop').url, '/tracker.html');
  console.log('Alert log: one inbox row per sent game alert, push URLs unchanged, goal detail present');
  const revised=structuredClone(fixture),goal=revised.plays.find(p=>p.typeDescKey==='goal');goal.details.scoringPlayerId=999999;
  assert.equal(await x.actor.stage(revised),0);revised.plays=revised.plays.filter(p=>p.eventId!==goal.eventId);
  assert.equal(await x.actor.stage(revised),0);assert.equal(await x.actor.stage(fixture),0);
  assert.equal(await setup(x.storage,x.env.ALERTS_KV).actor.stage(fixture),0);
  console.log('Incremental durable outbox:',wanted.length,'exact alerts once each; scorer edits, reversals and restart do not resend');
  const early=snapshots.find(g=>gameEvents(g).length===1),y=setup();await sub(y.env,'one');await sub(y.env,'two');await y.actor.stage(early);
  const id=[...(await y.storage.list({prefix:'pending:'})).keys()][0].slice(8);let throwOnce=true;
  y.env.PUSH_QUEUE.sendBatch=async ms=>{y.messages.push(...structuredClone(ms));if(throwOnce){throwOnce=false;throw Error('queue acceptance response lost');}};
  await assert.rejects(y.actor.flush());await y.actor.flush();
  await Promise.all(y.messages.map(m=>y.actor.delivery(m.body.gameAlert.id,m.body.gameAlert.batch)));
  assert.equal(y.accepted.length,2);assert.equal(new Set(y.accepted).size,2);assert.equal((await y.storage.list({prefix:'pending:'})).size,0);
  console.log('Ambiguous queue acceptance + concurrent duplicate messages: exactly one accepted send per recipient');
  const z=setup();await sub(z.env,'one');await sub(z.env,'two');await z.actor.stage(early);await z.actor.flush();
  const job=z.messages[0].body.gameAlert,successes=new Set();let failTwo=true;
  z.actor.send=async(env,subs,payload,{afterEach})=>{const stats={sent:0,failed:0,gone:0};for(const s of subs){if(s.id==='two'&&failTwo){stats.failed++;await afterEach(s,{ok:false});continue;}assert.ok(!successes.has(s.id));successes.add(s.id);stats.sent++;await afterEach(s,{ok:true});}return stats;};
  assert.equal((await z.actor.delivery(job.id,job.batch)).retry,true);failTwo=false;
  assert.equal((await z.actor.delivery(job.id,job.batch)).ok,true);assert.equal(successes.size,2);
  assert.equal((await z.actor.delivery(job.id,job.batch)).duplicate,true);
  console.log('Partial provider failure: only failed recipient retries; successful checkpoint survives retries');
  const l=setup();await sub(l.env);await store.markEvent(l.env,id,{type:'puck_drop',at:new Date(time).toISOString()});
  assert.equal(await l.actor.stage(early),0);l.env.GAME_ALERTS_SINCE='2026-11-08T03:00:00Z';
  assert.equal(await l.actor.stage(fixture),0);assert.equal(eligibleGame(fixture,l.env.GAME_ALERTS_SINCE,time),false);
  const off=setup(),r=await off.actor.run(time);assert.equal(r.active,false);assert.equal(r.polls,1);assert.equal(off.storage.alarm,null);
  const live=setup();live.actor.pause=async ms=>{await Promise.resolve();time+=ms;};let polls=0;
  live.actor.poll=async()=>{polls++;await Promise.resolve();return {active:true,staged:0};};
  const runs=await Promise.all(Array.from({length:20},()=>live.actor.run(time)));
  assert.equal(runs.filter(r=>r.busy).length,19);assert.equal(polls,4);
  const bad=setup();bad.actor.nhl=async()=>{throw Error('NHL down');};await assert.rejects(bad.actor.run(time));assert.ok(bad.storage.alarm>time);
  console.log('Scheduler: off-game exits after one check; 20 overlaps produce one 4-poll loop; recovery alarm survives feed failure');
  const response=await worker.fetch(new Request('https://worker.test/notify',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({type:'goal',title:'old Actions event'})}),{NOTIFY_SECRET:'test',GAME_ALERTS_ENABLED:'1'},{waitUntil(){}});
  assert.equal((await response.json()).ignored,true);
  console.log('Cutover: legacy KV sent IDs, all historical Actions-cache games and in-flight HTTP producer are fenced');
  const crash=setup();await sub(crash.env);await crash.actor.stage(early);await crash.actor.flush();
  const cj=crash.messages[0].body.gameAlert,del=crash.storage.delete.bind(crash.storage);let failDelete=true;
  crash.storage.delete=async k=>{if(failDelete){failDelete=false;throw Error('crash after recipient checkpoint');}return del(k);};
  await assert.rejects(crash.actor.delivery(cj.id,cj.batch));
  assert.equal((await crash.actor.delivery(cj.id,cj.batch)).duplicate,true);
  assert.equal(crash.accepted.length,1);assert.equal((await crash.storage.list({prefix:'pending:'})).size,0);
  const saved=setup();await sub(saved.env);await saved.actor.stage(early);
  const recovery=setup(saved.storage,saved.env.ALERTS_KV);await recovery.actor.flush();await drain(recovery);
  assert.equal(recovery.accepted.length,1,'persisted outbox survives restart before enqueue');
  console.log('Crash recovery: restart before enqueue and crash after last recipient checkpoint both preserve delivery without resending');

}finally{Date.now=realNow;}
const feed={bettingPartner:{name:'FanDuel'},lastUpdatedUTC:fixture.startTimeUTC,games:[{gameId:fixture.id,startTimeUTC:fixture.startTimeUTC,
  awayTeam:{abbrev:fixture.awayTeam.abbrev,name:fixture.awayTeam.commonName,odds:[{description:'MONEY_LINE_2_WAY',value:158}]},
  homeTeam:{abbrev:fixture.homeTeam.abbrev,name:fixture.homeTeam.commonName,odds:[{description:'MONEY_LINE_2_WAY',value:-192}]}}]};
const events=gameEvents(fixture),state={};addOdds(events,state,oddsGame(feed,fixture.id));
const code=`g,f=json.load(sys.stdin);st={};oc=m.OddsCache();oc.feed=f;oc.done=True;es=m.game_events(g);m.add_odds(es,str(g['id']),st,oc,None);print(json.dumps([es,st],ensure_ascii=False))`;
assert.deepEqual([events,state],python(code,[fixture,feed]));
const changed=structuredClone(feed);changed.lastUpdatedUTC=new Date(Date.parse(fixture.startTimeUTC)+3600000).toISOString();changed.games[0].homeTeam.odds[0].value=-250;
const periods=gameEvents(fixture).filter(e=>e.type==='period_end');addOdds(periods,state,oddsGame(changed,fixture.id));
assert.ok(periods.every(e=>e.alt?.pref==='odds'&&e.alt.body.includes('Live moneyline:')));
const alteredExpected=python(`g,f,st=json.load(sys.stdin);oc=m.OddsCache();oc.feed=f;oc.done=True;es=[e for e in m.game_events(g) if e['type']=='period_end'];m.add_odds(es,str(g['id']),st,oc,None);print(json.dumps([es,st],ensure_ascii=False))`,[fixture,changed,{odds0:state.odds0}]);
assert.deepEqual([periods,state],alteredExpected);
console.log('Odds: exact Python text/state parity and live odds-only period body variant preserved');
