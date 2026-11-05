(async () => {
  const {$, esc, getJSON} = CBN;
  let d; try { d = await getJSON("data/stats.json"); } catch { $("skaters").textContent = "Couldn't load stats."; return; }
  const toi = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const sk = [["name", "Player", 0], ["pos", "Pos", 0], ["gp", "GP"], ["g", "G"], ["a", "A"], ["p", "P"], ["pm", "+/-", 1, v => v > 0 ? "+" + v : v], ["pim", "PIM"], ["ppg", "PPG"], ["sog", "SOG"], ["toi", "TOI/GP", 1, toi]];
  const go = [["name", "Goalie", 0], ["gp", "GP"], ["w", "W"], ["l", "L"], ["otl", "OTL"], ["gaa", "GAA", 1, v => v.toFixed(2)], ["svp", "SV%", 1, v => v.toFixed(3).replace(/^0/, "")], ["so", "SO"]];
  function table(el, rows, cols, key, desc) {
    const sorted = [...rows].sort((a, b) => { const x = a[key], y = b[key]; const c = typeof x === "string" ? x.localeCompare(y) : x - y; return desc ? -c : c; });
    el.innerHTML = `<table class="tbl sortable"><thead><tr>${cols.map(([k, l]) => `<th data-k="${k}" class="${k === key ? (desc ? "desc" : "asc") : ""}">${l}</th>`).join("")}</tr></thead>
      <tbody>${sorted.map(r => `<tr>${cols.map(([k, , , f]) => `<td>${k === "name" ? `<a class="plink" href="player.html?id=${r.id}">${esc(r[k])}</a>` : esc(f ? f(r[k]) : r[k])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    el.querySelector("thead").onclick = e => { const k = e.target.dataset.k; if (!k) return;
      table(el, rows, cols, k, k === key ? !desc : !(["name", "pos"].includes(k) || k === "gaa")); };
  }
  table($("skaters"), d.skaters, sk, "p", true);
  table($("goalies"), d.goalies, go, "gp", true);
  $("stUpdated").textContent = "Updated " + new Date(d.updated).toLocaleString("en-US", {timeZone: "America/Edmonton", dateStyle: "medium", timeStyle: "short"}) + " MT";
})();
