(async () => {
  const {$, esc, getJSON, fmtDate, isFinal, isLive, matchup} = CBN;
  const box = $("scores");
  let d; try { d = await getJSON("data/schedule.json"); } catch { box.textContent = "Couldn't load scores."; return; }
  const draw = () => {
    const list = d.games.filter(g => isFinal(g.state) || isLive(g.state)).reverse();
    box.innerHTML = list.length ? `<div class="sched-list">${list.map(g => { const m = matchup(g), live = isLive(g.state);
      return `<a class="game-row${live ? " next" : ""}" href="game.html?id=${g.id}">
        <div class="gdate">${fmtDate(g.startTimeUTC, {month: "short"})}<b>${fmtDate(g.startTimeUTC, {day: "numeric"})}</b></div>
        <div class="gopp"><span class="ha">${m.home ? "vs" : "@"}</span> ${esc(m.opp.place)} ${esc(m.oppName)}${g.gameType === 1 ? ' <span class="pre">PRE</span>' : ""}<small>${esc(g.away.abbrev)} ${g.away.score} – ${g.home.score} ${esc(g.home.abbrev)} · ${esc(g.venue)}</small></div>
        <div class="gres">${live ? `<span class="res live">LIVE ${m.us.score}-${m.opp.score}</span>` : `<span class="res ${m.win ? "w" : "l"}">${m.label} ${m.us.score}-${m.opp.score}${m.extra}</span>`}<small>Box score →</small></div></a>`; }).join("")}</div>` : "<p>No games played yet.</p>";
    return list.some(g => isLive(g.state));
  };
  const tick = async () => { if (draw()) { setTimeout(async () => { try { d = await getJSON("data/schedule.json"); } catch {} tick(); }, 30000); } };
  tick();
})();
