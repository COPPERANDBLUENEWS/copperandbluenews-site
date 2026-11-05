(async () => {
  const {$, esc, getJSON} = CBN;
  let d, inj = await CBN.injuries(); try { d = await getJSON("data/roster.json"); } catch { $("roster").textContent = "Couldn't load the roster."; return; }
  $("roster").innerHTML = Object.entries(d.groups).map(([g, list], i) => `<h2 class="sub">${i ? g : "Roster · " + g}</h2><div class="roster">${list.map(p => `
    <a class="pcard" href="player.html?id=${p.id}"><img src="${esc(p.headshot)}" alt="" loading="lazy" width="72" height="72" onerror="this.style.visibility='hidden'">
    <span class="num">#${p.num ?? ""}</span><b>${esc(p.name)}</b><small>${esc(p.pos)}${p.shoots ? " · " + (p.pos === "G" ? "Catches " : "Shoots ") + esc(p.shoots) : ""}</small><small class="hw">${CBN.ht(p)} • ${CBN.wt(p)}</small>${CBN.injBadge(inj[p.id])}</a>`).join("")}</div>`).join("");
  $("rUpdated").textContent = "Updated " + new Date(d.updated).toLocaleString("en-US", {timeZone: "America/Edmonton", dateStyle: "medium", timeStyle: "short"}) + " MT";
})();
