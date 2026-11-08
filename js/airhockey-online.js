/* Online head-to-head for AirHockey with Copper.
   Accounts are a username plus a device token. The rink still renders with js/play.js.
   Single-player Copper is unchanged: this file only takes the arena while ownsArena is set.
   The server stays authoritative. This client predicts its own paddle, renders the puck and
   the opponent about 100 ms behind a snapshot buffer, and reconnects with the same device
   token inside the 15 s grace. iOS Safari/PWA: visibility, pageshow, online, and connection
   changes probe the socket and reconnect if the background or a network swap killed it. */
(function (root) {
  'use strict';
  const lib = root.CopperAirHockey;
  const net = root.CbnAirNet;
  const $ = id => document.getElementById(id);
  if (!lib || !net || !$('onlineCard')) return;
  const W = lib.constants.W, H = lib.constants.H, PR = lib.constants.PR, WALL = lib.constants.WALL;
  const KEY = 'cbn-airhockey-online', SHOW_CODE = 'cbn-airhockey-recovery-show';
  const owns = {ownsArena: false};
  root.CbnAirOnline = owns;

  function workerBase() {
    const host = location.hostname;
    const q = new URLSearchParams(location.search).get('api');
    if (q && (host === 'localhost' || host === '127.0.0.1')) {
      try {
        const u = new URL(q);
        if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
      } catch (_) {}
    }
    return String((root.CBN_CONFIG && root.CBN_CONFIG.WORKER_URL) || '').replace(/\/$/, '');
  }
  const base = workerBase();
  const params = new URLSearchParams(location.search);
  const roomParam = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let account = null, pollTimer = 0, ws = null, raf = 0, last = 0, match = null, seat = 's';
  let currSnap = null, phase = '', bannerOn = false, bannerKind = '', bannerUntil = 0, quitting = false;
  let reconnectUntil = 0, savedScroll = 0, prevMood = '';
  const pred = {x: W / 2, y: H - 132, tx: W / 2, ty: H - 132};
  let buf = net.createBuffer(100), bufGn = 0, lastN = -1, inputSeq = 0, lastSend = 0, lastSent = null;
  let pingSeq = 0, pingAt = 0, lastRx = 0, localRtt = -1, lastQ = 0, attempt = 0, reconnectTimer = 0;
  let oppGraceMs = 0, serverPing = {you: -1, opp: -1}, linkMode = '', seenOt = false, holdReconnect = false;
  let youRec = null, oppRec = null, wakeAt = 0, probeToken = 0, publicView = null;

  function loadAccount() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && v.token && v.username) return v; } catch (_) {}
    return null;
  }
  function saveAccount(user, token) {
    account = Object.assign({}, user, {token, email: user.email || null});
    try { localStorage.setItem(KEY, JSON.stringify({id: account.id, username: account.username, token: account.token})); } catch (_) {}
    return account;
  }
  function say(text, bad) {
    const el = $('accountMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = bad ? 'play-help ah-err' : 'play-help';
  }
  function show(id) {
    for (const key of ['accountGate', 'loginPanel', 'recoveryPanel', 'onlineMenu', 'queueBox', 'roomBox', 'leaderBox']) {
      const el = $(key);
      if (el) el.hidden = key !== id;
    }
  }
  function statLine(a) {
    const diff = a.diff || 0;
    return 'Rating ' + (a.rating || 1000) + ' · ' + (a.gp || 0) + ' GP · W-L-T/OTL ' + (a.wins || 0) + '-' + (a.losses || 0) + '-' + (a.ties || 0) + '/' + (a.otl || 0) +
      ' · GF ' + (a.gf || 0) + ' GA ' + (a.ga || 0) + ' · ' + (diff > 0 ? '+' : '') + diff + ' · ' + Number(a.gpg || 0).toFixed(2) + ' GPG';
  }
  function hello() {
    if (!account) return;
    if ($('onlineHello')) $('onlineHello').textContent = '';
    const card = $('profileCard');
    if (!card) return;
    card.hidden = false;
    $('profileName').textContent = account.username;
    $('profileLine').textContent = statLine(account);
  }
  async function api(path, opts) {
    opts = opts || {};
    const headers = {};
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (account && account.token) headers.Authorization = 'Bearer ' + account.token;
    const res = await fetch(base + path, {method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store'});
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && account && path !== '/airhockey/login') {
      try { localStorage.removeItem(KEY); } catch (_) {}
      account = null;
      show('accountGate');
    }
    if (!res.ok) {
      const err = new Error(data.error || 'Something went wrong.');
      err.status = res.status;
      throw err;
    }
    return data;
  }
  function stopPoll() { clearInterval(pollTimer); pollTimer = 0; }

  function clampOwn(x, y) {
    return {
      x: Math.max(WALL + PR, Math.min(W - WALL - PR, x)),
      y: Math.max(H / 2 + PR + 10, Math.min(H - WALL - PR - 10, y)),
    };
  }
  function toView(x, y) { return seat === 's' ? {x, y} : {x: W - x, y: H - y}; }
  function mineCode(code) { return (seat === 's' && code === 's') || (seat === 'n' && code === 'n'); }
  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  function maybeSend(force) {
    if (!owns.ownsArena || phase === 'o' || phase === 'a') return;
    const now = performance.now();
    if (!force && now - lastSend < 50) return;
    const x = +pred.tx.toFixed(1), y = +pred.ty.toFixed(1);
    if (!force && lastSent && lastSent.x === x && lastSent.y === y && now - lastSend < 150) return;
    lastSend = now;
    lastSent = {x, y};
    inputSeq++;
    send({t: 'i', s: inputSeq, x: x, y: y, ts: Math.round(now)});
  }

  function hideBanner() {
    if (!bannerOn) return;
    bannerOn = false;
    bannerKind = '';
    bannerUntil = 0;
    const banner = $('goalBanner');
    if (!banner) return;
    banner.hidden = true;
    banner.className = 'goal-banner';
  }
  function showBanner(name) {
    const banner = $('goalBanner'), title = $('goalBannerTitle'), kick = $('goalBannerKicker');
    if (kick) kick.textContent = 'Goal';
    if (title) title.textContent = name + ' lights the lamp!';
    if (!banner) return;
    banner.hidden = false;
    banner.className = 'goal-banner goal-flash';
    bannerOn = true;
    bannerKind = 'goal';
    if ($('gameLive')) $('gameLive').textContent = name + ' lights the lamp!';
    lib.clearTrails();
  }
  function flashCall(kicker, title, ms) {
    const banner = $('goalBanner');
    if ($('goalBannerKicker')) $('goalBannerKicker').textContent = kicker;
    if ($('goalBannerTitle')) $('goalBannerTitle').textContent = title;
    if (!banner) return;
    banner.hidden = false;
    banner.className = 'goal-banner goal-flash';
    bannerOn = true;
    bannerKind = kicker.toLowerCase();
    bannerUntil = performance.now() + ms;
    if ($('gameLive')) $('gameLive').textContent = title;
  }
  function playEvent(ev) {
    if (ev.k === 'g') {
      const mine = mineCode(ev.s);
      if (mine) lib.playHorn(); else lib.playAww();
      showBanner(ev.n || (mine ? (match && match.you) : (match && match.opponent)) || 'Goal');
    } else if (ev.k === 'c') lib.playContact('clack', ev.sp);
    else if (ev.k === 'b') lib.playContact('thud', ev.sp);
    else if (ev.k === 'z' && $('arenaComment')) $('arenaComment').textContent = 'Frozen puck. Fresh faceoff.';
  }

  function showLink(text, bad) {
    const el = $('linkBanner');
    if (!el) return;
    el.hidden = false;
    el.className = bad ? 'ah-link ah-link-bad' : 'ah-link';
    if ($('linkBannerText')) $('linkBannerText').textContent = text;
    linkMode = bad ? 'left' : linkMode;
  }
  function hideLink() {
    const el = $('linkBanner');
    if (el) { el.hidden = true; el.className = 'ah-link'; }
  }
  function paintLink() {
    if (linkMode === 'left') { showLink('Opponent left', true); return; }
    if (owns.ownsArena && (!ws || ws.readyState !== 1) && phase !== 'o' && phase !== 'a') { showLink('Reconnecting…', false); return; }
    if (oppGraceMs > 0 && phase !== 'o' && phase !== 'a' && phase !== 'w') {
      showLink('Opponent reconnecting… (' + Math.max(1, Math.ceil(oppGraceMs / 1000)) + 's)', false);
      return;
    }
    hideLink();
  }
  function setBars(id, ms) {
    const el = $(id);
    if (el) el.dataset.bars = String(net.pingBars(ms));
  }
  function paintPing() {
    const you = localRtt >= 0 ? localRtt : serverPing.you;
    const opp = serverPing.opp;
    if ($('pingYou')) $('pingYou').textContent = you >= 0 ? Math.round(you) + ' ms' : '–';
    if ($('pingOpp')) $('pingOpp').textContent = opp >= 0 ? Math.round(opp) + ' ms' : '–';
    setBars('barsYou', you);
    setBars('barsOpp', opp);
    if ($('pingOppName')) $('pingOppName').textContent = (match && match.opponent) || 'OPP';
  }
  function bits(r) {
    if (!r) return {line: '0-0-0-0', elo: 'Elo 1000'};
    const w = r.w || 0, l = r.l || 0, t = r.t || 0, o = r.o || 0, elo = r.elo || 1000;
    return {line: w + '-' + l + '-' + t + '-' + o, elo: 'Elo ' + elo};
  }
  function showVs() {
    const el = $('vsIntro');
    if (!el) return;
    el.hidden = false;
    if ($('vsYouName')) $('vsYouName').textContent = (match && match.you) || 'You';
    if ($('vsOppName')) $('vsOppName').textContent = (match && match.opponent) || 'Opponent';
    const y = bits(youRec), o = bits(oppRec);
    if ($('vsYouRec')) $('vsYouRec').textContent = y.line;
    if ($('vsYouElo')) $('vsYouElo').textContent = y.elo;
    if ($('vsOppRec')) $('vsOppRec').textContent = o.line;
    if ($('vsOppElo')) $('vsOppElo').textContent = o.elo;
  }
  function hideVs() { const el = $('vsIntro'); if (el) el.hidden = true; }

  function showPanel(title, copy, rematch) {
    document.body.classList.add('rink-paused');
    $('pongPanel').hidden = false;
    $('panelTitle').textContent = title;
    $('panelCopy').textContent = copy;
    $('resumeGame').hidden = true;
    $('againGame').hidden = !rematch;
    $('againGame').textContent = 'Rematch';
    $('shareGame').hidden = true;
    $('panelExit').hidden = false;
    $('panelExit').textContent = 'Back to lobby';
  }
  function hidePanel() {
    if ($('pongPanel').hidden) return;
    $('pongPanel').hidden = true;
    document.body.classList.remove('rink-paused');
  }
  function fromCareer(c) {
    if (!c) return null;
    return {id: c.id, name: c.username, w: c.wins || 0, l: c.losses || 0, t: c.ties || 0, o: c.otl || 0, elo: c.rating || 1000};
  }
  function lineChange(before, after) {
    if (!before || !after) return '';
    const d = after.elo - before.elo;
    return (after.name || before.name) + '  ' + before.w + '-' + before.l + '-' + before.t + '-' + before.o +
      ' → ' + after.w + '-' + after.l + '-' + after.t + '-' + after.o +
      '   Elo ' + before.elo + ' → ' + after.elo + ' (' + (d > 0 ? '+' : '') + d + ')';
  }
  function applyRecord(records) {
    if (!records || !account) return;
    const rec = records[account.id] || Object.values(records).find(r => r.username === account.username);
    if (!rec) return;
    Object.assign(account, rec, {token: account.token});
    if (youRec && records[youRec.id]) youRec = fromCareer(records[youRec.id]);
    if (oppRec && records[oppRec.id]) oppRec = fromCareer(records[oppRec.id]);
    hello();
  }
  let shownGn = -1;
  function showOver(msg) {
    const gn = msg.gn || 1;
    const first = shownGn !== gn;
    shownGn = gn;
    phase = 'o';
    hideVs();
    const delta = [lineChange(youRec, youRec && msg.records ? fromCareer(msg.records[youRec.id]) : null),
      lineChange(oppRec, oppRec && msg.records ? fromCareer(msg.records[oppRec.id]) : null)].filter(Boolean).join('\n');
    if (msg.records) applyRecord(msg.records);
    if (!first && !msg.records) return;
    const tie = !!msg.tie;
    const win = !tie && mineCode(msg.w);
    const mine = seat === 's' ? msg.sc[0] : msg.sc[1];
    const opp = seat === 's' ? msg.sc[1] : msg.sc[0];
    const who = tie ? 'Overtime tie' : win ? 'You take it!' : ((match && match.opponent) || 'Opponent') + ' takes it!';
    const sentence = (msg.forfeit ? 'Opponent left. ' : '') + (msg.ot ? (tie ? 'Still tied after overtime.' : 'Won in sudden death.') : (tie ? 'Level after two minutes.' : 'That’s the final.'));
    if ($('panelKicker')) { $('panelKicker').hidden = false; $('panelKicker').textContent = msg.forfeit ? 'Forfeit' : tie ? 'Tie' : 'Final'; }
    if ($('panelScore')) { $('panelScore').hidden = false; $('panelScore').textContent = mine + ' – ' + opp; }
    if ($('panelDelta')) { $('panelDelta').hidden = !delta; $('panelDelta').textContent = delta; }
    if ($('panelMascot')) $('panelMascot').hidden = true;
    if ($('arenaRecord')) $('arenaRecord').hidden = true;
    if (msg.forfeit) linkMode = 'left';
    showPanel(who, sentence, true);
    if ($('arenaComment')) $('arenaComment').textContent = who;
    paintLink();
  }

  let clkMs = 120000, clkAt = 0, clkRun = false, clkOt = false;
  function paintClock() {
    const rule = $('arenaRule');
    if (!rule || !owns.ownsArena) return;
    let left = clkMs;
    if (clkRun) left -= performance.now() - clkAt;
    left = Math.max(0, left);
    const total = Math.ceil(left / 1000);
    const text = (clkOt ? 'OT ' : '') + Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
    rule.textContent = text;
    if ($('scoreClock')) $('scoreClock').textContent = text;
  }

  function frame(t) {
    if (!owns.ownsArena) { raf = 0; return; }
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 0.016;
    last = t;
    if (held.size) {
      const kx = (held.has('ArrowRight') || held.has('d') ? 1 : 0) - (held.has('ArrowLeft') || held.has('a') ? 1 : 0);
      const ky = (held.has('ArrowDown') || held.has('s') ? 1 : 0) - (held.has('ArrowUp') || held.has('w') ? 1 : 0);
      const c = clampOwn(pred.tx + kx * 440 * dt, pred.ty + ky * 440 * dt);
      pred.tx = c.x; pred.ty = c.y;
    }
    net.stepPaddle(pred, dt, 890);
    maybeSend(false);
    const msg = currSnap && currSnap.msg;
    if (msg) {
      if (msg.ph === 'v') showVs();
      else hideVs();
      const latest = buf.items.length ? buf.items[buf.items.length - 1].msg : msg;
      const ownKey = seat === 's' ? 'a' : 'b';
      const serverOwn = toView(latest[ownKey][0], latest[ownKey][1]);
      if (msg.ph === 'p') net.reconcile(pred, serverOwn);
      else { pred.x = pred.tx = serverOwn.x; pred.y = pred.ty = serverOwn.y; }
      const view = net.sampleBuffer(buf, t);
      const puckW = view ? view.puck : msg.k;
      const oppW = view ? (seat === 's' ? view.north : view.south) : (seat === 's' ? msg.b : msg.a);
      const pv = toView(puckW[0], puckW[1]), ov = toView(oppW[0], oppW[1]);
      const youScore = seat === 's' ? msg.sc[0] : msg.sc[1];
      const oppScore = seat === 's' ? msg.sc[1] : msg.sc[0];
      $('youScore').textContent = youScore;
      $('copperScore').textContent = oppScore;
      clkMs = msg.clk || 0; clkAt = t; clkRun = msg.ph === 'p' && !msg.paused; clkOt = msg.per === 'o';
      paintClock();
      paintPing();
      paintLink();
      const ph = {p: 'playing', g: 'goal', o: 'over', v: 'versus', a: 'abandoned', f: 'faceoff', w: 'waiting'}[msg.ph] || 'faceoff';
      const youName = (match && match.you) || 'YOU';
      const oppName = (match && match.opponent) || 'OPPONENT';
      lib.drawSnapshot({
        phase: ph === 'over' || ph === 'versus' || ph === 'waiting' ? 'playing' : ph, paused: !!msg.paused,
        score: {you: youScore, copper: oppScore},
        lastGoal: mineCode(msg.lg) ? 'you' : msg.lg ? 'copper' : null, winner: mineCode(msg.w) ? 'you' : msg.w ? 'copper' : null,
        puck: {x: pv.x, y: pv.y, vx: 0, vy: 0}, you: {x: pred.x, y: pred.y}, copper: {x: ov.x, y: ov.y},
        bannerYou: youName.toUpperCase() + ' LIGHTS THE LAMP', bannerOpp: oppName.toUpperCase() + ' LIGHTS THE LAMP',
        human: true, online: true, oppName: oppName, hideCall: msg.ph === 'w' || msg.ph === 'v',
        faceoffText: msg.per === 'o' ? 'Sudden death.' : 'Two minutes. Own your half.',
      });
      publicView = {phase: ph, phaseCode: msg.ph, score: [youScore, oppScore], puck: pv, seat, you: youName, opp: oppName, winner: msg.w || null, clock: $('arenaRule') ? $('arenaRule').textContent : '', ping: localRtt, oppGrace: oppGraceMs};
      if (msg.ph === 'g' && bannerKind !== 'goal') showBanner(mineCode(msg.lg) ? youName : oppName);
      if (msg.ph !== 'g' && !(bannerKind === 'ot' && performance.now() < bannerUntil)) hideBanner();
      if (msg.ph === 'o') showOver(Object.assign({records: null, forfeit: 0, tie: msg.tie, ot: msg.per === 'o' ? 1 : 0}, msg));
      else if (msg.ph === 'p' || msg.ph === 'f' || msg.ph === 'w' || msg.ph === 'v') hidePanel();
    } else paintLink();
    paintClock();
    raf = requestAnimationFrame(frame);
  }
  function loop() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }

  function resetOnlineChrome() {
    document.body.classList.remove('ah-online');
    hideVs();
    hideLink();
    linkMode = '';
    const tag = $('youTag'); if (tag) tag.hidden = true;
    const clock = $('scoreClock'); if (clock) { clock.hidden = true; clock.textContent = ''; }
    const hud = $('netHud'); if (hud) hud.hidden = true;
    if ($('arenaRule')) $('arenaRule').removeAttribute('aria-hidden');
    if ($('restartGame')) $('restartGame').hidden = false;
    if ($('panelKicker')) { $('panelKicker').hidden = true; $('panelKicker').textContent = ''; }
    if ($('panelScore')) { $('panelScore').hidden = true; $('panelScore').textContent = ''; }
    if ($('panelDelta')) { $('panelDelta').hidden = true; $('panelDelta').textContent = ''; }
    if ($('panelMascot')) $('panelMascot').hidden = false;
    if ($('arenaRecord')) $('arenaRecord').hidden = false;
    if ($('panelExit')) $('panelExit').textContent = 'Exit rink';
  }
  function leaveArena() {
    quitting = true;
    holdReconnect = false;
    clearTimeout(reconnectTimer);
    stopPoll();
    try { if (ws) { ws._skip = true; ws.close(1000, 'leave'); } } catch (_) {}
    ws = null;
    owns.ownsArena = false;
    cancelAnimationFrame(raf); raf = 0;
    hideBanner();
    const arena = $('pongArena');
    arena.hidden = true;
    document.body.classList.remove('rink-immersive', 'rink-paused');
    document.documentElement.classList.remove('rink-lock');
    if (document.fullscreenElement === arena) { try { document.exitFullscreen().catch(() => {}); } catch (_) {} }
    $('youLabel').textContent = 'YOU';
    $('oppLabel').textContent = 'COPPER';
    $('copperMark').hidden = false;
    $('goalBannerTitle').textContent = 'You light the lamp';
    if ($('goalBannerKicker')) $('goalBannerKicker').textContent = 'Goal';
    $('pauseGame').textContent = 'Pause';
    $('restartGame').hidden = false;
    $('againGame').textContent = 'Play again';
    $('pongPanel').hidden = true;
    if (prevMood) $('arenaMood').textContent = prevMood;
    if ($('arenaRule')) $('arenaRule').textContent = 'FIRST TO 7';
    resetOnlineChrome();
    window.scrollTo(0, savedScroll);
    show('onlineMenu');
    hello();
  }

  function openArena() {
    savedScroll = scrollY;
    prevMood = $('arenaMood').textContent;
    owns.ownsArena = true;
    quitting = false;
    holdReconnect = false;
    reconnectUntil = 0;
    attempt = 0;
    bannerOn = false;
    linkMode = '';
    seenOt = false;
    buf = net.createBuffer(100);
    bufGn = 0;
    lastN = -1;
    inputSeq = 0;
    localRtt = -1;
    serverPing = {you: -1, opp: -1};
    oppGraceMs = 0;
    currSnap = null;
    pred.x = pred.tx = W / 2; pred.y = pred.ty = H - 132;
    $('pongArena').hidden = false;
    document.body.classList.add('rink-immersive', 'ah-online');
    document.documentElement.classList.add('rink-lock');
    $('youLabel').textContent = match.you;
    $('oppLabel').textContent = match.opponent || '…';
    if ($('youTag')) $('youTag').hidden = false;
    if ($('scoreClock')) $('scoreClock').hidden = false;
    if ($('netHud')) $('netHud').hidden = false;
    if ($('arenaRule')) $('arenaRule').setAttribute('aria-hidden', 'true');
    if ($('restartGame')) $('restartGame').hidden = true;
    $('copperMark').hidden = true;
    $('pauseGame').textContent = 'Quit';
    $('arenaMood').textContent = 'Live';
    $('youScore').textContent = '0';
    $('copperScore').textContent = '0';
    $('arenaComment').textContent = 'Connecting…';
    $('pongPanel').hidden = true;
    paintPing();
    lib.clearTrails();
    lib.unlockAudio();
    lib.fitCanvas();
    const arena = $('pongArena');
    try { if (arena.requestFullscreen) Promise.resolve(arena.requestFullscreen({navigationUI: 'hide'})).catch(() => {}); } catch (_) {}
    try { if (screen.orientation && screen.orientation.lock) Promise.resolve(screen.orientation.lock('portrait')).catch(() => {}); } catch (_) {}
    loop();
  }

  function onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      seat = msg.seat === 'n' ? 'n' : 's';
      match.you = msg.you; match.opponent = msg.opp;
      youRec = msg.rec || youRec;
      oppRec = msg.oppRec || oppRec;
      lastN = -1;
      buf = net.createBuffer(100);
      $('youLabel').textContent = msg.you;
      $('oppLabel').textContent = msg.opp;
      $('arenaMood').textContent = 'Live';
      if (account) { account.rating = msg.rating; account.wins = msg.wins; account.losses = msg.losses; account.ties = msg.ties || 0; account.otl = msg.otl || 0; }
      if (phase !== 'o') $('arenaComment').textContent = 'Drag your paddle. Own your half.';
      paintPing();
    } else if (msg.t === 'h') {
      if (msg.s && msg.s === pingSeq) {
        localRtt = performance.now() - pingAt;
        if (performance.now() - lastQ > 400) {
          lastQ = performance.now();
          send({t: 'q', ms: Math.round(localRtt)});
        }
      } else if (msg.n && msg.s == null) send({t: 'h', n: msg.n});
    } else if (msg.t === 's') {
      if (msg.gn && msg.gn !== bufGn) {
        bufGn = msg.gn;
        buf = net.createBuffer(100);
        lastN = -1;
        if (msg.ph === 'v') seenOt = false;
      }
      if (net.isStale(lastN, msg.n)) return;
      const prev = currSnap && currSnap.msg;
      lastN = msg.n | 0;
      net.pushSample(buf, performance.now(), msg);
      currSnap = {t: performance.now(), msg};
      phase = msg.ph;
      if (msg.gr) {
        oppGraceMs = seat === 's' ? msg.gr[1] : msg.gr[0];
      }
      if (msg.pg) serverPing = {you: seat === 's' ? msg.pg[0] : msg.pg[1], opp: seat === 's' ? msg.pg[1] : msg.pg[0]};
      if (prev && prev.sc && msg.sc) {
        const ys = seat === 's' ? msg.sc[0] : msg.sc[1];
        const os = seat === 's' ? msg.sc[1] : msg.sc[0];
        const py = seat === 's' ? prev.sc[0] : prev.sc[1];
        const po = seat === 's' ? prev.sc[1] : prev.sc[0];
        const evs = msg.ev || [];
        if (!evs.some(e => e.k === 'g')) {
          if (ys > py) { lib.playHorn(); showBanner((match && match.you) || 'You'); }
          else if (os > po) { lib.playAww(); showBanner((match && match.opponent) || 'Opponent'); }
        }
      }
      if (msg.ev) for (const ev of msg.ev) playEvent(ev);
      if (msg.per === 'o' && !seenOt) { seenOt = true; flashCall('OT', 'Sudden death', 1800); }
      if (msg.per !== 'o') seenOt = false;
    } else if (msg.t === 'over') showOver(msg);
    else if (msg.t === 'disc') {
      if (!mineCode(msg.seat)) {
        oppGraceMs = msg.ms || 15000;
        if ($('arenaComment')) $('arenaComment').textContent = 'Opponent reconnecting…';
      }
    } else if (msg.t === 'back') {
      oppGraceMs = 0;
      if (linkMode !== 'left') linkMode = '';
      if ($('arenaComment') && phase !== 'o') $('arenaComment').textContent = 'Drag your paddle. Own your half.';
    } else if (msg.t === 'go') {
      phase = 'v';
      seenOt = false;
      linkMode = '';
      oppGraceMs = 0;
      hideBanner();
      hidePanel();
      lib.clearTrails();
      pred.x = pred.tx = W / 2; pred.y = pred.ty = H - 132;
      $('youScore').textContent = '0';
      $('copperScore').textContent = '0';
      $('arenaComment').textContent = 'Rematch.';
      shownGn = -1;
    } else if (msg.t === 'rematch') {
      const mine = seat === 's' ? msg.south : msg.north;
      const opp = seat === 's' ? msg.north : msg.south;
      if (mine && !opp && $('panelCopy')) $('panelCopy').textContent = 'Waiting for ' + (match.opponent || 'your opponent') + ' to rematch…';
    } else if (msg.t === 'abandoned') {
      phase = 'a';
      hideVs();
      showPanel('Room closed', 'That match ended before it started.', false);
    } else if (msg.t === 'left') {
      linkMode = 'left';
      if ($('panelCopy')) $('panelCopy').textContent = ((match && match.opponent) || 'Opponent') + ' left the rink.';
      if ($('againGame')) $('againGame').hidden = true;
      paintLink();
    }
  }

  function scheduleReconnect() {
    if (holdReconnect || quitting || phase === 'o' || phase === 'a') return;
    if (!reconnectUntil) reconnectUntil = Date.now() + 15000;
    if (Date.now() > reconnectUntil) {
      if ($('arenaComment')) $('arenaComment').textContent = 'Connection lost.';
      showPanel('Connection lost', 'The 15 second reconnect window closed.', false);
      if ($('againGame')) $('againGame').hidden = true;
      return;
    }
    const delay = net.reconnectDelay(attempt++);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delay);
  }
  function connect() {
    if (quitting || holdReconnect || !match || !account) return;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    const url = base.replace(/^http/i, 'ws') + '/airhockey/ws/' + match.matchId + '?token=' + encodeURIComponent(account.token);
    const socket = new WebSocket(url);
    ws = socket;
    lastRx = performance.now();
    socket.onmessage = ev => { lastRx = performance.now(); onMessage(ev.data); };
    socket.onopen = () => {
      attempt = 0;
      reconnectUntil = 0;
      inputSeq = 0;
      lastSent = null;
      lastRx = performance.now();
      pingSeq++;
      pingAt = performance.now();
      send({t: 'h', s: pingSeq});
      if ($('arenaComment') && phase !== 'o' && phase !== 'v') $('arenaComment').textContent = 'Drag your paddle. Own your half.';
    };
    socket.onclose = () => {
      if (socket._skip) return;
      if (ws && ws !== socket) return;
      if (ws === socket) ws = null;
      if (quitting || phase === 'o' || phase === 'a') return;
      if ($('arenaComment') && phase !== 'o') $('arenaComment').textContent = 'Reconnecting…';
      scheduleReconnect();
    };
  }
  function forceReconnect() {
    if (holdReconnect || quitting || !owns.ownsArena) return;
    const old = ws;
    if (old) {
      old._skip = true;
      try { old.close(); } catch (_) {}
      if (ws === old) ws = null;
    }
    if (!reconnectUntil) reconnectUntil = Date.now() + 15000;
    connect();
  }
  function wakeNet() {
    if (!owns.ownsArena || quitting || holdReconnect) return;
    const now = Date.now();
    if (now - wakeAt < 400) return;
    wakeAt = now;
    if (!ws || ws.readyState > 1) { forceReconnect(); return; }
    pingSeq++;
    pingAt = performance.now();
    const mark = lastRx;
    send({t: 'h', s: pingSeq});
    const token = ++probeToken;
    setTimeout(() => {
      if (token !== probeToken || !owns.ownsArena || holdReconnect) return;
      if (lastRx <= mark) forceReconnect();
    }, 1500);
  }

  function begin(info) {
    stopPoll();
    match = {matchId: info.matchId, you: info.you, opponent: info.opponent, seat: info.seat};
    seat = info.seat === 'north' ? 'n' : 's';
    openArena();
    connect();
  }

  async function quick() {
    say('');
    show('queueBox');
    try {
      const data = await api('/airhockey/quick', {method: 'POST', body: {}});
      if (data.status === 'matched') return begin(data);
      pollTimer = setInterval(async () => {
        try {
          const q = await api('/airhockey/quick');
          if (q.status === 'matched') begin(q);
        } catch (e) { stopPoll(); say(e.message, true); show('onlineMenu'); }
      }, 1000);
    } catch (e) { say(e.message, true); show('onlineMenu'); }
  }

  function shareLink(code) {
    const link = new URL('play.html', location.href);
    link.search = '';
    link.searchParams.set('room', code);
    const apiParam = params.get('api');
    if (apiParam && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) link.searchParams.set('api', apiParam);
    return link.href;
  }
  async function shareRoom(code) {
    const url = shareLink(code);
    const text = 'Play me in AirHockey with Copper. Room ' + code;
    try {
      if (navigator.share) { await navigator.share({title: 'AirHockey with Copper', text, url}); $('roomStatus').textContent = 'Shared. Waiting for your friend…'; }
      else if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(url); $('roomStatus').textContent = 'Link copied. Waiting for your friend…'; }
      else $('roomStatus').textContent = url;
    } catch (e) { if (!e || e.name !== 'AbortError') $('roomStatus').textContent = url; }
  }
  async function createRoom() {
    say('');
    try {
      const data = await api('/airhockey/room', {method: 'POST', body: {}});
      show('roomBox');
      $('roomCode').textContent = data.code;
      $('roomStatus').textContent = 'Waiting for your friend…';
      pollTimer = setInterval(async () => {
        try {
          const q = await api('/airhockey/room?code=' + encodeURIComponent(data.code));
          if (q.status === 'matched') begin(q);
        } catch (e) { stopPoll(); say(e.message, true); show('onlineMenu'); }
      }, 1000);
    } catch (e) { say(e.message, true); show('onlineMenu'); }
  }
  async function join(code) {
    say('Joining room ' + code + '…');
    try {
      const data = await api('/airhockey/join', {method: 'POST', body: {code}});
      if (data.status === 'matched') return begin(data);
      show('roomBox');
      $('roomCode').textContent = code;
      $('roomStatus').textContent = 'Waiting for your friend…';
      pollTimer = setInterval(async () => {
        try {
          const q = await api('/airhockey/room?code=' + encodeURIComponent(code));
          if (q.status === 'matched') begin(q);
        } catch (e) { stopPoll(); say(e.message, true); show('onlineMenu'); }
      }, 1000);
    } catch (e) { say(e.message, true); show(account ? 'onlineMenu' : 'accountGate'); }
  }

  let boardSort = 'rating';
  async function leaderboard(sort) {
    if (sort) boardSort = sort;
    show('leaderBox');
    document.querySelectorAll('[data-sort]').forEach(btn => btn.classList.toggle('on', btn.dataset.sort === boardSort));
    $('boardList').textContent = 'Loading…';
    try {
      const data = await api('/airhockey/leaderboard?sort=' + encodeURIComponent(boardSort));
      const list = $('boardList');
      list.replaceChildren();
      if (!data.top.length) {
        const li = document.createElement('li');
        li.textContent = 'No games yet. Win a match and your name lands here.';
        list.appendChild(li);
      }
      for (const row of data.top) {
        const li = document.createElement('li');
        if (account && row.username === account.username) li.className = 'me';
        const name = document.createElement('span');
        name.className = 'nm';
        name.textContent = row.rank + '  ' + row.username;
        const meta = document.createElement('span');
        meta.className = 'meta';
        const diff = row.diff || 0;
        meta.textContent = row.rating + '  ' + row.wins + '-' + row.losses + '-' + row.ties + '/' + row.otl + '  GF ' + row.gf + '  ' + (diff > 0 ? '+' : '') + diff;
        li.append(name, meta);
        list.appendChild(li);
      }
      $('boardYou').textContent = data.you ? 'Your rank: #' + data.you.rank + ' · ' + data.you.username + ' · ' + data.you.rating + ' · ' + data.you.wins + 'W–' + data.you.losses + 'L–' + data.you.ties + 'T/' + data.you.otl + 'OTL · GF ' + data.you.gf : '';
    } catch (e) {
      $('boardList').textContent = '';
      $('boardYou').textContent = e.message;
    }
  }

  function showRecovery(code) {
    show('recoveryPanel');
    $('recoveryCode').textContent = code;
    try { sessionStorage.setItem(SHOW_CODE, code); } catch (_) {}
  }
  function showMenu() {
    show('onlineMenu');
    hello();
    if (params.get('online') === '1') focusOnline();
    if (roomParam) { const code = roomParam; join(code); }
  }

  $('signupBtn').addEventListener('click', async () => {
    say('');
    $('signupBtn').disabled = true;
    try {
      const data = await api('/airhockey/signup', {method: 'POST', body: {username: $('username').value}});
      saveAccount(data.user, data.token);
      showRecovery(data.recoveryCode);
    } catch (e) { say(e.message, true); }
    $('signupBtn').disabled = false;
  });
  $('showLogin').addEventListener('click', () => { say(''); show('loginPanel'); });
  $('loginBack').addEventListener('click', () => show('accountGate'));
  $('loginBtn').addEventListener('click', async () => {
    say('');
    $('loginBtn').disabled = true;
    try {
      const data = await api('/airhockey/login', {method: 'POST', body: {username: $('loginUser').value, recoveryCode: $('loginCode').value}});
      saveAccount(data.user, data.token);
      showMenu();
    } catch (e) { say(e.message, true); show('loginPanel'); }
    $('loginBtn').disabled = false;
  });
  $('copyRecovery').addEventListener('click', async () => {
    const code = $('recoveryCode').textContent;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(code);
      say('Recovery code copied. Store it somewhere safe.');
    } catch (_) { say('Copy the code above and store it somewhere safe.'); }
    show('recoveryPanel');
  });
  $('savedRecovery').addEventListener('click', () => {
    try { sessionStorage.removeItem(SHOW_CODE); } catch (_) {}
    showMenu();
  });
  $('quickMatch').addEventListener('click', () => { lib.unlockAudio(); quick(); });
  $('cancelQueue').addEventListener('click', async () => {
    stopPoll();
    try { await api('/airhockey/quick', {method: 'DELETE'}); } catch (_) {}
    show('onlineMenu');
  });
  $('challengeFriend').addEventListener('click', () => { lib.unlockAudio(); createRoom(); });
  $('shareRoom').addEventListener('click', () => shareRoom($('roomCode').textContent));
  $('cancelRoom').addEventListener('click', async () => {
    stopPoll();
    const code = $('roomCode').textContent;
    try { await api('/airhockey/room?code=' + encodeURIComponent(code), {method: 'DELETE'}); } catch (_) {}
    show('onlineMenu');
  });
  $('showLeaderboard').addEventListener('click', () => leaderboard('rating'));
  document.querySelectorAll('[data-sort]').forEach(btn => btn.addEventListener('click', () => leaderboard(btn.dataset.sort)));
  $('hideBoard').addEventListener('click', () => show('onlineMenu'));
  $('exitGame').addEventListener('click', () => { if (owns.ownsArena) { send({t: 'quit'}); leaveArena(); } });
  $('pauseGame').addEventListener('click', () => { if (owns.ownsArena) { send({t: 'quit'}); leaveArena(); } });
  $('panelExit').addEventListener('click', () => { if (owns.ownsArena) leaveArena(); });
  $('againGame').addEventListener('click', () => {
    if (!owns.ownsArena) return;
    send({t: 'rematch'});
    $('panelCopy').textContent = 'Waiting for ' + ((match && match.opponent) || 'your opponent') + ' to rematch…';
  });

  const canvas = $('pongCanvas');
  function aim(clientX, clientY, touch) {
    const pos = lib.pointerTarget(clientX, clientY, canvas.getBoundingClientRect(), touch);
    const c = clampOwn(pos.x, pos.y);
    pred.tx = c.x; pred.ty = c.y;
  }
  canvas.addEventListener('pointerdown', e => {
    if (!owns.ownsArena) return;
    lib.unlockAudio();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType !== 'touch') e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    aim(e.clientX, e.clientY, e.pointerType === 'touch');
    maybeSend(true);
  });
  canvas.addEventListener('pointermove', e => {
    if (!owns.ownsArena) return;
    if (e.pointerType !== 'mouse' && !canvas.hasPointerCapture?.(e.pointerId)) return;
    aim(e.clientX, e.clientY, e.pointerType === 'touch');
    maybeSend(false);
  });
  const held = new Set();
  document.addEventListener('keydown', e => {
    if (!owns.ownsArena) return;
    if (e.key === 'Escape') { e.preventDefault(); send({t: 'quit'}); leaveArena(); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(e.key)) { e.preventDefault(); held.add(e.key); }
  });
  document.addEventListener('keyup', e => held.delete(e.key));
  setInterval(() => {
    if (!owns.ownsArena || !ws || ws.readyState !== 1) return;
    pingSeq++;
    pingAt = performance.now();
    send({t: 'h', s: pingSeq});
    if (document.visibilityState === 'visible' && performance.now() - lastRx > 3500) forceReconnect();
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wakeNet(); });
  window.addEventListener('pageshow', () => wakeNet());
  window.addEventListener('online', () => wakeNet());
  window.addEventListener('focus', () => wakeNet());
  document.addEventListener('resume', () => wakeNet());
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && conn.addEventListener) conn.addEventListener('change', () => wakeNet());
  window.addEventListener('resize', () => { if (owns.ownsArena) lib.fitCanvas(); });

  owns.debug = {
    setTarget(x, y) { const c = clampOwn(x, y); pred.tx = c.x; pred.ty = c.y; },
    snapshot() { return publicView; },
    dropSocket() {
      holdReconnect = true;
      const old = ws;
      if (!old) return;
      old._skip = true;
      try { old.close(); } catch (_) {}
      if (ws === old) ws = null;
    },
    releaseReconnect() { holdReconnect = false; attempt = 0; reconnectUntil = 0; connect(); },
  };

  if (roomParam && $('joinNote')) $('joinNote').textContent = 'Room ' + roomParam + '. Sign in with a username to take the ice.';
  const wantOnline = params.get('online') === '1';
  function focusOnline() { const card = $('onlineCard'); if (card) card.scrollIntoView({block: 'start'}); }
  if (wantOnline) focusOnline();
  if (!base) {
    say('Online play is not available from this copy of the page. Copper is still ready.');
    return;
  }
  account = loadAccount();
  let pending = '';
  try { pending = sessionStorage.getItem(SHOW_CODE) || ''; } catch (_) {}
  if (account && pending) { showRecovery(pending); }
  else if (account) {
    api('/airhockey/me').then(me => { saveAccount(me.user, account.token); showMenu(); }).catch(e => {
      if (e.status !== 401) say(e.message, true);
      if (!account) show('accountGate');
      else showMenu();
    });
  } else show('accountGate');
})(typeof globalThis !== 'undefined' ? globalThis : this);
