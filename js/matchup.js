// Game Day Matchup: Oilers lines vs the opponent's, line by line (players.html, and the Live tracker's
// pre-game view). Reads data/lineup.json (EDM at the top level, the other team under "opponent"), built by
// scripts/update_lineup.py from DailyFaceoff + the NHL boxscore. Team names/abbreviations only, no logos.
// If the opponent block is missing, only the Oilers half is shown.
(() => {
  if (typeof CBN === "undefined") return;
  const {esc, getJSON} = CBN;
  let html = "", ver = 0, data = null;
  const PT = "America/Vancouver";
  const last = p => { const n = String(p.name || "").split(" "); return n.length > 1 ? n.slice(1).join(" ") : n[0]; };
  const pl = p => !p ? `<span class="mu-p empty">—</span>` :
    `<${p.id ? `a href="player.html?id=${p.id}"` : "span"} class="mu-p" title="${esc(p.name)}"><i>${p.num != null ? "#" + p.num : ""}</i>${esc(last(p))}</${p.id ? "a" : "span"}>`;
  const cell = (side, list) => `<div class="mu-c ${side}">${(list || []).map(pl).join("")}</div>`;
  const badge = t => t.status === "Confirmed" ? `<span class="lbadge conf">Confirmed · official</span>` : `<span class="lbadge proj">Projected</span>`;
  const gbadge = s => `<span class="gst ${({Confirmed: "ok", Likely: "likely"})[s] || "unc"}">${esc(s || "Unconfirmed")}</span>`;
  const upd = s => s ? new Date(s).toLocaleString("en-US", {timeZone: PT, month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}) + " PT" : "";
  const src = t => {
    const s = (t.sources || []).find(x => /line/.test(x.what || "")) || (t.sources || [])[0];
    const off = (t.sources || []).find(x => /official/.test(x.what || ""));
    if (!s) return "";
    return `${off ? `<a href="${esc(off.url)}" target="_blank" rel="noopener">NHL.com</a> + ` : ""}<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` +
      `${s.basis ? ` (${esc(s.basis)})` : ""}${s.updatedAt ? ` · ${esc(upd(s.updatedAt))}` : ""}`;
  };

  function build(d, compact) {
    const o = d.opponent && (d.opponent.forwards || []).length ? d.opponent : null;
    const edm = {abbrev: "EDM", name: "Oilers", status: d.status, forwards: d.forwards, defence: d.defence, goalie: d.goalie,
      injured: d.injured, sources: d.sources};
    const g = d.game, home = g.home;
    const teams = o ? [edm, o] : [edm];
    const sides = ["edm", "opp"];
    const head = teams.map((t, i) => `<div class="mu-th ${sides[i]}"><b>${esc(t.name)}</b> <span class="mu-ab">${esc(t.abbrev)}</span>${badge(t)}</div>`).join("");
    const row = (label, key, idx) => `<div class="mu-r"><span class="mu-l">${label}</span>${teams.map((t, i) => cell(sides[i], (t[key] || [])[idx])).join("")}</div>`;
    const n = (k) => Math.max(...teams.map(t => (t[k] || []).length));
    const goalies = `<div class="mu-r g"><span class="mu-l">G</span>${teams.map((t, i) => { const gl = t.goalie || {};
      return `<div class="mu-c ${sides[i]}">${pl(gl.starter)}${gbadge(gl.status)}${gl.backup && !compact ? `<span class="mu-bk">Backup: ${esc(last(gl.backup))}</span>` : ""}</div>`; }).join("")}</div>`;
    const out = compact ? "" : `<div class="mu-r inj"><span class="mu-l">Out</span>${teams.map((t, i) =>
      `<div class="mu-c ${sides[i]}"><span class="mu-out">${(t.injured || []).map(p => esc(last(p))).join(", ") || "None listed"}</span></div>`).join("")}</div>`;
    const when = new Date(g.startTimeUTC).toLocaleDateString("en-US", {timeZone: PT, weekday: "short", month: "short", day: "numeric"}) + " · " + CBN.bothTimes(g.startTimeUTC);
    const tabs = o && !compact ? `<div class="mu-tabs" role="tablist"><button type="button" class="on" data-v="both">Side by side</button><button type="button" data-v="edm">Oilers</button><button type="button" data-v="opp">${esc(o.name)}</button></div>` : "";
    return `<div class="mu ${o ? "mu-2" : "one"} v-both">
      <div class="lhead"><h2>Game Day Matchup</h2><span class="mu-vs">${home ? `${esc(o ? o.abbrev : g.opponent.abbrev)} @ EDM` : `EDM @ ${esc(o ? o.abbrev : g.opponent.abbrev)}`}</span></div>
      ${compact ? "" : `<p class="meta mu-when">${esc(when)}${g.venue ? " · " + esc(g.venue) : ""}</p>`}${tabs}
      <div class="mu-r hd"><span class="mu-l"></span>${head}</div>
      <h3 class="lsub">Forwards</h3>${Array.from({length: n("forwards")}, (_, i) => row("L" + (i + 1), "forwards", i)).join("")}
      <h3 class="lsub">Defence</h3>${Array.from({length: n("defence")}, (_, i) => row("D" + (i + 1), "defence", i)).join("")}
      <h3 class="lsub">Goalies</h3>${goalies}${out}
      ${o ? "" : `<p class="lnote">${esc(g.opponent.name)} lines aren't available right now.</p>`}
      <p class="lsrc">${teams.map(t => `${esc(t.abbrev)}: ${src(t)}`).join("<br>")}</p></div>`;
  }

  const fill = el => {
    const compact = el.dataset.matchup === "compact";
    const show = data && (!compact || new Date(data.game.startTimeUTC) > Date.now());
    el.hidden = !show; el.innerHTML = show ? build(data, compact) : ""; el.dataset.v = ver;
  };
  document.addEventListener("click", e => {
    const b = e.target.closest(".mu-tabs button"); if (!b) return;
    const mu = b.closest(".mu"); mu.classList.remove("v-both", "v-edm", "v-opp"); mu.classList.add("v-" + b.dataset.v);
    b.parentNode.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
  });
  async function render() {
    let d; try { d = await getJSON("data/lineup.json"); } catch { d = null; }
    data = d && d.game && (d.forwards || []).length ? d : null; ver++;
    document.querySelectorAll("[data-matchup]").forEach(fill);
  }
  new MutationObserver(() => document.querySelectorAll("[data-matchup]").forEach(el => { if (el.dataset.v !== String(ver)) fill(el); }))
    .observe(document.body, {childList: true, subtree: true});
  render();
  setInterval(render, 10 * 60e3);
})();
