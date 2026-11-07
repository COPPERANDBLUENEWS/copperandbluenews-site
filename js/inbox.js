// Notifications inbox. The list comes from the alerts Worker (GET /alerts/log).
// Unread ids live only in localStorage. ?sample=1 shows labeled example alerts.
(() => {
  const {$, esc} = CBN;
  const READ_KEY = "cbn-alerts-read";
  const root = $("inbox");
  const SAMPLE = [
    {id: "sample:lineup:official", type: "lineup", title: "Oilers lineup confirmed vs Canucks", body: "Official dressed lineup is in, Devon Levi in goal. See who's in and who's scratched.", url: "/players.html", at: "2026-11-08T02:40:00.000Z", game: "2026020276", matchup: "Canucks @ Oilers", away: "VAN", home: "EDM", detail: {kind: "lineup", starter: "Devon Levi", opponent: "Canucks", venue: "Rogers Place"}},
    {id: "sample:goal:edm", type: "goal", title: "🚨 OILERS GOAL! EDM 1, VAN 0", body: "C. McDavid (12) from Draisaitl, Bouchard · 1st 4:12 · power play", url: "/tracker.html", at: "2026-11-08T03:18:00.000Z", game: "2026020276", matchup: "Canucks @ Oilers", away: "VAN", home: "EDM", detail: {kind: "goal", team: "EDM", scorer: "C. McDavid", scorerId: 8478402, scorerTotal: 12, assists: ["Draisaitl", "Bouchard"], time: "4:12", period: "1st", strength: "power play", awayAbbrev: "VAN", homeAbbrev: "EDM", awayScore: 0, homeScore: 1}},
    {id: "sample:goal:opp", type: "goal", title: "Canucks goal. EDM 1, VAN 1", body: "Q. Hughes (4) from Pettersson · 2nd 8:02", url: "/tracker.html", at: "2026-11-08T03:51:00.000Z", game: "2026020276", matchup: "Canucks @ Oilers", away: "VAN", home: "EDM", detail: {kind: "goal", team: "VAN", scorer: "Q. Hughes", assists: ["Pettersson"], time: "8:02", period: "2nd", strength: "even strength", awayAbbrev: "VAN", homeAbbrev: "EDM", awayScore: 1, homeScore: 1}},
    {id: "sample:period", type: "period_end", title: "End of 1st: EDM 1, VAN 0", body: "Oilers vs Canucks · Shots: EDM 11, VAN 7.", url: "/tracker.html", at: "2026-11-08T03:40:00.000Z", game: "2026020276", matchup: "Canucks @ Oilers", away: "VAN", home: "EDM", detail: {kind: "period_end", period: "1st", awayAbbrev: "VAN", homeAbbrev: "EDM", awayScore: 0, homeScore: 1, shots: "EDM 11, VAN 7"}},
    {id: "sample:puck", type: "puck_drop", title: "Puck drop: Canucks @ Oilers", body: "Oilers vs Canucks is underway at Rogers Place. Follow it live on the rink tracker.", url: "/tracker.html", at: "2026-11-08T03:02:00.000Z", game: "2026020276", matchup: "Canucks @ Oilers", away: "VAN", home: "EDM", detail: {kind: "puck_drop", venue: "Rogers Place"}},
    {id: "sample:starter", type: "lineup", title: "Confirmed starter: Devon Levi in goal for the Oilers", body: "Devon Levi starts vs Canucks, puck drop 8 PM PT. Thatcher Demko is expected for the Canucks. Lines and pairs on the Players tab.", url: "/players.html", at: "2026-11-07T22:15:00.000Z", game: "2026020276", matchup: "Canucks @ Oilers", away: "VAN", home: "EDM", detail: {kind: "starter", starter: "Devon Levi", opponent: "Canucks", opponentStarter: "Thatcher Demko", opponentStatus: "Likely", when: "8 PM PT", venue: "Rogers Place"}},
    {id: "sample:final", type: "final", title: "FINAL: EDM 4, ANA 5", body: "Oilers fall 4-5 vs the Ducks. Box score and every goal on the site.", url: "/game.html?id=2026020260", at: "2026-11-06T03:45:00.000Z", game: "2026020260", matchup: "Ducks @ Oilers", away: "ANA", home: "EDM", detail: {kind: "final", result: "Oilers fall", awayAbbrev: "ANA", homeAbbrev: "EDM", awayScore: 5, homeScore: 4, extra: ""}},
  ];

  const readIds = () => {
    try { const s = JSON.parse(localStorage.getItem(READ_KEY) || "{}"); return new Set(Array.isArray(s.ids) ? s.ids : []); }
    catch { return new Set(); }
  };
  function markRead(ids) {
    const cur = readIds();
    ids.filter(Boolean).forEach(id => cur.add(id));
    try { localStorage.setItem(READ_KEY, JSON.stringify({ids: [...cur].slice(-500)})); } catch {}
    dispatchEvent(new Event("cbn-alerts-read"));
  }
  function unreadCount(alerts) {
    const seen = readIds();
    return alerts.filter(a => a.id && !seen.has(a.id)).length;
  }
  const when = iso => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-US", {timeZone: "America/Edmonton", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}) + " MT";
  };
  const day = iso => new Date(iso).toLocaleDateString("en-US", {timeZone: "America/Edmonton", weekday: "short", month: "short", day: "numeric"});
  function kindLabel(a) {
    if (a.type === "lineup" && (a.detail?.kind === "starter" || String(a.id).endsWith(":goalie"))) return "Starting goalie";
    if (a.type === "lineup") return "Lineup";
    return {puck_drop: "Puck drop", goal: "Goal", period_end: "Period", final: "Final", odds: "Odds", gameday: "Game day"}[a.type] || "Alert";
  }
  function gameHref(a) {
    if (!a.game) return (a.url || "tracker.html").replace(/^\//, "");
    if (a.type === "final") return `game.html?id=${a.game}`;
    return `tracker.html?id=${a.game}`;
  }
  function gameLabel(a) {
    return a.type === "final" ? "Box score" : "Live rink";
  }
  function extraHref(a) {
    const raw = (a.url || "").replace(/^\//, "");
    const primary = gameHref(a);
    if (!raw || raw.split("?")[0] === primary.split("?")[0]) return null;
    const label = raw.startsWith("players.html") ? "Lineup" : raw.startsWith("game.html") ? "Box score" : "Alert link";
    return {href: raw, label};
  }
  const score = d => d && d.awayAbbrev ? `${d.awayAbbrev} ${d.awayScore} – ${d.homeAbbrev} ${d.homeScore}` : "";
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";

  function facts(pairs) {
    return `<dl class="alert-facts">${pairs.filter(([, v]) => v != null && v !== "").map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
  }
  function detailBody(a) {
    const d = a.detail || {};
    if (d.kind === "goal") {
      const who = d.scorer ? `${d.scorer}${d.scorerTotal ? " (" + d.scorerTotal + ")" : ""}` : "";
      const whoHtml = d.team === "EDM" && d.scorerId ? `<a class="plink" href="player.html?id=${d.scorerId}">${esc(who)}</a>` : esc(who);
      return `<dl class="alert-facts">
        <div><dt>Scorer</dt><dd>${whoHtml || "—"}</dd></div>
        <div><dt>Assists</dt><dd>${esc((d.assists || []).length ? d.assists.join(", ") : "Unassisted")}</dd></div>
        <div><dt>Period</dt><dd>${esc(d.period || "—")}</dd></div>
        <div><dt>Time</dt><dd>${esc(d.time || "—")}</dd></div>
        <div><dt>Strength</dt><dd>${esc(cap(d.strength || "even strength"))}</dd></div>
        <div><dt>Score</dt><dd>${esc(score(d) || "—")}</dd></div>
      </dl>`;
    }
    if (d.kind === "starter") {
      const opp = d.opponentStarter ? `${d.opponentStarter} is ${d.opponentStatus === "Confirmed" ? "confirmed" : "expected"} for the ${d.opponent || "opponent"}` : "";
      return facts([["Oilers starter", d.starter], ["Opponent", opp], ["Puck drop", d.when], ["Venue", d.venue]]);
    }
    if (d.kind === "lineup") return facts([["Starting goalie", d.starter], ["Opponent", d.opponent], ["Venue", d.venue]]);
    if (d.kind === "period_end") return facts([["Period", d.period ? "End of " + d.period : ""], ["Score", score(d)], ["Shots", d.shots]]);
    if (d.kind === "final") return `<p class="big">${esc(score(d) || a.title)}</p>` + facts([["Result", [d.result, d.extra].filter(Boolean).join(" ")]]);
    if (d.kind === "puck_drop") return facts([["Game", a.matchup], ["Venue", d.venue]]);
    return `<p class="alert-body">${esc(a.body || "")}</p>`;
  }
  function links(a) {
    const extra = extraHref(a);
    return `<p class="alert-links"><a class="btn" href="${esc(gameHref(a))}">${esc(gameLabel(a))}</a>${extra ? ` <a class="btn btn-ghost" href="${esc(extra.href)}">${esc(extra.label)}</a>` : ""}</p>`;
  }

  let state = {alerts: [], sample: false, error: false};

  function groups(alerts) {
    const map = new Map();
    alerts.forEach(a => {
      const key = a.game || "other";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    });
    return [...map.entries()];
  }
  function openId(id) {
    const u = new URL(location.href);
    if (id) u.searchParams.set("id", id); else u.searchParams.delete("id");
    history.pushState(null, "", u.pathname + u.search);
    render();
  }

  function render() {
    const id = new URLSearchParams(location.search).get("id");
    const alerts = [...state.alerts].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const banner = state.sample ? `<p class="notice sample-banner"><b>Sample alerts.</b> These were not sent. The live log is empty until the alerts Worker with /alerts/log is deployed. This preview is only on <span class="mono">?sample=1</span>.</p>` : "";
    const settings = `<button type="button" class="cs-off alert-settings" id="alertSettings">Alert settings</button>`;
    if (id) {
      const a = alerts.find(x => x.id === id);
      if (a) markRead([id]);
      if (!a) {
        root.innerHTML = `${banner}<p class="crumb"><a href="notifications.html${state.sample ? "?sample=1" : ""}">← All notifications</a></p><p>That alert isn't in this list.</p>${settings}`;
      } else {
        root.innerHTML = `${banner}<p class="crumb"><button type="button" class="linkish" id="inboxBack">← All notifications</button></p>
          <article class="alert-detail">
            <p class="alert-kicker"><span class="alert-type ${esc(a.type)}">${esc(kindLabel(a))}</span> <time datetime="${esc(a.at)}">${esc(when(a.at))}</time></p>
            <h2>${esc(a.title)}</h2>
            ${a.matchup ? `<p class="meta">${esc(a.matchup)}</p>` : ""}
            ${detailBody(a)}
            ${links(a)}
          </article>${settings}`;
        $("inboxBack").onclick = () => openId(null);
      }
    } else if (state.error) {
      root.innerHTML = `${banner}<p>Couldn't load notifications. Try again in a minute.</p><button type="button" class="btn" id="inboxRetry">Retry</button>${settings}`;
      $("inboxRetry").onclick = () => load(true);
    } else if (!alerts.length) {
      root.innerHTML = `${banner}<p class="inbox-empty">No alerts yet. Puck drop, goals, period ends, finals, confirmed starting goalies and lineup alerts show up here after they're sent.</p>${settings}`;
    } else {
      const seen = readIds();
      root.innerHTML = `${banner}<p class="meta inbox-lead">Newest first, grouped by game. Tap one for the details.</p>` + groups(alerts).map(([, items]) => {
        const top = items[0];
        const label = items.find(a => a.matchup)?.matchup || "Other alerts";
        return `<section class="alert-game"><h2>${esc(label)} <small>${esc(day(top.at))}</small></h2>${
          items.map(a => `<button type="button" class="alert-row${!seen.has(a.id) ? " unread" : ""}" data-id="${esc(a.id)}">
            <span class="alert-type ${esc(a.type)}">${esc(kindLabel(a))}</span>
            <span class="alert-title">${esc(a.title)}</span>
            <time datetime="${esc(a.at)}">${esc(when(a.at))}</time>
          </button>`).join("")
        }</section>`;
      }).join("") + `<button type="button" class="linkish" id="markAll">Mark all read</button>` + settings;
      root.querySelectorAll(".alert-row").forEach(b => b.onclick = () => openId(b.dataset.id));
      const all = $("markAll");
      if (all) all.onclick = () => { markRead(alerts.map(a => a.id)); render(); };
    }
    const gear = $("alertSettings");
    if (gear) gear.onclick = () => window.CBN_PWA?.openPanel();
    const n = unreadCount(state.sample ? state.alerts : alerts);
    if (state.sample) window.CBN_PWA?.paintBadge(n);
    else dispatchEvent(new Event("cbn-alerts-read"));
  }

  async function load(force) {
    const sample = new URLSearchParams(location.search).get("sample") === "1";
    if (sample) { state = {alerts: SAMPLE, sample: true, error: false}; render(); return; }
    const base = ((window.CBN_CONFIG || {}).WORKER_URL || "").replace(/\/+$/, "");
    if (!base) { state = {alerts: [], sample: false, error: true}; render(); return; }
    try {
      const r = await fetch(base + "/alerts/log", {cache: "no-store"});
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      const alerts = Array.isArray(d.alerts) ? d.alerts : [];
      try { sessionStorage.setItem("cbn-alert-log", JSON.stringify({t: Date.now(), alerts})); } catch {}
      state = {alerts, sample: false, error: false};
    } catch {
      if (!force && state.alerts.length) return;
      state = {alerts: [], sample: false, error: true};
    }
    render();
  }

  if (new URLSearchParams(location.search).get("sample") === "1") document.body.dataset.inbox = "sample";
  else document.body.dataset.inbox = "1";
  addEventListener("popstate", render);
  navigator.serviceWorker?.addEventListener("message", e => {
    if (e.data?.type === "cbn-open-alert" && e.data.id) openId(e.data.id);
  });
  window.CBN_INBOX = {render, openId};
  load(false);
  if (new URLSearchParams(location.search).get("sample") !== "1") CBN.pollVisible(async () => { await load(false); return 30000; });
})();
