/* Online head-to-head for AirHockey with Copper.
   Accounts are a username plus a device token. The rink still renders with js/play.js.
   Single-player Copper is unchanged: this file only takes the arena while ownsArena is set. */
(function (root) {
  'use strict';
  const lib = root.CopperAirHockey;
  const $ = id => document.getElementById(id);
  if (!lib || !$('onlineCard')) return;
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
  let prevSnap = null, currSnap = null, phase = '', bannerOn = false, quitting = false, reconnectUntil = 0, savedScroll = 0, prevMood = '';
  const pred = {x: W / 2, y: H - 132, tx: W / 2, ty: H - 132};
  let publicView = null;

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

  function hideBanner() {
    if (!bannerOn) return;
    bannerOn = false;
    const banner = $('goalBanner');
    if (!banner) return;
    banner.hidden = true;
    banner.className = 'goal-banner';
  }
  function showBanner(name) {
    const banner = $('goalBanner'), title = $('goalBannerTitle');
    if (title) title.textContent = name + ' lights the lamp!';
    if (!banner) return;
    banner.hidden = false;
    banner.className = 'goal-banner goal-flash';
    bannerOn = true;
    if ($('gameLive')) $('gameLive').textContent = name + ' lights the lamp!';
    lib.clearTrails();
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
  }
  function hidePanel() {
    if ($('pongPanel').hidden) return;
    $('pongPanel').hidden = true;
    document.body.classList.remove('rink-paused');
  }
  function applyRecord(records) {
    if (!records || !account) return;
    const rec = records[account.id] || Object.values(records).find(r => r.username === account.username);
    if (!rec) return;
    Object.assign(account, rec, {token: account.token});
    hello();
  }
  let shownGn = -1;
  function showOver(msg) {
    const gn = msg.gn || 1;
    const first = shownGn !== gn;
    shownGn = gn;
    phase = 'o';
    if (msg.records) applyRecord(msg.records);
    if (!first && !msg.records) return;
    const tie = !!msg.tie;
    const win = !tie && mineCode(msg.w);
    const mine = seat === 's' ? msg.sc[0] : msg.sc[1];
    const opp = seat === 's' ? msg.sc[1] : msg.sc[0];
    const who = tie ? 'Overtime tie' : win ? 'You take it!' : ((match && match.opponent) || 'Opponent') + ' takes it!';
    const extra = (msg.forfeit ? 'Forfeit. ' : '') + (msg.ot ? (tie ? 'Still tied after overtime. ' : 'Sudden death. ') : '') + (account ? statLine(account) : '');
    showPanel(who, mine + '–' + opp + '. ' + extra, true);
    if ($('arenaComment')) $('arenaComment').textContent = who;
  }

  let clkMs = 120000, clkAt = 0, clkRun = false, clkOt = false;
  function paintClock() {
    const rule = $('arenaRule');
    if (!rule || !owns.ownsArena) return;
    let left = clkMs;
    if (clkRun) left -= performance.now() - clkAt;
    left = Math.max(0, left);
    const total = Math.ceil(left / 1000);
    rule.textContent = (clkOt ? 'OT ' : '') + Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }
  function samplePair(key) {
    if (!currSnap) return null;
    const now = performance.now() - 70;
    const a = prevSnap, b = currSnap;
    if (a && b.t > a.t && now < b.t && now > a.t) {
      const u = (now - a.t) / (b.t - a.t);
      return [a.msg[key][0] + (b.msg[key][0] - a.msg[key][0]) * u, a.msg[key][1] + (b.msg[key][1] - a.msg[key][1]) * u];
    }
    const extra = Math.min(0.05, Math.max(0, (performance.now() - b.t) / 1000));
    const row = b.msg[key];
    if (key === 'k') return [row[0] + row[2] * extra, row[1] + row[3] * extra];
    return [row[0], row[1]];
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
    const dx = pred.tx - pred.x, dy = pred.ty - pred.y, dist = Math.hypot(dx, dy);
    if (dist > 0.01) {
      const step = Math.min(890 * dt, dist);
      pred.x += dx / dist * step; pred.y += dy / dist * step;
    }
    const msg = currSnap && currSnap.msg;
    if (msg) {
      const mineW = seat === 's' ? msg.a : msg.b;
      const server = toView(mineW[0], mineW[1]);
      const err = Math.hypot(server.x - pred.x, server.y - pred.y);
      if (err > 36) { pred.x += (server.x - pred.x) * 0.35; pred.y += (server.y - pred.y) * 0.35; }
      const puckW = samplePair('k') || msg.k;
      const oppKey = seat === 's' ? 'b' : 'a';
      const oppW = samplePair(oppKey) || msg[oppKey];
      const pv = toView(puckW[0], puckW[1]), ov = toView(oppW[0], oppW[1]);
      const youScore = seat === 's' ? msg.sc[0] : msg.sc[1];
      const oppScore = seat === 's' ? msg.sc[1] : msg.sc[0];
      $('youScore').textContent = youScore;
      $('copperScore').textContent = oppScore;
      clkMs = msg.clk || 0; clkAt = performance.now(); clkRun = msg.ph === 'p' && !msg.paused; clkOt = msg.per === 'o';
      paintClock();
      const ph = msg.ph === 'p' ? 'playing' : msg.ph === 'g' ? 'goal' : msg.ph === 'o' ? 'over' : 'faceoff';
      const youName = (match && match.you) || 'YOU';
      const oppName = (match && match.opponent) || 'OPPONENT';
      lib.drawSnapshot({
        phase: ph === 'over' ? 'playing' : ph, paused: !!msg.paused, score: {you: youScore, copper: oppScore},
        lastGoal: mineCode(msg.lg) ? 'you' : msg.lg ? 'copper' : null, winner: mineCode(msg.w) ? 'you' : msg.w ? 'copper' : null,
        puck: {x: pv.x, y: pv.y, vx: 0, vy: 0}, you: {x: pred.x, y: pred.y}, copper: {x: ov.x, y: ov.y},
        bannerYou: youName.toUpperCase() + ' LIGHTS THE LAMP', bannerOpp: oppName.toUpperCase() + ' LIGHTS THE LAMP',
        human: true, hideCall: msg.ph === 'w',
      });
      publicView = {phase: ph, phaseCode: msg.ph, score: [youScore, oppScore], puck: pv, seat, you: youName, opp: oppName, winner: msg.w || null, clock: $('arenaRule') ? $('arenaRule').textContent : ''};
      if (msg.ph === 'g' && !bannerOn) showBanner(mineCode(msg.lg) ? youName : oppName);
      if (msg.ph !== 'g') hideBanner();
      if (msg.ph === 'o') showOver(Object.assign({records: null, forfeit: 0}, msg, {w: msg.w, sc: msg.sc}));
      else if (msg.ph === 'p' || msg.ph === 'f' || msg.ph === 'w') hidePanel();
    }
    paintClock();
    raf = requestAnimationFrame(frame);
  }
  function loop() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }

  function leaveArena() {
    quitting = true;
    stopPoll();
    try { if (ws) ws.close(1000, 'leave'); } catch (_) {}
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
    $('pauseGame').textContent = 'Pause';
    $('restartGame').hidden = false;
    $('againGame').textContent = 'Play again';
    $('pongPanel').hidden = true;
    if (prevMood) $('arenaMood').textContent = prevMood;
    if ($('arenaRule')) $('arenaRule').textContent = 'FIRST TO 7';
    window.scrollTo(0, savedScroll);
    show('onlineMenu');
    hello();
  }

  function openArena() {
    savedScroll = scrollY;
    prevMood = $('arenaMood').textContent;
    owns.ownsArena = true;
    quitting = false;
    reconnectUntil = 0;
    bannerOn = false;
    prevSnap = currSnap = null;
    pred.x = pred.tx = W / 2; pred.y = pred.ty = H - 132;
    $('pongArena').hidden = false;
    document.body.classList.add('rink-immersive');
    document.documentElement.classList.add('rink-lock');
    $('youLabel').textContent = match.you;
    $('oppLabel').textContent = match.opponent || '…';
    $('copperMark').hidden = true;
    $('restartGame').hidden = true;
    $('pauseGame').textContent = 'Quit';
    $('arenaMood').textContent = match.opponent || 'Online';
    $('youScore').textContent = '0';
    $('copperScore').textContent = '0';
    $('arenaComment').textContent = 'Connecting…';
    $('pongPanel').hidden = true;
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
      $('youLabel').textContent = msg.you;
      $('oppLabel').textContent = msg.opp;
      $('arenaMood').textContent = msg.opp;
      if (account) { account.rating = msg.rating; account.wins = msg.wins; account.losses = msg.losses; }
      $('arenaComment').textContent = 'Drag your paddle. Own your half.';
    } else if (msg.t === 's') {
      prevSnap = currSnap;
      currSnap = {t: performance.now(), msg};
      phase = msg.ph;
      if (msg.ev) for (const ev of msg.ev) playEvent(ev);
    } else if (msg.t === 'over') showOver(msg);
    else if (msg.t === 'disc') {
      if (!mineCode(msg.seat) && $('arenaComment')) $('arenaComment').textContent = 'Opponent reconnecting…';
    } else if (msg.t === 'back') {
      if ($('arenaComment')) $('arenaComment').textContent = 'Drag your paddle. Own your half.';
    } else if (msg.t === 'go') {
      phase = 'f';
      hideBanner();
      hidePanel();
      lib.clearTrails();
      pred.x = pred.tx = W / 2; pred.y = pred.ty = H - 132;
      $('youScore').textContent = '0';
      $('copperScore').textContent = '0';
      $('arenaComment').textContent = 'Rematch. First to 7.';
    } else if (msg.t === 'rematch') {
      const mine = seat === 's' ? msg.south : msg.north;
      const opp = seat === 's' ? msg.north : msg.south;
      if (mine && !opp) $('panelCopy').textContent = 'Waiting for ' + (match.opponent || 'your opponent') + ' to rematch…';
    }     else if (msg.t === 'abandoned') {
      phase = 'a';
      showPanel('Room closed', 'That match ended before it started.', false);
    } else if (msg.t === 'left') {
      if ($('panelCopy')) $('panelCopy').textContent = ((match && match.opponent) || 'Opponent') + ' left the rink.';
      if ($('againGame')) $('againGame').hidden = true;
    }
  }

  function connect() {
    if (!match || !account) return;
    const url = base.replace(/^http/i, 'ws') + '/airhockey/ws/' + match.matchId + '?token=' + encodeURIComponent(account.token);
    const socket = new WebSocket(url);
    ws = socket;
    socket.onmessage = ev => onMessage(ev.data);
    socket.onopen = () => { if ($('arenaComment') && phase !== 'o') $('arenaComment').textContent = 'Drag your paddle. Own your half.'; };
    socket.onclose = () => {
      if (ws !== socket || quitting || phase === 'o' || phase === 'a') return;
      if (!reconnectUntil) reconnectUntil = Date.now() + 15000;
      if (Date.now() > reconnectUntil) {
        if ($('arenaComment')) $('arenaComment').textContent = 'Connection lost.';
        showPanel('Connection lost', 'The 15 second reconnect window closed.', false);
        return;
      }
      if ($('arenaComment')) $('arenaComment').textContent = 'Reconnecting…';
      setTimeout(connect, 500);
    };
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
    send({t: 'p', x: pred.tx, y: pred.ty});
  });
  canvas.addEventListener('pointermove', e => {
    if (!owns.ownsArena) return;
    if (e.pointerType !== 'mouse' && !canvas.hasPointerCapture?.(e.pointerId)) return;
    aim(e.clientX, e.clientY, e.pointerType === 'touch');
  });
  const held = new Set();
  document.addEventListener('keydown', e => {
    if (!owns.ownsArena) return;
    if (e.key === 'Escape') { e.preventDefault(); send({t: 'quit'}); leaveArena(); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(e.key)) { e.preventDefault(); held.add(e.key); }
  });
  document.addEventListener('keyup', e => held.delete(e.key));
  setInterval(() => {
    if (owns.ownsArena && phase !== 'o') send({t: 'p', x: +pred.tx.toFixed(2), y: +pred.ty.toFixed(2)});
  }, 33);
  window.addEventListener('resize', () => { if (owns.ownsArena) lib.fitCanvas(); });

  owns.debug = {
    setTarget(x, y) { const c = clampOwn(x, y); pred.tx = c.x; pred.ty = c.y; },
    snapshot() { return publicView; },
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
