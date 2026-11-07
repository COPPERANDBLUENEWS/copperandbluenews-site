// League standings from data/standings.json (scripts/update_data.py ← NHL standings/now).
(() => {
  const {$, esc, getJSON} = CBN;
  const box = $("board");
  const views = ["division", "conference", "league"];
  const cols = [["gp", "GP"], ["w", "W"], ["l", "L"], ["otl", "OTL"], ["pts", "PTS"], ["pct", "P%"], ["gf", "GF"], ["ga", "GA"], ["diff", "DIFF"], ["streak", "Streak"], ["l10", "L10"]];
  const pct = v => v == null || v === "" ? "—" : Number(v).toFixed(3).replace(/^0/, "");
  const diff = n => (n > 0 ? "+" : "") + n;
  const cell = (t, k) => k === "pct" ? pct(t.pct) : k === "diff" ? diff(t.diff) : k === "streak" ? (t.streak || "—") : t[k];
  const by = (key) => (a, b) => (a[key] || 99) - (b[key] || 99);
  const inDivision = t => t.divRank >= 1 && t.divRank <= 3;
  const inWild = t => t.wc > 0 && t.wc <= 2;

  function row(t) {
    const edm = t.abbrev === "EDM";
    const tag = inDivision(t) ? '<span class="spot p">P</span>' : inWild(t) ? '<span class="spot wc">WC</span>' : "";
    return `<tr class="data${edm ? " edm" : ""}"><td><b>${esc(t.abbrev)}</b> <span class="tn">${esc(t.name)}</span>${tag}</td>${cols.map(([k]) => `<td>${esc(cell(t, k))}</td>`).join("")}</tr>`;
  }
  const cut = (label, cls) => `<tr class="cut ${cls}"><td colspan="${cols.length + 1}">${label}</td></tr>`;
  function table(teams, cuts) {
    const parts = [];
    teams.forEach((t, i) => {
      parts.push(row(t));
      (cuts || []).filter(c => c.after === i).forEach(c => parts.push(cut(c.label, c.cls || "")));
    });
    return `<div class="tbl-wrap"><table class="tbl board"><thead><tr><th>Team</th>${cols.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>${parts.join("")}</tbody></table></div>`;
  }
  function head(title, sub) {
    return `<h2 class="sub">${esc(title)}</h2>${sub ? `<h3 class="div-h">${esc(sub)}</h3>` : ""}`;
  }
  function division(teams) {
    const confs = ["Western", "Eastern"].filter(name => teams.some(t => t.conference === name));
    return confs.map(conf => {
      const mine = teams.filter(t => t.conference === conf);
      const divs = [...new Set(mine.map(t => t.division))].sort((a, b) => {
        const oil = name => mine.some(t => t.division === name && t.abbrev === "EDM");
        return (oil(b) - oil(a)) || a.localeCompare(b);
      });
      return head(conf) + divs.map(div => {
        const rows = mine.filter(t => t.division === div).sort(by("divRank"));
        return `<h3 class="div-h">${esc(div)}</h3>` + table(rows, [{after: 2, label: "Playoff line", cls: "po"}]);
      }).join("");
    }).join("");
  }
  function conference(teams) {
    const confs = ["Western", "Eastern"].filter(name => teams.some(t => t.conference === name));
    return confs.map(conf => {
      const mine = teams.filter(t => t.conference === conf);
      const divs = [...new Set(mine.map(t => t.division))].sort((a, b) => {
        const oil = name => mine.some(t => t.division === name && t.abbrev === "EDM");
        return (oil(b) - oil(a)) || a.localeCompare(b);
      });
      const tops = divs.map(div => {
        const rows = mine.filter(t => t.division === div && inDivision(t)).sort(by("divRank"));
        return `<h3 class="div-h">${esc(div)}</h3>` + table(rows, [{after: rows.length - 1, label: "Playoff line", cls: "po"}]);
      }).join("");
      const wc = mine.filter(t => t.wc > 0).sort(by("wc"));
      return head(conf) + tops + `<h3 class="div-h">Wild card</h3>` + table(wc, [{after: 1, label: "Wild-card line", cls: "wc"}]);
    }).join("");
  }
  function league(teams) {
    const rows = [...teams].sort(by("lgRank"));
    return `<p class="meta board-note">P = top 3 in the division. WC = a wild-card spot, the next 2 in the conference. Those are the playoff and wild-card lines, shown on Division and Conference.</p>` + table(rows.map(t => t));
  }

  let data;
  function draw() {
    const teams = data?.teams || [];
    if (!teams.length) { box.innerHTML = "<p>Standings aren't available yet.</p>"; return; }
    const view = views.includes(location.hash.slice(1)) ? location.hash.slice(1) : "division";
    document.querySelectorAll("#stdViews button").forEach(b => b.classList.toggle("on", b.dataset.v === view));
    box.innerHTML = (view === "conference" ? conference : view === "league" ? league : division)(teams);
  }
  $("stdViews").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    history.replaceState(null, "", "#" + b.dataset.v);
    draw();
  });
  addEventListener("hashchange", draw);
  (async () => {
    try { data = await getJSON("data/standings.json"); }
    catch { box.textContent = "Couldn't load standings."; return; }
    if ($("stdUpdated") && data.updated) $("stdUpdated").textContent = "Updated " + new Date(data.updated).toLocaleString("en-US", {timeZone: "America/Edmonton", dateStyle: "medium", timeStyle: "short"}) + " MT · Data: NHL";
    draw();
  })();
})();
