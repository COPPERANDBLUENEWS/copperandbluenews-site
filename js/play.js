/* AirHockey with Copper. Original art, offline, no dependencies or network calls.
   Fixed 120 Hz simulation; requestAnimationFrame display; shared engine exported for Node tests. */
(function (root) {
  'use strict';
  const W = 360, H = 620, WALL = 14, GOAL = 208, BH = 44, BR = 12, FRONT = 19, BACK = 74, SX = 56, R = 8, MAX = 930, STEP = 1 / 120;
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
    return {x:(clientX-box.left)*W/box.width,y:(clientY-box.top)*H/box.height-(touch?38*H/box.height:0)};
  }
  function seeded(seed) {return () => {seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296;};}
  const LOCAL_STICK = [
    {ax:-44,ay:3,bx:0,by:0,r:BR,part:'blade'},
    {ax:0,ay:0,bx:44,by:-7,r:BR,part:'blade'},
    {ax:-44,ay:3,bx:-20,by:60,r:6,part:'shaft'},
    {ax:-20,ay:60,bx:-20,by:60,r:14,part:'knob'}
  ];
  function paddle(y) {return {x:W/2,y,bottom:y>H/2,vx:0,vy:0,tx:W/2,ty:y,think:0};}
  function stickSegments(p) {
    const d=p.bottom?1:-1;
    return LOCAL_STICK.map(s=>({...s,ax:p.x+s.ax*d,ay:p.y+s.ay*d,bx:p.x+s.bx*d,by:p.y+s.by*d}));
  }
  function closest(segment,x,y) {
    const dx=segment.bx-segment.ax,dy=segment.by-segment.ay,l2=dx*dx+dy*dy;
    const t=l2?clamp(((x-segment.ax)*dx+(y-segment.ay)*dy)/l2,0,1):0;
    const cx=segment.ax+t*dx,cy=segment.ay+t*dy;
    return {x:cx,y:cy,dx:x-cx,dy:y-cy,d:Math.hypot(x-cx,y-cy)};
  }
  function create(options = {}) {
    const mood = MOODS[options.difficulty] ? options.difficulty : 'normal';
    const state = {difficulty:mood, phase:'faceoff', timer:.9, score:{you:0,copper:0}, winner:null, paused:false,
      puck:{x:W/2,y:H/2,vx:0,vy:0}, you:paddle(H-132), copper:paddle(132), goals:0, time:0, stillTime:0, regionTime:0, regionX:W/2, regionY:H/2, laneTime:0};
    const rng = options.rng || Math.random;
    const api = {state, step, target, pause(v) {state.paused = !!v;}, constants:{W,H,WALL,GOAL,BH,BR,FRONT,BACK,SX,R,MAX,STEP}};
    function target(x,y) {state.you.tx=clamp(x,WALL+SX,W-WALL-SX);state.you.ty=clamp(y,H/2+FRONT+10,H-WALL-BACK-10);}
    function resetPositions() {
      Object.assign(state.puck,{x:W/2,y:H/2,vx:0,vy:0});state.regionTime=0;state.regionX=W/2;state.regionY=H/2;state.laneTime=0;
      Object.assign(state.you,paddle(H-132)); Object.assign(state.copper,paddle(132));
    }
    function serve() {
      const angle=(rng()-.5)*1.2, dir=rng()<.5 ? -1:1;
      state.puck.vx=Math.sin(angle)*280;state.puck.vy=Math.cos(angle)*280*dir;state.phase='playing';
    }
    function move(p, speed, dt, bottom) {
      p.tx=clamp(p.tx,WALL+SX,W-WALL-SX);p.ty=clamp(p.ty,bottom?H/2+FRONT+10:WALL+BACK+10,bottom?H-WALL-BACK-10:H/2-FRONT-10);
      const dx=p.tx-p.x,dy=p.ty-p.y,d=Math.hypot(dx,dy),s=d?Math.min(speed,d/dt)/d:0;
      p.vx=dx*s;p.vy=dy*s;p.x+=p.vx*dt;p.y+=p.vy*dt;
    }
    function ai(p, cfg, dt, bottom) {
      p.think-=dt; if(p.think>0)return; p.think=cfg.reaction;
      const q=state.puck, qy=bottom?H-q.y:q.y, py=bottom?H-p.y:p.y;
      const jitter=(rng()-.5)*2*cfg.error;
      if(qy < WALL+BACK+R+10) {
        // Don't seal the puck behind the long shaft/knob against our end boards: back off and free it.
        p.tx=clamp(q.x+jitter,WALL+SX,W-WALL-SX);p.ty=bottom?H-166:166;
      } else if(qy < H/2+10) {
        p.tx=q.x+jitter*.5;
        // Get behind the puck, then drive through it toward the other goal.
        const lined=Math.abs(p.x-q.x)<BH*.8 && py<qy-BR-4;
        const ty=lined?qy+40*cfg.attack:qy-BR-R-10;
        p.ty=bottom?H-ty:ty;
      } else {
        let x=q.x;const vy=bottom?-q.vy:q.vy;
        if(vy<0) {
          x+=q.vx*((106-qy)/vy);
          const lo=WALL+R, span=W-2*lo, v=((x-lo)%(2*span)+2*span)%(2*span);
          x=lo+(v>span?2*span-v:v);
        }
        p.tx=clamp(x+jitter,WALL+SX,W-WALL-SX);p.ty=bottom?H-106:106;
      }
    }
    function cap() {const q=state.puck,s=Math.hypot(q.vx,q.vy);if(s>MAX){q.vx*=MAX/s;q.vy*=MAX/s;}}
    function collide(p) {
      const q=state.puck,shape=stickSegments(p);
      const legal=(x,y)=>withinRink(x,y);
      const clear=(x,y)=>shape.every(s=>closest(s,x,y).d>=s.r+R-.02);
      // The visible curved blade, shaft and knob are exactly this union of capsules.
      for(let pass=0;pass<3;pass++) {
        let hit=null,point=null,depth=0;
        for(const s of shape){const c=closest(s,q.x,q.y),pen=s.r+R-c.d;if(pen>depth){hit=s;point=c;depth=pen;}}
        if(!hit||depth<.001)break;
        const sum=hit.r+R;
        let nx=point.d?point.dx/point.d:0,ny=point.d?point.dy/point.d:(p.bottom?-1:1);
        let cx=point.x+nx*(sum+.1),cy=point.y+ny*(sum+.1);
        if(!legal(cx,cy)||!clear(cx,cy)) {
          let best=Infinity;
          for(let i=0;i<48;i++){const angle=i*Math.PI/24,x=point.x+Math.cos(angle)*(sum+.1),y=point.y+Math.sin(angle)*(sum+.1);
            if(legal(x,y)&&clear(x,y)){const cost=(x-q.x)**2+(y-q.y)**2;if(cost<best){best=cost;cx=x;cy=y;nx=Math.cos(angle);ny=Math.sin(angle);}}}
          if(!Number.isFinite(best)) {
            // Rare compound-shape corner: search capsule endpoints for the nearest free separation.
            for(const s of shape)for(const t of [0,.5,1])for(let i=0;i<24;i++) {
              const angle=i*Math.PI/12,px=s.ax+(s.bx-s.ax)*t,py=s.ay+(s.by-s.ay)*t;
              const x=px+Math.cos(angle)*(s.r+R+.1),y=py+Math.sin(angle)*(s.r+R+.1);
              if(legal(x,y)&&clear(x,y)){const cost=(x-q.x)**2+(y-q.y)**2;if(cost<best){best=cost;cx=x;cy=y;const d=Math.hypot(x-point.x,y-point.y);nx=d?(x-point.x)/d:0;ny=d?(y-point.y)/d:(p.bottom?-1:1);}}
            }
          }
        }
        q.x=cx;q.y=cy;
        const vn=(q.vx-p.vx)*nx+(q.vy-p.vy)*ny;
        if(vn<0){q.vx-=1.92*vn*nx;q.vy-=1.92*vn*ny;q.vx+=p.vx*.14;q.vy+=p.vy*.14;cap();}
      }
    }
    function post(x,y) {
      const q=state.puck,dx=q.x-x,dy=q.y-y,d=Math.hypot(dx,dy),sum=R+3;
      if(!d||d>=sum)return;const nx=dx/d,ny=dy/d; q.x=x+nx*(sum+.05);q.y=y+ny*(sum+.05);
      const vn=q.vx*nx+q.vy*ny;if(vn<0){q.vx-=1.96*vn*nx;q.vy-=1.96*vn*ny;}
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
      if(q.x<WALL+R){q.x=WALL+R;q.vx=Math.abs(q.vx)*.99;}
      if(q.x>W-WALL-R){q.x=W-WALL-R;q.vx=-Math.abs(q.vx)*.99;}
      const mouth=Math.abs(q.x-W/2)<GOAL/2-R;
      if(!mouth) {
        if(q.y<WALL+R){q.y=WALL+R;q.vy=Math.abs(q.vy)*.99;}
        if(q.y>H-WALL-R){q.y=H-WALL-R;q.vy=-Math.abs(q.vy)*.99;}
      }
      // The rink art has rounded corners: reflect from the same quarter-circle, not an invisible square corner.
      const cornerX=q.x<WALL+25?WALL+25:q.x>W-WALL-25?W-WALL-25:null;
      const cornerY=q.y<WALL+25?WALL+25:q.y>H-WALL-25?H-WALL-25:null;
      if(cornerX!==null&&cornerY!==null){const dx=q.x-cornerX,dy=q.y-cornerY,d=Math.hypot(dx,dy),radius=25-R;
        if(d>radius){const nx=dx/d,ny=dy/d;q.x=cornerX+nx*radius;q.y=cornerY+ny*radius;const vn=q.vx*nx+q.vy*ny;if(vn>0){q.vx-=1.98*vn*nx;q.vy-=1.98*vn*ny;}}}
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
  const lib={create,seeded,updateRecord,stickSegments,closest,withinRink,pointerTarget,MOODS,constants:{W,H,WALL,GOAL,BH,BR,FRONT,BACK,SX,R,MAX,STEP}};
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
  let game=null,immersive=false,nativeEntered=false,savedScroll=0,raf=0,last=0,acc=0,activePointer=null,trails=[],sound=false,audio=null,scoreKey='',finishShown=false;
  const keys=new Set(),params=new URLSearchParams(location.search),demo=params.get('demo')==='1';
  const demoSpeed=demo?clamp(Number(params.get('speed'))||1,1,20):1;
  const demoSeed=Number(params.get('seed'))||42;
  const storageKey='cbn-airhockey-v1';
  const blank=()=>({wins:0,losses:0,streak:0,bestStreak:0,bestWin:null});
  let record=blank();
  try{const r=JSON.parse(localStorage.getItem(storageKey));if(r&&typeof r==='object'){
    for(const k of ['wins','losses','streak','bestStreak'])record[k]=Number.isSafeInteger(r[k])&&r[k]>=0?r[k]:0;
    if(r.bestWin&&r.bestWin.you===7&&Number.isInteger(r.bestWin.copper)&&r.bestWin.copper>=0&&r.bestWin.copper<7)record.bestWin=r.bestWin;
  }}catch(_){/* private mode or full storage: the match still works */}
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
      const shape=stickSegments(p);
      const stroke=(segments,color,inset=0,shadow=0)=>{ctx.strokeStyle=color;ctx.lineCap='round';ctx.lineJoin='round';
        for(const seg of segments){ctx.lineWidth=seg.r*2-inset;ctx.beginPath();ctx.moveTo(seg.ax,seg.ay+shadow);ctx.lineTo(seg.bx,seg.by+shadow);ctx.stroke();}};
      stroke(shape,'rgba(11,26,51,.17)',-4,3);
      stroke(shape.filter(s=>s.part==='shaft'),'#0b1a33');stroke(shape.filter(s=>s.part==='shaft'),you?'#c8763a':'#24416c',3);
      const blade=shape.filter(s=>s.part==='blade');stroke(blade,'#0b1a33');stroke(blade,you?'#FF4C00':'#12264a',3);
      // Small tape/grip markings follow the same fixed blade curve; no invisible round mallet remains.
      ctx.save();ctx.translate(p.x,p.y);if(!you)ctx.rotate(Math.PI);ctx.strokeStyle=you?'#ffd4b0':'#c8763a';ctx.lineWidth=1.5;
      for(const x of [-18,-7,4,15]){ctx.beginPath();ctx.moveTo(x,-8-x*.1);ctx.lineTo(x,8-x*.1);ctx.stroke();}ctx.restore();
      const k=shape.find(s=>s.part==='knob');ctx.beginPath();ctx.arc(k.ax,k.ay,k.r,0,Math.PI*2);ctx.fillStyle=you?'#c8763a':'#0b1a33';ctx.fill();ctx.strokeStyle=you?'#0b1a33':'#c8763a';ctx.lineWidth=2;ctx.stroke();
      if(!you)copperFace(ctx,k.ax,k.ay,k.r*.87);
    }
    const q=s.puck;ctx.beginPath();ctx.ellipse(q.x,q.y+3,R+1,R*.8,0,0,Math.PI*2);ctx.fillStyle='rgba(11,26,51,.2)';ctx.fill();
    ctx.fillStyle='#0b1a33';ctx.beginPath();ctx.arc(q.x,q.y,R,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#45607b';ctx.lineWidth=2;ctx.stroke();
    if(s.phase==='faceoff'||s.phase==='goal'){
      ctx.fillStyle='rgba(11,26,51,.87)';rounded(ctx,52,H/2-50,W-104,100,16);ctx.fill();ctx.textAlign='center';ctx.fillStyle='#fff4df';ctx.font='800 29px system-ui';
      ctx.fillText(s.phase==='goal'?'GOAL!':'FACEOFF',W/2,H/2-4);ctx.font='600 13px system-ui';ctx.fillStyle='#f4b37c';ctx.fillText(s.phase==='goal'?(s.lastGoal==='you'?'YOU LIGHT THE LAMP':'COPPER LIGHTS THE LAMP'):'First to 7. Let’s play.',W/2,H/2+24);
    }
  }
  function resize() {
    if(!immersive)return;const wrap=$('pongRink'),available=wrap.getBoundingClientRect();
    const height=Math.max(80,Math.min(available.height,available.width*H/W)),width=height*W/H,dpr=Math.min(devicePixelRatio||1,3);
    canvas.style.width=width+'px';canvas.style.height=height+'px';canvas.width=Math.round(width*dpr);canvas.height=Math.round(canvas.width*H/W);draw();
  }
  function horn() {
    if(!sound||!audio)return;
    try{const t=audio.currentTime,g=audio.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.065,t+.03);g.gain.exponentialRampToValueAtTime(.001,t+.45);g.connect(audio.destination);
      for(const hz of [146.8,196]){const o=audio.createOscillator();o.type='sawtooth';o.frequency.value=hz;o.connect(g);o.start(t);o.stop(t+.46);}
    }catch(_){/* sound is optional */}
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
    finishShown=false;scoreKey='';trails=[];keys.clear();document.body.classList.remove('rink-paused');
    game=create({difficulty:$('playMood').value,demo,demoDifficulty:'normal',...(demo?{rng:seeded(demoSeed)}:{}),
      onGoal(side,s){syncScore();horn();const text=cheers[side][Math.floor(Math.random()*cheers[side].length)];$('arenaComment').textContent=text;$('gameLive').textContent=`${side==='you'?'You score':'Copper scores'}. You ${s.score.you}, Copper ${s.score.copper}. ${text}`;trails=[];},onFinish:finish,onFreeze(){ $('arenaComment').textContent='Frozen puck. Fresh centre-ice faceoff!'; }});
    $('arenaMood').textContent=MOODS[game.state.difficulty].name+(demo?' · demo':'');$('arenaComment').textContent='Drag your stick. Own your half.';syncScore();$('pongPanel').hidden=true;$('pauseGame').textContent='Pause';$('pauseGame').disabled=false;$('shareStatus').textContent='';if(immersive)animate();
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
  $('startGame').addEventListener('click',()=>enter(!game||game.state.phase==='over'));
  $('newGame').addEventListener('click',()=>{game=null;enter(true);});
  $('exitGame').addEventListener('click',exit);
  $('pauseGame').addEventListener('click',()=>game.state.paused?resumeGame():pauseGame());
  $('restartGame').addEventListener('click',()=>game.state.phase==='over'?fresh():pauseGame('restart'));
  $('resumeGame').addEventListener('click',resumeGame);
  $('againGame').addEventListener('click',()=>{fresh();last=0;acc=0;canvas.focus({preventScroll:true});});
  $('panelExit').addEventListener('click',exit);
  $('soundGame').addEventListener('click',()=>{
    sound=!sound;if(sound){try{const Audio=root.AudioContext||root.webkitAudioContext;if(!Audio)throw Error('unavailable');audio=audio||new Audio();audio.resume().catch(()=>{});}catch(_){sound=false;}}
    $('soundGame').textContent=sound?'Sound on':'Sound off';$('soundGame').setAttribute('aria-pressed',String(sound));
  });
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
  canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();activePointer=e.pointerId;try{canvas.setPointerCapture(e.pointerId);}catch(_){}pointer(e);});
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
    // Deterministic demo replay for offline QA/screenshots; advance actual physics, never assign a score.
    const at=clamp(Number(params.get('at'))||0,0,300);
    for(let i=0;i<at/STEP&&game.state.phase!=='over';i++)game.step(STEP);
    draw();
  }
})(typeof globalThis!=='undefined'?globalThis:this);
