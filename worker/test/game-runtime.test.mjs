// Local workerd integration; generate throwaway keys and intercept ALL external fetches. No real pushes.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import crypto from 'node:crypto';
import fs from 'node:fs';
import ece from 'http_ece';
import assert from 'node:assert/strict';
import {gameEvents} from '../src/game-events.js';
const g=JSON.parse(fs.readFileSync(new URL('../../data/pbp/2026020260.json',import.meta.url)));
g.startTimeUTC=new Date(Date.now()-3600000).toISOString();
const ua=crypto.createECDH('prime256v1');ua.generateKeys();const auth=crypto.randomBytes(16);
const vapid=crypto.createECDH('prime256v1');vapid.generateKeys();const pushes=[];let offGame=true;
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"cbn-test",modules:true,modulesRoot:"/tmp/cbn-game-alerts-bundle",scriptPath:'/tmp/cbn-game-alerts-bundle/index.js',compatibilityDate:'2026-11-01',
  kvNamespaces:['ALERTS_KV'],durableObjects:{GAME_ALERTS:{className:'GameAlerts',useSQLite:true}},
  queueProducers:{PUSH_QUEUE:'cbn-game-test'},queueConsumers:{'cbn-game-test':{maxBatchSize:1,maxBatchTimeout:1,maxRetries:10}},
  bindings:{GAME_ALERTS_ENABLED:'1',GAME_ALERTS_SINCE:'2020-01-01T00:00:00Z',ALLOW_ANY_PUSH_HOST:'1',
    VAPID_PUBLIC_KEY:vapid.getPublicKey().toString('base64url'),VAPID_PRIVATE_KEY:vapid.getPrivateKey().toString('base64url'),
    VAPID_SUBJECT:'https://copperandbluenews.com',NOTIFY_SECRET:'local-test-only'},
  outboundService:async req=>{
    const u=new URL(req.url);
    if(u.hostname==='push.test'){
      pushes.push(JSON.parse(ece.decrypt(Buffer.from(await req.arrayBuffer()),{version:'aes128gcm',privateKey:ua,authSecret:auth}).toString()));
      return new Response('',{status:201});
    }
    assert.equal(u.hostname,'api-web.nhle.com','unexpected external network prohibited');
    if(u.pathname.includes('club-schedule-season'))return Response.json({games:offGame?[]:[g]});
    if(u.pathname.includes('partner-game'))return Response.json({games:[]});
    assert.ok(u.pathname.includes('/play-by-play'));return Response.json(g);
  }}]}));
const waitFor=async test=>{const deadline=Date.now()+20000;while(!test()){if(Date.now()>deadline)throw Error('Local queue timeout');await new Promise(r=>setTimeout(r,50));}};
try{
  const ns=await mf.getDurableObjectNamespace('GAME_ALERTS');
  const off=ns.get(ns.idFromName('local-offgame-test'));
  let r=await off.fetch('https://internal/tick',{method:'POST',body:JSON.stringify({scheduledTime:Date.now()})});
  assert.equal(r.status,200);assert.equal((await r.json()).staged,0);offGame=false;
  const actor=ns.get(ns.idFromName('edm-game-alerts-v1'));
  const post=(path,b)=>mf.dispatchFetch('https://local.test/'+path,{method:'POST',headers:{Origin:'https://copperandbluenews.com',Authorization:'Bearer local-test-only'},body:JSON.stringify(b)});
  r=await post('subscribe',{subscription:{endpoint:'https://push.test/device',keys:{p256dh:ua.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}},prefs:{puck_drop:true,goal:true,period_end:true,final:true,lineup:true,odds:true,gameday:true}});assert.equal(r.status,200);
  const tick=()=>actor.fetch('https://internal/tick',{method:'POST',body:JSON.stringify({scheduledTime:Date.now()})});
  r=await tick();assert.equal(r.status,200);assert.equal((await r.json()).staged,14);
  await waitFor(()=>pushes.length===14);
  const byId=new Map(pushes.map(p=>[p.id,p]));assert.equal(byId.size,14);
  for(const {order,...e}of gameEvents(g)){const {topic,ts,renotify,...sent}=byId.get(e.id);assert.deepEqual(sent,e);assert.equal(renotify,false);assert.match(topic,/^[A-Za-z0-9_-]{22}$/);}
  r=await actor.fetch('https://internal/deliver',{method:'POST',body:JSON.stringify({id:pushes[0].id,batch:0})});assert.equal((await r.json()).duplicate,true);
  assert.equal((await (await tick()).json()).staged,0);assert.equal(pushes.length,14);
  r=await post('notify',{id:'legacy-game',type:'goal',title:'must not send'});assert.equal((await r.json()).ignored,true);
  r=await post('notify',{id:'local-lineup',type:'lineup',title:'Lineup local test',body:'unchanged',url:'/players.html'});assert.equal(r.status,200);
  await waitFor(()=>pushes.length===15);assert.equal(pushes[14].url,'/players.html');
  r=await post('notify',{id:'local-odds',type:'odds',title:'Odds local test',body:'unchanged',url:'/tracker.html'});assert.equal(r.status,200);
  await waitFor(()=>pushes.length===16);
  console.log('LOCAL RUNTIME PASS: SQLite actor + Queue + actual encryption, 14 exact decrypted game alerts once each; producer fence, duplicate redelivery, unchanged lineup/odds HTTP paths');
}finally{await mf.dispose();}
