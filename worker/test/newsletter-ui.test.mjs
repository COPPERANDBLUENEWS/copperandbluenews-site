// Client logic unit tests against a synthetic DOM (not a browser/session; all fetches are local stubs).
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const script=fs.readFileSync(new URL('../../js/newsletter.js',import.meta.url),'utf8');
function setup(source='home',response={ok:true,status:200,data:{ok:true}}) {
 let listener,markup='',requests=[];
 const email={value:'',checkValidity(){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value);},focus(){this.focused=true;}},consent={checked:false,focus(){this.focused=true;}},website={value:''};
 const btn={disabled:false},msg={textContent:'',className:''};
 const form={elements:{email,consent,website},hidden:false,querySelector(){return btn;},addEventListener(type,fn){assert.equal(type,'submit');listener=fn;},setAttribute(){},removeAttribute(){}};
 const box={dataset:{newsletter:source},set innerHTML(v){markup=v;},querySelector(s){return s==='form'?form:msg;}};
 const context={window:{CBN_CONFIG:{WORKER_URL:'https://worker.invalid/'}},document:{querySelector(){return box;}},AbortController,setTimeout,clearTimeout,
 fetch:async(url,opts)=>{requests.push({url,...opts,body:JSON.parse(opts.body)});if(response.throw)throw new TypeError('Failed to fetch');return {ok:response.ok,status:response.status,json:async()=>response.data};}};
 Object.defineProperty(context.window,'localStorage',{get(){throw Error('newsletter must not persist email');}});
 vm.runInNewContext(script,context);
 return {form,email,consent,website,btn,msg,requests,markup,submit:()=>listener({preventDefault(){}})};
}
for(const source of ['home','news']) {
 const c=setup(source);
 assert.match(c.markup,/Game day previews and Oilers news from The Copper &amp; Blue News\. Unsubscribe anytime\./);
 assert.ok(!c.markup.match(/<input type="checkbox"[^>]*\bchecked\b/));assert.match(c.markup,/name="website" tabindex="-1"/);assert.match(c.markup,/role="status" aria-live="polite"/);
 await c.submit();assert.equal(c.requests.length,0);assert.match(c.msg.textContent,/valid email/);assert.ok(c.email.focused);
 c.email.value=' test+cbn@example.com ';await c.submit();assert.equal(c.requests.length,0);assert.match(c.msg.textContent,/consent box/);assert.ok(c.consent.focused);
 c.consent.checked=true;await Promise.all([c.submit(),c.submit()]);assert.equal(c.requests.length,1);
 assert.deepEqual(c.requests[0].body,{email:'test+cbn@example.com',consent:true,consentVersion:'2026-11-06-v1',source,website:''});
 assert.equal(c.requests[0].url,'https://worker.invalid/newsletter');assert.equal(c.requests[0].credentials,'omit');assert.equal(c.requests[0].cache,'no-store');
 assert.equal(c.form.hidden,true);assert.equal(c.email.value,'');assert.match(c.msg.textContent,/coming soon/);assert.equal(c.btn.disabled,false);
}
for(const response of [{ok:false,status:429,data:{error:'Too many attempts. Please wait a minute and try again.'}},{throw:true}]) {
 const c=setup('home',response);c.email.value='test+cbn@example.com';c.consent.checked=true;await c.submit();assert.equal(c.form.hidden,false);assert.equal(c.btn.disabled,false);assert.match(c.msg.className,/err/);assert.match(c.msg.textContent,/try again/);
}
console.log('NEWSLETTER CLIENT PASS: home/news exact unchecked consent, invalid/unchecked blocking, honeypot payload, no double submit, no credential/storage use, success + rate-limit + network error recovery');
