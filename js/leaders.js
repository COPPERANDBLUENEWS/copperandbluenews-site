// NHL stat leaders from data/leaders.json (scripts/update_data.py ← skater/goalie-stats-leaders).
(() => {
  const {$, esc, getJSON} = CBN;
  const skaterCats = [["points", "Points", "P"], ["goals", "Goals", "G"], ["assists", "Assists", "A"], ["plusMinus", "+/−", "+/−"], ["ppg", "PPG", "PPG"]];
  const goalieCats = [["gaa", "GAA", "GAA"], ["svp", "SV%", "SV%"], ["wins", "Wins", "W"], ["so", "Shutouts", "SO"]];
  const fmt = {
    plusMinus: v => v > 0 ? "+" + v : String(v),
    gaa: v => Number(v).toFixed(2),
    svp: v => Number(v).toFixed(3).replace(/^0/, ""),
  };
  let data, sk = "points", go = "gaa";

  function chips(el, cats, cur, set) {
    el.innerHTML = cats.map(([k, label]) => `<button type="button" data-k="${k}" class="${k === cur ? "on" : ""}" aria-pressed="${k === cur}">${label}</button>`).join("");
    el.onclick = e => { const b = e.target.closest("button"); if (!b) return; set(b.dataset.k); draw(); };
  }
  function table(el, rows, valueLabel, kind) {
    const show = fmt[kind] || (v => v == null ? "—" : String(v));
    el.innerHTML = rows?.length ? `<table class="tbl board"><thead><tr><th>Player</th><th>Team</th><th>${esc(valueLabel)}</th></tr></thead><tbody>${
      rows.map((r, i) => {
        const edm = r.team === "EDM";
        const name = edm ? `<a class="plink" href="player.html?id=${r.id}">${esc(r.name)}</a>` : esc(r.name);
        return `<tr class="data${edm ? " edm" : ""}"><td><span class="rk">${i + 1}</span> ${name}</td><td>${esc(r.team)}</td><td>${esc(show(r.value))}</td></tr>`;
      }).join("")
    }</tbody></table>` : "<p>No leaders in this category yet.</p>";
  }
  function draw() {
    const skMeta = skaterCats.find(([k]) => k === sk) || skaterCats[0];
    const goMeta = goalieCats.find(([k]) => k === go) || goalieCats[0];
    chips($("skCats"), skaterCats, sk, v => { sk = v; });
    chips($("goCats"), goalieCats, go, v => { go = v; });
    table($("skaters"), data.skaters?.[sk], skMeta[2], sk);
    table($("goalies"), data.goalies?.[go], goMeta[2], go);
  }
  (async () => {
    try { data = await getJSON("data/leaders.json"); }
    catch { $("skaters").textContent = "Couldn't load leaders."; return; }
    if (data.updated) $("ldUpdated").textContent = "Updated " + new Date(data.updated).toLocaleString("en-US", {timeZone: "America/Edmonton", dateStyle: "medium", timeStyle: "short"}) + " MT · Data: NHL";
    draw();
  })();
})();
