(async () => {
  const {$, esc, getJSON} = CBN;
  const root = $("cap");
  let d; try { d = await getJSON("data/contracts.json"); } catch { root.textContent = "Couldn't load cap data."; return; }
  const $$ = v => v == null || v === "" ? "—" : "$" + Number(v).toLocaleString("en-US");
  const L = d.league || {}, T = d.team || {};
  const card = (label, v, sub) => `<div class="card capc"><h2>${label}</h2><div class="big">${v}</div>${sub ? `<div class="meta">${sub}</div>` : ""}</div>`;
  const full = T.capHit != null;
  const see = d.seeAlso ? ` See also: <a href="${esc(d.seeAlso.url)}" target="_blank" rel="noopener">${esc(d.seeAlso.name)} ↗</a>` : "";
  let html = `<div class="cap-cards">
    ${card("2026-27 Cap Ceiling", $$(L.upperLimit), `Floor ${$$(L.lowerLimit)} · Min salary ${$$(L.minSalary)} · Max ${$$(L.maxPlayerSalary)}`)}
    ${full ? card("Oilers Cap Hit", $$(T.capHit)) + card("Cap Space", $$(T.capSpace))
           : card("Cap Hit (covered so far)", $$(T.coveredCapHit), `${T.coveredCount} of ${T.rosterCount} players`) + card("Cap Space", "—", `Not shown: ${T.rosterCount - T.coveredCount} players missing a verified cap hit`)}
    ${T.ltir != null ? card("LTIR", $$(T.ltir)) : ""}</div>
    <p class="meta">League figures: <a href="${esc(L.sourceUrl)}" target="_blank" rel="noopener">${esc(L.source)}</a> (${esc(L.asOf)}). Sources: public reports (NHL.com, EdmontonOilers.com, TSN, Sportsnet, Edmonton Journal), as of ${esc(d.asOf)}; per-row links below.${see}</p>
    <p class="notice">Contract figures are entered by hand and aren't updated automatically.${full ? "" : ` Missing a verified 2026-27 cap hit: ${T.missing.map(esc).join(", ")}.`} ${esc(T.note || "")}</p>`;
  const yrs = p => p.years == null ? "—" : `${p.years} yr${p.years > 1 ? "s" : ""}`;
  const cols = [["name", "Player"], ["pos", "Pos"], ["capHit", "Cap hit", $$], ["total", "Total", $$], ["years", "Term", (v, p) => yrs(p)], ["lastSeason", "Through"], ["status", "UFA/RFA"], ["clauses", "Clauses"]];
  let key = "capHit", desc = true;
  function table() {
    const rows = [...d.players].sort((a, b) => { const x = a[key], y = b[key]; if (x == null) return 1; if (y == null) return -1; const c = typeof x === "string" ? x.localeCompare(y) : x - y; return desc ? -c : c; });
    return `<h2 class="sub">Contracts</h2><div class="tbl-wrap"><table class="tbl sortable" id="ctbl"><thead><tr>${cols.map(([k, l]) => `<th data-k="${k}" class="${k === key ? (desc ? "desc" : "asc") : ""}">${l}</th>`).join("")}<th>Source</th></tr></thead><tbody>
      ${rows.map(p => `<tr><td><a class="plink" href="player.html?id=${p.id}">${esc(p.name)}</a>${p.note ? ` <span title="${esc(p.note)}">ⓘ</span>` : ""}</td>${cols.slice(1).map(([k, , f]) => `<td>${esc(f ? f(p[k], p) : (p[k] ?? "—"))}</td>`).join("")}<td><a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">${esc(p.sourceName)} ↗</a></td></tr>`).join("")}</tbody></table></div>
      <p class="meta">ⓘ = see note on the player's profile. Blank (—) means not verified in a cited report.</p>`;
  }
  const dead = (T.deadCap || []).length ? `<h2 class="sub">Dead Cap / Buyouts</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Player</th><th>Type</th><th>2026-27 hit</th><th>Through</th></tr></thead><tbody>${T.deadCap.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.type || "—")}</td><td>${$$(x.capHit)}</td><td>${esc(x.through || "—")}</td></tr>`).join("")}</tbody></table></div>` : "";
  const draw = () => { root.innerHTML = html + table() + dead; root.querySelector("#ctbl thead").onclick = e => { const k = e.target.dataset.k; if (!k) return; desc = k === key ? !desc : !["name", "pos", "status", "clauses", "lastSeason"].includes(k); key = k; draw(); }; };
  draw();
})();
