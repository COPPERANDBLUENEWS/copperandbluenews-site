// Game-Day Lineup (players.html). Reads data/lineup.json built by scripts/update_lineup.py.
(async () => {
  const {$, esc, getJSON} = CBN, el = $("lineup"); if (!el) return;
  let d; try { d = await getJSON("data/lineup.json"); } catch { el.hidden = true; return; }
  if (!d || !d.game || !(d.forwards || []).length) { el.hidden = true; return; }
  const g = d.game, start = new Date(g.startTimeUTC), now = Date.now();
  const ptDay = t => new Date(t).toLocaleDateString("en-CA", {timeZone: "America/Vancouver"});
  const today = ptDay(start) === ptDay(now);
  const when = start.toLocaleDateString("en-US", {timeZone: "America/Vancouver", weekday: "short", month: "short", day: "numeric"}) + " · " + CBN.fmtTime(g.startTimeUTC, "America/Vancouver", "PT");
  const conf = d.status === "Confirmed", stale = now - start > 12 * 3600e3;
  const name = p => { const parts = String(p.name || "").split(" "), last = parts.slice(1).join(" ") || parts[0]; return `<small>${esc(parts.length > 1 ? parts[0] : "")}</small><b>${esc(last)}</b>`; };
  const chip = (p, extra = "") => !p ? `<span class="lchip empty">—</span>` : `<${p.id ? `a href="player.html?id=${p.id}"` : "span"} class="lchip"><span class="lnum">${p.num != null ? "#" + p.num : ""}</span>${name(p)}${extra}</${p.id ? "a" : "span"}>`;
  const rows = (list, label, n) => list.map((r, i) => `<div class="lrow n${n}"><span class="llab">${label}${i + 1}</span>${Array.from({length: Math.max(n, r.length)}, (_, j) => chip(r[j])).join("")}</div>`).join("");
  const gs = (d.goalie || {}).status || "Unconfirmed";
  const gcls = {Confirmed: "ok", Likely: "likely"}[gs] || "unc";
  const small = (list, label) => list && list.length ? `<p class="lmini"><b>${label}:</b> ${list.map(p => (p.id ? `<a href="player.html?id=${p.id}">` : "<span>") + (p.num != null ? "#" + p.num + " " : "") + esc(p.name) + (p.status ? ` <em>(${esc(p.status)})</em>` : "") + (p.id ? "</a>" : "</span>")).join(", ")}</p>` : "";
  const srcs = (d.sources || []).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> <span>(${esc(s.what)})</span>`).join(" · ");
  el.innerHTML = `<div class="lhead"><h2>Game-Day Lineup</h2><span class="lbadge ${conf ? "conf" : "proj"}">${conf ? "Confirmed · official" : "Projected"}</span></div>
    <div class="lmatch">${today ? "" : `<span class="lnext">Next game</span>`}<b>Oilers ${g.home ? "vs" : "@"} ${esc(g.opponent.name)}</b>
      <span class="meta">${esc(when)}${g.venue ? " · " + esc(g.venue) : ""}</span></div>
    ${stale ? `<p class="lnote">This is the lineup from the last game; the next game's projection isn't available yet.</p>` : ""}
    <h3 class="lsub">Forwards</h3>${rows(d.forwards, "L", 3)}
    <h3 class="lsub">Defence</h3>${rows(d.defence, "D", 2)}
    <h3 class="lsub">Goalies</h3><div class="lrow n2"><span class="llab">G</span>${chip(d.goalie.starter, `<span class="gst ${gcls}">Starter · ${esc(gs)}</span>`)}${chip(d.goalie.backup, `<span class="gst bk">Backup</span>`)}</div>
    ${(d.pp || []).length ? `<h3 class="lsub">Power play</h3>${d.pp.map((u, i) => `<div class="lrow pp"><span class="llab">PP${i + 1}</span><div class="ppg">${u.map(p => chip(p)).join("")}</div></div>`).join("")}` : ""}
    ${small(d.scratches, "Scratches")}${small(d.injured, "Injured")}
    ${(d.notes || []).map(n => `<p class="lnote">${esc(n)}</p>`).join("")}
    <p class="lsrc">Source: ${srcs}${d.updated ? ` · Updated ${new Date(d.updated).toLocaleString("en-US", {timeZone: "America/Vancouver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"})} PT` : ""}</p>`;
})();
