/* Shared AirHockey net helpers. Browser global and CommonJS.
   Render delay, stale sequence drops, and reconnect backoff live here so the
   page and the simulated-latency test use the same code. */
(function (root) {
  'use strict';

  function createBuffer(delay) {
    return {items: [], delay: delay == null ? 100 : delay, offset: null};
  }

  function pushSample(buf, recv, msg) {
    const srv = Number.isFinite(+msg.ts) ? +msg.ts : recv;
    buf.items.push({recv: recv, srv: srv, msg: msg});
    const off = recv - srv;
    buf.offset = buf.offset == null ? off : buf.offset * 0.85 + off * 0.15;
    const cutoff = srv - 1200;
    while (buf.items.length > 2 && buf.items[0].srv < cutoff) buf.items.shift();
    if (buf.items.length > 40) buf.items.splice(0, buf.items.length - 40);
  }

  function lerp(a, b, u) {
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  }

  function sampleBuffer(buf, now) {
    const items = buf.items;
    if (!items.length) return null;
    const offset = buf.offset == null ? 0 : buf.offset;
    const target = now - offset - buf.delay;
    let idx = -1;
    for (let i = 0; i < items.length; i++) {
      if (items[i].srv <= target) idx = i;
      else break;
    }
    if (idx >= 0 && idx < items.length - 1) {
      const a = items[idx], b = items[idx + 1];
      const span = b.srv - a.srv;
      const u = span > 0 ? Math.max(0, Math.min(1, (target - a.srv) / span)) : 0;
      return {puck: lerp(a.msg.k, b.msg.k, u), south: lerp(a.msg.a, b.msg.a, u), north: lerp(a.msg.b, b.msg.b, u), gap: 0};
    }
    const last = idx >= 0 ? items[idx] : items[0];
    const prev = idx > 0 ? items[idx - 1] : null;
    const gap = idx >= 0 ? Math.max(0, (target - last.srv) / 1000) : 0;
    const puckGap = Math.min(gap, 0.08);
    const k = last.msg.k;
    const paddle = key => {
      const cur = last.msg[key];
      if (!prev || gap <= 0) return [cur[0], cur[1]];
      const dt = (last.srv - prev.srv) / 1000;
      if (dt < 0.001) return [cur[0], cur[1]];
      const g = Math.min(gap, 0.05);
      const old = prev.msg[key];
      return [cur[0] + (cur[0] - old[0]) / dt * g, cur[1] + (cur[1] - old[1]) / dt * g];
    };
    return {
      puck: [k[0] + (k[2] || 0) * puckGap, k[1] + (k[3] || 0) * puckGap],
      south: paddle('a'),
      north: paddle('b'),
      gap: gap,
    };
  }

  // Drop a snapshot that is older than the last one we applied, unless the
  // sequence jumped backwards by a lot (the actor woke up and the counter reset).
  function isStale(lastN, n) {
    n = n | 0;
    if (lastN < 0 || n <= 0) return false;
    if (n > lastN) return false;
    if (lastN - n > 5000) return false;
    return true;
  }

  function reconnectDelay(attempt) {
    return Math.min(1500, 200 * Math.pow(2, Math.max(0, attempt | 0)));
  }

  function pingBars(ms) {
    if (!(ms >= 0)) return 0;
    if (ms < 80) return 4;
    if (ms < 150) return 3;
    if (ms < 250) return 2;
    return 1;
  }

  function stepPaddle(pred, dt, speed) {
    const dx = pred.tx - pred.x, dy = pred.ty - pred.y, dist = Math.hypot(dx, dy);
    if (dist > 0.01) {
      const step = Math.min((speed || 890) * dt, dist);
      pred.x += dx / dist * step;
      pred.y += dy / dist * step;
    }
    return pred;
  }

  // Own paddle trusts the local prediction. Only a large miss (faceoff reset,
  // missed packet burst) snaps to the server, so latency does not rubber-band it.
  function reconcile(pred, server) {
    if (!server) return 0;
    const err = Math.hypot(server.x - pred.x, server.y - pred.y);
    if (err > 90) { pred.x = server.x; pred.y = server.y; }
    return err;
  }

  const api = {createBuffer, pushSample, sampleBuffer, isStale, reconnectDelay, pingBars, stepPaddle, reconcile};
  root.CbnAirNet = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
