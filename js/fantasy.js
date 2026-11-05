// Fantasy: News tab "Fantasy" section (news.html#fantasy) + "Fantasy Points" tables on stats.html.
// Everything comes from data/fantasy.json (scripts/update_fantasy.py). Projections are fan estimates.
(() => {
  const {$, esc, getJSON} = CBN;
  const PT = iso => new Date(iso).toLocaleString("en-US", {timeZone: "America/Vancouver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}) + " PT";
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const n1 = v => v == null ? "–" : (+v).toFixed(1), n2 = v => v == null ? "–" : (+v).toFixed(2);
  const pl = (id, name) => `<a class="plink" href="player.html?id=${id}">${esc(name)}</a>`;
  const get = (r, k) => k.split(".").reduce((o, p) => o?.[p], r);
  // Sortable table: cols = [key, label, format?, descByDefault?]
  function table(el, rows, cols, key, desc) {
    const sorted = [...rows].sort((a, b) => { const x = get(a, key), y = get(b, key); const c = typeof x === "string" ? x.localeCompare(y) : (x ?? -1e9) - (y ?? -1e9); return desc ? -c : c; });
    el.innerHTML = `<table class="tbl sortable"><thead><tr>${cols.map(([k, l]) => `<th data-k="${k}" class="${k === key ? (desc ? "desc" : "asc") : ""}">${l}</th>`).join("")}</tr></thead>
      <tbody>${sorted.map(r => `<tr>${cols.map(([k, , f]) => `<td>${k === "name" ? pl(r.id, r.name) : f ? f(get(r, k), r) : esc(get(r, k) ?? "–")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    el.querySelector("thead").onclick = e => { const k = e.target.dataset.k; if (!k) return;
      table(el, rows, cols, k, k === key ? !desc : !["name", "pos"].includes(k)); };
  }
  const legend = sc => `<p class="fp-legend"><b>Scoring</b> · Skaters: ${Object.entries(sc.skater).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(", ")} · Goalies: ${Object.entries(sc.goalie).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(", ")}. PPP = power-play points. Regular season, games with EDM.</p>`;
  const load = () => getJSON("data/fantasy.json");

  // ---------- Stats page: Fantasy Points tables
  async function stats() {
    const sk = $("fpSkaters"); if (!sk) return;
    let d; try { d = await load(); } catch { sk.textContent = "Couldn't load fantasy points."; return; }
    $("fpLegend").innerHTML = legend(d.scoring);
    const fpg = (r, w) => r[w].gp ? r[w].FP / r[w].gp : null;
    const rows = d.skaters.map(r => ({...r, fpg: r.season.FPG, l10fpg: fpg(r, "l10")}));
    table(sk, rows, [["name", "Player"], ["pos", "Pos"], ["season.gp", "GP"], ["season.FP", "FP", n1], ["fpg", "FP/GP", n2], ["l10.FP", "L10 FP", n1], ["l10fpg", "L10 FP/GP", n2],
      ["season.G", "G"], ["season.A", "A"], ["season.PPP", "PPP"], ["season.SOG", "SOG"], ["season.HIT", "HIT"], ["season.BLK", "BLK"]], "season.FP", true);
    const go = d.goalies.map(r => ({...r, fpg: r.season.FPG, l10fpg: fpg(r, "l10")}));
    table($("fpGoalies"), go, [["name", "Goalie"], ["season.gp", "GP"], ["season.FP", "FP", n1], ["fpg", "FP/GP", n2], ["l10.FP", "L10 FP", n1], ["l10fpg", "L10 FP/GP", n2],
      ["season.W", "W"], ["season.SV", "SV"], ["season.GA", "GA"], ["season.SO", "SO"]], "season.FP", true);
    $("fpUpdated").textContent = `Through ${d.through} · ${d.games} games · updated ${PT(d.updated)}`;
  }

  // ---------- News page: Team News | Fantasy
  function tabs() {
    const bar = $("newsTabs"); if (!bar) return false;
    const show = () => { const f = location.hash === "#fantasy";
      $("tabTeam").hidden = f; $("tabFantasy").hidden = !f;
      bar.querySelectorAll("a").forEach(a => a.classList.toggle("on", (a.getAttribute("href") === "#fantasy") === f)); };
    window.addEventListener("hashchange", show); show(); return true;
  }
  async function fantasy() {
    if (!tabs()) return;
    const root = $("fantasyRoot");
    let d; try { d = await load(); } catch { root.textContent = "Couldn't load fantasy data."; return; }
    const o = d.outlook, sc = d.scoring;
    const pick = (r, cls) => `<li class="fpick ${cls}"><div>${pl(r.id, r.name)} <small>${esc(r.pos)}</small><span class="why">${r.reasons.map(esc).join(" · ") || "&nbsp;"}</span></div>
      <div class="fpnum"><b>${n1(r.projFP)}</b><small>proj FP · ${n2(r.projP)} P</small></div></li>`;
    const list = (title, rows, cls, empty) => `<div class="card fcol"><h2>${title}</h2>${rows.length ? `<ul class="fpicks">${rows.map(r => pick(r, cls)).join("")}</ul>` : `<p class="meta">${empty}</p>`}</div>`;
    let html = `<p class="notice fan">Fan predictions and projections from public NHL stats, not guarantees or betting advice.</p>`;
    if (o) {
      const g = o.game, op = o.opponent, gl = o.goalie;
      const when = new Date(g.startTimeUTC).toLocaleString("en-US", {timeZone: "America/Vancouver", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}).replace(":00", "") + " PT";
      html += `<div class="card fout"><h2>Fantasy Outlook · Next game</h2>
        <div class="match">Oilers <span class="vs">${g.home ? "vs" : "@"}</span> ${esc(g.oppName)}</div>
        <div class="meta">${esc(when)} · ${esc(g.venue || "")}</div>
        <dl class="facts fgrid">
          <div><dt>${esc(g.opp)} goals against / GP</dt><dd>${n2(op.gaPerGp)} <small>(league ${n2(op.leagueGaPerGp)})</small></dd></div>
          <div><dt>Scoring adjustment</dt><dd>×${(op.adj ?? 1).toFixed(3)}</dd></div>
          ${gl ? `<div><dt>Projected starter</dt><dd>${gl.id ? pl(gl.id, gl.name) : esc(gl.name)} <small>${esc(gl.status || "")}</small></dd></div>
          ${gl.gp ? `<div><dt>${esc(gl.name.split(" ").pop())} with EDM</dt><dd>${gl.w} W in ${gl.gp} GP · SV% ${gl.svp != null ? gl.svp.toFixed(3).replace(/^0/, "") : "–"} · <b>${n1(gl.projFP)}</b> proj FP</dd></div>` : ""}` : ""}
        </dl>${o.lineupBasis ? `<p class="meta">Lineup basis: ${o.lineupBasis.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>${s.what ? ` <small>(${esc(s.what)})</small>` : ""}`).join(", ")} · ${esc(o.lineupBasis.status || "")} · <a href="players.html">Game-day lineup →</a></p>` : `<p class="meta">No lineup posted yet, using the last game's skaters.</p>`}</div>
        <div class="fcols">${list("Start", o.start, "start", "No data")}${list("Sleepers", o.sleepers, "sleeper", "No sleepers flagged by the data this time.")}${list("Sit / cold", o.sits, "sit", "Nobody in the lineup is pointless over the last 5.")}</div>`;
    }
    const items = d.news?.items || [];
    html += `<h2 class="sub">Fantasy News</h2><div class="news-list" id="fNews">${items.length ? items.map((x, i) => `<a class="card news-item"${i >= 8 ? " hidden" : ""} href="${esc(x.url)}" target="_blank" rel="noopener">
      <div class="meta"><b>${esc(x.source)}</b> · <time datetime="${esc(x.published)}">${PT(x.published)}</time></div><h3>${esc(x.title)}</h3>${x.snippet ? `<p class="snip">${esc(x.snippet)}</p>` : ""}
      <div class="ptags">${x.players.map(p => `<span>${esc(p.name)}</span>`).join("")}</div></a>`).join("") : "<p>No Oilers fantasy news in the last few days.</p>"}</div>${items.length > 8 ? `<p><button class="btn fmore" id="fMore">Show all ${items.length}</button></p>` : ""}
      <p class="meta">Headlines link to the original reports (RotoWire, CBS Sports and others via Google News; DailyFaceoff and Yahoo feeds also checked). Filtered to current Oilers players.${d.news?.updated ? ` Checked ${PT(d.news.updated)}.` : ""}</p>`;
    if (o) html += `<h2 class="sub">Next-game projections</h2><div class="tbl-wrap" id="fProj"></div>`;
    html += `<h2 class="sub">Hot / cold</h2><div class="subtabs" id="hcTabs"><a href="#fantasy" data-w="l5" class="on">Last 5</a><a href="#fantasy" data-w="l10">Last 10</a></div><div class="tbl-wrap" id="fHot"></div>
      <div class="card how"><h2>How we project</h2>
      <p>For each skater in the projected lineup: per-game rates of G, A, PPP, SOG, hits and blocks are a 50/50 blend of his season (with EDM) and his last 10 games. G, A and PPP are then scaled by the opponent's goals against per game vs the league average, at half strength and capped at ±15%${o?.opponent?.factor ? ` (${esc(o.game.opp)}: ${n2(o.opponent.gaPerGp)} vs ${n2(o.opponent.leagueGaPerGp)} → ×${o.opponent.adj.toFixed(3)})` : ""}. Projected points = G + A; projected FP uses the scoring below.</p>
      <p>Goalie: 50/50 blend of FP per game (season and last 5), minus half of the opponent's goals-for per game above the league average. <b>Start</b> = top 5 projected FP. <b>Sleepers</b> = outside the top 5 but on PP2, TOI up 1:00+ over the last 5, or hot (last-5 FP/G ≥ 1.2× season and 3+ P). <b>Sit / cold</b> = no points in the last 5 games, or last-5 FP/G ≤ 60% of season.</p>
      ${legend(sc)}<p class="meta">Data: NHL box scores through ${esc(d.through)} (${d.games} games), NHL standings, and the game-day lineup. Updated ${PT(d.updated)}.</p></div>`;
    root.innerHTML = html;
    $("fMore")?.addEventListener("click", e => { $("fNews").querySelectorAll("[hidden]").forEach(a => a.hidden = false); e.target.remove(); });
    if (o) table($("fProj"), o.projections, [["name", "Player"], ["pos", "Pos"], ["pp", "PP", v => v ? "PP" + v : "–"], ["projFP", "Proj FP", n2], ["projP", "Proj P", n2],
      ["projG", "Proj G", n2], ["projSOG", "Proj SOG", n1], ["toi", "TOI", mmss], ["seasonFPG", "FP/GP", n2], ["l5FPG", "L5 FP/G", n2]], "projFP", true);
    const roster = d.skaters.filter(r => r.onRoster && r.l5.gp);
    const hot = w => table($("fHot"), roster.map(r => ({...r, fpgw: r[w].FPG})), [["name", "Player"], [w + ".gp", "GP"], [w + ".G", "G"], [w + ".A", "A"], [w + ".P", "P"], [w + ".SOG", "SOG"],
      [w + ".PPP", "PPP"], [w + ".HIT", "HIT"], [w + ".BLK", "BLK"], [w + ".FP", "FP", n1], ["fpgw", "FP/G", n2], ["season.FPG", "Season FP/G", n2]], w + ".FP", true);
    hot("l5");
    $("hcTabs").onclick = e => { const a = e.target.closest("a"); if (!a) return; e.preventDefault();
      $("hcTabs").querySelectorAll("a").forEach(x => x.classList.toggle("on", x === a)); hot(a.dataset.w); };
  }
  CBN.fantasy = {load, legend, table};
  stats(); fantasy();
})();
