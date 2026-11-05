(async () => {
  const {$, esc, getJSON, fmtDate, bothTimes, isFinal, isLive, matchup} = CBN;
  const box = $("sched");
  let d; try { d = await getJSON("data/schedule.json"); } catch { box.textContent = "Couldn't load the schedule."; return; }
  const types = {1: "Preseason", 2: "Regular season", 3: "Playoffs"};
  const next = d.games.find(g => !isFinal(g.state));
  let filter = d.games.some(g => g.gameType === 2) ? "2" : "all", where = "all";
  const btn = (k, v, label, cur) => `<button data-${k}="${v}" class="${cur === v ? "on" : ""}">${label}</button>`;
  function draw() {
    $("filters").innerHTML = [btn("type", "all", "All", filter), ...[...new Set(d.games.map(g => g.gameType))].map(t => btn("type", String(t), types[t] || "Other", filter)),
      "<span class='sep'></span>", btn("where", "all", "Home & Away", where), btn("where", "home", "Home", where), btn("where", "away", "Away", where), next ? '<button class="jump" data-jump="1">Next game ↓</button>' : ""].join("");
    const list = d.games.filter(g => (filter === "all" || String(g.gameType) === filter) && (where === "all" || (where === "home") === (g.home.abbrev === "EDM")));
    const months = {};
    list.forEach(g => (months[fmtDate(g.startTimeUTC, {month: "long", year: "numeric"})] ??= []).push(g));
    box.innerHTML = Object.entries(months).map(([mo, gs]) => `<h2 class="month">${mo}</h2><div class="sched-list">${gs.map(row).join("")}</div>`).join("") || "<p>No games.</p>";
  }
  function row(g) {
    const m = matchup(g), fin = isFinal(g.state), live = isLive(g.state);
    const res = fin ? `<span class="res ${m.win ? "w" : "l"}">${m.label} ${m.us.score}-${m.opp.score}${m.extra}</span>`
      : live ? `<span class="res live">LIVE ${m.us.score}-${m.opp.score}</span>`
      : g.scheduleState !== "OK" ? `<span class="res">${esc(g.scheduleState)}</span>` : `<span class="time">${bothTimes(g.startTimeUTC)}</span>`;
    const link = fin || live;
    return `<${link ? `a href="game.html?id=${g.id}"` : "div"} class="game-row${g === next ? " next" : ""}">
      <div class="gdate">${fmtDate(g.startTimeUTC, {weekday: "short"})}<b>${fmtDate(g.startTimeUTC, {day: "numeric"})}</b></div>
      <div class="gopp"><span class="ha">${m.home ? "vs" : "@"}</span> ${esc(m.opp.place || m.oppName)} ${esc(m.oppName)}${g === next ? ' <span class="badge">Next</span>' : ""}${g.gameType === 1 ? ' <span class="pre">PRE</span>' : ""}<small>${esc(g.venue)}</small></div>
      <div class="gres">${res}${link ? '<small>Box score →</small>' : ""}</div></${link ? "a" : "div"}>`;
  }
  $("filters").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; if (b.dataset.jump) { document.querySelector(".game-row.next")?.scrollIntoView({behavior: "smooth", block: "center"}); return; } if (b.dataset.type) filter = b.dataset.type; if (b.dataset.where) where = b.dataset.where; draw(); });
  draw();
})();
