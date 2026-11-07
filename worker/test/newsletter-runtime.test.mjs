// Real local workerd + KV + native rate-limit binding. Every external request is prohibited.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import assert from 'node:assert/strict';
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'cbn-newsletter-test',modules:true,modulesRoot:'/tmp/cbn-game-alerts-bundle',scriptPath:'/tmp/cbn-game-alerts-bundle/index.js',compatibilityDate:'2026-11-01',
 kvNamespaces:['ALERTS_KV'],durableObjects:{GAME_ALERTS:{className:'GameAlerts',useSQLite:true}},
 ratelimits:{NEWSLETTER_RATE:{namespace_id:'2026110635',simple:{limit:5,period:60}}},
 bindings:{ADMIN_SECRET:'newsletter-runtime-local-only'},outboundService:async()=>{throw Error('No external request permitted in newsletter test');}}]}));
try{
 const call=(path,body,admin=false)=>mf.dispatchFetch('https://local.test'+path,{method:body?'POST':'GET',headers:{Origin:'https://copperandbluenews.com','CF-Connecting-IP':'192.0.2.10',...(admin?{Authorization:'Bearer newsletter-runtime-local-only'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const body={email:'test+cbn@example.com',consent:true,consentVersion:'2026-11-06-v1',source:'home',website:''};
 let r=await call('/newsletter',body);assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
 r=await call('/newsletter',body);assert.equal(r.status,200);
 const kv=await mf.getKVNamespace('ALERTS_KV');assert.equal((await kv.list({prefix:'nl:'})).keys.length,1);
 r=await call('/stats',null,true);assert.deepEqual((await r.json()).newsletter,{total:1,new_24h:1});
 r=await call('/export?list=newsletter',null,true);const csv=await r.text();assert.match(csv,/test\+cbn@example.com/);
 const token=csv.match(/\?token=([^\r\n,]+)/)[1];
 r=await call('/newsletter/unsubscribe?token='+token);assert.equal(r.status,200);assert.equal((await kv.list({prefix:'nl:'})).keys.length,0);
 r=await call('/stats',null,true);assert.deepEqual((await r.json()).newsletter,{total:0,new_24h:0});
 const statuses=[];for(let i=0;i<6;i++)statuses.push((await call('/newsletter',body)).status);
 assert.ok(statuses.includes(429),'native per-location throttle returns 429');
 console.log('NEWSLETTER LOCAL RUNTIME PASS: real workerd/KV, native rate limiter, signup + duplicate + protected signed export + unsubscribe + zero final count; no network/email/push calls');
}finally{await mf.dispose();}
