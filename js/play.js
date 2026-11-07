/* AirHockey with Copper. Original art, offline, no dependencies or network calls.
   Fixed 120 Hz simulation; requestAnimationFrame display; shared engine exported for Node tests. */
(function (root) {
  'use strict';
  const W = 360, H = 620, WALL = 14, GOAL = 176, PR = 34, R = 8, MAX = 930, STEP = 1 / 120;
  const MOODS = {
    easy: {name:'Rookie Copper', reaction:.23, speed:225, error:82, attack:.68},
    normal: {name:'Copper', reaction:.16, speed:300, error:56, attack:.86},
    hard: {name:'Playoff Copper', reaction:.105, speed:365, error:34, attack:1}
  };
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  function withinRink(x,y,pad=R) {
    if(x<WALL+pad||x>W-WALL-pad)return false;
    if(Math.abs(x-W/2)<GOAL/2-pad)return true;
    if(y<WALL+pad||y>H-WALL-pad)return false;
    const radius=25,cx=x<WALL+radius?WALL+radius:x>W-WALL-radius?W-WALL-radius:null;
    const cy=y<WALL+radius?WALL+radius:y>H-WALL-radius?H-WALL-radius:null;
    return cx===null||cy===null||Math.hypot(x-cx,y-cy)<=radius-pad+.001;
  }
  function pointerTarget(clientX,clientY,box,touch=false) {
    return {x:(clientX-box.left)*W/box.width,y:(clientY-box.top)*H/box.height-(touch?24*H/box.height:0)};
  }
  function seeded(seed) {return () => {seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296;};}
  function paddle(y) {return {x:W/2,y,bottom:y>H/2,vx:0,vy:0,tx:W/2,ty:y,think:0};}
  function create(options = {}) {
    const mood = MOODS[options.difficulty] ? options.difficulty : 'normal';
    const state = {difficulty:mood, phase:'faceoff', timer:.9, score:{you:0,copper:0}, winner:null, paused:false,
      puck:{x:W/2,y:H/2,vx:0,vy:0}, you:paddle(H-132), copper:paddle(132), goals:0, time:0, stillTime:0, regionTime:0, regionX:W/2, regionY:H/2, laneTime:0};
    const rng = options.rng || Math.random;
    const api = {state, step, target, pause(v) {state.paused = !!v;}, constants:{W,H,WALL,GOAL,PR,R,MAX,STEP}};
    function target(x,y) {state.you.tx=clamp(x,WALL+PR,W-WALL-PR);state.you.ty=clamp(y,H/2+PR+10,H-WALL-PR-10);}
    function resetPositions() {
      Object.assign(state.puck,{x:W/2,y:H/2,vx:0,vy:0});state.regionTime=0;state.regionX=W/2;state.regionY=H/2;state.laneTime=0;
      Object.assign(state.you,paddle(H-132)); Object.assign(state.copper,paddle(132));
    }
    function serve() {
      const angle=(rng()-.5)*1.2, dir=rng()<.5 ? -1:1;
      state.puck.vx=Math.sin(angle)*280;state.puck.vy=Math.cos(angle)*280*dir;state.phase='playing';
    }
    function move(p, speed, dt, bottom) {
      p.tx=clamp(p.tx,WALL+PR,W-WALL-PR);p.ty=clamp(p.ty,bottom?H/2+PR+10:WALL+PR+10,bottom?H-WALL-PR-10:H/2-PR-10);
      const dx=p.tx-p.x,dy=p.ty-p.y,d=Math.hypot(dx,dy),s=d?Math.min(speed,d/dt)/d:0;
      p.vx=dx*s;p.vy=dy*s;p.x+=p.vx*dt;p.y+=p.vy*dt;
    }
    function ai(p, cfg, dt, bottom) {
      p.think-=dt; if(p.think>0)return; p.think=cfg.reaction;
      const q=state.puck, qy=bottom?H-q.y:q.y, py=bottom?H-p.y:p.y;
      const jitter=(rng()-.5)*2*cfg.error;
      if(qy < WALL+PR+R+10) {
        // Back off when the puck is behind the mallet rather than pinning it to the end boards.
        p.tx=clamp(q.x+jitter,WALL+PR,W-WALL-PR);p.ty=bottom?H-116:116;
      } else if(qy < H/2+10) {
        p.tx=q.x+jitter*.5;
        // Get behind the puck, then drive through it toward the other goal.
        const lined=Math.abs(p.x-q.x)<PR*.8 && py<qy-PR-4;
        const ty=lined?qy+40*cfg.attack:qy-PR-R-10;
        p.ty=bottom?H-ty:ty;
      } else {
        let x=q.x;const vy=bottom?-q.vy:q.vy;
        if(vy<0) {
          x+=q.vx*((106-qy)/vy);
          const lo=WALL+R, span=W-2*lo, v=((x-lo)%(2*span)+2*span)%(2*span);
          x=lo+(v>span?2*span-v:v);
        }
        p.tx=clamp(x+jitter,WALL+PR,W-WALL-PR);p.ty=bottom?H-106:106;
      }
    }
    function cap() {const q=state.puck,s=Math.hypot(q.vx,q.vy);if(s>MAX){q.vx*=MAX/s;q.vy*=MAX/s;}}
    function collide(p) {
      const q=state.puck,dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy),sum=PR+R;
      if(d>=sum)return;
      let nx=d?dx/d:0,ny=d?dy/d:(p.bottom?-1:1);
      let x=p.x+nx*(sum+.1),y=p.y+ny*(sum+.1);
      if(!withinRink(x,y)) {
        // Separate along the nearest legal point on the same visible circular perimeter.
        let best=Infinity;
        for(let i=0;i<48;i++) {
          const angle=i*Math.PI/24,cx=p.x+Math.cos(angle)*(sum+.1),cy=p.y+Math.sin(angle)*(sum+.1);
          if(withinRink(cx,cy)){const cost=(cx-q.x)**2+(cy-q.y)**2;if(cost<best){best=cost;x=cx;y=cy;nx=Math.cos(angle);ny=Math.sin(angle);}}
        }
      }
      q.x=x;q.y=y;
      const vn=(q.vx-p.vx)*nx+(q.vy-p.vy)*ny;
      if(vn<0){
        const hit=-vn;
        q.vx-=1.92*vn*nx;q.vy-=1.92*vn*ny;q.vx+=p.vx*.14;q.vy+=p.vy*.14;cap();
        if(hit>30&&options.onPaddle)options.onPaddle(hit);
      }
    }
    function board(speed){if(speed>40&&options.onBoard)options.onBoard(speed);}
    function post(x,y) {
      const q=state.puck,dx=q.x-x,dy=q.y-y,d=Math.hypot(dx,dy),sum=R+3;
      if(!d||d>=sum)return;const nx=dx/d,ny=dy/d; q.x=x+nx*(sum+.05);q.y=y+ny*(sum+.05);
      const vn=q.vx*nx+q.vy*ny;if(vn<0){q.vx-=1.96*vn*nx;q.vy-=1.96*vn*ny;board(-vn);}
    }
    function goal(side) {
      state.score[side]++;state.goals++;state.puck.vx=state.puck.vy=0;
      state.phase=state.score[side]>=7?'over':'goal';state.timer=1.05;state.lastGoal=side;
      if(state.phase==='over')state.winner=side;
      if(options.onGoal)options.onGoal(side,state);
      if(state.phase==='over'&&options.onFinish)options.onFinish(state);
    }
    function step(dt=STEP) {
      // Reject pathological deltas; the caller accumulates fixed steps, including accelerated demo tests.
      if(state.paused||state.phase==='over'||!Number.isFinite(dt)||dt<=0)return;
      dt=Math.min(dt,1/60);state.time+=dt;
      if(state.phase==='playing') {
        ai(state.copper,MOODS[mood],dt,false);
        if(options.demo)ai(state.you,MOODS[options.demoDifficulty]||MOODS.normal,dt,true);
      } else {
        state.copper.tx=W/2;state.copper.ty=132;
        if(options.demo){state.you.tx=W/2;state.you.ty=H-132;}
      }
      move(state.you,options.demo?MOODS[options.demoDifficulty||'normal'].speed:890,dt,true);move(state.copper,MOODS[mood].speed,dt,false);
      if(state.phase!=='playing') {
        state.timer-=dt;if(state.timer<=0) {
          if(state.phase==='goal'){resetPositions();state.phase='faceoff';state.timer=.8;}
          else serve();
        }
        return;
      }
      const q=state.puck,oldX=q.x,oldY=q.y;
      q.x+=q.vx*dt;q.y+=q.vy*dt;
      if(q.x<WALL+R){const hit=Math.abs(q.vx);q.x=WALL+R;q.vx=Math.abs(q.vx)*.99;board(hit);}
      if(q.x>W-WALL-R){const hit=Math.abs(q.vx);q.x=W-WALL-R;q.vx=-Math.abs(q.vx)*.99;board(hit);}
      const mouth=Math.abs(q.x-W/2)<GOAL/2-R;
      if(!mouth) {
        if(q.y<WALL+R){const hit=Math.abs(q.vy);q.y=WALL+R;q.vy=Math.abs(q.vy)*.99;board(hit);}
        if(q.y>H-WALL-R){const hit=Math.abs(q.vy);q.y=H-WALL-R;q.vy=-Math.abs(q.vy)*.99;board(hit);}
      }
      // The rink art has rounded corners: reflect from the same quarter-circle, not an invisible square corner.
      const cornerX=q.x<WALL+25?WALL+25:q.x>W-WALL-25?W-WALL-25:null;
      const cornerY=q.y<WALL+25?WALL+25:q.y>H-WALL-25?H-WALL-25:null;
      if(cornerX!==null&&cornerY!==null){const dx=q.x-cornerX,dy=q.y-cornerY,d=Math.hypot(dx,dy),radius=25-R;
        if(d>radius){const nx=dx/d,ny=dy/d;q.x=cornerX+nx*radius;q.y=cornerY+ny*radius;const vn=q.vx*nx+q.vy*ny;if(vn>0){q.vx-=1.98*vn*nx;q.vy-=1.98*vn*ny;board(vn);}}}
      for(const x of [W/2-GOAL/2,W/2+GOAL/2]){post(x,WALL);post(x,H-WALL);}
      collide(state.you);collide(state.copper);
      if(Math.abs(q.x-W/2)<GOAL/2-R) {
        if(q.y<WALL-R){goal('you');return;}if(q.y>H-WALL+R){goal('copper');return;}
      }
      const drag=Math.exp(-.075*dt);q.vx*=drag;q.vy*=drag;
      const speed=Math.hypot(q.vx,q.vy);
      if(speed>0&&speed<115){q.vx*=115/speed;q.vy*=115/speed;}
      cap();
      state.stillTime=Math.hypot(q.x-oldX,q.y-oldY)<.035?state.stillTime+dt:0;
      if(Math.hypot(q.x-state.regionX,q.y-state.regionY)>36){state.regionTime=0;state.regionX=q.x;state.regionY=q.y;}else state.regionTime+=dt;
      state.laneTime=Math.abs(q.y-H/2)<3&&Math.abs(q.vy)<4?state.laneTime+dt:0;
      if(state.stillTime>1.4||state.regionTime>2.2||state.laneTime>2.2){resetPositions();state.stillTime=0;state.phase='faceoff';state.timer=.8;if(options.onFreeze)options.onFreeze();}
    }
    return api;
  }
  function updateRecord(previous,score,winner,difficulty) {
    const next={...previous};
    if(winner==='you'){next.wins++;next.streak++;next.bestStreak=Math.max(next.bestStreak,next.streak);if(!next.bestWin||score.copper<next.bestWin.copper)next.bestWin={you:7,copper:score.copper,difficulty};}
    else{next.losses++;next.streak=0;}
    return next;
  }
  const lib={create,seeded,updateRecord,withinRink,pointerTarget,MOODS,constants:{W,H,WALL,GOAL,PR,R,MAX,STEP}};
  if(typeof module!=='undefined'&&module.exports)module.exports=lib;
  root.CopperAirHockey=lib;
  if(!root.document)return;
  const $=id=>document.getElementById(id),canvas=$('pongCanvas'),arena=$('pongArena');
  if(!canvas||!arena)return;
  const ctx=canvas.getContext('2d',{alpha:false});if(!ctx){$('playHelp').textContent='Canvas is unavailable in this browser.';return;}
  const art=document.createElement('canvas');art.width=W*2;art.height=H*2;const ac=art.getContext('2d');ac.scale(2,2);
  function rounded(c,x,y,w,h,r) {c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
  function drawRink() {
    const c=ac;c.fillStyle='#0b1a33';c.fillRect(0,0,W,H);
    rounded(c,5,5,W-10,H-10,35);c.fillStyle='#d9e8f0';c.fill();c.strokeStyle='#9fb0cc';c.lineWidth=3;c.stroke();
    rounded(c,WALL,WALL,W-2*WALL,H-2*WALL,25);c.save();c.clip();
    const ice=c.createLinearGradient(0,0,W,H);ice.addColorStop(0,'#f5fbff');ice.addColorStop(.5,'#e2f0f7');ice.addColorStop(1,'#f7fbff');c.fillStyle=ice;c.fillRect(0,0,W,H);
    c.strokeStyle='rgba(65,126,166,.08)';c.lineWidth=1;
    for(let y=34;y<H;y+=22){c.beginPath();c.moveTo(0,y);c.lineTo(W,y-28);c.stroke();}
    const line=(y,color,width)=>{c.beginPath();c.strokeStyle=color;c.lineWidth=width;c.moveTo(WALL,y);c.lineTo(W-WALL,y);c.stroke();};
    line(H/2,'#ce4253',4);line(211,'#3881c3',5);line(H-211,'#3881c3',5);line(WALL+12,'#ce4253',2);line(H-WALL-12,'#ce4253',2);
    c.lineWidth=2;c.strokeStyle='#3881c3';c.beginPath();c.arc(W/2,H/2,49,0,Math.PI*2);c.stroke();
    for(const y of [143,H-143])for(const x of [92,W-92]){c.strokeStyle='#cc5262';c.beginPath();c.arc(x,y,34,0,Math.PI*2);c.stroke();c.fillStyle='#cc5262';c.beginPath();c.arc(x,y,3,0,Math.PI*2);c.fill();}
    for(const [y,start,end] of [[WALL,0,Math.PI],[H-WALL,Math.PI,2*Math.PI]]){c.beginPath();c.arc(W/2,y,GOAL*.43,start,end);c.closePath();c.fillStyle='rgba(64,159,204,.18)';c.fill();c.strokeStyle='#ce4253';c.stroke();}
    c.fillStyle='#0b1a33';c.globalAlpha=.12;c.font='700 17px system-ui';c.textAlign='center';c.fillText('COPPER & BLUE',W/2,H/2-12);c.fillText('AIRHOCKEY',W/2,H/2+15);c.globalAlpha=1;
    c.fillStyle='#ce4253';for(const y of [H/2]){c.beginPath();c.arc(W/2,y,4,0,Math.PI*2);c.fill();}
    c.restore();
    for(const y of [0,H-WALL]){c.fillStyle='#12264a';c.fillRect(W/2-GOAL/2,y,GOAL,WALL);c.strokeStyle='#c8763a';c.lineWidth=2;c.strokeRect(W/2-GOAL/2,y,GOAL,WALL);c.strokeStyle='#9fb0cc';c.lineWidth=.5;
      for(let x=W/2-GOAL/2+6;x<W/2+GOAL/2;x+=7){c.beginPath();c.moveTo(x,y);c.lineTo(x,y+WALL);c.stroke();}}
  }
  drawRink();
  let game=null,immersive=false,nativeEntered=false,savedScroll=0,raf=0,last=0,acc=0,activePointer=null,trails=[],audio=null,scoreKey='',finishShown=false,bannerOn=false;
  const keys=new Set(),params=new URLSearchParams(location.search),demo=params.get('demo')==='1';
  const demoSpeed=demo?clamp(Number(params.get('speed'))||1,1,20):1;
  const demoSeed=Number(params.get('seed'))||42;
  const storageKey='cbn-airhockey-v1',hornKey='cbn-airhockey-horn';
  let sound=true;
  const blank=()=>({wins:0,losses:0,streak:0,bestStreak:0,bestWin:null});
  let record=blank();
  try{const r=JSON.parse(localStorage.getItem(storageKey));if(r&&typeof r==='object'){
    for(const k of ['wins','losses','streak','bestStreak'])record[k]=Number.isSafeInteger(r[k])&&r[k]>=0?r[k]:0;
    if(r.bestWin&&r.bestWin.you===7&&Number.isInteger(r.bestWin.copper)&&r.bestWin.copper>=0&&r.bestWin.copper<7)record.bestWin=r.bestWin;
  }}catch(_){/* private mode or full storage: the match still works */}
  try{const v=localStorage.getItem(hornKey);if(v==='off')sound=false;else if(v==='on')sound=true;}catch(_){}
  function recordText(){const text=`${record.wins}W – ${record.losses}L · streak ${record.streak} · best streak ${record.bestStreak}${record.bestWin?' · best win 7–'+record.bestWin.copper:''}`;$('playRecord').textContent=text;$('arenaRecord').textContent=text;}
  recordText();
  function copperFace(c,x,y,r) {
    c.save();c.translate(x,y);c.fillStyle='#c8763a';c.strokeStyle='#0b1a33';c.lineWidth=1.5;
    c.beginPath();c.moveTo(0,-r*.83);c.bezierCurveTo(-r*.2,-r*.25,-r*.72,-r*.15,-r*.65,r*.32);c.bezierCurveTo(-r*.58,r*.98,r*.65,r*.98,r*.67,r*.25);c.bezierCurveTo(r*.7,-r*.2,r*.15,-r*.4,0,-r*.83);c.fill();c.stroke();
    // Bare pointed oil drop, purple black eye and gap-toothed smirk match the full SVG.
    c.fillStyle='#67517f';c.beginPath();c.ellipse(-r*.23,r*.14,r*.2,r*.22,0,0,Math.PI*2);c.fill();
    c.fillStyle='#0b1a33';c.beginPath();c.ellipse(-r*.23,r*.15,r*.085,r*.075,0,0,Math.PI*2);c.fill();c.beginPath();c.ellipse(r*.24,r*.13,r*.09,r*.13,0,0,Math.PI*2);c.fill();
    c.lineWidth=1.7;c.beginPath();c.moveTo(-r*.4,-r*.06);c.lineTo(-r*.09,r*.035);c.moveTo(r*.09,r*.025);c.lineTo(r*.4,-r*.08);c.stroke();
    c.fillStyle='#0b1a33';c.beginPath();c.moveTo(-r*.27,r*.36);c.quadraticCurveTo(0,r*.49,r*.3,r*.27);c.quadraticCurveTo(r*.19,r*.7,-r*.1,r*.57);c.closePath();c.fill();
    c.fillStyle='#fff4df';c.beginPath();c.moveTo(-r*.19,r*.4);c.quadraticCurveTo(r*.03,r*.48,r*.22,r*.35);c.lineTo(r*.17,r*.46);c.quadraticCurveTo(0,r*.57,-r*.14,r*.46);c.fill();
    c.fillStyle='#0b1a33';c.fillRect(-r*.015,r*.42,r*.1,r*.13);c.restore();
  }
  function draw() {
    if(!game)return;const s=game.state,scale=canvas.width/W;ctx.setTransform(scale,0,0,scale,0,0);ctx.drawImage(art,0,0,W,H);
    if(s.phase==='playing'&&!s.paused){trails.push({x:s.puck.x,y:s.puck.y});if(trails.length>7)trails.shift();}
    trails.forEach((p,i)=>{ctx.fillStyle=`rgba(11,26,51,${.035+i*.015})`;ctx.beginPath();ctx.arc(p.x,p.y,R*(i+1)/trails.length,0,Math.PI*2);ctx.fill();});
    for(const [p,you] of [[s.copper,false],[s.you,true]]) {
      // Outer painted edge and circular collider both use exactly PR (1.62x the original radius).
      ctx.beginPath();ctx.arc(p.x,p.y+3,PR,0,Math.PI*2);ctx.fillStyle='rgba(11,26,51,.18)';ctx.fill();
      const fill=ctx.createRadialGradient(p.x-PR*.3,p.y-PR*.4,2,p.x,p.y,PR);
      fill.addColorStop(0,you?'#ff9b57':'#35547b');fill.addColorStop(1,you?'#c8763a':'#0b1a33');
      ctx.beginPath();ctx.arc(p.x,p.y,PR-1,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=you?'#0b1a33':'#c8763a';ctx.lineWidth=2;ctx.stroke();
      ctx.beginPath();ctx.arc(p.x,p.y,PR-7,0,Math.PI*2);ctx.strokeStyle=you?'#ffc291':'#45607b';ctx.lineWidth=2;ctx.stroke();
      if(you){ctx.beginPath();ctx.arc(p.x,p.y,PR*.42,0,Math.PI*2);ctx.fillStyle='#FF4C00';ctx.fill();ctx.strokeStyle='#9f4e21';ctx.lineWidth=2;ctx.stroke();}
      else copperFace(ctx,p.x,p.y-1,PR*.88);
    }
    const q=s.puck;ctx.beginPath();ctx.ellipse(q.x,q.y+3,R+1,R*.8,0,0,Math.PI*2);ctx.fillStyle='rgba(11,26,51,.2)';ctx.fill();
    ctx.fillStyle='#0b1a33';ctx.beginPath();ctx.arc(q.x,q.y,R,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#45607b';ctx.lineWidth=2;ctx.stroke();
    if(s.phase==='faceoff'||s.phase==='goal'){
      ctx.fillStyle='rgba(11,26,51,.87)';rounded(ctx,52,H/2-50,W-104,100,16);ctx.fill();ctx.textAlign='center';ctx.fillStyle='#fff4df';ctx.font='800 29px system-ui';
      ctx.fillText(s.phase==='goal'?'GOAL!':'FACEOFF',W/2,H/2-4);ctx.font='600 13px system-ui';ctx.fillStyle='#f4b37c';ctx.fillText(s.phase==='goal'?(s.lastGoal==='you'?'YOU LIGHT THE LAMP':'COPPER LIGHTS THE LAMP'):'First to 7. Let’s play.',W/2,H/2+24);
    }
    syncCelebration();
  }
  function resize() {
    if(!immersive)return;const wrap=$('pongRink'),available=wrap.getBoundingClientRect();
    const height=Math.max(80,Math.min(available.height,available.width*H/W)),width=height*W/H,dpr=Math.min(devicePixelRatio||1,3);
    canvas.style.width=width+'px';canvas.style.height=height+'px';canvas.width=Math.round(width*dpr);canvas.height=Math.round(canvas.width*H/W);draw();
  }
  function audioCtx() {
    try{const AC=root.AudioContext||root.webkitAudioContext;if(!AC)return null;if(!audio)audio=new AC();return audio;}catch(_){return null;}
  }
  const MEDIA=['goalHorn','copperAww','puckClack','boardThud'];
  const heardAt={clack:-1e9,thud:-1e9};
  function nowMs(){try{if(root.performance&&typeof root.performance.now==='function')return root.performance.now();}catch(_){}return Date.now();}
  // iOS routes Web Audio through the silent switch. HTML media does not, once play() runs in a gesture.
  function mediaSession(){try{if(root.navigator&&root.navigator.audioSession)root.navigator.audioSession.type='playback';}catch(_){}}
  function hiddenTree(el){try{for(let n=el;n&&n.nodeType===1;n=n.parentElement)if(n.hidden)return true;}catch(_){}return false;}
  function primeMedia(el){
    // play() under display:none does not unlock iOS, so skip while an ancestor is hidden.
    if(!el||typeof el.play!=='function'||hiddenTree(el)||el._cbnUnlocking||el._cbnUnlocked)return;
    el._cbnUnlocking=true;
    try{
      el.muted=true;
      const p=el.play();
      const finish=ok=>{try{el.pause();el.currentTime=0;}catch(_){}el.muted=false;el._cbnUnlocking=false;if(ok)el._cbnUnlocked=true;};
      if(p&&typeof p.then==='function')p.then(()=>finish(true)).catch(()=>finish(false));
      else finish(true);
    }catch(_){el._cbnUnlocking=false;el.muted=false;}
  }
  function unlockAudio(){
    mediaSession();
    for(const id of MEDIA)primeMedia($(id));
    const ctx=audioCtx();if(!ctx)return;
    try{
      if(ctx.state==='suspended'&&ctx.resume){const p=ctx.resume();if(p&&typeof p.catch==='function')p.catch(()=>{});}
      if(!ctx._cbnPrimed&&ctx.createBuffer&&ctx.createBufferSource){
        ctx._cbnPrimed=true;const buf=ctx.createBuffer(1,1,ctx.sampleRate||22050),src=ctx.createBufferSource();
        src.buffer=buf;src.connect(ctx.destination);src.start(0);
      }
    }catch(_){/* autoplay unlock is best-effort */}
  }
  function playSample(el,volume){
    if(!sound||!el||typeof el.play!=='function')return false;
    try{
      mediaSession();
      el.muted=false;
      el.volume=Math.max(0,Math.min(1,volume));
      try{el.pause();}catch(_){}
      try{el.currentTime=0;}catch(_){}
      const p=el.play();
      if(p&&typeof p.catch==='function')p.catch(()=>{});
      return true;
    }catch(_){return false;}
  }
  function playContact(kind,speed){
    if(!sound||!Number.isFinite(speed))return;
    const n=nowMs();if(n-heardAt[kind]<40)return;heardAt[kind]=n;
    const vol=kind==='clack'?Math.max(.16,Math.min(.72,.16+.56*Math.min(1,speed/900))):Math.max(.1,Math.min(.4,.1+.3*Math.min(1,speed/750)));
    playSample($(kind==='clack'?'puckClack':'boardThud'),vol);
  }
  let hornCurve=null;
  function distortionCurve() {
    if(hornCurve)return hornCurve;
    const n=1024,curve=new Float32Array(n),k=2.1,norm=Math.tanh(k);
    for(let i=0;i<n;i++){const x=i/(n-1)*2-1;curve[i]=Math.tanh(k*x)/norm;}
    hornCurve=curve;return curve;
  }
  // Original oil-field horn: layered low saw/square tones, slight detune, swell, ~2.8s blast and fade. Not a team recording.
  function playHorn() {
    if(!sound)return;
    if(playSample($('goalHorn'),.85))return;
    const ctx=audio;if(!ctx)return;
    try{
      if(ctx.state==='suspended'&&ctx.resume){const p=ctx.resume();if(p&&typeof p.catch==='function')p.catch(()=>{});}
      const t=ctx.currentTime+.02,dur=2.8;
      const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.Q.value=.7;
      filter.frequency.setValueAtTime(260,t);filter.frequency.exponentialRampToValueAtTime(740,t+.26);filter.frequency.exponentialRampToValueAtTime(340,t+dur);
      const shaper=ctx.createWaveShaper();shaper.curve=distortionCurve();shaper.oversample='2x';
      const master=ctx.createGain();
      master.gain.setValueAtTime(.0001,t);master.gain.exponentialRampToValueAtTime(.18,t+.22);master.gain.linearRampToValueAtTime(.16,t+1.7);master.gain.exponentialRampToValueAtTime(.0001,t+dur);
      filter.connect(shaper);shaper.connect(master);master.connect(ctx.destination);
      const delay=ctx.createDelay(.4),feedback=ctx.createGain(),wet=ctx.createGain();
      delay.delayTime.value=.09;feedback.gain.value=.24;wet.gain.value=.14;
      master.connect(delay);delay.connect(feedback);feedback.connect(delay);delay.connect(wet);wet.connect(ctx.destination);
      for(const [hz,type,vol] of [[104,'sawtooth',.2],[105.6,'sawtooth',.16],[130,'sine',.14],[156,'square',.09],[157.4,'square',.07],[196,'triangle',.05]]){
        const osc=ctx.createOscillator(),g=ctx.createGain();osc.type=type;osc.frequency.value=hz;g.gain.value=vol;
        osc.connect(g);g.connect(filter);osc.start(t);osc.stop(t+dur+.03);
      }
    }catch(_){/* sound is optional */}
  }
  function playAww() {
    if(!sound)return;
    if(playSample($('copperAww'),.45))return;
    const ctx=audio;if(!ctx)return;
    try{
      const t=ctx.currentTime,dur=.48,osc=ctx.createOscillator(),g=ctx.createGain();
      osc.type='triangle';osc.frequency.setValueAtTime(180,t);osc.frequency.exponentialRampToValueAtTime(96,t+.42);
      g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.05,t+.04);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
      osc.connect(g);g.connect(ctx.destination);osc.start(t);osc.stop(t+dur+.02);
    }catch(_){/* sound is optional */}
  }
  function syncCelebration() {
    const banner=$('goalBanner');if(!banner||!game)return;
    const show=game.state.phase==='goal'&&game.state.lastGoal==='you';
    if(show===bannerOn)return;
    bannerOn=show;banner.hidden=!show;banner.className=show?'goal-banner goal-flash':'goal-banner';
  }
  function syncSoundButton() {
    const btn=$('soundGame');if(!btn)return;
    btn.setAttribute('aria-pressed',sound?'true':'false');
    btn.setAttribute('aria-label',sound?'Mute rink sounds':'Unmute rink sounds');
    const label=$('soundLabel');if(label)label.textContent=sound?'Mute':'Unmute';
  }
  const cheers={you:['Nice shot! Copper gives you a glove tap.','Copper: “Okay, that was a beauty!”','Top shelf! Copper wants a rematch.'],copper:['Copper: “Stick with it, you’ve got this!”','Copper: “A little copper magic!”','Copper: “Next faceoff is yours!”']};
  function syncScore(){if(!game)return;const s=game.state,k=s.score.you+':'+s.score.copper;if(k!==scoreKey){$('youScore').textContent=s.score.you;$('copperScore').textContent=s.score.copper;scoreKey=k;}}
  function finish(s) {
    if(finishShown)return;finishShown=true;syncScore();$('pauseGame').disabled=true;
    if(!demo){record=updateRecord(record,s.score,s.winner,s.difficulty);
      try{localStorage.setItem(storageKey,JSON.stringify(record));}catch(_){}recordText();}
    showPanel('over');
  }
  function fresh() {
    finishShown=false;scoreKey='';trails=[];keys.clear();bannerOn=false;document.body.classList.remove('rink-paused');
    const banner=$('goalBanner');if(banner){banner.hidden=true;banner.className='goal-banner';}
    game=create({difficulty:$('playMood').value,demo,demoDifficulty:'normal',...(demo?{rng:seeded(demoSeed)}:{}),
      onPaddle(speed){playContact('clack',speed);},onBoard(speed){playContact('thud',speed);},
      onGoal(side,s){syncScore();if(side==='you')playHorn();else playAww();const text=cheers[side][Math.floor(Math.random()*cheers[side].length)];$('arenaComment').textContent=text;$('gameLive').textContent=`${side==='you'?'You score':'Copper scores'}. You ${s.score.you}, Copper ${s.score.copper}. ${text}`;trails=[];},onFinish:finish,onFreeze(){ $('arenaComment').textContent='Frozen puck. Fresh centre-ice faceoff!'; }});
    $('arenaMood').textContent=MOODS[game.state.difficulty].name+(demo?' · demo':'');$('arenaComment').textContent='Drag your paddle. Own your half.';syncScore();$('pongPanel').hidden=true;$('pauseGame').textContent='Pause';$('pauseGame').disabled=false;$('shareStatus').textContent='';if(immersive)animate();
  }
  function showPanel(kind) {
    document.body.classList.add('rink-paused');
    const s=game.state,over=kind==='over',win=s.winner==='you';
    $('pongPanel').hidden=false;$('panelTitle').textContent=over?(win?'You beat Copper!':'Copper takes this one!'):kind==='restart'?'Fresh ice?':'Taking a breather';
    $('panelCopy').textContent=over?`${s.score.you}–${s.score.copper}. ${win?'Copper: “What a beauty! Rematch?”':'Copper: “Good game! Your next win is coming.”'}${demo?' Demo only — not added to your record.':''}`:kind==='restart'?'Restart this match at 0–0? Your saved record stays.':'Copper is keeping your spot. Resume when you’re ready.';
    $('resumeGame').hidden=over;$('resumeGame').textContent=kind==='restart'?'Keep playing':'Resume';$('againGame').textContent=over?'Play again':'Restart match';$('shareGame').hidden=!over;
    $('resumeGame').hidden?$('againGame').focus():$('resumeGame').focus();
  }
  function pauseGame(reason='pause') {
    if(!game||game.state.phase==='over')return;game.pause(true);keys.clear();activePointer=null;trails=[];acc=0;$('pauseGame').textContent='Resume';showPanel(reason);
  }
  function resumeGame() {if(!game||game.state.phase==='over')return;game.pause(false);document.body.classList.remove('rink-paused');$('pongPanel').hidden=true;$('pauseGame').textContent='Pause';last=0;acc=0;canvas.focus({preventScroll:true});animate();}
  function frame(t) {
    if(!immersive||document.hidden){raf=0;return;}
    const elapsed=last?Math.min((t-last)/1000,.05):STEP;last=t;
    if(game&&!game.state.paused&&game.state.phase!=='over') {
      const s=game.state;
      if(!demo&&keys.size){const dx=(keys.has('ArrowRight')||keys.has('d')?1:0)-(keys.has('ArrowLeft')||keys.has('a')?1:0),dy=(keys.has('ArrowDown')||keys.has('s')?1:0)-(keys.has('ArrowUp')||keys.has('w')?1:0);game.target(s.you.tx+dx*440*elapsed,s.you.ty+dy*440*elapsed);}
      acc+=elapsed*demoSpeed;let n=0;while(acc>=STEP&&n++<180){game.step(STEP);acc-=STEP;} // bounded catch-up; never simulate a hidden-tab backlog
    }
    draw();if(game.state.paused||game.state.phase==='over'){raf=0;return;}raf=requestAnimationFrame(frame);
  }
  function animate(){if(!raf&&!document.hidden&&immersive){last=0;raf=requestAnimationFrame(frame);}}
  function enter(newMatch,userGesture=true) {
    if(immersive)return;savedScroll=scrollY;immersive=true;arena.hidden=false;document.body.classList.add('rink-immersive');document.documentElement.classList.add('rink-lock');
    if(newMatch||!game||game.state.phase==='over')fresh();else{game.pause(true);showPanel('pause');}
    // requestFullscreen must be invoked directly in a user gesture. iPhone uses this same fixed 100dvh overlay.
    if(userGesture&&arena.requestFullscreen){try{Promise.resolve(arena.requestFullscreen({navigationUI:'hide'})).then(()=>{if(immersive)nativeEntered=true;else if(document.fullscreenElement===arena)document.exitFullscreen().catch(()=>{});resize();}).catch(()=>{});}catch(_){}}
    try{if(userGesture&&screen.orientation?.lock)Promise.resolve(screen.orientation.lock('portrait')).then(()=>{if(!immersive)screen.orientation.unlock();}).catch(()=>{});}catch(_){}
    resize();animate();if(newMatch)canvas.focus({preventScroll:true});
  }
  function exit() {
    if(!immersive)return;pauseGame();immersive=false;nativeEntered=false;cancelAnimationFrame(raf);raf=0;keys.clear();activePointer=null;arena.hidden=true;
    document.body.classList.remove('rink-immersive');document.body.classList.remove('rink-paused');document.documentElement.classList.remove('rink-lock');
    if(document.fullscreenElement===arena)try{document.exitFullscreen().catch(()=>{});}catch(_){}
    try{screen.orientation?.unlock();}catch(_){}
    $('startGame').textContent=game?.state.phase==='over'?'Play Copper again':'Resume match';$('newGame').hidden=!game||game.state.phase==='over';window.scrollTo(0,savedScroll);$('startGame').focus({preventScroll:true});
  }
  function bindUnlock(id){const el=$(id);if(!el)return;el.addEventListener('pointerdown',unlockAudio);el.addEventListener('touchstart',unlockAudio,{passive:false});}
  bindUnlock('startGame');bindUnlock('newGame');bindUnlock('soundGame');bindUnlock('pongArena');
  $('startGame').addEventListener('click',()=>{enter(!game||game.state.phase==='over');unlockAudio();});
  $('newGame').addEventListener('click',()=>{game=null;enter(true);unlockAudio();});
  $('exitGame').addEventListener('click',exit);
  $('pauseGame').addEventListener('click',()=>game.state.paused?resumeGame():pauseGame());
  $('restartGame').addEventListener('click',()=>game.state.phase==='over'?fresh():pauseGame('restart'));
  $('resumeGame').addEventListener('click',resumeGame);
  $('againGame').addEventListener('click',()=>{fresh();last=0;acc=0;canvas.focus({preventScroll:true});});
  $('panelExit').addEventListener('click',exit);
  $('soundGame').addEventListener('click',()=>{
    unlockAudio();sound=!sound;try{localStorage.setItem(hornKey,sound?'on':'off');}catch(_){}syncSoundButton();
  });
  syncSoundButton();
  document.addEventListener('pointerdown',unlockAudio);
  document.addEventListener('touchstart',unlockAudio,{passive:true});
  $('shareGame').addEventListener('click',async()=>{
    const s=game.state,text=s.winner==='you'?`I beat Copper ${s.score.you}-${s.score.copper} in AirHockey with Copper on copperandbluenews.com 🏒`:`Copper beat me ${s.score.copper}-${s.score.you} in AirHockey with Copper on copperandbluenews.com 🏒. Can you beat Copper?`;
    try{if(navigator.share){await navigator.share({title:'AirHockey with Copper',text,url:'https://copperandbluenews.com/play.html'});$('shareStatus').textContent='Shared!';}
      else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);$('shareStatus').textContent='Score copied!';}
      else{$('shareStatus').textContent=text;}
    }catch(e){if(e.name!=='AbortError')$('shareStatus').textContent=text;}
  });
  function pointer(e) {
    if(!game||game.state.paused||demo)return;const box=canvas.getBoundingClientRect(),pos=pointerTarget(e.clientX,e.clientY,box,e.pointerType==='touch');game.target(pos.x,pos.y);
  }
  canvas.addEventListener('touchstart',unlockAudio,{passive:false});
  canvas.addEventListener('pointerdown',e=>{unlockAudio();if(e.pointerType==='mouse'&&e.button!==0)return;if(e.pointerType!=='touch')e.preventDefault();activePointer=e.pointerId;try{canvas.setPointerCapture(e.pointerId);}catch(_){}pointer(e);});
  canvas.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'||e.pointerId===activePointer){e.preventDefault();pointer(e);}});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>{activePointer=null;});
  arena.addEventListener('touchmove',e=>{if(immersive&&$('pongPanel').hidden)e.preventDefault();},{passive:false});
  arena.addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('keydown',e=>{
    if(!immersive)return;
    if(e.key==='Escape'){e.preventDefault();exit();return;}
    if(e.code==='Space'&&e.target===canvas){e.preventDefault();game.state.paused?resumeGame():pauseGame();return;}
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','w','a','s','d'].includes(e.key)&&e.target===canvas){e.preventDefault();keys.add(e.key);}
    // Keep keyboard focus inside the visible pause/result dialog.
    if(e.key==='Tab'&&!$('pongPanel').hidden){const all=[...$('pongPanel').querySelectorAll('button')].filter(b=>!b.hidden),first=all[0],end=all[all.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();end.focus();}else if(!e.shiftKey&&document.activeElement===end){e.preventDefault();first.focus();}}
  });
  document.addEventListener('keyup',e=>keys.delete(e.key));
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&immersive){pauseGame();cancelAnimationFrame(raf);raf=0;last=0;acc=0;}else animate();});
  window.addEventListener('pagehide',()=>{if(immersive)exit();});
  document.addEventListener('fullscreenchange',()=>{if(document.fullscreenElement===arena){nativeEntered=true;resize();}else if(nativeEntered&&immersive)exit();});
  window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(resize).observe($('pongRink'));
  if(demo){
    enter(true,false);
    unlockAudio();
    // Deterministic demo replay for offline QA/screenshots; advance actual physics, never assign a score.
    const at=clamp(Number(params.get('at'))||0,0,300);
    for(let i=0;i<at/STEP&&game.state.phase!=='over';i++)game.step(STEP);
    if(params.get('hold')==='1'){cancelAnimationFrame(raf);raf=0;last=0;acc=0;}
    draw();
  }
})(typeof globalThis!=='undefined'?globalThis:this);
