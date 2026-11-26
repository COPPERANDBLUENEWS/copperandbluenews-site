/* Oilers Trivia. Username accounts match the AirHockey pattern: a device token and a one-time recovery code.
   The server owns the clock, the answer key, and the leaderboard. This file only draws what the server returns. */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('accountCard')) return;
  const KEY = 'cbn-trivia-player';
  const QUESTION_MS = 15000;
  const LETTERS = ['A', 'B', 'C', 'D'];

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
  let account = null, pollTimer = 0, raf = 0, deadline = 0, sent = false, mode = 'menu';
  let runId = '', matchId = '', drawnKey = '', sort = 'points';

  function loadAccount() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && v.token && v.username) return v; } catch (_) {}
    return null;
  }
  function saveAccount(user, token) {
    account = Object.assign({}, user, {token: token});
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
  function stopPoll() { if (pollTimer) clearTimeout(pollTimer); pollTimer = 0; }
  function stopFrame() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function statLine(user) {
    const acc = user.answered ? user.accuracy + '%' : '—';
    return (user.points || 0).toLocaleString() + ' pts · Duels ' + (user.wins || 0) + '-' + (user.losses || 0) + '-' + (user.ties || 0) +
      ' · ' + acc + ' · best streak ' + (user.bestStreak || 0) + ' · best solo ' + (user.bestSolo || 0).toLocaleString();
  }
  function hello() {
    if (!account) return;
    $('profileName').textContent = account.username;
    $('profileLine').textContent = statLine(account);
  }
  async function api(path, opts) {
    opts = opts || {};
    if (!base) throw new Error('Trivia is not connected yet. It goes live with the next Worker deploy.');
    const headers = {};
    if (account && account.token) headers.Authorization = 'Bearer ' + account.token;
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, {method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store'});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }
  function menu() {
    stopPoll();
    stopFrame();
    mode = 'menu';
    $('triviaPlay').hidden = true;
    $('triviaHero').hidden = false;
    $('accountCard').hidden = false;
    show('onlineMenu');
    hello();
  }

  function armTimer(ms) {
    deadline = ms || 0;
    sent = false;
    const tick = () => {
      if (!deadline || mode === 'menu') return;
      const remain = Math.max(0, deadline - Date.now());
      $('timerBar').style.width = Math.max(0, Math.min(100, remain / QUESTION_MS * 100)) + '%';
      $('timerLabel').textContent = (remain / 1000).toFixed(1) + 's';
      $('timerWrap').hidden = false;
      $('timerLabel').hidden = false;
      if (remain <= 0 && !sent && mode === 'solo') { sent = true; submitSolo(-1); return; }
      raf = requestAnimationFrame(tick);
    };
    stopFrame();
    tick();
  }
  function hideTimer() {
    stopFrame();
    deadline = 0;
    $('timerWrap').hidden = true;
    $('timerLabel').hidden = true;
  }
  function choiceButtons(question, locked, correctIndex, picked) {
    $('qCat').textContent = question.category || '';
    $('qPrompt').textContent = question.prompt || '';
    $('playRound').textContent = 'Question ' + ((question.index | 0) + 1) + ' of ' + (question.total || 10);
    $('qChoices').replaceChildren();
    question.choices.forEach((text, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'trivia-choice';
      if (correctIndex === i) btn.classList.add('right');
      else if (picked === i && picked !== correctIndex) btn.classList.add('wrong');
      const mark = document.createElement('i');
      mark.textContent = LETTERS[i];
      const label = document.createElement('span');
      label.textContent = text;
      btn.append(mark, label);
      btn.disabled = !!locked;
      if (!locked) btn.addEventListener('click', () => { if (mode === 'solo') submitSolo(i); else submitDuel(i); });
      $('qChoices').append(btn);
    });
  }
  function openPlay(kicker) {
    $('triviaHero').hidden = true;
    $('accountCard').hidden = true;
    $('triviaPlay').hidden = false;
    $('qReveal').hidden = true;
    $('qFinal').hidden = true;
    $('duelScores').hidden = true;
    $('playKicker').textContent = kicker;
    $('qChoices').replaceChildren();
    $('triviaPlay').scrollIntoView({block: 'start'});
  }
  function showFinal(title, copy, againLabel) {
    hideTimer();
    $('qReveal').hidden = true;
    $('qChoices').replaceChildren();
    $('qPrompt').textContent = '';
    $('qCat').textContent = '';
    $('qFinal').hidden = false;
    $('finalTitle').textContent = title;
    $('finalCopy').textContent = copy;
    $('againBtn').textContent = againLabel;
  }
  function revealBlock(title, split, fact, nextLabel, showNext) {
    $('qReveal').hidden = false;
    $('revealTitle').textContent = title;
    $('revealSplit').textContent = split;
    $('revealFact').textContent = fact || '';
    $('nextBtn').hidden = !showNext;
    $('nextBtn').textContent = nextLabel || 'Next question';
  }
  function splitText(row) {
    if (!row) return '';
    if (!row.correct) return '0 points · streak back to 0';
    return '+' + row.points + ' · ' + row.base + ' base + ' + row.time + ' time + ' + row.streakBonus + ' streak';
  }

  async function submitSolo(choice) {
    if (sent && choice !== -1) return;
    sent = true;
    $('qChoices').querySelectorAll('button').forEach(btn => { btn.disabled = true; });
    try {
      const data = await api('/trivia/solo/answer', {method: 'POST', body: {runId: runId, choice: choice}});
      paintSolo(data);
    } catch (e) { say(e.message, true); sent = false; }
  }
  function paintSolo(data) {
    mode = 'solo';
    runId = data.runId || runId;
    $('duelScores').hidden = true;
    if (data.user) account = Object.assign(account, data.user);
    if (data.done && data.phase === 'done' && data.reveal) {
      const row = data.reveal;
      choiceButtons(row, true, row.correctIndex, row.you && row.you.choice);
      hideTimer();
      const title = row.you && row.you.correct ? 'Correct' : 'Not this time';
      revealBlock(title, splitText(row.you) + ' · total ' + (data.score || 0).toLocaleString(), row.fact, '', false);
      $('qFinal').hidden = false;
      $('finalTitle').textContent = data.personalBest ? 'New solo best' : 'Practice complete';
      $('finalCopy').textContent = (data.score || 0).toLocaleString() + ' points. Best streak this run: ' + (data.bestStreak || 0) + '.';
      $('againBtn').textContent = 'Practice again';
      return;
    }
    $('qFinal').hidden = true;
    if (data.phase === 'question' && data.question) {
      $('qReveal').hidden = true;
      choiceButtons(data.question, false);
      armTimer(data.question.deadline);
      return;
    }
    if (data.reveal) {
      const row = data.reveal;
      choiceButtons(row, true, row.correctIndex, row.you && row.you.choice);
      hideTimer();
      const title = row.you && row.you.correct ? 'Correct' : 'Not this time';
      revealBlock(title, splitText(row.you) + ' · total ' + (data.score || 0).toLocaleString(), row.fact, 'Next question', true);
    }
  }
  async function startSolo(note) {
    say(note || '');
    const data = await api('/trivia/solo', {method: 'POST', body: {}});
    openPlay('Practice');
    paintSolo(data);
  }

  function paintDuel(data) {
    mode = 'duel';
    $('duelScores').hidden = false;
    $('youName').textContent = data.you.name || 'You';
    $('oppName').textContent = data.opponent.name || 'Rival';
    $('youPts').textContent = String(data.you.total || 0);
    $('oppPts').textContent = String(data.opponent.total || 0);
    if (data.phase === 'waiting') {
      hideTimer();
      $('qCat').textContent = 'Head to head';
      $('qPrompt').textContent = 'Waiting for ' + (data.opponent.name || 'your opponent') + ' to sit down.';
      $('qChoices').replaceChildren();
      $('qReveal').hidden = true;
      $('playRound').textContent = 'Same 10 questions';
      return;
    }
    if (data.phase === 'done' && data.result) {
      const last = data.reveal;
      if (last) choiceButtons(last, true, last.correctIndex, last.you && last.you.choice);
      hideTimer();
      $('qReveal').hidden = !last;
      if (last) revealBlock(last.you && last.you.correct ? 'Correct' : 'Not this time', splitText(last.you), last.fact, '', false);
      const result = data.result;
      const title = result.forfeit ? (result.youWon ? 'Opponent didn’t arrive' : 'Duel forfeited') : result.tie ? 'Tie duel' : result.youWon ? 'You win the duel' : 'Duel lost';
      showFinal(title, 'You ' + result.youScore + ', ' + (data.opponent.name || 'rival') + ' ' + result.oppScore + '.', 'Quick duel');
      return;
    }
    $('qFinal').hidden = true;
    if (data.phase === 'question' && data.question) {
      const key = data.question.id + ':' + data.question.index;
      if (key !== drawnKey) {
        drawnKey = key;
        sent = !!data.you.answered;
        $('qReveal').hidden = true;
        $('qFinal').hidden = true;
        choiceButtons(data.question, sent, null, null);
        if (!sent) armTimer(data.question.deadline);
      }
      if (sent || data.you.answered) {
        $('qChoices').querySelectorAll('button').forEach(btn => { btn.disabled = true; });
        stopFrame();
        $('timerWrap').hidden = false;
        $('timerLabel').hidden = false;
        $('timerLabel').textContent = data.opponent.answered ? 'Rival is locked in' : 'Locked in · rival still answering';
      }
      return;
    }
    if (data.phase === 'reveal' && data.reveal) {
      const key = 'r:' + data.reveal.id + ':' + data.reveal.index;
      if (key === drawnKey) return;
      drawnKey = key;
      const row = data.reveal;
      choiceButtons(row, true, row.correctIndex, row.you && row.you.choice);
      hideTimer();
      const title = row.you && row.you.correct ? 'Correct' : 'Not this time';
      const opp = row.opponent ? (row.opponent.correct ? 'Rival +' + row.opponent.points : 'Rival missed') : '';
      revealBlock(title, splitText(row.you) + (opp ? ' · ' + opp : ''), row.fact, '', false);
      return;
    }
  }
  async function pollDuel() {
    if (mode !== 'duel' || !matchId) return;
    try {
      const data = await api('/trivia/duel?match=' + encodeURIComponent(matchId));
      paintDuel(data);
      if (data.phase === 'done') { stopPoll(); return; }
    } catch (e) { say(e.message, true); }
    pollTimer = setTimeout(pollDuel, 700);
  }
  function startDuel(id, note) {
    matchId = id;
    drawnKey = '';
    sent = false;
    say(note || '');
    openPlay('Head to head');
    mode = 'duel';
    stopPoll();
    pollDuel();
  }
  async function submitDuel(choice) {
    if (sent) return;
    sent = true;
    $('qChoices').querySelectorAll('button').forEach(btn => { btn.disabled = true; });
    try {
      const data = await api('/trivia/duel/answer', {method: 'POST', body: {matchId: matchId, choice: choice}});
      paintDuel(data);
    } catch (e) { say(e.message, true); sent = false; }
  }

  async function pollQuick() {
    try {
      const data = await api('/trivia/quick');
      if (data.status === 'matched') { stopPoll(); startDuel(data.matchId, 'Duel vs ' + data.opponent); return; }
      if (data.status === 'solo') { stopPoll(); await startSolo('Nobody was waiting. Practice run started.'); return; }
      if (data.waitMs) $('queueStatus').textContent = 'Looking for another player… ' + Math.ceil(data.waitMs / 1000) + 's, then practice.';
    } catch (e) { say(e.message, true); show('onlineMenu'); return; }
    pollTimer = setTimeout(pollQuick, 1000);
  }
  async function pollRoom() {
    try {
      const data = await api('/trivia/room?code=' + encodeURIComponent($('roomCode').textContent || ''));
      if (data.status === 'matched') { stopPoll(); startDuel(data.matchId, 'Duel vs ' + data.opponent); return; }
    } catch (e) { say(e.message, true); show('onlineMenu'); return; }
    pollTimer = setTimeout(pollRoom, 1000);
  }

  function boardRow(entry, mine) {
    const li = document.createElement('li');
    if (mine) li.className = 'me';
    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = entry.rank + '. ' + entry.username;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const acc = entry.answered ? entry.accuracy + '%' : '—';
    meta.textContent = (entry.points || 0).toLocaleString() + ' pts · ' + (entry.wins || 0) + '-' + (entry.losses || 0) + '-' + (entry.ties || 0) + ' · ' + acc + ' · streak ' + (entry.bestStreak || 0);
    li.append(name, meta);
    return li;
  }
  async function loadBoard() {
    const data = await api('/trivia/leaderboard?sort=' + encodeURIComponent(sort) + '&limit=25');
    $('boardList').replaceChildren();
    (data.top || []).forEach(entry => $('boardList').append(boardRow(entry, data.you && entry.rank === data.you.rank && entry.username === data.you.username)));
    $('boardYou').textContent = data.you ? 'You are ' + data.you.rank + ' · ' + statLine(data.you) : '';
  }

  $('signupBtn').addEventListener('click', async () => {
    say('');
    try {
      const data = await api('/trivia/signup', {method: 'POST', body: {username: $('username').value}});
      saveAccount(data.user, data.token);
      $('recoveryCode').textContent = data.recoveryCode;
      show('recoveryPanel');
    } catch (e) { say(e.message, true); }
  });
  $('showLogin').addEventListener('click', () => { say(''); show('loginPanel'); });
  $('loginBack').addEventListener('click', () => show('accountGate'));
  $('loginBtn').addEventListener('click', async () => {
    say('');
    try {
      const data = await api('/trivia/login', {method: 'POST', body: {username: $('loginUser').value, recoveryCode: $('loginCode').value}});
      saveAccount(data.user, data.token);
      show('onlineMenu');
      hello();
      if (roomParam) joinRoom(roomParam);
    } catch (e) { say(e.message, true); }
  });
  $('copyRecovery').addEventListener('click', async () => {
    const code = $('recoveryCode').textContent;
    try { await navigator.clipboard.writeText(code); say('Copied.'); } catch (_) { say(code); }
  });
  $('savedRecovery').addEventListener('click', () => { show('onlineMenu'); hello(); if (roomParam) joinRoom(roomParam); });
  $('practiceBtn').addEventListener('click', () => startSolo().catch(e => say(e.message, true)));
  $('quickBtn').addEventListener('click', async () => {
    say('');
    try {
      const data = await api('/trivia/quick', {method: 'POST', body: {}});
      if (data.status === 'matched') { startDuel(data.matchId, 'Duel vs ' + data.opponent); return; }
      show('queueBox');
      $('queueStatus').textContent = 'Looking for another player…';
      stopPoll();
      pollQuick();
    } catch (e) { say(e.message, true); }
  });
  $('cancelQueue').addEventListener('click', async () => {
    stopPoll();
    try { await api('/trivia/quick', {method: 'DELETE'}); } catch (_) {}
    show('onlineMenu');
  });
  $('roomBtn').addEventListener('click', async () => {
    say('');
    try {
      const data = await api('/trivia/room', {method: 'POST', body: {}});
      $('roomCode').textContent = data.code;
      $('roomStatus').textContent = 'Waiting for your friend…';
      show('roomBox');
      stopPoll();
      pollRoom();
    } catch (e) { say(e.message, true); }
  });
  $('cancelRoom').addEventListener('click', async () => {
    stopPoll();
    try { await api('/trivia/room?code=' + encodeURIComponent($('roomCode').textContent || ''), {method: 'DELETE'}); } catch (_) {}
    show('onlineMenu');
  });
  $('shareRoom').addEventListener('click', async () => {
    const code = $('roomCode').textContent;
    const url = new URL('trivia.html', location.href);
    url.searchParams.set('room', code);
    const text = 'Oilers Trivia duel. Room ' + code;
    try {
      if (navigator.share) await navigator.share({title: 'Oilers Trivia', text: text, url: url.toString()});
      else { await navigator.clipboard.writeText(url.toString()); $('roomStatus').textContent = 'Link copied.'; }
    } catch (_) {}
  });
  $('boardBtn').addEventListener('click', () => { show('leaderBox'); loadBoard().catch(e => say(e.message, true)); });
  $('hideBoard').addEventListener('click', () => show('onlineMenu'));
  document.querySelectorAll('.ah-sorts button').forEach(btn => btn.addEventListener('click', () => {
    sort = btn.dataset.sort;
    document.querySelectorAll('.ah-sorts button').forEach(el => el.classList.toggle('on', el === btn));
    loadBoard().catch(e => say(e.message, true));
  }));
  $('nextBtn').addEventListener('click', async () => {
    try {
      const data = await api('/trivia/solo/next', {method: 'POST', body: {runId: runId}});
      paintSolo(data);
    } catch (e) { say(e.message, true); }
  });
  $('againBtn').addEventListener('click', () => {
    if ($('againBtn').textContent.indexOf('Practice') === 0) startSolo().catch(e => say(e.message, true));
    else {
      $('triviaPlay').hidden = true;
      $('accountCard').hidden = false;
      mode = 'menu';
      $('quickBtn').click();
    }
  });
  $('menuBtn').addEventListener('click', async () => {
    try { const data = await api('/trivia/me'); account = Object.assign(account, data.user); } catch (_) {}
    menu();
  });
  document.addEventListener('keydown', e => {
    if (mode !== 'solo' && mode !== 'duel') return;
    if ($('triviaPlay').hidden || !$('qReveal').hidden || !$('qFinal').hidden) return;
    const n = ['1', '2', '3', '4'].indexOf(e.key);
    if (n >= 0) { e.preventDefault(); if (mode === 'solo') submitSolo(n); else submitDuel(n); }
  });

  async function joinRoom(code) {
    try {
      const data = await api('/trivia/join', {method: 'POST', body: {code: code}});
      if (data.status === 'waiting') {
        $('roomCode').textContent = code;
        $('roomStatus').textContent = 'Waiting for your friend…';
        show('roomBox');
        stopPoll();
        pollRoom();
        return;
      }
      if (data.status === 'matched') startDuel(data.matchId, 'Duel vs ' + (data.opponent || 'your friend'));
    } catch (e) { say(e.message, true); }
  }

  if (roomParam) $('joinNote').textContent = 'Room ' + roomParam + '. Create a username, or sign in, to take your seat.';
  account = loadAccount();
  if (!base) say('Online trivia starts when this Worker deploy is live. The page is ready.', true);
  else if (account) {
    api('/trivia/me').then(data => {
      account = Object.assign(account, data.user, {token: account.token});
      show('onlineMenu');
      hello();
      if (roomParam) joinRoom(roomParam);
    }).catch(() => { account = null; try { localStorage.removeItem(KEY); } catch (_) {} show('accountGate'); });
  } else show('accountGate');
})(window);
