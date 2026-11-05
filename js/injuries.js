(async () => {
  const {$, esc, getJSON} = CBN;
  let d; try { d = await getJSON("data/injuries.json"); } catch { $("inj").textContent = "Couldn't load the injury report."; return; }
  const day = s => new Date(s + "T12:00:00").toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"});
  $("iUpdated").textContent = `Last updated ${new Date(d.updated).toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"})}` + (d.basis ? ` · based on ${d.basis.title} (${day(d.basis.date)})` : "");
  const cls = s => ({IR: "ir", LTIR: "ltir", "Day-to-day": "dtd"}[s] || "out");
  $("inj").innerHTML = !d.players.length ? `<p class="card">No reported injuries.</p>` : `<div class="inj-list">${d.players.map(p => `<div class="card inj-card"><div class="inj-top">${p.id ? `<a class="plink" href="player.html?id=${p.id}">${esc(p.name)}</a>` : `<b>${esc(p.name)}</b>`}<span class="ibadge ${cls(p.status)}">${esc(p.status)}</span></div>
    <dl><dt>Injury</dt><dd>${esc(p.injury || "—")}</dd><dt>Expected return</dt><dd>${esc(p.expectedReturn || "Not reported")}</dd><dt>Last update</dt><dd>${day(p.updated)}</dd>
    <dt>Source</dt><dd>${p.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} (${day(s.date)}) ↗</a>`).join("<br>")}</dd></dl></div>`).join("")}</div>
    ${d.players.filter(p => p.note).map(p => `<p class="meta"><b>${esc(p.name)}:</b> ${esc(p.note)} <i>(NHL.com status report)</i></p>`).join("")}`;
})();
// Small injury badge on roster cards and profiles (used by players.js / player.js too).
