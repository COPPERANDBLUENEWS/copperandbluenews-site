// Home page game-day poll: who scores the Oilers' first goal?
// One pick per device, stored under a localStorage id, changeable until puck drop.
// Votes and the live tally are the Game alerts Worker route /fgs (worker/src/fgs.js).
(function () {
  const box = document.getElementById("fgs");
  const W = (window.CBN_CONFIG || {}).WORKER_URL;
  // CBN is a global lexical binding from main.js, not a window property.
  if (!box || !W || typeof CBN === "undefined") return;
  const {esc, getJSON, pollVisible, liveNow} = CBN;
  const LS = "cbn-fgs";
  const store = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
  const save = s => { try { localStorage.setItem(LS, JSON.stringify(s)); } catch {} };
  function voterId() {
    const s = store();
    if (!s.voter) {
      s.voter = crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ Math.random() * 16 >> c / 4).toString(16));
      save(s);
    }
    return s.voter;
  }
  const ptDay = t => new Date(t).toLocaleDateString("en-CA", {timeZone: "America/Vancouver"});
  const tonight = iso => !!iso && ptDay(iso) === ptDay(Date.now());
  const ordinal = n => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || "th");
  const periodLabel = p => !p ? "" : p.periodType === "SO" ? "SO" : p.periodType === "OT" ? (p.number > 4 ? `${p.number - 3}OT` : "OT") : ordinal(p.number || 1);
  const clock = t => String(t || "").replace(/^0/, "");

  function addSkater(out, seen, p, group) {
    if (!p || p.id == null || p.pos === "G" || seen.has(p.id)) return;
    seen.add(p.id);
    out.push({id: String(p.id), name: p.name || "Skater", num: p.num, pos: p.pos || "", group});
  }
  function skatersFromLineup(d, id) {
    if (!d || !d.game || String(d.game.id) !== String(id)) return [];
    const out = [], seen = new Set();
    (d.forwards || []).flat().forEach(p => addSkater(out, seen, p, "Forwards"));
    (d.defence || []).flat().forEach(p => addSkater(out, seen, p, "Defence"));
    return out;
  }
  function skatersFromRoster(d) {
    const out = [], seen = new Set(), groups = (d && d.groups) || {};
    for (const group of ["Forwards", "Defence"]) for (const p of groups[group] || []) addSkater(out, seen, p, group);
    return out;
  }
  function firstFromPbp(g) {
    if (!g) return null;
    const home = g.homeTeam || {}, away = g.awayTeam || {};
    const edm = home.abbrev === "EDM" ? home : away.abbrev === "EDM" ? away : null;
    if (!edm) return null;
    const goals = (g.plays || []).filter(p => p.typeDescKey === "goal" && p.periodDescriptor?.periodType !== "SO");
    goals.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const goal = goals.find(p => Number(p.details?.eventOwnerTeamId) === Number(edm.id));
    if (!goal) return null;
    const id = goal.details?.scoringPlayerId;
    const spot = (g.rosterSpots || []).find(r => Number(r.playerId) === Number(id));
    const name = spot ? `${spot.firstName?.default || ""} ${spot.lastName?.default || ""}`.trim() : "";
    return {id: id ?? null, name: name || "Oilers", num: spot?.sweaterNumber ?? null, period: goal.periodDescriptor || null, time: goal.timeInPeriod || ""};
  }
  function firstFromSummary(s) {
    for (const per of s?.scoring || []) {
      if (per.periodDescriptor?.periodType === "SO") continue;
      for (const goal of per.goals || []) {
        if (goal.teamAbbrev?.default !== "EDM") continue;
        const name = `${goal.firstName?.default || ""} ${goal.lastName?.default || ""}`.trim() || goal.name?.default || "Oilers";
        return {id: goal.playerId ?? null, name, num: null, period: per.periodDescriptor, time: goal.timeInPeriod || ""};
      }
    }
    return null;
  }

  const view = {game: null, options: [], source: "lineup", selected: null, mine: null, results: null, scorer: null, noGoal: false, shootout: false, saving: false, locked: false, error: ""};

  function label(id) {
    const o = view.options.find(x => x.id === String(id));
    return o ? o.name : (id === "other" ? "Other" : "your pick");
  }
  function calledIt(pick, scorer) {
    if (!pick || !scorer) return null;
    const sid = scorer.id == null || scorer.id === "" ? "" : String(scorer.id);
    const lineup = new Set(view.options.filter(o => o.id !== "other").map(o => o.id));
    if (pick === "other") return sid ? !lineup.has(sid) : true;
    return pick === sid;
  }
  function scorerName() {
    const sid = view.scorer && view.scorer.id != null ? String(view.scorer.id) : "";
    const opt = view.options.find(o => o.id === sid);
    return (opt && opt.name) || view.scorer.name || "An Oiler";
  }
  function tallyRows() {
    const map = new Map(view.options.map(o => [o.id, {...o, n: 0}]));
    if (!map.has("other")) map.set("other", {id: "other", name: "Other", num: null, pos: "", group: "Other", n: 0});
    for (const v of (view.results && view.results.votes) || []) {
      const id = String(v.id);
      if (!map.has(id)) map.set(id, {id, name: "Player " + id, num: null, pos: "", group: "Other", n: 0});
      map.get(id).n += v.n || 0;
    }
    const rows = [...map.values()];
    const total = rows.reduce((a, r) => a + r.n, 0);
    return {rows, total};
  }
  function optHtml(r, showBars, total) {
    const on = view.selected === r.id;
    const mine = view.mine === r.id;
    const pct = total ? Math.round(r.n / total * 100) : 0;
    const width = total ? (r.n / total * 100) : 0;
    const num = r.id === "other" || r.num == null ? "" : "#" + r.num;
    const bar = showBars ? `<span class="fgs-bar" aria-hidden="true"><span style="width:${width}%"></span></span>` : "";
    const pctHtml = showBars ? `<span class="pct">${pct}%</span>` : "";
    const you = mine ? `<span class="fgs-you">You</span>` : "";
    const pos = r.pos ? `<span class="pos">${esc(r.pos)}</span>` : "";
    const described = `${r.name}${mine ? ", your pick" : ""}${showBars ? ", " + pct + " percent" : ""}`;
    return `<button type="button" class="fgs-opt${on ? " on" : ""}" data-id="${esc(r.id)}" aria-pressed="${on ? "true" : "false"}"${view.locked ? " disabled" : ""} aria-label="${esc(described)}">
      <span class="fgs-line">${num ? `<span class="num">${esc(num)}</span>` : ""}<span class="name">${esc(r.name)}</span>${you}${pos}${pctHtml}</span>${bar}</button>`;
  }
  function optionsHtml(showBars, total, rows) {
    const groups = new Map();
    for (const r of rows) {
      const g = r.group || "Other";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
    return ["Forwards", "Defence", "Other"].filter(g => groups.get(g)?.length).map(g =>
      `<h3 class="fgs-sub">${g}</h3>` + groups.get(g).map(r => optHtml(r, showBars, total)).join("")).join("");
  }
  function statusHtml() {
    if (view.scorer) {
      const when = `${periodLabel(view.scorer.period)} ${clock(view.scorer.time)}`.trim();
      const hit = calledIt(view.mine, view.scorer);
      const tail = hit == null ? "" : hit ? " <b>You called it!</b>" : " Not this time.";
      return `<p class="fgs-call${hit ? " yes" : ""}" role="status">${esc(scorerName())} scored the Oilers' first goal${when ? ", " + esc(when) : ""}.${tail}</p>`;
    }
    if (view.noGoal) return `<p class="fgs-call" role="status">${view.shootout ? "The Oilers didn't score before the shootout." : "The Oilers were shut out. No first goal."}</p>`;
    if (view.locked) {
      const mine = view.mine ? `Your pick: ${esc(label(view.mine))}. ` : "";
      return `<p class="fgs-msg" aria-live="polite">${mine}Voting is locked. Puck has dropped. Waiting on the Oilers' first goal.</p>`;
    }
    const err = view.error ? `<span class="fgs-err">${esc(view.error)}</span>` : "";
    if (view.mine) return `<p class="fgs-msg" aria-live="polite">Your pick: ${esc(label(view.mine))}. You can change it until puck drop. ${err}</p>`;
    return `<p class="fgs-msg" aria-live="polite">${err || "Tap a skater, then lock it in. You can change it until puck drop."}</p>`;
  }

  function render() {
    const g = view.game;
    const {rows, total} = tallyRows();
    const showBars = !!(view.mine || view.locked) && total > 0;
    const where = g.home ? `${g.opp} @ Oilers` : `Oilers @ ${g.opp}`;
    const same = view.selected && view.selected === view.mine;
    const btn = view.locked ? "" : `<button type="button" class="btn fgs-go"${!view.selected || same || view.saving ? " disabled" : ""}>${view.saving ? "Saving…" : view.mine ? "Update my pick" : "Lock in my pick"}</button>`;
    const src = view.source === "roster" ? "Oilers roster, plus Other." : "Tonight's lineup, plus Other.";
    box.hidden = false;
    box.innerHTML = `<h2>Who scores the Oilers' first goal?</h2>
      <p class="fgs-when">${esc(where)}${g.when ? " · " + esc(g.when) : ""}</p>
      <p class="fgs-note">${src} One vote on this device.</p>
      ${statusHtml()}
      ${btn}
      ${showBars ? `<p class="fgs-total">${total} pick${total === 1 ? "" : "s"}</p>` : ""}
      <div class="fgs-opts">${optionsHtml(showBars, total, rows)}</div>`;
    if (!view.locked) box.querySelectorAll(".fgs-opt").forEach(b => b.onclick = () => {
      if (view.saving) return;
      view.selected = b.dataset.id;
      view.error = "";
      render();
    });
    const go = box.querySelector(".fgs-go");
    if (go) go.onclick = submit;
  }

  async function submit() {
    if (view.locked || view.saving || !view.selected || view.selected === view.mine) return;
    view.saving = true; view.error = ""; render();
    try {
      const res = await fetch(`${W}/fgs`, {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({game: view.game.id, voter: voterId(), player: view.selected})});
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) { view.locked = true; view.saving = false; view.error = ""; await refresh(); return; }
      if (!res.ok) throw new Error(j.error || "Couldn't save your pick");
      const st = store(); st[view.game.id] = view.selected; save(st);
      view.mine = view.selected;
    } catch (e) {
      view.saving = false;
      view.error = e.message || "Couldn't save your pick. Try again.";
      render();
      return;
    }
    view.saving = false;
    await refresh();
  }

  async function localScorer() {
    try {
      const live = await liveNow();
      if (live?.game && String(live.game.id) === String(view.game.id)) {
        const g = (live.goals || []).find(x => x.team === "EDM" && x.period?.periodType !== "SO");
        if (g) {
          const opt = view.options.find(o => o.name === g.name);
          return {id: opt ? opt.id : null, name: g.name, num: opt?.num ?? null, period: g.period, time: g.time};
        }
      }
    } catch {}
    try { const s = firstFromPbp(await getJSON(`data/pbp/${view.game.id}.json`)); if (s) return s; } catch {}
    try { const s = firstFromSummary((await getJSON(`data/games/${view.game.id}.json`)).summary); if (s) return s; } catch {}
    return null;
  }

  async function refresh() {
    if (view.saving) return view.locked ? 15000 : 60000;
    let r = null;
    try { r = await getJSON(`${W}/fgs?game=${view.game.id}`); } catch {}
    if (r) {
      view.results = r;
      if (r.scorer) view.scorer = r.scorer;
      view.noGoal = !!r.noGoal;
      view.shootout = !!r.shootoutGoal;
      if (r.locked) view.locked = true;
    }
    const started = view.locked || (!!view.game.start && Date.parse(view.game.start) <= Date.now());
    view.locked = started;
    if (!view.scorer && started) {
      const local = await localScorer();
      if (local) { view.scorer = local; view.noGoal = false; }
    }
    render();
    if (view.scorer || view.noGoal) return null;
    return view.locked ? 15000 : 60000;
  }

  function metaFrom(g, home, opp, when) {
    return {id: String(g.id), start: g.startTimeUTC, home, opp, when};
  }
  async function boot() {
    const [data, lineup, roster] = await Promise.all([
      getJSON("data.json").catch(() => null),
      getJSON("data/lineup.json").catch(() => null),
      getJSON("data/roster.json").catch(() => null)
    ]);
    const games = [data?.next, data?.last].filter(Boolean);
    const lg = lineup?.game;
    let meta = null;
    if (lg?.startTimeUTC && tonight(lg.startTimeUTC)) {
      const g = games.find(x => String(x.id) === String(lg.id));
      const home = g ? g.home.abbrev === "EDM" : !!lg.home;
      const opp = g ? (home ? g.away.name : g.home.name) : (lg.opponent?.name || "Opponent");
      const when = g ? [g.dateMT, g.timePT].filter(Boolean).join(" · ") : (lg.puckDropPT || "");
      meta = metaFrom(lg, home, opp, when);
    } else {
      const g = games.find(x => tonight(x.startTimeUTC));
      if (g) {
        const home = g.home.abbrev === "EDM";
        meta = metaFrom(g, home, (home ? g.away : g.home).name, [g.dateMT, g.timePT].filter(Boolean).join(" · "));
      }
    }
    if (!meta) { box.hidden = true; return; }
    let options = skatersFromLineup(lineup, meta.id);
    view.source = "lineup";
    if (!options.length) { options = skatersFromRoster(roster); view.source = "roster"; }
    if (!options.length) { box.hidden = true; return; }
    options.push({id: "other", name: "Other", num: null, pos: "", group: "Other"});
    view.game = meta;
    view.options = options;
    view.mine = store()[meta.id] || null;
    view.selected = view.mine;
    pollVisible(() => refresh().catch(() => 60000));
  }
  boot();
})();
