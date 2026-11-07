// Entirely local fixtures. No real signup, credentials, network, subscribers or email delivery.
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import * as nl from '../src/newsletter.js';
const data = new Map(), metadata = new Map(); let puts=0, deletes=0, allowed=true, rateCalls=0;
const env={ADMIN_SECRET:'newsletter-local-test-only', NEWSLETTER_RATE:{async limit({key}){assert.match(key,/^[a-f0-9]{64}$/);rateCalls++;return {success:allowed};}},
  ALERTS_KV:{async get(k,type){let v=data.get(k);return v == null?null:type==='json'?JSON.parse(v):v;},
    async put(k,v,opts){puts++;data.set(k,v);metadata.set(k,structuredClone(opts?.metadata));},
    async delete(k){deletes++;data.delete(k);metadata.delete(k);},
    async list({prefix='',cursor}={}){const keys=[...data.keys()].filter(k=>k.startsWith(prefix)).sort(),start=Number(cursor||0),page=keys.slice(start,start+2);return {keys:page.map(name=>({name,metadata:structuredClone(metadata.get(name))})),list_complete:start+2>=keys.length,cursor:String(start+2)};}}};
const ctx={waitUntil(p){throw Error('Newsletter must not enqueue/send pushes or background writes');}};
const base={email:' Test+CBN@Example.COM ',consent:true,consentVersion:nl.CONSENT_VERSION,source:'home',website:''};
function request(path, {method='GET',body,origin='https://copperandbluenews.com',admin=false,raw}={}) {
 return worker.fetch(new Request('https://local.test'+path,{method,headers:{...(origin?{Origin:origin}:{}),...(admin?{Authorization:'Bearer '+env.ADMIN_SECRET}:{}),'CF-Connecting-IP':'192.0.2.1'},...(body!==undefined||raw!==undefined?{body:raw!==undefined?raw:JSON.stringify(body)}:{})}),env,ctx);
}
let r=await request('/newsletter',{method:'OPTIONS'});assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://copperandbluenews.com');
assert.equal((await request('/newsletter',{method:'OPTIONS',origin:'https://bad.test'})).status,403);
assert.equal((await request('/newsletter')).status,405);
assert.equal((await request('/newsletter',{method:'POST',body:base,origin:'https://bad.test'})).status,403);assert.equal(puts,0);
r=await request('/newsletter',{method:'POST',body:base});assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});assert.equal(r.headers.get('Cache-Control'),'no-store');
assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://copperandbluenews.com');assert.equal(puts,1);assert.equal(data.size,1);
const id=await nl.emailId('test+cbn@example.com'), k='nl:'+id, stored=JSON.parse(data.get(k));
assert.equal(stored.email,'test+cbn@example.com');assert.equal(stored.consent_text,nl.CONSENT_TEXT);assert.equal(stored.consent_version,nl.CONSENT_VERSION);assert.equal(stored.consent_ts,stored.ts);assert.equal(stored.consent_method,'unchecked_checkbox_and_submit');assert.equal(stored.source,'home');assert.ok(!JSON.stringify(stored).includes('192.0.2.1'));
r=await request('/newsletter',{method:'POST',body:{...base,source:'news'},origin:'https://www.copperandbluenews.com'});assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});assert.equal(puts,1);assert.deepEqual(JSON.parse(data.get(k)),stored);
const beforeRate=rateCalls;r=await request('/newsletter',{method:'POST',body:{website:'bot'}});assert.equal(r.status,200);assert.equal(puts,1);assert.equal(rateCalls,beforeRate);
for(const body of [null,[],{...base,consent:false},{...base,consent:'true'},{...base,consentVersion:'old'},{...base,email:'a..b@example.com'},{...base,email:'bad@example'},{...base,email:'bad\r\n@example.com'},{...base,email:'a@-bad.com'},{...base,email:'a@bad..com'},{...base,email:'x'.repeat(255)+'@example.com'}]) assert.equal((await request('/newsletter',{method:'POST',body})).status,400,JSON.stringify(body));
assert.equal((await request('/newsletter',{method:'POST',raw:'{'})).status,400);
assert.equal((await request('/newsletter',{method:'POST',raw:'x'.repeat(2049)})).status,413);
allowed=false;r=await request('/newsletter',{method:'POST',body:base});assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'60');assert.equal(puts,1);allowed=true;
assert.equal((await request('/stats')).status,401);assert.equal((await request('/export?list=newsletter')).status,401);
r=await request('/stats?hours=1',{admin:true});assert.deepEqual((await r.json()).newsletter,{total:1,new_24h:1});
r=await request('/export?list=newsletter',{admin:true});const csv=await r.text();assert.equal(r.status,200);assert.match(csv,/email,ts,source,consent_ts,consent_version,consent_text/);assert.match(csv,/test\+cbn@example.com/);assert.match(csv,/unchecked_checkbox_and_submit/);assert.equal(r.headers.get('Cache-Control'),'no-store');
const link=csv.match(/https:\/\/[^\s,\r\n]+\/newsletter\/unsubscribe\?token=[^\s,\r\n]+/)[0],token=new URL(link).searchParams.get('token');
assert.equal((await request('/newsletter/unsubscribe?token=bad',{origin:null})).status,400);assert.equal(deletes,0);
const forged=token.slice(0,-3)+(token.at(-3)==='a'?'b':'a')+token.slice(-2);
assert.equal((await request('/newsletter/unsubscribe?token='+forged,{origin:null})).status,400);assert.equal(deletes,0);
r=await request('/newsletter/unsubscribe?token='+token,{origin:null});assert.equal(r.status,200);assert.match(await r.text(),/You're unsubscribed/);assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');assert.ok(r.headers.get('Content-Security-Policy'));assert.equal(deletes,1);assert.equal(data.size,0);
assert.equal((await request('/newsletter/unsubscribe?token='+token,{origin:null})).status,200);assert.equal(deletes,1);
// Old signed links cannot delete a new, later consent record.
const later={...stored,ts:new Date(Date.parse(stored.ts)+1000).toISOString()};await env.ALERTS_KV.put(k,JSON.stringify(later),{metadata:later});
assert.equal((await request('/newsletter/unsubscribe?token='+token,{origin:null})).status,400);assert.ok(data.has(k));
assert.equal((await request('/export',{admin:true})).status,200);assert.match(await (await request('/export',{admin:true})).text(),/^id,email,puck_drop/);
// Pagination and fixed 24h newsletter counts even when alert stats use another window.
for(let i=0;i<5;i++){const row={...stored,email:`local${i}@example.com`,ts:new Date(Date.now()-(i===4?2:0)*86400000).toISOString()};await env.ALERTS_KV.put('nl:'+await nl.emailId(row.email),JSON.stringify(row),{metadata:row});}
assert.deepEqual(await nl.counts(env),{total:6,new_24h:5});
r=await request('/stats?hours=192',{admin:true});assert.deepEqual((await r.json()).newsletter,{total:6,new_24h:5});
r=await request('/export?list=newsletter',{admin:true});assert.equal((await r.text()).trim().split('\r\n').length,7);
console.log('NEWSLETTER PASS: validation, exact consent, normalization, idempotence, honeypot, CORS/methods/body bounds, private IP throttling, protected paginated export/counts, HMAC forgery, unsubscribe/re-subscribe isolation; zero email/push/network calls');
