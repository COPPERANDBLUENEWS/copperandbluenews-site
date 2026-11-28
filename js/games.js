// Games page. Each Oilers game gets its own heading. The live card that used to
// sit on the home page is the matching game's detail, and it keeps polling.
(() => {
  const root = document.getElementById("upcoming");
  if (!root || typeof CBN === "undefined") return;
  const {esc, getJSON, fmtDate, bothTimes, isFinal, isLive, matchup, pollVisible, liveNow, liveInner, gameTitle} = CBN;
  const UP = 8, RECENT = 8;
  let games = [], featured = null, sig = "";
  const same = (a, b) => String(a) === String(b);

  function mergeLive(live) {
    const g = live && live.game;
    featured = g && !isFinal(g.state) ? live : null;
    if (!g) return;
    const i = games.findIndex(x => same(x.id, g.id));
    if (i >= 0) {
      const prev = games[i];
      games[i] = {...prev, ...g, dateMT: prev.dateMT || g.dateMT, venue: g.venue || prev.venue};
    } else games.push({...g, dateMT: g.dateMT || fmtDate(g.startTimeUTC).replace(/,/g, "")});
  }

  function lists() {
    const finals = games.filter(g => isFinal(g.state));
    const ahead = games.filter(g => !isFinal(g.state));
    let upcoming = ahead.slice(0, UP);
    if (featured && !upcoming.some(g => same(g.id, featured.game.id))) {
      const g = games.find(x => same(x.id, featured.game.id));
      if (g) upcoming = [g, ...upcoming].slice(0, UP);
    }
    return {upcoming, recent: finals.slice(-RECENT).reverse()};
  }

  function shell(g, opts) {
    const cls = ["card", "game-card"];
    if (opts.live) cls.push("is-live");
    else if (opts.next) cls.push("is-next");
    return `<article class="${cls.join(" ")}" id="g-${g.id}">
      <h2>${esc(gameTitle(g))}</h2>
      <div class="game-detail"></div>
      ${opts.odds ? `<div class="odds-slot" data-odds hidden></div>` : ""}
    </article>`;
  }

  function staticDetail(g, kind) {
    const m = matchup(g);
    const when = `${g.dateMT || fmtDate(g.startTimeUTC).replace(/,/g, "")} · ${bothTimes(g.startTimeUTC)}`;
    if (isFinal(g.state)) {
      const score = `${m.label} ${m.us.score}-${m.opp.score}${m.extra}`;
      return `<p class="game-kicker">Final${g.gameType === 1 ? " · Preseason" : ""}</p>
        <div class="big ${m.win ? "w" : "l"}">${esc(score)}</div>
        <p class="meta">${esc(when)}<br>${esc(g.venue || "")}</p>
        <a class="more" href="game.html?id=${encodeURIComponent(g.id)}">Box score →</a>`;
    }
    const label = kind === "next" ? "Next" : isLive(g.state) ? "Live" : g.gameType === 1 ? "Preseason" : "Upcoming";
    const flag = g.scheduleState && g.scheduleState !== "OK" ? ` · ${g.scheduleState}` : "";
    return `<p class="game-kicker">${esc(label + flag)}</p>
      <p class="meta">${esc(when)}<br>${esc(g.venue || "")}</p>`;
  }

  async function fill(g, kind) {
    const card = document.getElementById("g-" + g.id);
    const el = card && card.querySelector(".game-detail");
    if (!el) return;
    let html = "";
    if (featured && same(featured.game.id, g.id)) html = await liveInner(featured);
    if (!html) html = staticDetail(g, kind);
    if (el._html === html) return;
    el._html = html;
    el.innerHTML = html;
  }

  async function draw() {
    const {upcoming, recent} = lists();
    const oddsId = upcoming.find(g => Date.parse(g.startTimeUTC) > Date.now())?.id;
    const nextId = upcoming.find(g => !(featured && same(g.id, featured.game.id)))?.id;
    const nextSig = upcoming.map(g => g.id + (same(g.id, oddsId) ? "o" : "") + (same(g.id, featured && featured.game.id) ? "l" : "")).join(",")
      + "|" + recent.map(g => g.id).join(",");
    if (nextSig !== sig) {
      sig = nextSig;
      root.innerHTML = upcoming.length ? upcoming.map(g => shell(g, {
        next: same(g.id, nextId),
        live: !!(featured && same(g.id, featured.game.id)),
        odds: same(g.id, oddsId)
      })).join("") : `<p class="meta">No games scheduled.</p>`;
      const recentEl = document.getElementById("recent");
      if (recentEl) recentEl.innerHTML = recent.length ? recent.map(g => shell(g, {})).join("") : `<p class="meta">No games played yet.</p>`;
    }
    for (const g of upcoming) await fill(g, same(g.id, nextId) ? "next" : "");
    for (const g of recent) await fill(g, "");
  }

  (async () => {
    let sched;
    try { sched = await getJSON("data/schedule.json"); }
    catch { root.textContent = "Couldn't load games."; return; }
    games = Array.isArray(sched.games) ? sched.games.slice() : [];
    const updated = document.getElementById("updated");
    if (updated && sched.updated) updated.textContent = "Updated " + new Date(sched.updated).toLocaleString("en-US", {timeZone: "America/Edmonton", dateStyle: "medium", timeStyle: "short"}) + " MT";
    try { mergeLive(await liveNow()); } catch {}
    await draw();
    pollVisible(async () => {
      try { mergeLive(await liveNow()); } catch {}
      await draw();
      return featured ? 3000 : 300000;
    });
  })();
})();
