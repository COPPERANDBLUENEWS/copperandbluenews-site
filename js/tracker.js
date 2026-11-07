// Live rink tracker. Backup/replay data: data/pbp/<gameId>.json, a slim copy of the NHL play-by-play
// (api-web.nhle.com/v1/gamecenter/<id>/play-by-play) written by scripts/update_data.py.
// Live games use the two-second edge-cached Worker NHL relay, polling every three seconds.
(() => {
  const {$, esc, getJSON, fmtDate, isFinal, isLive} = CBN;
  const FOCUS = "EDM", EDM_COL = "#FF4C00", COPPER = "#c8763a", POLL_MS = 3000;
  const TEAM_COL = {ANA:"#1a1a1a",BOS:"#1a1a1a",BUF:"#003087",CGY:"#C8102E",CAR:"#CE1126",CHI:"#CF0A2C",COL:"#6F263D",CBJ:"#002654",DAL:"#006847",DET:"#CE1126",FLA:"#C8102E",LAK:"#111111",MIN:"#154734",MTL:"#AF1E2D",NSH:"#041E42",NJD:"#CE1126",NYI:"#00539B",NYR:"#0038A8",OTT:"#C52032",PHI:"#111111",PIT:"#111111",SJS:"#006D75",SEA:"#00616e",STL:"#002F87",TBL:"#002868",TOR:"#00205B",UTA:"#3f7fbf",VAN:"#00205B",VGK:"#333F48",WSH:"#C8102E",WPG:"#041E42"};
  const TYPES = [
    ["goal", "Goal"], ["shot-on-goal", "Shot on goal"], ["missed-shot", "Missed"], ["blocked-shot", "Blocked"],
    ["hit", "Hit"], ["faceoff", "Faceoff"], ["penalty", "Penalty"], ["takeaway", "Takeaway"], ["giveaway", "Giveaway"]];
  const TYPE_NAME = Object.fromEntries(TYPES);
  const SYS = {"period-start": 1, "period-end": 1, "game-end": 1, "shootout-complete": 1};
  const ptFmt = iso => new Date(iso).toLocaleTimeString("en-US", {timeZone: "America/Vancouver", hour: "numeric", minute: "2-digit"}).replace(":00", "") + " PT";
  const mtFmt = iso => new Date(iso).toLocaleTimeString("en-US", {timeZone: "America/Edmonton", hour: "numeric", minute: "2-digit"}).replace(":00", "") + " MT";
  const pName = pd => !pd ? "" : pd.periodType === "SO" ? "SO" : pd.periodType === "OT" ? (pd.number > 4 ? `${pd.number - 3}OT` : "OT") : CBN.ordinal(pd.number);
  const secs = s => { const [m, x] = String(s || "0:0").split(":"); return (+m || 0) * 60 + (+x || 0); };
  const mmss = n => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

  // ---------- shapes (feet, centred on 0,0) ----------
  const star = (r, ri) => Array.from({length: 10}, (_, i) => { const a = Math.PI / 5 * i - Math.PI / 2, q = i % 2 ? ri : r; return `${(Math.cos(a) * q).toFixed(2)},${(Math.sin(a) * q).toFixed(2)}`; }).join(" ");
  function shape(type, c) {
    const W = 'stroke="#fff" stroke-width=".35"';
    switch (type) {
      case "goal": return `<polygon points="${star(3.6, 1.6)}" fill="${c}" stroke="${COPPER}" stroke-width=".9" stroke-linejoin="round"/>`;
      case "shot-on-goal": return `<circle r="1.7" fill="${c}" ${W}/>`;
      case "missed-shot": return `<circle r="1.45" fill="#fff" fill-opacity=".55" stroke="${c}" stroke-width=".6"/>`;
      case "blocked-shot": return `<path d="M-1.4-1.4L1.4 1.4M1.4-1.4L-1.4 1.4" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><path d="M-1.4-1.4L1.4 1.4M1.4-1.4L-1.4 1.4" stroke="${c}" stroke-width=".7" stroke-linecap="round"/>`;
      case "hit": return `<rect x="-1.25" y="-1.25" width="2.5" height="2.5" transform="rotate(45)" fill="${c}" ${W}/>`;
      case "faceoff": return `<circle r="1.35" fill="#fff" stroke="${c}" stroke-width=".55"/><circle r=".5" fill="${c}"/>`;
      case "penalty": return `<rect x="-1.5" y="-1.05" width="3" height="2.1" rx=".3" fill="#f5c518" stroke="${c}" stroke-width=".6"/>`;
      case "takeaway": return `<path d="M0-1.8L1.7 1.2H-1.7Z" fill="#1f9d55" stroke="${c}" stroke-width=".55" stroke-linejoin="round"/>`;
      case "giveaway": return `<path d="M0 1.8L1.7-1.2H-1.7Z" fill="#e0433a" stroke="${c}" stroke-width=".55" stroke-linejoin="round"/>`;
    }
    return `<circle r="1" fill="${c}"/>`;
  }
  const icon = (type, c = "#cfd8e6") => `<svg viewBox="-4 -4 8 8" aria-hidden="true">${shape(type, c)}</svg>`;

  // ---------- rink (NHL 200 x 85 ft, origin at centre ice, 28 ft corners) ----------
  function rinkSVG() {
    const fo = [[69, 22], [69, -22], [-69, 22], [-69, -22]];
    const hash = (cx, cy) => [-1, 1].map(sx => [-1, 1].map(sy => { const x = cx + sx * 2.94, y0 = cy + sy * Math.sqrt(225 - 2.94 * 2.94); return `<line class="red" stroke-width=".17" x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + sy * 2}"/>`; }).join("")).join("");
    const lmarks = (cx, cy) => [-1, 1].map(sx => [-1, 1].map(sy => { const x = cx + sx * 2, y = cy + sy * .75; return `<path class="red" stroke-width=".17" d="M${x + sx * 4} ${y}H${x}V${y + sy * 3}"/>`; }).join("")).join("");
    const end = s => `
      <line class="red" stroke-width=".17" x1="${s * 89}" y1="-42.5" x2="${s * 89}" y2="42.5"/>
      <path class="crease" d="M${s * 89} -4 H${s * 84.53} A6 6 0 0 ${s > 0 ? 0 : 1} ${s * 84.53} 4 H${s * 89}Z"/>
      <path class="red" stroke-width=".17" d="M${s * 89} -11 L${s * 100} -14 M${s * 89} 11 L${s * 100} 14"/>
      <rect class="net" x="${s > 0 ? 89 : -92.33}" y="-3" width="3.33" height="6" rx=".8"/>`;
    return `<svg class="rink" id="rink" viewBox="-101 -43.5 202 87" role="img" aria-label="Rink with plotted game events">
      <defs><clipPath id="rclip"><rect x="-100" y="-42.5" width="200" height="85" rx="28"/></clipPath></defs>
      <rect class="ice" x="-100" y="-42.5" width="200" height="85" rx="28"/>
      <g clip-path="url(#rclip)">
        <rect x="-25.5" y="-42.5" width="1" height="85" fill="#1d4f9c"/><rect x="24.5" y="-42.5" width="1" height="85" fill="#1d4f9c"/>
        <rect x="-.5" y="-42.5" width="1" height="85" fill="#d22630"/>
        <path d="M-.05-42.5V42.5" stroke="#fff" stroke-width=".12" stroke-dasharray="1 1"/>
        <circle class="blue" stroke-width=".17" r="15"/><circle class="dotb" r=".5"/>
        <path class="red" stroke-width=".17" d="M-10 42.5A10 10 0 0 1 10 42.5"/>
        ${fo.map(([x, y]) => `<circle class="red" stroke-width=".17" cx="${x}" cy="${y}" r="15"/><circle class="dotr" cx="${x}" cy="${y}" r="1"/>${hash(x, y)}${lmarks(x, y)}`).join("")}
        ${[[20, 22], [20, -22], [-20, 22], [-20, -22]].map(([x, y]) => `<circle class="dotr" cx="${x}" cy="${y}" r="1"/>`).join("")}
        ${end(1)}${end(-1)}
        <text class="endlbl" id="lblL" x="-62" y="2" ></text><text class="endlbl" id="lblR" x="62" y="2"></text>
        <text class="dir" id="dirL" x="-45" y="-36.5"></text><text class="dir" id="dirR" x="45" y="-36.5"></text>
      </g>
      <rect class="boards" x="-100" y="-42.5" width="200" height="85" rx="28"/>
      <g id="trail" aria-hidden="true"></g>
      <g id="marks"></g>
      <g id="players" aria-hidden="true"></g>
      <g id="puck-layer" aria-hidden="true"></g>
      <g id="fx"></g>
    </svg>`;
  }

  // ---------- state ----------
  const S = {mode: null, g: null, evs: [], plotted: [], shown: 0, drawn: 0, curT: 0, T: 0, playing: false, speed: 60,
    team: "all", types: new Set(TYPES.map(t => t[0])), period: "all", orient: "fixed", feedAll: false, sel: null, timer: null, raf: null, seen: new Set(), sched: null, live: null,
    P: {}, puckRaf: null, puckFrom: null, lastPlayId: null, fsFallback: false,
    hlId: null, hlPlaying: false, hlFrom: null, hlTimer: null, hlResume: null};
  const params = new URLSearchParams(location.search);
  if (+params.get("speed")) S.speed = +params.get("speed");

  function players(g) {
    const m = {};
    for (const r of g.rosterSpots || []) m[r.playerId] = {team: r.teamId, num: r.sweaterNumber, short: `${(r.firstName?.default || "")[0] || ""}. ${r.lastName?.default || ""}`, full: `${r.firstName?.default || ""} ${r.lastName?.default || ""}`.trim()};
    return m;
  }
  const periodLen = (pd, g) => pd.periodType === "OT" && g.gameType !== 3 ? 300 : 1200;
  // Build normalised events: game-time t, team, plotted coords (focus team always attacks right in "fixed").
  function build(g) {
    const P = players(g), home = g.homeTeam, away = g.awayTeam;
    const focusHome = home.abbrev === FOCUS || away.abbrev !== FOCUS;
    const teamById = {[home.id]: home, [away.id]: away};
    const base = {}; let acc = 0;
    const periods = [...new Map((g.plays || []).map(p => [p.periodDescriptor.number, p.periodDescriptor])).values()].sort((a, b) => a.number - b.number);
    for (const pd of periods) { base[pd.number] = acc; acc += pd.periodType === "SO" ? 0 : periodLen(pd, g); }
    // Defending side per period (fallback when a play lacks homeTeamDefendingSide).
    const hdsBy = {};
    for (const p of g.plays || []) if (p.homeTeamDefendingSide && !hdsBy[p.periodDescriptor.number]) hdsBy[p.periodDescriptor.number] = p.homeTeamDefendingSide;
    for (const pd of periods) if (!hdsBy[pd.number]) { // infer from home offensive-zone shots
      const xs = (g.plays || []).filter(p => p.periodDescriptor.number === pd.number && p.details?.zoneCode === "O" && p.details.eventOwnerTeamId === home.id && p.details.xCoord != null).map(p => p.details.xCoord);
      if (xs.length) hdsBy[pd.number] = xs.reduce((a, b) => a + b, 0) > 0 ? "left" : "right";
    }
    const evs = []; let lastT = 0, soIdx = 0;
    for (const p of [...(g.plays || [])].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const type = p.typeDescKey, d = p.details || {}, pd = p.periodDescriptor;
      if (!(type in TYPE_NAME) && !SYS[type]) continue;
      let t = pd.periodType === "SO" ? acc + (++soIdx) * 20 : (base[pd.number] || 0) + secs(p.timeInPeriod);
      t = Math.max(t, lastT); lastT = t;
      const ownerPid = {goal: d.scoringPlayerId, "shot-on-goal": d.shootingPlayerId, "missed-shot": d.shootingPlayerId, "blocked-shot": d.shootingPlayerId, hit: d.hittingPlayerId, faceoff: d.winningPlayerId, penalty: d.committedByPlayerId, takeaway: d.playerId, giveaway: d.playerId}[type];
      const tid = d.eventOwnerTeamId || P[ownerPid]?.team;
      const tm = teamById[tid];
      const hds = p.homeTeamDefendingSide || hdsBy[pd.number];
      const focusDef = focusHome ? hds : hds === "left" ? "right" : hds === "right" ? "left" : null;
      const e = {id: p.eventId, so: p.sortOrder, type, pd, t, clock: p.timeRemaining, tip: p.timeInPeriod, d, tm, focus: tm ? tm.abbrev === FOCUS : false, sys: !!SYS[type], sit: p.situationCode, flipFixed: focusDef === "right"};
      if (d.xCoord != null && d.yCoord != null && !e.sys) { e.x = d.xCoord; e.y = d.yCoord; }
      e.desc = describe(e, P, g);
      evs.push(e);
    }
    // cumulative score/SOG (regulation + OT; shootout goals don't count) for replay headers
    let as = 0, hs = 0, asg = 0, hsg = 0;
    for (const e of evs) {
      if (e.pd.periodType !== "SO" && e.tm) {
        const isAway = e.tm.id === away.id;
        if (e.type === "goal") { if (e.d.awayScore != null) { as = e.d.awayScore; hs = e.d.homeScore; } else isAway ? as++ : hs++; }
        if (e.type === "goal" || e.type === "shot-on-goal") isAway ? asg++ : hsg++;
      }
      e.cum = {as, hs, asg, hsg};
    }
    return {evs, P, T: lastT, base, periods};
  }
  function strength(e) {
    const s = e.sit; if (!s || s.length !== 4 || !e.tm || e.pd.periodType === "SO") return "";
    const awayG = +s[0], awayS = +s[1], homeS = +s[2], homeG = +s[3], isAway = e.tm.id === S.g.awayTeam.id;
    const own = isAway ? awayS : homeS, opp = isAway ? homeS : awayS, oppG = isAway ? homeG : awayG;
    return [oppG === 0 ? "EN" : "", own > opp ? "PP" : own < opp ? "SH" : ""].filter(Boolean).join(" ");
  }
  function describe(e, P, g) {
    const d = e.d, n = id => id ? esc(P[id]?.short || "#" + id) : "", f = id => id ? esc(P[id]?.full || P[id]?.short || "") : "";
    const tag = x => x ? ` <span class="tag2">${x}</span>` : "";
    switch (e.type) {
      case "goal": {
        const as = [d.assist1PlayerId, d.assist2PlayerId].filter(Boolean).map((a, i) => `${n(a)}${d[`assist${i + 1}PlayerTotal`] ? ` (${d[`assist${i + 1}PlayerTotal`]})` : ""}`);
        e.banner = {who: `${f(d.scoringPlayerId)}${d.scoringPlayerTotal && e.pd.periodType !== "SO" ? ` (${d.scoringPlayerTotal})` : ""}`, ast: e.pd.periodType === "SO" ? "Shootout goal" : as.length ? "Assists: " + as.join(", ") : "Unassisted"};
        return `<b>GOAL</b> · <b>${n(d.scoringPlayerId)}</b>${d.scoringPlayerTotal && e.pd.periodType !== "SO" ? ` (${d.scoringPlayerTotal})` : ""}${d.shotType ? ", " + esc(d.shotType) : ""}${e.pd.periodType === "SO" ? "" : tag(strength(e))}<small>${e.banner.ast}${d.awayScore != null && e.pd.periodType !== "SO" ? ` · ${esc(g.awayTeam.abbrev)} ${d.awayScore}–${d.homeScore} ${esc(g.homeTeam.abbrev)}` : ""}</small>`;
      }
      case "shot-on-goal": return `Shot on goal · <b>${n(d.shootingPlayerId)}</b>${d.shotType ? ", " + esc(d.shotType) : ""}${d.goalieInNetId ? `<small>Saved by ${n(d.goalieInNetId)}</small>` : ""}`;
      case "missed-shot": return `Missed shot · <b>${n(d.shootingPlayerId)}</b><small>${esc((d.reason || "").replace(/-/g, " "))}</small>`;
      case "blocked-shot": return `Shot blocked · <b>${n(d.shootingPlayerId)}</b>${d.blockingPlayerId ? `<small>Blocked by ${n(d.blockingPlayerId)}</small>` : d.reason === "teammate-blocked" ? "<small>Blocked by a teammate</small>" : ""}`;
      case "hit": return `Hit · <b>${n(d.hittingPlayerId)}</b>${d.hitteePlayerId ? ` on ${n(d.hitteePlayerId)}` : ""}`;
      case "faceoff": return `Faceoff won · <b>${n(d.winningPlayerId)}</b>${d.losingPlayerId ? ` vs ${n(d.losingPlayerId)}` : ""}<small>${({O: "Offensive zone", D: "Defensive zone", N: "Neutral zone"})[d.zoneCode] || ""}</small>`;
      case "penalty": return `Penalty · <b>${n(d.committedByPlayerId) || (d.servedByPlayerId ? "Bench" : "Team")}</b> ${d.duration ? d.duration + " min" : ""}<small>${esc((d.descKey || "").replace(/-/g, " "))}${d.drawnByPlayerId ? " · drawn by " + n(d.drawnByPlayerId) : ""}${d.servedByPlayerId ? " · served by " + n(d.servedByPlayerId) : ""}</small>`;
      case "takeaway": return `Takeaway · <b>${n(d.playerId)}</b>`;
      case "giveaway": return `Giveaway · <b>${n(d.playerId)}</b>`;
      case "period-start": return `Start of ${pName(e.pd)}${e.pd.periodType === "REG" ? " period" : ""}`;
      case "period-end": return `End of ${pName(e.pd)}${e.pd.periodType === "REG" ? " period" : ""}`;
      case "shootout-complete": return "Shootout complete";
      case "game-end": return "Final";
    }
    return esc(e.type);
  }
  // Header badges use team colours; on the ice the opponent is always dark navy so it never blends with Oilers orange.
  const OPP_ICE = "#1c2c4c";
  const colOf = tm => !tm ? "#888" : tm.abbrev === FOCUS ? EDM_COL : OPP_ICE;
  const badgeCol = tm => !tm ? "#888" : tm.abbrev === FOCUS ? EDM_COL : (TEAM_COL[tm.abbrev] || "#1e3a6e");
  const pos = e => { const f = S.orient === "fixed" && e.flipFixed; return [f ? -e.x : e.x, f ? e.y : -e.y]; }; // SVG y grows down
  const pass = e => e.x != null && (S.hlPlaying || (S.types.has(e.type) && (S.team === "all" || (S.team === "focus") === e.focus) && (S.period === "all" || (S.period === "OT" ? e.pd.periodType === "OT" : S.period === "SO" ? e.pd.periodType === "SO" : e.pd.periodType === "REG" && String(e.pd.number) === S.period))));


  // ---------- puck trail + player markers (discrete PBP coords only; no continuous skating paths) ----------
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function rolesFor(e) {
    const d = e.d || {};
    const add = (id, role) => id ? [{id, role}] : [];
    switch (e.type) {
      case "goal": return [
        ...add(d.scoringPlayerId, "Scorer"),
        ...add(d.assist1PlayerId, "A1"),
        ...add(d.assist2PlayerId, "A2"),
        ...add(d.goalieInNetId, "G"),
      ];
      case "shot-on-goal": return [...add(d.shootingPlayerId, "Shot"), ...add(d.goalieInNetId, "G")];
      case "missed-shot": return add(d.shootingPlayerId, "Miss");
      case "blocked-shot": return [...add(d.shootingPlayerId, "Shot"), ...add(d.blockingPlayerId, "Block")];
      case "hit": return [...add(d.hittingPlayerId, "Hit"), ...add(d.hitteePlayerId, "Hittee")];
      case "faceoff": return [...add(d.winningPlayerId, "Won"), ...add(d.losingPlayerId, "Lost")];
      case "penalty": return [...add(d.committedByPlayerId || d.servedByPlayerId, "Penalty"), ...add(d.drawnByPlayerId, "Drawn")];
      case "takeaway": case "giveaway": return add(d.playerId, e.type === "takeaway" ? "Take" : "Give");
    }
    return [];
  }
  function coordEvents(upto) {
    const n = upto == null ? S.shown : upto;
    const start = S.hlFrom == null ? 0 : S.hlFrom;
    return S.evs.slice(start, n).filter(e => e.x != null && e.y != null && !e.sys);
  }
  function drawTrail() {
    const L = $("trail"); if (!L) return;
    // Last 3 passes only (4 event points). A full-period path crowds the ice.
    const pts = coordEvents().slice(-4);
    L.innerHTML = "";
    if (pts.length < 2) return;
    const toPts = arr => arr.map(e => { const [x, y] = pos(e); return `${x.toFixed(2)},${y.toFixed(2)}`; }).join(" ");
    const all = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    all.setAttribute("class", "trail");
    all.setAttribute("points", toPts(pts));
    L.appendChild(all);
    const hotN = Math.min(3, pts.length);
    if (hotN >= 2) {
      const hot = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      hot.setAttribute("class", "trail-hot");
      hot.setAttribute("points", toPts(pts.slice(-hotN)));
      L.appendChild(hot);
    }
  }
  function puckTarget() {
    // Live / discrete: sit on the latest plotted event with coords.
    // Replay: ease between known event points using game time (never invent paths beyond those points).
    const pts = S.evs.filter(e => e.x != null && e.y != null && !e.sys);
    if (!pts.length) return null;
    if (S.mode !== "replay") {
      const shown = coordEvents();
      return shown.length ? pos(shown[shown.length - 1]) : null;
    }
    const t = S.curT;
    let i = 0;
    while (i < pts.length && pts[i].t <= t) i++;
    if (i <= 0) return pos(pts[0]);
    if (i >= pts.length) return pos(pts[pts.length - 1]);
    // Only interpolate when the next event is already "shown" (reached in scrubber).
    if (pts[i].so > (S.evs[S.shown - 1]?.so ?? -1)) return pos(pts[i - 1]);
    const a = pts[i - 1], b = pts[i];
    const span = Math.max(0.001, b.t - a.t);
    const u = Math.max(0, Math.min(1, (t - a.t) / span));
    const [ax, ay] = pos(a), [bx, by] = pos(b);
    return [ax + (bx - ax) * u, ay + (by - ay) * u];
  }
  function placePuck(xy, soft) {
    const L = $("puck-layer"); if (!L) return;
    if (!xy) { L.innerHTML = ""; S.puckFrom = null; return; }
    const [x, y] = xy;
    let g = L.querySelector(".puck");
    if (!g) {
      g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "puck");
      g.innerHTML = `<circle class="puck-rim" r="5.4"/><circle class="puck-core" r="3.7"/>`;
      L.appendChild(g);
    }
    if (soft && S.puckFrom && !reduceMotion()) {
      const [x0, y0] = S.puckFrom;
      cancelAnimationFrame(S.puckRaf);
      const t0 = performance.now(), dur = S.mode === "replay" && S.speed > 120 ? 160 : 700;
      const step = now => {
        const u = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - u, 3);
        g.setAttribute("transform", `translate(${(x0 + (x - x0) * e).toFixed(2)} ${(y0 + (y - y0) * e).toFixed(2)})`);
        if (u < 1) S.puckRaf = requestAnimationFrame(step);
        else S.puckFrom = [x, y];
      };
      S.puckRaf = requestAnimationFrame(step);
    } else {
      cancelAnimationFrame(S.puckRaf);
      g.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      S.puckFrom = [x, y];
    }
  }
  function updatePuck(anim) {
    placePuck(puckTarget(), !!anim);
  }
  function updatePlayers(anim) {
    const L = $("players"); if (!L) return;
    const cur = S.evs[S.shown - 1];
    if (!cur || cur.sys || cur.x == null) {
      L.innerHTML = ""; S.lastPlayId = null; return;
    }
    const roles = rolesFor(cur).filter(r => S.P[r.id]);
    if (!roles.length) { L.innerHTML = ""; S.lastPlayId = cur.id; return; }
    const changed = S.lastPlayId !== cur.id;
    S.lastPlayId = cur.id;
    const [cx, cy] = pos(cur);
    const n = roles.length;
    L.innerHTML = "";
    roles.forEach((r, i) => {
      const pl = S.P[r.id];
      const ang = -Math.PI / 2 + (i - (n - 1) / 2) * (n === 1 ? 0 : Math.min(1.1, 2.2 / n));
      const rad = n === 1 ? 0 : 7.5;
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad - (n === 1 ? 6.5 : 0);
      const tm = S.g && (S.g.homeTeam.id === pl.team ? S.g.homeTeam : S.g.awayTeam.id === pl.team ? S.g.awayTeam : null);
      const fill = colOf(tm);
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "plmk" + (anim && changed && !reduceMotion() ? " pop" : ""));
      g.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      const num = pl.num != null ? String(pl.num) : "";
      const short = (pl.short || "").slice(0, 12);
      g.innerHTML = `<circle class="disc" r="3.3" fill="${fill}"/><text class="lab" y="0.15">${esc(num)}</text>
        <text class="name" y="5.6">${esc(short)}</text><text class="role" y="7.7">${esc(r.role)}</text>`;
      L.appendChild(g);
    });
  }
  function updateTracer(full, anim) {
    drawTrail();
    updatePuck(anim && !full);
    updatePlayers(anim && !full);
  }
  function fsActive() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || S.fsFallback);
  }
  function syncFsUi() {
    const wrap = document.querySelector(".rink-wrap");
    if (wrap) wrap.classList.toggle("is-fs", !!S.fsFallback);
    document.body.classList.toggle("trk-fs-lock", fsActive());
    const enter = $("fs-enter");
    if (enter) enter.setAttribute("aria-pressed", fsActive() ? "true" : "false");
  }
  function exitFs() {
    const docExit = document.exitFullscreen || document.webkitExitFullscreen;
    if ((document.fullscreenElement || document.webkitFullscreenElement) && docExit) {
      try { docExit.call(document); } catch {}
    }
    S.fsFallback = false;
    syncFsUi();
  }
  function enterFs() {
    const wrap = document.querySelector(".rink-wrap"); if (!wrap) return;
    const req = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
    // iPhone / missing Fullscreen API: viewport-filling CSS fallback so the rink still goes large in the PWA.
    if (typeof req === "function") {
      try {
        const p = req.call(wrap);
        if (p && typeof p.then === "function") {
          p.then(() => { S.fsFallback = false; syncFsUi(); })
           .catch(() => { S.fsFallback = true; syncFsUi(); });
          return;
        }
        S.fsFallback = false;
        syncFsUi();
        return;
      } catch {
        S.fsFallback = true; syncFsUi(); return;
      }
    }
    S.fsFallback = true;
    syncFsUi();
  }
  function toggleFs() { fsActive() ? exitFs() : enterFs(); }
  function bindFs() {
    const enter = $("fs-enter"), exit = $("fs-exit");
    if (enter) enter.onclick = toggleFs;
    if (exit) exit.onclick = exitFs;
    syncFsUi();
    if (S._fsBound) return;
    S._fsBound = true;
    const onFsChange = () => syncFsUi();
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    document.addEventListener("keydown", ev => { if (ev.key === "Escape" && S.fsFallback) exitFs(); });
  }

  // ---------- drawing ----------
  function markEl(e, anim) {
    const [x, y] = pos(e), c = colOf(e.tm);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "mk" + (anim ? " pop" : "") + (S.sel === e.id ? " sel" : ""));
    g.setAttribute("transform", `translate(${x} ${y})`);
    g.dataset.id = e.id;
    g.innerHTML = `<g class="sh">${shape(e.type, c)}</g>`;
    return g;
  }
  function fx(e) {
    const [x, y] = pos(e), c = colOf(e.tm), L = $("fx"); if (!L) return;
    const add = html => { const n = document.createElementNS("http://www.w3.org/2000/svg", "g"); n.setAttribute("transform", `translate(${x} ${y})`); n.innerHTML = html; L.appendChild(n); return n; };
    if (e.type === "goal") {
      const rays = Array.from({length: 14}, (_, i) => { const a = i * Math.PI / 7; return `<line x1="${(Math.cos(a) * 3).toFixed(2)}" y1="${(Math.sin(a) * 3).toFixed(2)}" x2="${(Math.cos(a) * 11).toFixed(2)}" y2="${(Math.sin(a) * 11).toFixed(2)}" stroke="${i % 2 ? "#e09a5f" : COPPER}" stroke-width="1.1" stroke-linecap="round"/>`; }).join("");
      const n = add(`<g class="burst"><circle r="9" fill="${COPPER}" fill-opacity=".35"/><circle r="5" fill="${COPPER}" fill-opacity=".55"/>${rays}</g><circle class="ring" r="3.5" stroke="${COPPER}"/>`);
      setTimeout(() => n.remove(), 1600);
      banner(e);
    } else { const n = add(`<circle class="ring" r="${e.type === "penalty" ? 2.2 : 1.6}" stroke="${e.type === "penalty" ? "#f5c518" : c}"/>`); setTimeout(() => n.remove(), 950); }
  }
  let bannerT;
  function banner(e) {
    const b = $("banner"); if (!b || !e.banner) return;
    b.innerHTML = `<b>GOAL!</b><span>${esc(e.tm?.abbrev || "")} · ${e.banner.who}</span><small>${e.banner.ast} · ${pName(e.pd)} ${esc(e.tip || "")}</small>`;
    b.style.background = e.focus ? "" : `linear-gradient(135deg,#0f2142,${badgeCol(e.tm)} 55%,#8a4d22)`;
    b.classList.add("show"); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove("show"), S.mode === "replay" && S.speed > 120 ? 1800 : 3200);
  }
  function opacity(e) {
    const age = S.curT - e.t, min = e.type === "goal" ? .75 : .22;
    return age <= 90 ? 1 : Math.max(min, 1 - (age - 90) / 900);
  }
  function drawMarks(full) {
    const L = $("marks"); if (!L) return;
    const list = S.evs.slice(S.hlFrom == null ? 0 : S.hlFrom, S.shown);
    if (full || S.shown < S.drawn) { L.innerHTML = ""; for (const e of list) if (pass(e)) L.appendChild(markEl(e, false)); }
    else {
      const fresh = S.evs.slice(S.drawn, S.shown), anim = fresh.length <= 10;
      for (const e of fresh) if (pass(e)) { L.appendChild(markEl(e, anim)); if (anim) fx(e); }
      if (!anim) for (const e of fresh) if (e.type === "goal" && pass(e)) { banner(e); }
    }
    // goals on top
    L.querySelectorAll(".mk").forEach(el => { const e = S.byId[el.dataset.id]; if (e) { el.style.opacity = opacity(e); if (e.type === "goal") L.appendChild(el); } });
    S.drawn = S.shown;
  }
  function endLabels() {
    const g = S.g; if (!g || !$("lblL")) return;
    const opp = g.homeTeam.abbrev === FOCUS ? g.awayTeam.abbrev : g.homeTeam.abbrev;
    if (S.orient === "fixed") { $("lblL").textContent = `${FOCUS} NET`; $("lblR").textContent = `${opp} NET`; $("dirL").textContent = `← ${opp} ATTACKS`; $("dirR").textContent = `${FOCUS} ATTACKS →`; return; }
    const cur = S.evs[Math.max(0, S.shown - 1)], pd = cur?.pd?.number || 1;
    const p = (g.plays || []).find(x => x.periodDescriptor.number === pd && x.homeTeamDefendingSide);
    const hds = p?.homeTeamDefendingSide || "left";
    $("lblL").textContent = `${hds === "left" ? g.homeTeam.abbrev : g.awayTeam.abbrev} NET`; $("lblR").textContent = `${hds === "left" ? g.awayTeam.abbrev : g.homeTeam.abbrev} NET`;
    $("dirL").textContent = "ARENA VIEW (ENDS SWITCH"; $("dirR").textContent = `EACH PERIOD) · ${pName(cur?.pd || {number: 1, periodType: "REG"})}`;
  }
  function replayClock() {
    const g = S.g, cur = S.evs[S.shown - 1];
    if (cur?.pd?.periodType === "SO") return "Shootout";
    const per = S.periods.slice().reverse().find(p => S.base[p.number] <= S.curT && p.periodType !== "SO") || S.periods[0];
    if (!per) return "";
    const rem = Math.max(0, periodLen(per, g) - (S.curT - S.base[per.number]));
    return `${pName(per)} ${mmss(rem)}`;
  }
  function header() {
    const g = S.g, el = $("bug"); if (!el || !g) return;
    const A = g.awayTeam, H = g.homeTeam;
    let st, clk, sc = {as: A.score ?? 0, hs: H.score ?? 0, asg: A.sog ?? 0, hsg: H.sog ?? 0};
    if (S.mode === "replay") {
      const cur = S.evs[S.shown - 1];
      const atEnd = S.curT >= S.T && S.shown === S.evs.length;
      if (!atEnd) sc = cur ? cur.cum : {as: 0, hs: 0, asg: 0, hsg: 0};
      clk = replayClock();
      st = atEnd ? `<span class="bug-st final">Final${g.gameOutcome?.lastPeriodType && g.gameOutcome.lastPeriodType !== "REG" ? "/" + g.gameOutcome.lastPeriodType : ""}</span>` : `<span class="bug-st replay">↺ Replay</span>`;
    } else if (isLive(g.gameState)) {
      const int = g.clock?.inIntermission;
      st = int ? `<span class="bug-st int">Intermission</span>` : `<span class="bug-st live"><span class="pulse"></span>Live</span>`;
      clk = `${pName(g.periodDescriptor)} ${int ? "INT " : ""}${esc(g.clock?.timeRemaining || "")}`;
    } else if (isFinal(g.gameState)) {
      st = `<span class="bug-st final">Final${g.gameOutcome?.lastPeriodType && g.gameOutcome.lastPeriodType !== "REG" ? "/" + g.gameOutcome.lastPeriodType : ""}</span>`; clk = "";
    } else { st = `<span class="bug-st pre">Pre-game</span>`; clk = `<small>Puck drop</small> ${ptFmt(g.startTimeUTC)}`; }
    const t = (tm, s, sog, h) => `<div class="bug-team${h ? " h" : ""}"><span class="bug-ab" style="background:${badgeCol(tm)}">${esc(tm.abbrev)}</span><div><span class="bug-sc">${s}</span><span class="bug-sog">SOG ${sog}</span></div></div>`;
    el.innerHTML = `<div class="bug-row">${t(A, sc.as, sc.asg)}<div class="bug-mid">${st}<div class="bug-clk">${clk || "&nbsp;"}</div></div>${t(H, sc.hs, sc.hsg, true)}</div>
      <div class="bug-sub">${esc(A.abbrev)} @ ${esc(H.abbrev)} · ${fmtDate(g.startTimeUTC, {weekday: "short", month: "short", day: "numeric"})} · ${ptFmt(g.startTimeUTC)}${g.venue?.default ? " · " + esc(g.venue.default) : ""}</div>`;
  }
  function feed() {
    const el = $("pbp"); if (!el) return;
    const list = S.evs.slice(0, S.shown).filter(e => e.sys || (S.types.has(e.type) && (S.team === "all" || (S.team === "focus") === e.focus))).reverse();
    const lim = S.feedAll ? list.length : 60;
    el.innerHTML = list.length ? list.slice(0, lim).map(e => e.sys ? `<div class="pe sys">${e.desc}</div>` :
      `<div class="pe ${e.type === "goal" ? "goal" : ""}${S.prevShown != null && e.so > S.prevSo ? " new" : ""}" data-id="${e.id}">${icon(e.type, e.focus ? EDM_COL : "#cfd8e6")}<div class="tm"><b>${pName(e.pd)} ${esc(e.tip || "")}</b>${e.pd.periodType === "SO" ? "" : esc((e.clock || "").replace(/^0/, "")) + " left"}</div><div class="d"><span class="ab" style="background:${badgeCol(e.tm)}">${esc(e.tm?.abbrev || "")}</span>${e.desc}</div></div>`).join("")
      : `<p class="meta" style="padding:10px">No events yet.</p>`;
    $("more").hidden = list.length <= 60;
    $("more").textContent = S.feedAll ? "Show fewer" : `Show all ${list.length} events`;
    $("feedcount").textContent = `${list.filter(e => !e.sys).length} events`;
  }
  function scrubUI() {
    const r = $("scrub"); if (!r) return;
    r.max = S.T; r.value = Math.min(S.curT, S.T);
    const cur = S.evs[S.shown - 1];
    $("scrub-l").textContent = S.curT <= 0 ? "Start" : S.curT >= S.T ? "End" : replayClock() + (cur?.pd?.periodType === "SO" ? "" : " left");
    $("scrub-r").textContent = `${S.shown}/${S.evs.length} plays`;
    $("play").textContent = S.playing ? "❚❚" : "▶"; $("play").setAttribute("aria-label", S.playing ? "Pause" : "Play");
  }
  function update(full) {
    const prevShown = S.shown;
    if (S.hlPlaying || S.mode !== "replay") {
      S.shown = Math.min(S.evs.length, S.liveShown ?? S.evs.length); S.curT = S.evs[S.shown - 1]?.t ?? 0;
    } else { let n = 0; while (n < S.evs.length && S.evs[n].t <= S.curT) n++; S.shown = n; }
    const advanced = S.shown !== prevShown;
    if (S.shown !== S.drawn || full) {
      drawMarks(full); feed(); endLabels(); header();
      updateTracer(full, advanced || full);
      S.prevShown = S.shown; S.prevSo = S.evs[S.shown - 1]?.so ?? -1;
    } else {
      header();
      // Replay scrubber mid-segment: keep the puck gliding between known event points.
      if (S.mode === "replay") updateTracer(false, false);
    }
    if (S.mode === "replay") scrubUI();
  }

  // ---------- goal highlights (short rink clips of the last few passes into a goal) ----------
  function highlightEvents() { return S.evs.filter(e => e.type === "goal" && !e.sys); }
  function highlightUrl(id) {
    const u = new URL(location.href);
    for (const k of [...u.searchParams.keys()]) if (k !== "mode" && k !== "id") u.searchParams.delete(k);
    if (S.mode === "replay" && S.g?.id) { u.searchParams.set("mode", "replay"); u.searchParams.set("id", String(S.g.id)); }
    else { u.searchParams.delete("mode"); u.searchParams.delete("id"); }
    u.searchParams.set("hl", String(id));
    return u.toString();
  }
  function renderHighlights() {
    const el = $("hls"); if (!el) return;
    const goals = highlightEvents();
    if (!goals.length) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    const rows = goals.slice().reverse().map(e => {
      const who = S.P[e.d.scoringPlayerId];
      const name = who?.short || "Goal";
      const asts = [e.d.assist1PlayerId, e.d.assist2PlayerId].filter(Boolean).map(id => S.P[id]?.short).filter(Boolean);
      const str = strength(e);
      const meta = [str, asts.length ? asts.join(", ") : "Unassisted"].filter(Boolean).join(" · ");
      return `<div class="hls-item${S.hlId === e.id ? " on" : ""}" data-hl="${e.id}">
        <span class="ab" style="background:${badgeCol(e.tm)}">${esc(e.tm?.abbrev || "")}</span>
        <div class="hls-d"><b>${esc(name)}</b><small>${esc(pName(e.pd))} ${esc(e.tip || "")}${meta ? " · " + esc(meta) : ""}</small></div>
        <button type="button" class="hls-play" data-hl="${e.id}" aria-label="Play highlight">▶</button>
        <button type="button" class="hls-share" data-hl="${e.id}" aria-label="Copy highlight link">Share</button>
      </div>`;
    }).join("");
    el.innerHTML = `<div class="feed-h"><h2 class="sub">Highlights</h2><span class="meta">${goals.length} goal${goals.length === 1 ? "" : "s"}</span></div><div class="hls-list">${rows}</div>`;
  }
  async function copyHighlight(id, btn) {
    const url = highlightUrl(id);
    try { await navigator.clipboard.writeText(url); }
    catch {
      const ta = document.createElement("textarea"); ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } finally { ta.remove(); }
    }
    if (btn) { const old = btn.textContent; btn.textContent = "Copied"; setTimeout(() => { if (btn.textContent === "Copied") btn.textContent = old; }, 1600); }
  }
  function stopHighlight(resume) {
    clearInterval(S.hlTimer); S.hlTimer = null;
    clearTimeout(S.hlResume); S.hlResume = null;
    S.hlPlaying = false; S.hlFrom = null; S.hlId = null;
    if (resume && S.mode !== "replay") S.liveShown = null;
    if (resume) update(true);
    if (resume && $("info")) $("info").innerHTML = "Tap a marker for details. Puck trail shows the last few plays · play a highlight below · use the expand control for full-screen rink.";
    renderHighlights();
  }
  function playHighlight(id) {
    const idx = S.evs.findIndex(e => e.id === id);
    if (idx < 0) return;
    clearInterval(S.stag);
    if (S.playing) setPlaying(false);
    const located = [];
    for (let i = 0; i <= idx; i++) {
      const ev = S.evs[i];
      if (ev.x != null && ev.y != null && !ev.sys) located.push(i);
    }
    let seq = located.slice(-4);
    if (!seq.includes(idx)) seq = seq.concat([idx]);
    const start = seq[0];
    clearInterval(S.hlTimer); clearTimeout(S.hlResume);
    S.hlId = id; S.hlPlaying = true; S.hlFrom = start;
    S.puckFrom = null; S.lastPlayId = null;
    S.liveShown = start + 1; S.drawn = 0;
    update(true);
    renderHighlights();
    const ev = S.evs[idx];
    const who = S.P[ev.d?.scoringPlayerId]?.full || "Goal";
    if ($("info")) $("info").innerHTML = `Playing highlight · ${esc(ev.tm?.abbrev || "")} · ${esc(who)}`;
    if (seq.length === 1 && ev.type === "goal") fx(ev);
    let k = 0;
    const stepMs = reduceMotion() ? 80 : 750;
    S.hlTimer = setInterval(() => {
      k++;
      if (k >= seq.length) {
        clearInterval(S.hlTimer); S.hlTimer = null;
        select(id);
        S.hlResume = setTimeout(() => stopHighlight(true), 2800);
        return;
      }
      S.liveShown = seq[k] + 1;
      update(false);
    }, stepMs);
  }
  function maybePlayHlFromUrl() {
    const raw = params.get("hl");
    if (!raw || S._hlBooted) return;
    const id = +raw;
    if (!S.evs.some(e => e.id === id && e.type === "goal")) return;
    S._hlBooted = true;
    playHighlight(id);
  }

  // ---------- page skeleton ----------
  function skeleton(replay) {
    $("trk").innerHTML = `<div class="trk-grid"><div>
      <div class="bug" id="bug"></div>
      <div class="rink-wrap" id="rink-wrap">${rinkSVG()}
        <div class="rink-tools">
          <button type="button" class="fs-enter" id="fs-enter" aria-label="Full screen rink" title="Full screen">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3H3v4h2V5h2V3zm14 0h-4v2h2v2h2V3zM5 17H3v4h4v-2H5v-2zm16 0h-2v2h-2v2h4v-4z"/></svg>
          </button>
          <button type="button" class="fs-exit" id="fs-exit" aria-label="Exit full screen" title="Exit full screen">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H7v4H3v2h6V3zm8 0h-2v6h6V7h-4V3zM9 15H3v2h4v4h2v-6zm12 0h-6v6h2v-4h4v-2z"/></svg>
          </button>
        </div>
        <div class="banner" id="banner"></div><div class="rink-msg" id="rmsg" hidden></div></div>
      <div class="info" id="info">Tap a marker for details. Puck trail shows the last few plays · play a highlight below · use the expand control for full-screen rink.</div>
      <div class="hls" id="hls" hidden></div>
      ${replay ? "" : `<div class="odds-slot trk-odds" data-odds hidden></div>`}
      ${replay ? "" : `<div class="card matchup trk-matchup" data-matchup="compact" hidden></div>`}
      ${replay ? `<div class="ctl"><button class="sec" id="rst" aria-label="Restart">⏮</button><button id="play" aria-label="Play">▶</button>
        <div class="scrub"><input type="range" id="scrub" min="0" max="3600" step="1" value="0" aria-label="Timeline"><div class="ticks" id="ticks"></div></div>
        <select id="speed" aria-label="Replay speed">${[10, 30, 60, 120, 300, 600].map(v => `<option value="${v}"${v === S.speed ? " selected" : ""}>${v}×</option>`).join("")}</select>
        <div class="scrub-lbl"><span id="scrub-l"></span><span id="scrub-r"></span></div></div>` : ""}
      <div class="trk-filters team" id="fteam"></div>
      <div class="trk-filters" id="ftype"></div>
      <div class="trk-filters" id="fper"></div>
      </div><div>
      <div class="feed-h"><h2 class="sub">Play-by-play</h2><span class="meta" id="feedcount"></span></div>
      <div class="pbp" id="pbp"></div><button class="more-btn" id="more" hidden></button>
      </div></div>`;
    $("rink").addEventListener("click", ev => { const m = ev.target.closest(".mk"); if (m) select(+m.dataset.id); });
    $("pbp").addEventListener("click", ev => { const r = ev.target.closest(".pe[data-id]"); if (r) select(+r.dataset.id, true); });
    $("more").onclick = () => { S.feedAll = !S.feedAll; feed(); };
    const hls = $("hls");
    if (hls) hls.onclick = ev => {
      const share = ev.target.closest(".hls-share");
      if (share) { ev.preventDefault(); ev.stopPropagation(); copyHighlight(+share.dataset.hl, share); return; }
      const play = ev.target.closest("[data-hl]");
      if (play) playHighlight(+play.dataset.hl);
    };
    bindFs();
    if (replay) {
      $("play").onclick = () => { if (!S.playing && S.curT >= S.T) { S.curT = 0; update(true); } setPlaying(!S.playing); };
      $("rst").onclick = () => { S.curT = 0; update(true); };
      $("scrub").oninput = e => { S.curT = +e.target.value; update(true); };
      $("speed").onchange = e => { S.speed = +e.target.value; };
    }
  }
  function select(id, scroll) {
    S.sel = id; const e = S.byId[id]; if (!e) return;
    document.querySelectorAll("#marks .mk.sel").forEach(x => x.classList.remove("sel"));
    const m = document.querySelector(`#marks .mk[data-id="${id}"]`); if (m) { m.classList.add("sel"); $("marks").appendChild(m); }
    $("info").innerHTML = `<b>${pName(e.pd)} ${esc(e.tip || "")}</b> · ${esc(e.tm?.abbrev || "")} · ${e.desc.replace(/<small>/g, " — ").replace(/<\/small>/g, "")}${e.x == null ? " <small>(no location)</small>" : ""}`;
    if (scroll && m) $("rink").scrollIntoView({block: "nearest", behavior: "smooth"});
  }
  function filters() {
    const g = S.g, opp = g.homeTeam.abbrev === FOCUS ? g.awayTeam : g.homeTeam;
    $("fteam").innerHTML = `<span class="lab">Team</span>` + [["all", "Both"], ["focus", FOCUS], ["opp", opp.abbrev]].map(([k, l]) => `<button data-k="${k}" class="${S.team === k ? "on" : ""}">${l}</button>`).join("") +
      `<span class="lab" style="margin-left:6px">Ends</span>` + [["fixed", `${FOCUS} →`], ["arena", "Arena"]].map(([k, l]) => `<button data-o="${k}" class="${S.orient === k ? "on" : ""}">${l}</button>`).join("");
    $("ftype").innerHTML = `<span class="lab">Show</span>` + TYPES.map(([k, l]) => `<button data-t="${k}" class="${S.types.has(k) ? "on" : ""}" aria-pressed="${S.types.has(k)}">${icon(k)}${l}</button>`).join("");
    const ps = S.periods.map(p => p.periodType === "REG" ? String(p.number) : p.periodType);
    $("fper").innerHTML = `<span class="lab">Period</span>` + ["all", ...new Set(ps)].map(k => `<button data-p="${k}" class="${S.period === k ? "on" : ""}">${k === "all" ? "All" : /^\d$/.test(k) ? CBN.ordinal(+k) : k}</button>`).join("");
    $("fteam").onclick = ev => { const b = ev.target.closest("button"); if (!b) return; if (b.dataset.k) S.team = b.dataset.k; if (b.dataset.o) { S.orient = b.dataset.o; S.puckFrom = null; } filters(); update(true); };
    $("ftype").onclick = ev => { const b = ev.target.closest("button"); if (!b) return; const k = b.dataset.t; S.types.has(k) ? S.types.delete(k) : S.types.add(k); filters(); update(true); };
    $("fper").onclick = ev => { const b = ev.target.closest("button"); if (!b) return; S.period = b.dataset.p; filters(); update(true); };
  }
  function ticks() {
    const el = $("ticks"); if (!el || !S.T) return;
    el.innerHTML = S.periods.filter(p => S.base[p.number] > 0).map(p => `<em style="left:${S.base[p.number] / S.T * 100}%"></em>`).join("") +
      S.evs.filter(e => e.type === "goal").map(e => `<i class="${e.focus ? "" : "opp"}" style="left:${e.t / S.T * 100}%" title="${esc(e.tm?.abbrev || "")} goal ${pName(e.pd)} ${esc(e.tip)}"></i>`).join("");
  }
  function setPlaying(on) {
    S.playing = on; cancelAnimationFrame(S.raf);
    if (on) { let last = performance.now(); const step = now => { S.curT = Math.min(S.T, S.curT + (now - last) / 1000 * S.speed); last = now; update(false); if (S.curT >= S.T) { S.playing = false; scrubUI(); return; } S.raf = requestAnimationFrame(step); }; S.raf = requestAnimationFrame(step); }
    scrubUI();
  }
  function setData(g) {
    S.g = g; const b = build(g);
    S.evs = b.evs; S.T = b.T; S.base = b.base; S.periods = b.periods; S.P = b.P; S.byId = Object.fromEntries(b.evs.map(e => [e.id, e]));
    S.puckFrom = null; S.lastPlayId = null;
  }
  function msg(t) { const m = $("rmsg"); if (!m) return; m.hidden = !t; m.innerHTML = t ? `<span>${t}</span>` : ""; }

  // ---------- modes ----------
  async function pbpFetch(id) {
    if (S.mode === "live") return CBN.liveJSON(`/live/pbp?id=${id}`, `data/pbp/${id}.json`);
    const r = await fetch(`data/pbp/${id}.json`, {cache: "no-cache"}); // revalidates with the ETag, cheap 304s
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }
  function note(src) {
    $("trk-note").innerHTML = `${src} · Rink coordinates and events from the public NHL play-by-play feed. <a href="https://www.nhl.com/" target="_blank" rel="noopener">Data: NHL</a>. Fan-made, not affiliated with the NHL or the Edmonton Oilers.`;
  }
  async function replay(id) {
    S.mode = "replay"; S.stopPoll?.(); clearTimeout(S.timer); skeleton(true);
    let g; try { g = await pbpFetch(id); } catch { $("trk").innerHTML = `<p>Play-by-play for this game isn't available yet.</p>`; return; }
    setData(g); filters(); ticks();
    const t0 = params.get("t"); S.curT = t0 != null && params.get("id") == id ? Math.min(S.T, Math.max(0, +t0)) : 0;
    S.drawn = 0; update(true);
    note(`Replay of a completed game, animated in game time (${FOCUS} always shoots right in “${FOCUS} →” view)`);
    renderHighlights();
    maybePlayHlFromUrl();
    if (!params.get("hl") && params.get("autoplay") !== "0") setPlaying(true);
  }
  async function live(gm) {
    S.mode = "live"; skeleton(false);
    const tick = async () => {
      let g = null;
      const near = isLive(gm.state) || isFinal(gm.state) || new Date(gm.startTimeUTC) - Date.now() < 10 * 60e3;
      if (near) try { g = await pbpFetch(gm.id); } catch {}
      // Other workflows (news/lineup) can briefly redeploy older data mid-game: never go backwards.
      if (S.g?.plays?.length && (!g || (g.fetched && S.g.fetched && g.fetched < S.g.fetched))) { return POLL_MS; }
      if (!g) { // no play-by-play yet (pre-game or first live deploy pending)
        S.g = S.g || {id: gm.id, startTimeUTC: gm.startTimeUTC, gameState: gm.state, awayTeam: {abbrev: gm.away.abbrev, score: gm.away.score, sog: gm.away.sog}, homeTeam: {abbrev: gm.home.abbrev, score: gm.home.score, sog: gm.home.sog}, venue: {default: gm.venue}, plays: [], rosterSpots: []};
        header(); msg(isLive(gm.state) ? "Live · waiting for the first play-by-play update" : `Puck drop ${ptFmt(gm.startTimeUTC)} <small style="display:block;font:600 .75rem Inter">(${mtFmt(gm.startTimeUTC)})</small><span class="cd" id="cd"></span>`);
        if (!$("ftype").innerHTML) { S.periods = []; filters(); }
        countdown(gm.startTimeUTC);
        // re-check live.json for state changes
        try { const lj = await CBN.liveNow(); if (lj.game?.id === gm.id) gm = {...gm, ...lj.game}; } catch {}
        return new Date(gm.startTimeUTC) - Date.now() < 10 * 60e3 ? POLL_MS : new Date(gm.startTimeUTC) - Date.now() < 3600e3 ? 60000 : 300000;
      }
      if (S.hlPlaying) { return POLL_MS; }
      msg("");
      const first = !S.evs.length; const prevIds = new Set(S.evs.map(e => e.id));
      const prevG = S.g;
      setData(g);
      if (first || !prevG?.plays?.length) {
        filters(); S.drawn = 0;
        // Walk the puck along the last few located plays so a refresh still shows motion,
        // instead of dropping the puck on the latest spot with a static trail.
        const located = [];
        S.evs.forEach((e, i) => { if (e.x != null && e.y != null && !e.sys) located.push(i); });
        if (located.length > 1) {
          clearInterval(S.stag);
          S.liveShown = located[Math.max(0, located.length - 8)] + 1;
          update(true);
          S.stag = setInterval(() => {
            S.liveShown++;
            update(false);
            if (S.liveShown >= S.evs.length) { clearInterval(S.stag); S.liveShown = null; }
          }, 750);
        } else update(true);
      }
      else {
        // put already-seen events first so only genuinely new ones animate
        const fresh = S.evs.filter(e => !prevIds.has(e.id));
        S.evs = S.evs.filter(e => prevIds.has(e.id)).concat(fresh);
        // Stagger new events onto the ice one at a time so each gets its pop (last 30 at most).
        clearInterval(S.stag);
        const k = Math.min(fresh.length, 30);
        S.liveShown = S.evs.length - k; update(true);
        if (k) S.stag = setInterval(() => { S.liveShown++; update(false); if (S.liveShown >= S.evs.length) { clearInterval(S.stag); S.liveShown = null; } }, Math.min(750, 10000 / k));
        else S.liveShown = null;
        if (S.periods.length !== (prevG.__np || 0)) filters();
      }
      g.__np = S.periods.length;
      renderHighlights();
      maybePlayHlFromUrl();
      const age = g.fetched ? Math.round((Date.now() - new Date(g.fetched)) / 1000) : null;
      note(`Live: ${g.__relay ? "direct NHL relay" : "backup site feed"}${age != null ? ` · last NHL fetch ${age < 90 ? age + " s" : Math.round(age / 60) + " min"} ago (${new Date(g.fetched).toLocaleTimeString("en-US", {timeZone: "America/Vancouver", hour: "numeric", minute: "2-digit", second: "2-digit"})} PT)` : ""} · ${g.__relay ? "roughly 10–30 s behind the NHL feed (feed delay varies)" : "backup data may be delayed 2–4 min"} · this page re-checks every ${POLL_MS / 1000} s`);
      if (isLive(g.gameState) || (!isFinal(g.gameState) && new Date(g.startTimeUTC) - Date.now() < 3600e3)) return POLL_MS;
      else if (isFinal(g.gameState)) note(`Final · <a href="tracker.html?mode=replay&id=${g.id}">Replay this game</a> · <a href="game.html?id=${g.id}">Box score</a> · <a href="https://www.nhl.com/" target="_blank" rel="noopener">Data: NHL</a>`);
      return null;
    };
    S.stopPoll?.();
    S.stopPoll = CBN.pollVisible(tick);
  }
  let cdT;
  function countdown(iso) {
    clearInterval(cdT);
    const f = () => { const el = $("cd"); if (!el) return clearInterval(cdT); const s = Math.round((new Date(iso) - Date.now()) / 1000); el.textContent = s > 0 ? ` in ${s > 86400 ? Math.floor(s / 86400) + "d " : ""}${Math.floor(s % 86400 / 3600)}h ${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s` : " · any minute"; el.style.display = "block"; el.style.color = "#FF4C00"; };
    f(); cdT = setInterval(f, 1000);
  }

  // ---------- boot ----------
  async function boot() {
    const nav = document.querySelector(".nav"); if (nav) document.documentElement.style.setProperty("--navh", nav.offsetHeight + "px");
    let sched = [], lj = null;
    try { sched = (await getJSON("data/schedule.json")).games; } catch {}
    try { lj = (await CBN.liveNow()).game; } catch {}
    const now = Date.now();
    const done = sched.filter(g => isFinal(g.state));
    const lastDone = done[done.length - 1];
    let cur = lj && !isFinal(lj.state) ? lj : sched.find(g => isLive(g.state)) || sched.find(g => !isFinal(g.state) && new Date(g.startTimeUTC) > now - 5 * 3600e3);
    const mode = params.get("mode") === "replay" ? "replay" : "live";
    const rid = params.get("id") && /^\d+$/.test(params.get("id")) ? +params.get("id") : lastDone?.id;
    if (mode === "live" && params.get("id") && /^\d+$/.test(params.get("id"))) { const x = sched.find(g => g.id === +params.get("id")); if (x) cur = x; }
    const opt = g => { const m = CBN.matchup(g); return `<option value="${g.id}"${mode === "replay" && g.id === rid ? " selected" : ""}>${fmtDate(g.startTimeUTC, {month: "short", day: "numeric"})} ${m.home ? "vs" : "@"} ${esc(m.opp.abbrev)} ${m.label} ${m.us.score}-${m.opp.score}</option>`; };
    $("modes").innerHTML = `<button id="m-live" class="${mode === "live" ? "on" : ""}">${cur && isLive(cur.state) ? "● Live game" : "Next game"}</button>
      ${lastDone ? `<button id="m-rep" class="${mode === "replay" && rid === lastDone.id ? "on" : ""}">↺ Replay last game</button>` : ""}
      ${done.length ? `<select id="m-pick" aria-label="Replay another game"><option value="">Replay another…</option>${done.slice().reverse().map(opt).join("")}</select>` : ""}`;
    const go = (m, id) => { const u = new URL(location.href); u.search = m === "replay" ? `?mode=replay&id=${id}` : ""; location.href = u; };
    $("m-live").onclick = () => go("live");
    if ($("m-rep")) $("m-rep").onclick = () => go("replay", lastDone.id);
    if ($("m-pick")) $("m-pick").onchange = e => e.target.value && go("replay", e.target.value);
    if (mode === "replay" && rid) return replay(rid);
    if (cur) return live(cur);
    $("trk").innerHTML = `<p>No upcoming Oilers games on the schedule.${lastDone ? ` <a href="tracker.html?mode=replay&id=${lastDone.id}">Replay the last game</a>.` : ""}</p>`;
  }
  window.__trk = S; // for debugging/tests
  boot();
})();
