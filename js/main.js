// Shared helpers + home page. The NHL API sends no CORS headers, so every page
// uses the Worker NHL relay for live scores, with generated JSON as a fallback.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const getJSON = async url => { const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), {cache: "no-store"}); if (!r.ok) throw new Error(r.status); return r.json(); };
const fmtTime = (iso, tz, label) => new Date(iso).toLocaleTimeString("en-US", {timeZone: tz, hour: "numeric", minute: "2-digit"}).replace(":00", "") + " " + label;
const fmtDate = (iso, o = {weekday: "short", month: "short", day: "numeric"}) => new Date(iso).toLocaleDateString("en-US", {timeZone: "America/Edmonton", ...o});
const bothTimes = iso => `${fmtTime(iso, "America/Edmonton", "MT")} | ${fmtTime(iso, "America/Vancouver", "PT")}`;
const ordinal = n => n + (["th","st","nd","rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || "th");
const isFinal = s => s === "OFF" || s === "FINAL";
const isLive = s => s === "LIVE" || s === "CRIT";
const periodName = p => !p ? "" : p.periodType === "SO" ? "SO" : p.periodType === "OT" ? (p.number > 4 ? `${p.number - 3}OT` : "OT") : ordinal(p.number);
// Oilers perspective: {home, opp, oppName, label: W/L/OTL/SOL, us, them}
function matchup(g) {
  const home = g.home.abbrev === "EDM", us = home ? g.home : g.away, opp = home ? g.away : g.home;
  const win = us.score > opp.score, lp = g.lastPeriod;
  const label = win ? "W" : lp === "SO" ? "SOL" : lp === "OT" ? "OTL" : "L";
  return {home, us, opp, oppName: opp.name || opp.abbrev, win, label, extra: win && lp && lp !== "REG" ? ` (${lp})` : ""};
}
const CBN = {$, esc, getJSON, fmtTime, fmtDate, bothTimes, ordinal, isFinal, isLive, periodName, matchup};

// One request at a time; hidden tabs stop polling and refresh immediately on return.
CBN.pollVisible = (run, fallbackMs = 300000) => {
  let timer, running = false, stopped = false;
  const tick = async () => {
    clearTimeout(timer);
    if (document.hidden || running || stopped) return;
    running = true;
    let delay = fallbackMs;
    try { delay = await run(); } catch (e) { console.warn("Live refresh failed", e); }
    finally {
      running = false;
      if (delay === null) stopped = true;
      if (!stopped && !document.hidden) timer = setTimeout(tick, delay ?? fallbackMs);
    }
  };
  const visible = () => { clearTimeout(timer); if (!document.hidden) tick(); };
  document.addEventListener("visibilitychange", visible);
  tick();
  return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
};
const LIVE_API = "https://cbn-alerts.copperandbluenews.workers.dev";
CBN.liveJSON = async (path, fallback) => {
  try {
    const r = await fetch(LIVE_API + path, {cache: "no-store", signal: AbortSignal.timeout(5000)});
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    if (path.startsWith("/live/pbp") ? !Array.isArray(d.plays) || !d.fetched || String(d.id) !== new URLSearchParams(path.split("?")[1]).get("id")
      : !d.updated || !("game" in d)) throw new Error("Invalid live feed");
    return {...d, __relay: true};
  } catch { return {...await getJSON(fallback), __relay: false}; }
};
let lastLive;
CBN.liveNow = async () => {
  const d = await CBN.liveJSON("/live/now", "data/live.json");
  // A stale Pages deploy/fallback must never replace a fresher relay score.
  if (lastLive && Date.parse(d.updated) < Date.parse(lastLive.updated)) return lastLive;
  return lastLive = d;
};

function renderNext(g) {
  const el = $("next")?.querySelector(".body"); if (!el) return;
  if (!g) { el.textContent = "No upcoming games scheduled."; return; }
  const m = matchup(g);
  el.innerHTML = `<div class="match">Oilers <span class="vs">${m.home ? "vs" : "@"}</span> ${esc(m.oppName)}</div>
    <div class="meta">${fmtDate(g.startTimeUTC)} · ${bothTimes(g.startTimeUTC)}<br>${esc(g.venue)}</div>`;
}
function renderLast(g) {
  const el = $("last")?.querySelector(".body"); if (!el) return;
  if (!g) { el.textContent = "No games played yet."; return; }
  const m = matchup(g);
  el.innerHTML = `<div class="big ${m.win ? "w" : "l"}">${m.label} ${m.us.score}-${m.opp.score}${m.extra}</div>
    <div class="meta">Oilers ${m.home ? "vs" : "@"} ${esc(m.oppName)} · ${fmtDate(g.startTimeUTC)}<br>${esc(g.venue)}</div>
    <a class="more" href="game.html?id=${g.id}">Box score →</a>`;
}
function renderStandings(s) {
  const el = $("standings")?.querySelector(".body"); if (!el) return;
  if (!s) { el.textContent = "Standings unavailable."; return; }
  el.innerHTML = `<div class="big">${s.wins}-${s.losses}-${s.otLosses}</div>
    <div class="meta">${s.points} PTS in ${s.gamesPlayed} GP · ${ordinal(s.divisionSequence)} in ${esc(s.divisionName)}${s.streakCode ? ` · Streak ${s.streakCode}${s.streakCount}` : ""}</div>`;
}
// Live card on the home page (shown from 30 min before puck drop to the final).
async function renderLive() {
  const el = $("live"); if (!el) return;
  let live; try { live = await CBN.liveNow(); } catch { return; }
  const g = live.game;
  if (!g || isFinal(g.state)) { el.hidden = true; return false; }
  const m = matchup(g); let goals = "";
  if (live.__relay) {
    goals = (live.goals || []).map(x => `<li><b>${esc(x.team)}</b> ${esc(x.name)} · ${periodName(x.period)} ${esc(x.time)}</li>`).join("");
  } else try {
    const d = await getJSON(`data/games/${g.id}.json`);
    goals = (d.summary.scoring || []).flatMap(p => p.goals.map(x => `<li><b>${esc(x.teamAbbrev.default)}</b> ${esc(x.name.default)} · ${periodName(p.periodDescriptor)} ${x.timeInPeriod}</li>`)).join("");
  } catch {}
  const status = isLive(g.state) ? `<span class="pulse"></span>LIVE · ${periodName(g.period)} ${g.clock?.inIntermission ? "INT " : ""}${esc(g.clock?.timeRemaining || "")}` : `Puck drop ${bothTimes(g.startTimeUTC)}`;
  el.hidden = false;
  el.innerHTML = `<h2>${status}</h2>
    <div class="live-score"><div><span>${esc(g.away.abbrev)}</span><b>${g.away.score ?? 0}</b><small>SOG ${g.away.sog ?? 0}</small></div>
    <div class="dash">–</div><div><span>${esc(g.home.abbrev)}</span><b>${g.home.score ?? 0}</b><small>SOG ${g.home.sog ?? 0}</small></div></div>
    ${goals ? `<ul class="goals">${goals}</ul>` : ""}
    <div class="meta">Updated ${new Date(live.updated).toLocaleTimeString("en-US", {timeZone: "America/Edmonton", hour: "numeric", minute: "2-digit"})} MT · ${live.__relay ? "checks every 3 s · roughly 10–30 s behind the NHL feed (feed delay varies)" : "backup feed · updates may be delayed 2–4 min"}</div>
    <a class="more" href="game.html?id=${g.id}">Full game page →</a>`;
  return true;
}
async function loadGames() {
  if (!$("next")) return;
  try {
    const d = await getJSON("data.json");
    renderNext(d.next); renderLast(d.last); renderStandings(d.standings);
    if (d.updated) $("updated").textContent = "Updated " + new Date(d.updated).toLocaleString("en-US", {timeZone: "America/Edmonton", dateStyle: "medium", timeStyle: "short"}) + " MT";
  } catch (e) { ["next", "last", "standings"].forEach(id => $(id).querySelector(".body").textContent = "Couldn't load game data."); }
  CBN.pollVisible(async () => (await renderLive()) ? 3000 : 300000);
}
async function loadPosts() {
  const feed = $("feed"); if (!feed) return;
  const posts = (await getJSON("posts.json")).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.date.localeCompare(a.date));
  const limit = +feed.dataset.limit || posts.length;
  feed.innerHTML = posts.slice(0, limit).map(p => `<article class="post">
    ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy">` : ""}
    <div class="pb"><span class="badge ${esc(p.type)}">${esc(p.type === "gameday" ? "Game Day" : p.type)}</span><span class="meta">${new Date(p.date + "T12:00:00").toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric", year: "numeric"})}</span>
    <h3 style="margin-top:10px">${esc(p.title)}</h3><p style="white-space:pre-line">${esc(p.caption)}</p>${p.source ? `<p class="meta">Source: <a href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.name)}</a></p>` : ""}${p.link ? `<a class="btn" href="${esc(p.link)}" target="_blank" rel="noopener">View on Instagram</a>` : ""}</div></article>`).join("");
}
$("yr").textContent = new Date().getFullYear();
// Navigation: top bar (desktop), bottom tab bar (phones) and the More menu.
(() => {
  const here = location.pathname.split("/").pop() || "./";
  const cur = here === "index.html" ? "./" : (here === "game.html" || here === "stats.html") ? "scores.html" : here === "player.html" ? "players.html" : here === "posts.html" ? "news.html" : here;
  document.querySelectorAll(".topnav a, .tabbar a, .more-menu a").forEach(a => { if (a.getAttribute("href") === cur) a.classList.add("on"); });
  const menu = document.getElementById("more-menu"); if (!menu) return;
  const inMore = (sel) => !!menu.querySelector(`a.on${sel}`);
  if (inMore(":not(.m-mob)")) document.querySelectorAll(".more-btn").forEach(b => b.classList.add("on"));
  if (inMore(".m-mob")) document.querySelector(".tabbar .more-btn")?.classList.add("on");
  const btns = document.querySelectorAll(".more-btn");
  const set = open => { menu.hidden = !open; btns.forEach(b => b.setAttribute("aria-expanded", open)); document.body.classList.toggle("more-open", open); };
  btns.forEach(b => b.addEventListener("click", e => { e.stopPropagation(); set(menu.hidden); }));
  menu.addEventListener("click", e => { if (e.target === menu) set(false); });
  document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target)) set(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") set(false); });
})();
loadGames(); loadPosts();
// Height/weight exactly as the NHL API reports them (imperial and metric both come from the API; nothing derived).
CBN.ht = p => p && p.heightInInches ? `${Math.floor(p.heightInInches / 12)}'${p.heightInInches % 12}"${p.heightInCentimeters ? ` <small>(${p.heightInCentimeters} cm)</small>` : ""}` : "—";
CBN.wt = p => p && p.weightInPounds ? `${p.weightInPounds} lbs${p.weightInKilograms ? ` <small>(${p.weightInKilograms} kg)</small>` : ""}` : "—";

CBN.injuries = (() => { let pr; return () => pr || (pr = getJSON("data/injuries.json").then(d => Object.fromEntries(d.players.filter(p => p.id).map(p => [p.id, p]))).catch(() => ({}))); })();
CBN.injBadge = r => r ? `<span class="ibadge ${({IR: "ir", LTIR: "ltir", "Day-to-day": "dtd"})[r.status] || "out"}" title="${esc((r.injury || "injury") + " · " + r.status)}">${esc(r.status)}${r.injury && r.injury !== "undisclosed" ? " · " + esc(r.injury) : ""}</span>` : "";
// Live tracker tab: add it to any page whose static nav doesn't have it yet (keeps the tab bar consistent).
(() => { const nav = document.querySelector(".nav nav"); if (!nav || nav.querySelector('a[href="tracker.html"]')) return;
  const a = document.createElement("a"); a.href = "tracker.html"; a.textContent = "Live";
  const after = nav.querySelector('a[href="scores.html"]'); after ? after.after(a) : nav.appendChild(a); })();
