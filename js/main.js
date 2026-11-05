// Shared helpers + home page. The NHL API sends no CORS headers, so every page
// reads JSON that scripts/update_data.py builds (see README "Live updates").
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
  let live; try { live = await getJSON("data/live.json"); } catch { return; }
  const g = live.game;
  if (!g || isFinal(g.state)) { el.hidden = true; return false; }
  const m = matchup(g); let goals = "";
  try {
    const d = await getJSON(`data/games/${g.id}.json`);
    goals = (d.summary.scoring || []).flatMap(p => p.goals.map(x => `<li><b>${esc(x.teamAbbrev.default)}</b> ${esc(x.name.default)} · ${periodName(p.periodDescriptor)} ${x.timeInPeriod}</li>`)).join("");
  } catch {}
  const status = isLive(g.state) ? `<span class="pulse"></span>LIVE · ${periodName(g.period)} ${g.clock?.inIntermission ? "INT " : ""}${esc(g.clock?.timeRemaining || "")}` : `Puck drop ${bothTimes(g.startTimeUTC)}`;
  el.hidden = false;
  el.innerHTML = `<h2>${status}</h2>
    <div class="live-score"><div><span>${esc(g.away.abbrev)}</span><b>${g.away.score ?? 0}</b><small>SOG ${g.away.sog ?? 0}</small></div>
    <div class="dash">–</div><div><span>${esc(g.home.abbrev)}</span><b>${g.home.score ?? 0}</b><small>SOG ${g.home.sog ?? 0}</small></div></div>
    ${goals ? `<ul class="goals">${goals}</ul>` : ""}
    <div class="meta">Updated ${new Date(live.updated).toLocaleTimeString("en-US", {timeZone: "America/Edmonton", hour: "numeric", minute: "2-digit"})} MT · refreshes automatically (data is ~2-4 min behind live)</div>
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
  const tick = async () => { const on = await renderLive(); setTimeout(tick, on ? 30000 : 300000); };
  tick();
}
async function loadPosts() {
  const feed = $("feed"); if (!feed) return;
  const posts = (await getJSON("posts.json")).sort((a, b) => b.date.localeCompare(a.date));
  const limit = +feed.dataset.limit || posts.length;
  feed.innerHTML = posts.slice(0, limit).map(p => `<article class="post">
    ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy">` : ""}
    <div class="pb"><span class="badge ${esc(p.type)}">${esc(p.type === "gameday" ? "Game Day" : p.type)}</span><span class="meta">${new Date(p.date + "T12:00:00").toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric", year: "numeric"})}</span>
    <h3 style="margin-top:10px">${esc(p.title)}</h3><p>${esc(p.caption)}</p></div></article>`).join("");
}
$("yr").textContent = new Date().getFullYear();
document.querySelectorAll(".nav nav a").forEach(a => { if (a.getAttribute("href") === (location.pathname.split("/").pop() || "./")) a.classList.add("on"); });
loadGames(); loadPosts();
