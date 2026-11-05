(async () => {
  const {$, esc, getJSON, fmtDate, bothTimes, periodName, isFinal, isLive, matchup} = CBN;
  const root = $("game"), id = new URLSearchParams(location.search).get("id");
  if (!/^\d+$/.test(id || "")) { root.innerHTML = '<p>No game selected. <a href="schedule.html">Pick one from the schedule.</a></p>'; return; }
  const pn = p => p.periodType === "REG" ? String(p.number) : periodName(p);
  const nm = p => p ? `${p.firstName?.default?.[0] || ""}. ${p.lastName?.default || ""}`.trim() : "";
  const stat = (r, c) => (r.teamGameStats || []).find(x => x.category === c) || {};
  async function draw() {
    let d; try { d = await getJSON(`data/games/${id}.json`); } catch { root.innerHTML = '<p>Box score not available yet. Box scores appear once a game starts. <a href="schedule.html">Back to schedule</a></p>'; return false; }
    const b = d.box, s = d.summary || {}, r = d.rail || {}, A = b.awayTeam, H = b.homeTeam;
    const g = {home: {abbrev: H.abbrev, score: H.score, name: H.commonName?.default}, away: {abbrev: A.abbrev, score: A.score, name: A.commonName?.default}, lastPeriod: b.gameOutcome?.lastPeriodType};
    const fin = isFinal(b.gameState), live = isLive(b.gameState), m = matchup(g);
    document.title = `${A.abbrev} ${A.score ?? ""} @ ${H.abbrev} ${H.score ?? ""} | The Copper & Blue News`;
    const status = fin ? `Final${g.lastPeriod && g.lastPeriod !== "REG" ? "/" + g.lastPeriod : ""} · <span class="${m.win ? "w" : "l"}">${m.label}</span>`
      : live ? `<span class="pulse"></span>LIVE · ${periodName(b.periodDescriptor)} ${b.clock?.inIntermission ? "INT " : ""}${esc(b.clock?.timeRemaining || "")}` : `Puck drop ${bothTimes(b.startTimeUTC)}`;
    const per = r.linescore?.byPeriod || [], shots = r.shotsByPeriod || [];
    const lineTbl = (rows, tot, label) => `<table class="tbl line"><thead><tr><th>${label}</th>${rows.map(p => `<th>${pn(p.periodDescriptor)}</th>`).join("")}<th>T</th></tr></thead><tbody>
      ${[["away", A], ["home", H]].map(([k, t]) => `<tr><td><b>${esc(t.abbrev)}</b></td>${rows.map(p => `<td>${p[k]}</td>`).join("")}<td><b>${tot(k)}</b></td></tr>`).join("")}</tbody></table>`;
    const goals = (s.scoring || []).filter(p => p.periodDescriptor.periodType !== "SO").map(p => `<h3 class="per">${pn(p.periodDescriptor) === "OT" ? "Overtime" : periodName(p.periodDescriptor) + " period"}</h3>${p.goals.length ? p.goals.map(x => `<div class="ev">
      <span class="t">${x.timeInPeriod}</span><span class="tm">${esc(x.teamAbbrev.default)}</span>
      <div><b>${esc(x.name.default)}</b> ${x.goalsToDate ? `(${x.goalsToDate})` : ""}${x.strength && x.strength !== "ev" ? ` <span class="tag2">${x.strength.toUpperCase()}</span>` : ""}${x.goalModifier === "empty-net" ? ' <span class="tag2">EN</span>' : ""}
      <small>${x.assists?.length ? "Assists: " + x.assists.map(a => esc(a.name.default)).join(", ") : "Unassisted"} · ${x.awayScore}-${x.homeScore}</small></div></div>`).join("") : '<p class="meta">No scoring</p>'}`).join("");
    const so = s.shootout?.events?.length ? `<h3 class="per">Shootout</h3>${s.shootout.events.map(e => `<div class="ev"><span class="t">#${e.sequence}</span><span class="tm">${esc(e.teamAbbrev.default)}</span><div>${esc(e.firstName.default)} ${esc(e.lastName.default)} <small>${e.result === "goal" ? "<b class='w'>GOAL</b>" : esc(e.result)}${e.gameWinner ? " · winner" : ""}</small></div></div>`).join("")}` : "";
    const pens = (s.penalties || []).map(p => p.penalties.length ? `<h3 class="per">${periodName(p.periodDescriptor)}</h3>${p.penalties.map(x => `<div class="ev"><span class="t">${x.timeInPeriod}</span><span class="tm">${esc(x.teamAbbrev.default)}</span>
      <div><b>${esc(nm(x.committedByPlayer) || (x.servedBy ? "Bench (served by " + esc(x.servedBy.default || x.servedBy) + ")" : "Team"))}</b> ${x.duration} min <small>${esc((x.descKey || "").replace(/-/g, " "))}${x.drawnBy ? " · drawn by " + esc(nm(x.drawnBy)) : ""}</small></div></div>`).join("")}` : "").join("") || '<p class="meta">No penalties</p>';
    const fo = stat(r, "faceoffWins"), pp = stat(r, "powerPlay");
    const ts = [["Shots", stat(r, "sog")], ["Power play", pp], ["Faceoffs", {awayValue: `${fo.awayValue ?? ""} (${Math.round((stat(r, "faceoffWinningPctg").awayValue || 0) * 100)}%)`, homeValue: `${fo.homeValue ?? ""} (${Math.round((stat(r, "faceoffWinningPctg").homeValue || 0) * 100)}%)`}],
      ["Hits", stat(r, "hits")], ["Blocks", stat(r, "blockedShots")], ["PIM", stat(r, "pim")], ["Giveaways", stat(r, "giveaways")], ["Takeaways", stat(r, "takeaways")]];
    const stars = (s.threeStars || []).length ? `<div class="stars">${s.threeStars.map(x => `<div class="star"><span>${"★".repeat(x.star)}</span><b>${esc(x.name.default)}</b><small>${esc(x.teamAbbrev)} · ${x.position === "G" ? (x.savePctg ? "SV% " + x.savePctg.toFixed(3).replace(/^0/, "") : "G") : `${x.goals}G ${x.assists}A`}</small></div>`).join("")}</div>` : "";
    const pg = b.playerByGameStats || {};
    const skTbl = list => `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Skater</th><th>Pos</th><th>G</th><th>A</th><th>P</th><th>+/-</th><th>SOG</th><th>PIM</th><th>HIT</th><th>BLK</th><th>FO%</th><th>TOI</th></tr></thead><tbody>
      ${list.map(p => `<tr><td>#${p.sweaterNumber} ${esc(p.name.default)}</td><td>${p.position}</td><td>${p.goals}</td><td>${p.assists}</td><td>${p.points}</td><td>${p.plusMinus > 0 ? "+" : ""}${p.plusMinus}</td><td>${p.sog}</td><td>${p.pim}</td><td>${p.hits}</td><td>${p.blockedShots}</td><td>${p.faceoffWinningPctg ? Math.round(p.faceoffWinningPctg * 100) : "-"}</td><td>${p.toi}</td></tr>`).join("")}</tbody></table></div>`;
    const gTbl = list => `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Goalie</th><th>SA</th><th>SV</th><th>GA</th><th>SV%</th><th>EV</th><th>PP</th><th>TOI</th><th>Dec</th></tr></thead><tbody>
      ${list.filter(p => p.toi !== "00:00").map(p => `<tr><td>#${p.sweaterNumber} ${esc(p.name.default)}</td><td>${p.shotsAgainst}</td><td>${p.saves}</td><td>${p.goalsAgainst}</td><td>${p.savePctg != null ? p.savePctg.toFixed(3).replace(/^0/, "") : "-"}</td><td>${p.evenStrengthShotsAgainst}</td><td>${p.powerPlayShotsAgainst}</td><td>${p.toi}</td><td>${esc(p.decision || "")}</td></tr>`).join("")}</tbody></table></div>`;
    const team = (k, t) => pg[k] ? `<h3 class="per">${esc(t.placeName?.default || "")} ${esc(t.commonName?.default || t.abbrev)}</h3>${skTbl([...pg[k].forwards, ...pg[k].defense].sort((a, b) => b.points - a.points || b.goals - a.goals))}${gTbl(pg[k].goalies)}` : "";
    root.innerHTML = `<p class="crumb"><a href="schedule.html">← Schedule</a></p>
      <div class="scorebug card"><div class="st">${status}</div>
        <div class="live-score"><div><span>${esc(A.abbrev)}</span><b>${A.score ?? 0}</b><small>SOG ${A.sog ?? 0}</small></div><div class="dash">@</div>
        <div><span>${esc(H.abbrev)}</span><b>${H.score ?? 0}</b><small>SOG ${H.sog ?? 0}</small></div></div>
        <div class="meta">${fmtDate(b.startTimeUTC, {weekday: "long", month: "long", day: "numeric", year: "numeric"})} · ${bothTimes(b.startTimeUTC)} · ${esc(b.venue?.default)}</div>
        ${live ? '<div class="meta">Auto-refreshing · data is ~2-4 min behind live</div>' : ""}</div>
      ${stars ? `<h2 class="sub">Three Stars</h2>${stars}` : ""}
      <h2 class="sub">Scoring by Period</h2><div class="tbl-wrap">${lineTbl(per, k => r.linescore?.totals?.[k] ?? "", "Goals")}</div>
      <div class="tbl-wrap">${lineTbl(shots, k => (k === "away" ? A : H).sog ?? "", "Shots")}</div>
      <div class="two"><div><h2 class="sub">Goals</h2>${goals || '<p class="meta">No goals yet</p>'}${so}</div><div><h2 class="sub">Penalties</h2>${pens}</div></div>
      <h2 class="sub">Team Stats</h2><table class="tbl ts"><thead><tr><th>${esc(A.abbrev)}</th><th></th><th>${esc(H.abbrev)}</th></tr></thead><tbody>${ts.map(([l, v]) => `<tr><td>${esc(v.awayValue ?? "-")}</td><th>${l}</th><td>${esc(v.homeValue ?? "-")}</td></tr>`).join("")}</tbody></table>
      <h2 class="sub">Player Stats</h2>${team("awayTeam", A)}${team("homeTeam", H)}
      <p class="updated">Data fetched ${new Date(d.fetched).toLocaleString("en-US", {timeZone: "America/Edmonton", dateStyle: "medium", timeStyle: "short"})} MT · source: public NHL API</p>`;
    return live || (!fin && new Date(b.startTimeUTC) - Date.now() < 3600e3);
  }
  const tick = async () => { if (await draw()) setTimeout(tick, 30000); };
  tick();
})();
