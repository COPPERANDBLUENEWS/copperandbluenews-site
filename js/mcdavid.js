// McDavid Chase. Reads data/mcdavid.json (written by scripts/update_data.py).
// The NHL API sends no CORS headers, so the page never calls it directly.
(function () {
  if (!$("chase") && !$("chaseApp")) return;
  const RECORD = 215;

  const ppgText = n => n == null || !isFinite(n) ? "—" : Number(n).toFixed(2);
  const oneDec = n => (Math.round(Number(n) * 10) / 10).toFixed(1);
  const gapText = n => {
    const v = Math.round(Math.abs(Number(n)) * 10) / 10;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  };
  const shortDate = iso => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {timeZone: "UTC", weekday: "short", month: "short", day: "numeric"});
  };
  const whenGame = g => {
    if (!g) return "";
    const where = `${g.home ? "vs" : "@"} ${g.oppName || g.opp}`;
    return `${fmtDate(g.startTimeUTC, {weekday: "short", month: "short", day: "numeric", year: "numeric"})} · ${where} · ${bothTimes(g.startTimeUTC)}`;
  };
  const markerPoints = (d) => {
    const s = d.summary;
    if (s.gretzkyThrough != null) return {points: s.gretzkyThrough, actual: true};
    if (d.gretzky && d.gretzky.pace === "average" && s.gp) return {points: RECORD * s.gp / d.gretzky.gamesPlayed, actual: false};
    return {points: null, actual: false};
  };

  function renderCard(d) {
    const s = d.summary, go = $("chaseGo"), meta = $("chaseMeta"), fill = $("chaseFill"), tick = $("chaseTick"), track = $("chaseTrack");
    if (!go) return;
    const ahead = s.points >= RECORD + 1 ? `${s.points - RECORD} past 215` : s.points === RECORD ? "Tied 215" : `${s.toTie} to go`;
    go.innerHTML = `${esc(ahead)}<small>${s.points >= RECORD ? "the record" : "to tie 215"}</small>`;
    const pct = Math.max(0, Math.min(100, s.points / RECORD * 100));
    fill.style.width = pct + "%";
    const mark = markerPoints(d);
    if (mark.points == null) tick.hidden = true;
    else {
      tick.hidden = false;
      tick.style.left = Math.max(0, Math.min(100, mark.points / RECORD * 100)) + "%";
      tick.title = mark.actual ? `Gretzky after ${s.gp} games: ${mark.points} points` : "Average 215-in-80 pace";
    }
    const live = d.live ? ` · live: ${d.live.points} pt${d.live.points === 1 ? "" : "s"} vs ${d.live.opp}` : "";
    meta.textContent = `${s.goals}-${s.assists}—${s.points} · ${s.gp} GP · ${s.gamesLeft} left${live}`;
    if (track) track.setAttribute("aria-label", `${s.points} of ${RECORD} points`);
    $("chase").setAttribute("aria-label", `McDavid Chase, ${ahead}`);
  }

  function ringSVG(points, mark) {
    const r = 46, c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(1, points / RECORD));
    let tick = "";
    if (mark != null) {
      const ang = -Math.PI / 2 + Math.max(0, Math.min(1, mark / RECORD)) * 2 * Math.PI;
      const x1 = 60 + Math.cos(ang) * 40, y1 = 60 + Math.sin(ang) * 40;
      const x2 = 60 + Math.cos(ang) * 52, y2 = 60 + Math.sin(ang) * 52;
      tick = `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#e8c4a4" stroke-width="3" stroke-linecap="round"><title>Gretzky marker: ${esc(String(Math.round(mark)))} points</title></line>`;
    }
    return `<svg viewBox="0 0 120 120" role="img" aria-label="${points} of ${RECORD} points">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="#1f3866" stroke-width="8"/>
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="#FF4C00" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${(pct * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 60 60)"/>
      ${tick}</svg>`;
  }

  function paceSentence(s) {
    const tie = s.tie, br = s.break;
    if (s.points >= RECORD + 1) return `<p class="chase-on">The record is broken. He's ${s.points - RECORD} past 215.</p>`;
    if (s.points === RECORD) return `<p class="chase-on">He has tied the record at 215. ${s.toBreak} more breaks it.</p>`;
    const need = s.gamesLeft > 0
      ? `<p>He needs <b>${ppgText(s.toTie / s.gamesLeft)}</b> points per game over the ${s.gamesLeft} left to tie, and <b>${ppgText(s.toBreak / s.gamesLeft)}</b> to break it.</p>`
      : `<p>No regular-season games left.</p>`;
    let where = "";
    if (br.onPace && br.game) {
      const same = tie.game && tie.game.id === br.game.id;
      where = same
        ? `<p class="chase-on">On pace to tie and break the record on ${esc(whenGame(br.game))}.</p>`
        : `<p class="chase-on">On pace to break the record on ${esc(whenGame(br.game))}.</p>`;
      if (!same && tie.onPace && tie.game) where += `<p>The pace line reaches 215 on ${esc(whenGame(tie.game))}.</p>`;
    } else if (tie.onPace && tie.game) {
      where = `<p class="chase-on">On pace to tie 215 on ${esc(whenGame(tie.game))}.</p>`;
      if (!br.onPace) where += `<p class="chase-off">Off pace to break it by ${gapText(br.offBy)} points.</p>`;
    } else {
      where = `<p class="chase-off">Off pace by ${gapText(tie.offBy)} points.</p>`;
    }
    return need + where;
  }

  function drawChart(d) {
    const host = $("chaseChart"), read = $("chaseRead");
    const games = d.games || [];
    const n = games.length;
    if (!n) { host.textContent = "No games in the log yet."; read.textContent = ""; return; }
    const cum = d.gretzky && d.gretzky.pace === "game-log" ? (d.gretzky.cumulative || []) : null;
    const actual = !!(cum && cum.length);
    const greN = actual ? Math.min(n, cum.length) : n;
    const gre = actual ? cum.slice(0, greN) : games.map(g => RECORD * g.gp / (d.gretzky.gamesPlayed || 80));
    const legend = $("chaseLegend");
    legend.innerHTML = `<span><i class="me"></i>McDavid</span><span><i class="him"></i>${actual ? "Gretzky 1985-86" : "Average pace (215/80)"}</span>`;
    const top = Math.max(...games.map(g => g.cum), ...gre, 1);
    const axisMax = Math.max(4, Math.ceil(top * 1.18));
    const W = 360, H = 196, L = 34, R = 8, T = 14, B = 24;
    const x = i => L + (n === 1 ? (W - L - R) / 2 : (W - L - R) * i / (n - 1));
    const y = v => T + (H - T - B) * (1 - v / axisMax);
    const poly = arr => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const yLabel = v => `<text x="${L - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" fill="#9fb0cc" font-size="10" font-family="Inter,sans-serif">${v}</text>`;
    const grid = [0, Math.round(axisMax / 2), axisMax].map(v =>
      `<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}" stroke="#1f3866" stroke-width="1"/>${yLabel(v)}`).join("");
    const dots = games.map((g, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(g.cum).toFixed(1)}" r="3.2" fill="#FF4C00"><title>Game ${g.gp}: ${g.cum} points</title></circle>`).join("");
    const xLabels = [0, n - 1].filter((v, i, a) => a.indexOf(v) === i).map(i =>
      `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : "end"}" fill="#9fb0cc" font-size="10" font-family="Inter,sans-serif">${games[i].gp}</text>`).join("");
    const gretzkyLabel = actual ? `Gretzky had ${gre[gre.length - 1]} after ${greN} games in 1985-86.` : "Dashed line is an even 215 points over 80 games.";
    host.innerHTML = `<svg class="chase-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="McDavid has ${games[n - 1].cum} points through ${n} games. ${gretzkyLabel}">
      <rect width="${W}" height="${H}" fill="transparent"/>
      ${grid}
      <polyline points="${poly(gre)}" fill="none" stroke="#9fb0cc" stroke-width="2" stroke-dasharray="4 3"/>
      <polyline points="${poly(games.map(g => g.cum))}" fill="none" stroke="#FF4C00" stroke-width="2.5"/>
      ${dots}${xLabels}
      <line id="chaseGuide" x1="0" y1="${T}" x2="0" y2="${H - B}" stroke="#e8c4a4" stroke-width="1" opacity="0"/>
    </svg>`;
    const svg = host.querySelector("svg");
    const guide = svg.querySelector("#chaseGuide");
    const show = i => {
      const g = games[i];
      guide.setAttribute("x1", x(i)); guide.setAttribute("x2", x(i)); guide.setAttribute("opacity", "0.8");
      const where = `${g.home ? "vs" : "@"} ${g.oppName || g.opp}`;
      const him = !actual ? `Average pace: ${oneDec(gre[i])}.`
        : i < gre.length ? `Gretzky had ${gre[i]} after this many games.`
        : `Gretzky's 1985-86 log ends at ${cum.length} games.`;
      read.textContent = `Game ${g.gp} · ${shortDate(g.date)} · ${where} · ${g.g}G ${g.a}A · ${g.cum} points. ${him}`;
    };
    const pick = ev => {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) / rect.width * W;
      let best = 0, dist = Infinity;
      for (let i = 0; i < n; i++) { const dd = Math.abs(x(i) - px); if (dd < dist) { dist = dd; best = i; } }
      show(best);
    };
    svg.addEventListener("pointermove", pick);
    svg.addEventListener("pointerdown", pick);
    show(n - 1);
  }

  function renderPage(d) {
    const s = d.summary;
    const body = $("chaseBody");
    body.hidden = false;
    $("chaseStatus").hidden = true;
    const mark = markerPoints(d);
    $("chaseRing").innerHTML = ringSVG(s.points, mark.points);
    const num = $("chaseNum");
    if (s.points > RECORD) { num.innerHTML = `<b>${s.points - RECORD}</b><span>past 215</span>`; }
    else if (s.points === RECORD) { num.innerHTML = `<b>215</b><span>tied</span>`; }
    else { num.innerHTML = `<b>${s.toTie}</b><span>to tie 215</span>`; }
    $("chaseBreak").textContent = s.points > RECORD ? `${s.points} points, ${s.goals} goals and ${s.assists} assists.`
      : `${s.toBreak} to break it (216).`;
    $("chaseLine").textContent = `${s.goals}G · ${s.assists}A · ${s.points}P · ${s.gp} GP · ${s.gamesLeft} left`;
    const liveEl = $("chaseLive");
    if (d.live) {
      const L = d.live;
      liveEl.hidden = false;
      const left = L.toTie > 0
        ? `If this game ended now, ${L.toTie} points would still be needed to tie 215, and ${L.toBreak} to break it.`
        : L.toBreak > 0
          ? `If this game ended now, 215 would be tied. ${L.toBreak} more would break it.`
          : `If this game ended now, the record would be broken.`;
      liveEl.textContent = `${L.home ? "vs" : "@"} ${L.oppName || L.opp}, live: ${L.goals}G ${L.assists}A. ${left} The countdown stays on completed games until the NHL game log includes this one.`;
    } else liveEl.hidden = true;
    const diff = mark.actual ? s.points - mark.points : null;
    const ahead = diff == null ? "" : diff === 0 ? "even with Gretzky" : diff > 0 ? `${diff} ahead of Gretzky` : `${-diff} behind Gretzky`;
    $("chaseMark").textContent = mark.actual
      ? `Tick: Gretzky had ${mark.points} after ${s.gp} games in 1985-86. McDavid is ${ahead}.`
      : mark.points != null
        ? `Tick: an even 215-points-in-80-games pace (${oneDec(mark.points)} after ${s.gp}). His game-by-game 1985-86 log was not available, so this is not his actual total.`
        : "";
    const played = s.gp + s.gamesLeft;
    $("chasePpg").innerHTML = `${ppgText(s.ppg)} <span>per game</span>`;
    $("chaseProj").textContent = s.ppg == null ? "No pace yet." : `${oneDec(s.tie.projected)} projected points`;
    const sched = `${s.gamesLeft} games left on the Oilers' ${s.seasonGames}-game regular-season schedule.`;
    const missed = s.missed ? ` ${s.missed} final ${s.missed === 1 ? "game" : "games"} are missing from his log, so the projection uses the ${played} he can still play.` : "";
    $("chaseSched").textContent = sched + missed;
    $("chasePredict").innerHTML = paceSentence(s);
    const logged = d.games || [];
    const sig = `${logged.length}:${logged.length ? logged[logged.length - 1].cum : 0}:${d.gretzky && d.gretzky.pace}`;
    const chartHost = $("chaseChart");
    if (chartHost.dataset.sig !== sig) { chartHost.dataset.sig = sig; drawChart(d); }
    const prior = (d.seasons || []).filter(x => String(x.seasonId) !== String(d.season)).sort((a, b) => b.p - a.p || b.gp - a.gp);
    const best = prior[0], next = prior[1];
    const g = d.gretzky || {};
    const bestThrough = best && d.careerBest && d.careerBest.seasonId === best.seasonId && s.careerBestThrough != null
      ? ` Through ${s.gp} games that year he had ${s.careerBestThrough}.` : "";
    const items = [];
    if (mark.actual) items.push(`<li><b>${diff > 0 ? "+" : ""}${diff}</b><span><strong>Same ${s.gp} games</strong> · Gretzky had ${mark.points} points in 1985-86. McDavid is ${ahead}.</span></li>`);
    if (best) items.push(`<li><b>${best.p}</b><span><strong>Career best, ${esc(best.season)}</strong> · ${best.g}-${best.a}—${best.p} in ${best.gp} GP.${esc(bestThrough)}</span></li>`);
    if (next) items.push(`<li><b>${next.p}</b><span><strong>${esc(next.season)}</strong> · ${next.g}-${next.a}—${next.p} in ${next.gp} GP.</span></li>`);
    items.push(`<li><b>${g.points || RECORD}</b><span><strong>The record, ${esc(g.season || "1985-86")}</strong> · ${g.goals}-${g.assists}—${g.points} in ${g.gamesPlayed} GP. Wayne Gretzky, Oilers.</span></li>`);
    $("chaseCmp").innerHTML = items.join("");
    const updated = d.updated ? new Date(d.updated).toLocaleString("en-US", {timeZone: "America/Edmonton", dateStyle: "medium", timeStyle: "short"}) + " MT" : "";
    $("chaseUpdated").textContent = updated ? "Updated " + updated : "";
    const share = $("chaseShare");
    share.onclick = async () => {
      const text = `McDavid Chase: ${s.goals}G-${s.assists}A-${s.points}P in ${s.gp} GP. ${s.points >= RECORD ? "He's at the record." : s.toTie + " points to tie Gretzky's 215."} ${s.gamesLeft} games left.`;
      const url = "https://copperandbluenews.com/mcdavid.html";
      if (navigator.share) {
        try { await navigator.share({title: "McDavid Chase", text, url}); return; }
        catch (e) { if (e && e.name === "AbortError") return; }
      }
      try { await navigator.clipboard.writeText(text + " " + url); share.textContent = "Copied"; }
      catch { share.textContent = "Copy the link"; }
    };
  }

  CBN.pollVisible(async () => {
    try {
      const d = await getJSON("data/mcdavid.json");
      if (!d.summary || !Array.isArray(d.games)) throw new Error("bad chase file");
      if ($("chase")) renderCard(d);
      if ($("chaseApp")) renderPage(d);
      return d.live ? 30000 : 300000;
    } catch (e) {
      console.warn(e);
      if ($("chaseMeta")) $("chaseMeta").textContent = "Couldn't load the chase.";
      const st = $("chaseStatus");
      if (st) { st.hidden = false; st.textContent = "Couldn't load the chase."; }
      return 300000;
    }
  });
})();
