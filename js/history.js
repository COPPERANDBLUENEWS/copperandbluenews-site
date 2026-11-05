// History timeline: reads data/history.json (hand-curated; every entry carries a source link).
(async () => {
  const {$, esc, getJSON} = CBN;
  let d; try { d = await getJSON("data/history.json"); } catch { $("hist").textContent = "Couldn't load the history timeline."; return; }
  const entries = d.entries.slice().sort((a, b) => a.date.localeCompare(b.date));
  const cups = entries.filter(e => e.cup);
  $("hCups").innerHTML = `<span class="hc-label">Stanley Cups</span>${cups.map(c => `<a class="hc-year" href="#e-${esc(c.date)}">🏆 ${c.date.slice(0, 4)}</a>`).join("")}`;
  const chips = [{id: "all", name: "All"}, {id: "cups", name: "🏆 Cup years"}, ...d.eras.map(e => ({id: e.id, name: e.name}))];
  $("hFilters").innerHTML = chips.map((c, i) => `<button type="button" data-f="${esc(c.id)}" class="${i ? "" : "on"}">${esc(c.name)}</button>`).join("");
  const card = e => `<article class="hcard${e.cup ? " cup" : ""}" id="e-${esc(e.date)}">
    <div class="hwhen">${esc(e.when)}${e.tag ? ` <span class="htag${e.cup ? " cup" : ""}">${esc(e.tag)}</span>` : ""}</div>
    <h3>${e.cup ? "🏆 " : ""}${esc(e.title)}</h3><p>${esc(e.text)}</p>
    ${e.source?.url ? `<a class="hsrc" href="${esc(e.source.url)}" target="_blank" rel="noopener">Source: ${esc(e.source.name || "link")} ↗</a>` : ""}</article>`;
  const render = f => {
    const show = e => f === "all" || (f === "cups" ? e.cup : e.era === f);
    $("hist").innerHTML = d.eras.map(era => {
      const list = entries.filter(e => e.era === era.id && show(e));
      return list.length ? `<section class="era"><h2 class="era-h"><span>${esc(era.name)}</span><small>${esc(era.years)}</small></h2><div class="tl">${list.map(card).join("")}</div></section>` : "";
    }).join("") || `<p class="card">No entries.</p>`;
  };
  render("all");
  $("hFilters").addEventListener("click", ev => {
    const b = ev.target.closest("button"); if (!b) return;
    $("hFilters").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    render(b.dataset.f);
  });
  $("hCups").addEventListener("click", ev => {
    if (!ev.target.closest("a")) return;
    const on = $("hFilters").querySelector("button.on");
    if (on && on.dataset.f !== "all" && on.dataset.f !== "cups") $("hFilters").querySelector('[data-f="all"]').click();
  });
})();
