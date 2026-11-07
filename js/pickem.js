// Home page Pick'em: predict the final score of the next Oilers game. One pick per device, changeable
// until puck drop. Picks + crowd results live in the Game alerts Worker (worker/src/pickem.js).
(function () {
  const box = document.getElementById("pickem");
  const W = (window.CBN_CONFIG || {}).WORKER_URL;
  if (!box || !W) return;
  const LS = "cbn-pickem";
  const store = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
  const save = s => { try { localStorage.setItem(LS, JSON.stringify(s)); } catch {} };
  function voterId() {
    const s = store();
    if (!s.voter) { s.voter = (crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ Math.random() * 16 >> c / 4).toString(16))); save(s); }
    return s.voter;
  }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const sides = g => { const edmHome = g.home.abbrev === "EDM"; return {edmHome, opp: edmHome ? g.away : g.home}; };
  const getJSON = async u => { const r = await fetch(u, {cache: "no-store"}); if (!r.ok) throw new Error(r.status); return r.json(); };

  function crowd(r, oppName, mine) {
    if (!r || !r.total) return `<p class="pk-crowd muted">${mine ? "Your pick is in. Crowd results refresh every minute." : "No picks yet. Be the first!"}</p>`;
    const pct = Math.round(r.edmWins / r.total * 100);
    const top = r.top && r.top[0] ? ` Most popular: <b>${esc(r.top[0].score)}</b> Oilers.` : "";
    return `<div class="pk-bar" role="img" aria-label="${pct}% pick the Oilers"><span style="width:${pct}%"></span></div>
      <p class="pk-crowd"><b>${pct}%</b> pick the Oilers · ${100 - pct}% the ${esc(oppName)} · ${r.total} pick${r.total === 1 ? "" : "s"}.${top}
      Average: ${r.avgEdm}–${r.avgOpp}.</p>`;
  }

  function lastLine(last) {
    const mine = last && store()[last.id];
    if (!mine || !(last.state === "OFF" || last.state === "FINAL")) return "";
    const {edmHome, opp} = sides(last);
    const e = edmHome ? last.home.score : last.away.score, o = opp.score;
    const right = (mine.edm > mine.opp) === (e > o), exact = mine.edm === e && mine.opp === o;
    return `<p class="pk-last">Last game you picked ${mine.edm}–${mine.opp}. Final was Oilers ${e}, ${esc(opp.name)} ${o}. ${exact ? "🎯 Exact score!" : right ? "✅ You had the right winner." : "❌ Not this time."}</p>`;
  }

  async function render(d) {
    const g = d.next, s = store();
    if (!g || !g.id) { box.hidden = true; return; }
    const {opp} = sides(g);
    const locked = !(g.state === "FUT" || g.state === "PRE") || Date.parse(g.startTimeUTC) <= Date.now();
    const mine = s[g.id];
    let r = null;
    try { r = await getJSON(`${W}/pickem?game=${g.id}`); } catch {}
    const pick = mine || {edm: 4, opp: 2};
    box.hidden = false;
    box.innerHTML = `<h2>Pick'em: ${esc(opp.name)} ${g.home.abbrev === "EDM" ? "@ Oilers" : "vs Oilers"}</h2>
      <p class="muted pk-when">${esc(g.dateMT || "")} · ${esc(g.timePT || "")} / ${esc(g.timeMT || "")}. Call the final score.</p>
      ${locked ? `<p class="pk-mine">${mine ? `Your pick: Oilers ${mine.edm}, ${esc(opp.name)} ${mine.opp}. ` : ""}Picks are locked. Puck has dropped.</p>` : `
      <div class="pk-score">
        ${["edm", "opp"].map(k => `<div class="pk-team"><span>${k === "edm" ? "Oilers" : esc(opp.name)}</span>
          <div class="pk-step"><button type="button" data-k="${k}" data-d="-1" aria-label="fewer goals">−</button>
          <b data-v="${k}">${pick[k]}</b><button type="button" data-k="${k}" data-d="1" aria-label="more goals">+</button></div></div>`).join('<span class="pk-dash">–</span>')}
      </div>
      <button type="button" class="btn pk-go">${mine ? "Update my pick" : "Lock in my pick"}</button>
      <p class="pk-msg" aria-live="polite">${mine ? `Your pick: Oilers ${mine.edm}, ${esc(opp.name)} ${mine.opp}. You can change it until puck drop.` : ""}</p>`}
      ${crowd(r, opp.name, mine)}${lastLine(d.last)}`;
    if (locked) return;
    const val = {...pick};
    box.querySelectorAll(".pk-step button").forEach(b => b.onclick = () => {
      const k = b.dataset.k; val[k] = Math.max(0, Math.min(15, val[k] + +b.dataset.d));
      box.querySelector(`[data-v="${k}"]`).textContent = val[k];
    });
    box.querySelector(".pk-go").onclick = async () => {
      const msg = box.querySelector(".pk-msg");
      if (val.edm === val.opp) { msg.textContent = "No ties in the NHL. Somebody has to win!"; return; }
      msg.textContent = "Saving…";
      try {
        const res = await fetch(`${W}/pickem`, {method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({game: g.id, voter: voterId(), edm: val.edm, opp: val.opp})});
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "Couldn't save your pick");
        const st = store(); st[g.id] = {edm: val.edm, opp: val.opp}; save(st);
        render(d);
      } catch (e) { msg.textContent = e.message || "Couldn't save your pick. Try again."; }
    };
  }

  getJSON("data.json").then(render).catch(() => { box.hidden = true; });
})();
