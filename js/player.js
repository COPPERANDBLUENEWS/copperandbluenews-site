(async () => {
  const {$, esc, getJSON} = CBN;
  const root = $("player"), id = new URLSearchParams(location.search).get("id");
  if (!/^\d+$/.test(id || "")) { root.innerHTML = '<p>No player selected. <a href="players.html">See the roster.</a></p>'; return; }
  const inj = (await CBN.injuries())[+id];
  let p; try { p = await getJSON(`data/players/${id}.json`); } catch { root.innerHTML = '<p>Profile not available. <a href="players.html">Back to Players</a></p>'; return; }
  const name = `${p.firstName.default} ${p.lastName.default}`, G = p.position === "G";
  document.title = `${name} | The Copper & Blue News`;
  const POS = {C: "Centre", L: "Left Wing", R: "Right Wing", D: "Defence", G: "Goalie"};
  const COUNTRY = {CAN: "Canada", USA: "USA", SWE: "Sweden", FIN: "Finland", DEU: "Germany", CZE: "Czechia", SVK: "Slovakia", RUS: "Russia", CHE: "Switzerland", DNK: "Denmark", NOR: "Norway", AUT: "Austria", LVA: "Latvia", FRA: "France", GBR: "UK"};
  const born = new Date(p.birthDate + "T12:00:00"), now = new Date();
  const age = now.getFullYear() - born.getFullYear() - (now < new Date(now.getFullYear(), born.getMonth(), born.getDate()) ? 1 : 0);
  const place = [p.birthCity?.default, p.birthStateProvince?.default, COUNTRY[p.birthCountry] || p.birthCountry].filter(Boolean).join(", ");
  const ht = CBN.ht(p), wt = CBN.wt(p);
  const dd = p.draftDetails, ord = n => n + (["th","st","nd","rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || "th");
  const draft = dd ? `${dd.year} ${esc(dd.teamAbbrev)}, round ${dd.round}, pick ${dd.pickInRound} (${ord(dd.overallPick)} overall)` : "Undrafted";
  const seasonFmt = s => `${String(s).slice(0, 4)}-${String(s).slice(6)}`;
  const pct = v => v == null ? "-" : v.toFixed(3).replace(/^0/, ""), gaa = v => v == null ? "-" : v.toFixed(2), pm = v => v > 0 ? "+" + v : (v ?? "-");
  const cr = p.careerTotals?.regularSeason, cp = p.careerTotals?.playoffs, cur = p.featuredStats?.regularSeason?.subSeason;
  // Bio: built only from API fields.
  const awards = (p.awards || []).map(a => `${a.trophy.default}${a.seasons.length > 1 ? ` (${a.seasons.length}×)` : ""}`);
  let bio = `${name} is a ${age}-year-old ${(POS[p.position] || p.position).toLowerCase()} for the Edmonton Oilers, wearing #${p.sweaterNumber}. Born in ${place} on ${born.toLocaleDateString("en-US", {month: "long", day: "numeric", year: "numeric"})}, he ${G ? "catches" : "shoots"} ${p.shootsCatches === "L" ? "left" : "right"}. `;
  bio += dd ? `He was drafted ${ord(dd.overallPick)} overall by ${esc(dd.teamAbbrev)} in ${dd.year}. ` : "He was never drafted. ";
  if (cr) bio += G ? `Over ${cr.gamesPlayed} NHL regular-season games he has ${cr.wins} wins, a ${gaa(cr.goalsAgainstAvg)} GAA, a ${pct(cr.savePctg)} save percentage and ${cr.shutouts} shutouts.`
    : `Over ${cr.gamesPlayed} NHL regular-season games he has ${cr.goals} goals and ${cr.assists} assists for ${cr.points} points.`;
  if (awards.length) bio += ` His NHL awards include the ${awards.join(", ")}.`;
  const sk = [["GP", "gamesPlayed"], ["G", "goals"], ["A", "assists"], ["P", "points"], ["+/-", "plusMinus", pm], ["PIM", "pim"], ["PPG", "powerPlayGoals"], ["SOG", "shots"], ["SH%", "shootingPctg", v => v == null ? "-" : (v * 100).toFixed(1)], ["TOI", "avgToi"]];
  const gk = [["GP", "gamesPlayed"], ["W", "wins"], ["L", "losses"], ["OTL", "otLosses"], ["GAA", "goalsAgainstAvg", gaa], ["SV%", "savePctg", pct], ["SO", "shutouts"]];
  const cols = G ? gk : sk;
  const cell = (r, [, k, f]) => `<td>${esc(r?.[k] == null ? "-" : f ? f(r[k]) : r[k])}</td>`;
  const tbl = (head, rows) => `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const big = (r, label) => r ? `<div class="statline"><h3>${label}</h3><div>${cols.filter(c => !["PIM", "PPG", "TOI", "SH%"].includes(c[0])).map(c => `<span><b>${esc(r[c[1]] == null ? "-" : c[2] ? c[2](r[c[1]]) : r[c[1]])}</b>${c[0]}</span>`).join("")}</div></div>` : "";
  const l5 = (p.last5Games || []).map(g => `<tr><td><a class="plink" href="game.html?id=${g.gameId}">${new Date(g.gameDate + "T12:00:00").toLocaleDateString("en-US", {month: "short", day: "numeric"})}</a></td><td>${g.homeRoadFlag === "H" ? "vs" : "@"} ${esc(g.opponentAbbrev)}</td>${G
    ? `<td>${esc(g.decision || "-")}</td><td>${g.shotsAgainst}</td><td>${g.goalsAgainst}</td><td>${pct(g.savePctg)}</td><td>${g.toi}</td>`
    : `<td>${g.goals}</td><td>${g.assists}</td><td>${g.points}</td><td>${pm(g.plusMinus)}</td><td>${g.shots}</td><td>${g.toi}</td>`}</tr>`).join("");
  const l5h = `<th>Date</th><th>Opp</th>${G ? "<th>Dec</th><th>SA</th><th>GA</th><th>SV%</th><th>TOI</th>" : "<th>G</th><th>A</th><th>P</th><th>+/-</th><th>SOG</th><th>TOI</th>"}`;
  const seasons = (p.nhlSeasons || []).filter(s => s.gameTypeId === 2).reverse();
  const seasonRows = seasons.map(s => `<tr><td>${seasonFmt(s.season)}</td><td>${esc(s.teamName?.default || "")}</td>${cols.map(c => cell(s, c)).join("")}</tr>`).join("");
  const careerRow = (r, l) => r ? `<tr><td><b>${l}</b></td>${cols.map(c => cell(r, c)).join("")}</tr>` : "";
  const aw = (p.awards || []).length ? `<h2 class="sub">Awards</h2><ul class="awards">${p.awards.map(a => `<li><b>${esc(a.trophy.default)}</b><small>${a.seasons.map(s => seasonFmt(s.seasonId)).join(", ")}</small></li>`).join("")}</ul>` : "";
  let contract = "";
  try {
    const c = await getJSON("data/contracts.json"), r = c.players.find(x => String(x.id) === String(id));
    const $$ = v => v == null || v === "" ? "—" : "$" + Number(v).toLocaleString("en-US");
    if (r) contract = `<h2 class="sub">Contract</h2><dl class="facts"><div><dt>2026-27 cap hit</dt><dd>${$$(r.capHit)}</dd></div><div><dt>AAV</dt><dd>${$$(r.aav)}</dd></div>
      <div><dt>Total value</dt><dd>${$$(r.total)}</dd></div><div><dt>Term</dt><dd>${r.years ? r.years + (r.years > 1 ? " years" : " year") : "—"}</dd></div>
      <div><dt>Seasons</dt><dd>${r.firstSeason || r.lastSeason ? esc((r.firstSeason || "?") + " to " + (r.lastSeason || "?")) : "—"}</dd></div><div><dt>Signed</dt><dd>${esc(r.signed ?? "—")}</dd></div>
      <div><dt>Expiry status</dt><dd>${esc(r.status ?? "—")}</dd></div><div><dt>Clauses</dt><dd>${esc(r.clauses ?? "—")}</dd></div></dl>
      ${r.note ? `<p class="notice">${esc(r.note)}</p>` : ""}
      <p class="meta">Sources: public reports. This contract: <a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.sourceName)} ↗</a>, as of ${esc(c.asOf)}. Blank (—) means not verified. Entered by hand, not updated automatically.${c.seeAlso ? ` See also: <a href="${esc(c.seeAlso.url)}" target="_blank" rel="noopener">${esc(c.seeAlso.name)} ↗</a>` : ""} · <a href="cap.html">Oilers cap →</a></p>`;
  } catch {}
  let fant = "";
  try {
    const f = await getJSON("data/fantasy.json"), r = [...f.skaters, ...f.goalies].find(x => String(x.id) === String(id));
    if (r) fant = `<div class="statline"><h3>Fantasy Points · ${f.through ? "through " + esc(f.through) : "season"}</h3><div><span><b>${r.season.FP.toFixed(1)}</b>FP</span><span><b>${r.season.FPG.toFixed(2)}</b>FP/GP</span><span><b>${r.l10.FP.toFixed(1)}</b>L10 FP</span><span><b>${r.l5.FP.toFixed(1)}</b>L5 FP</span></div></div><p class="meta" style="margin:4px 0 0">Regular season with EDM. <a href="stats.html#fantasy-points">Scoring and all players →</a></p>`;
  } catch {}
  root.innerHTML = `<p class="crumb"><a href="players.html">← Players</a></p>
    <div class="phero">${p.heroImage ? `<img class="action" src="${esc(p.heroImage)}" alt="${esc(name)} action shot" onerror="this.remove()">` : ""}
      <div class="pid"><img class="head" src="${esc(p.headshot)}" alt="${esc(name)}" width="96" height="96"><div><span class="num">#${p.sweaterNumber ?? ""} · ${esc(POS[p.position] || p.position)}</span><h1>${esc(name)}</h1>${inj ? `<a href="injuries.html" style="text-decoration:none">${CBN.injBadge(inj)}</a>` : ""}</div></div></div>
    <dl class="facts"><div><dt>${G ? "Catches" : "Shoots"}</dt><dd>${esc(p.shootsCatches || "-")}</dd></div><div><dt>Height</dt><dd>${ht}</dd></div><div><dt>Weight</dt><dd>${wt}</dd></div>
      <div><dt>Born</dt><dd>${born.toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"})} (age ${age})</dd></div><div><dt>Birthplace</dt><dd>${esc(place)}</dd></div><div><dt>Draft</dt><dd>${draft}</dd></div></dl>
    <p class="bio">${bio}</p>
    ${big(cur, `${seasonFmt(p.featuredStats?.season || "")} Season`)}${fant}
    ${l5 ? `<h2 class="sub">Last 5 Games</h2>${tbl(l5h, l5)}` : ""}
    <h2 class="sub">Career Totals</h2>${tbl(`<th></th>${cols.map(c => `<th>${c[0]}</th>`).join("")}`, careerRow(cr, "Regular season") + careerRow(cp, "Playoffs"))}
    ${seasonRows ? `<h2 class="sub">NHL Seasons</h2>${tbl(`<th>Season</th><th>Team</th>${cols.map(c => `<th>${c[0]}</th>`).join("")}`, seasonRows)}` : ""}
    ${contract}${aw}<p class="updated">Source: public NHL API</p>`;
})();
