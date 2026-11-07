/* Top-3 AirHockey teaser on the home page. One small request; hidden if the worker is quiet. */
(function () {
  var list = document.getElementById('homeBoard');
  if (!list) return;
  var base = '';
  var q = new URLSearchParams(location.search).get('api');
  if (q && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    try { var u = new URL(q); if (u.protocol === 'http:' || u.protocol === 'https:') base = u.origin; } catch (_) {}
  }
  if (!base) base = String((window.CBN_CONFIG && window.CBN_CONFIG.WORKER_URL) || '').replace(/\/$/, '');
  if (!base) return;
  var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, 4000);
  fetch(base + '/airhockey/leaderboard?limit=3', {cache: 'no-store', signal: ctrl.signal}).then(function (r) {
    return r.ok ? r.json() : null;
  }).then(function (data) {
    clearTimeout(timer);
    if (!data || !data.top || !data.top.length) return;
    list.hidden = false;
    data.top.slice(0, 3).forEach(function (row) {
      var li = document.createElement('li');
      var name = document.createElement('span');
      name.textContent = row.rank + '. ' + row.username;
      var rating = document.createElement('b');
      rating.textContent = String(row.rating);
      li.append(name, rating);
      list.appendChild(li);
    });
  }).catch(function () { clearTimeout(timer); });
})();
