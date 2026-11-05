// Pre-game odds box (Home "Next Game" card and the Live tracker's pre-game view). Data: data/odds.json,
// written by scripts/update_data.py from the NHL's public partner-odds feed (FanDuel Canada). Shown only
// before puck drop and only when odds exist. No sportsbook logos, no affiliate or referral links.
(() => {
  if (typeof CBN === "undefined") return;
  let box = "", ver = 0;  // last rendered box; slots added later (the tracker re-renders its skeleton) get it too
  const fill = el => { el.hidden = !box; el.innerHTML = box; el.dataset.v = ver; };
  const {esc, getJSON} = CBN;
  const row = (label, a, b) => `<div class="ob-row"><span>${label}</span><b>${a}</b><b>${b}</b></div>`;
  async function render() {
    let d; try { d = await getJSON("data/odds.json"); } catch { return; }
    const o = d && d.game, start = o && new Date(o.startTimeUTC);
    const ok = o && o.ml && start > Date.now() && start - Date.now() < 36 * 3600e3;
    ver++;
    if (!ok) { box = ""; document.querySelectorAll("[data-odds]").forEach(fill); return; }
    const teams = o.teams.slice().sort((x, y) => (x.abbrev !== "EDM") - (y.abbrev !== "EDM"));
    const [us, them] = teams, ab = t => esc(t.abbrev);
    let html = row("Moneyline", `${ab(us)} ${esc(o.ml[us.abbrev])}`, `${ab(them)} ${esc(o.ml[them.abbrev])}`);
    const pu = o.pl?.[us.abbrev], pt = o.pl?.[them.abbrev];
    if (pu && pt) html += row("Puck line", `${ab(us)} ${esc(pu.line)} (${esc(pu.odds)})`, `${ab(them)} ${esc(pt.line)} (${esc(pt.odds)})`);
    if (o.total?.over && o.total?.under) html += row(`Total ${esc(o.total.line)}`, `O ${esc(o.total.over)}`, `U ${esc(o.total.under)}`);
    box = `<div class="odds-box"><div class="ob-h">Odds <span class="ob-tag">19+ · Play responsibly</span></div>${html}
      <p class="ob-rg">Odds via ${esc(o.partner || "FanDuel")}. 19+. Please play responsibly.</p></div>`;
    document.querySelectorAll("[data-odds]").forEach(fill);
  }
  if (!document.querySelector("[data-odds]") && !document.getElementById("trk")) return;
  new MutationObserver(() => document.querySelectorAll("[data-odds]").forEach(el => { if (el.dataset.v !== String(ver)) fill(el); }))
    .observe(document.body, {childList: true, subtree: true});
  render();
  setInterval(render, 5 * 60e3);
})();
