// The NHL API (api-web.nhle.com) sends no CORS headers (tested Nov 4 2026), so the
// browser can't read it directly. We try it anyway, then fall back to data.json,
// which scripts/update_data.py generates.
const API = "https://api-web.nhle.com/v1";
const $ = id => document.getElementById(id);
const fmtTime = (iso, tz, label) => new Date(iso).toLocaleTimeString("en-US", {timeZone: tz, hour: "numeric", minute: "2-digit"}).replace(":00", "") + " " + label;
const fmtDate = iso => new Date(iso).toLocaleDateString("en-US", {timeZone: "America/Edmonton", weekday: "short", month: "short", day: "numeric"});
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function matchup(g) {
  const home = g.home.abbrev === "EDM";
  const opp = home ? g.away : g.home;
  return {home, opp, oppName: opp.name || opp.abbrev};
}
function renderNext(g) {
  const el = $("next")?.querySelector(".body"); if (!el) return;
  if (!g) { el.textContent = "No upcoming games scheduled."; return; }
  const m = matchup(g);
  el.innerHTML = `<div class="match">Oilers <span class="vs">${m.home ? "vs" : "@"}</span> ${esc(m.oppName)}</div>
    <div class="meta">${fmtDate(g.startTimeUTC)} · ${fmtTime(g.startTimeUTC, "America/Edmonton", "MT")} | ${fmtTime(g.startTimeUTC, "America/Vancouver", "PT")}<br>${esc(g.venue)}</div>`;
}
function renderLast(g) {
  const el = $("last")?.querySelector(".body"); if (!el) return;
  if (!g) { el.textContent = "No games played yet."; return; }
  const m = matchup(g), edm = m.home ? g.home : g.away;
  const win = edm.score > m.opp.score, lp = g.lastPeriod;
  const label = win ? "W" : lp === "SO" ? "SOL" : lp === "OT" ? "OTL" : "L";
  const extra = win && lp && lp !== "REG" ? ` (${lp})` : "";
  el.innerHTML = `<div class="big ${win ? "w" : "l"}">${label} ${edm.score}-${m.opp.score}${extra}</div>
    <div class="meta">Oilers ${m.home ? "vs" : "@"} ${esc(m.oppName)} · ${fmtDate(g.startTimeUTC)}<br>${esc(g.venue)}</div>`;
}
function renderStandings(s) {
  const el = $("standings")?.querySelector(".body"); if (!el) return;
  if (!s) { el.textContent = "Standings unavailable."; return; }
  el.innerHTML = `<div class="big">${s.wins}-${s.losses}-${s.otLosses}</div>
    <div class="meta">${s.points} PTS in ${s.gamesPlayed} GP · ${ordinal(s.divisionSequence)} in ${esc(s.divisionName)}${s.streakCode ? ` · Streak ${s.streakCode}${s.streakCount}` : ""}</div>`;
}
const ordinal = n => n + (["th","st","nd","rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || "th");

async function liveData() {
  const sched = await (await fetch(`${API}/club-schedule-season/EDM/now`)).json();
  const done = g => ["OFF", "FINAL"].includes(g.gameState);
  const side = t => ({abbrev: t.abbrev, name: t.commonName?.default || t.abbrev, score: t.score});
  const norm = g => g && {startTimeUTC: g.startTimeUTC, venue: g.venue?.default, lastPeriod: g.gameOutcome?.lastPeriodType, away: side(g.awayTeam), home: side(g.homeTeam)};
  const played = sched.games.filter(done);
  return {next: norm(sched.games.find(g => !done(g))), last: norm(played[played.length - 1]), standings: null, live: true};
}
async function loadGames() {
  if (!$("next")) return;
  let d;
  try { d = await liveData(); } catch (e) { d = await (await fetch("data.json", {cache: "no-cache"})).json(); }
  renderNext(d.next); renderLast(d.last); renderStandings(d.standings);
  if (d.updated) $("updated").textContent = "Updated " + new Date(d.updated).toLocaleString("en-US", {timeZone: "America/Edmonton", dateStyle: "medium", timeStyle: "short"}) + " MT";
}
async function loadPosts() {
  const feed = $("feed"); if (!feed) return;
  const posts = (await (await fetch("posts.json", {cache: "no-cache"})).json()).sort((a, b) => b.date.localeCompare(a.date));
  const limit = +feed.dataset.limit || posts.length;
  feed.innerHTML = posts.slice(0, limit).map(p => `<article class="post">
    ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy">` : ""}
    <div class="pb"><span class="badge ${esc(p.type)}">${esc(p.type === "gameday" ? "Game Day" : p.type)}</span><span class="meta">${new Date(p.date + "T12:00:00").toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric", year: "numeric"})}</span>
    <h3 style="margin-top:10px">${esc(p.title)}</h3><p>${esc(p.caption)}</p></div></article>`).join("");
}
$("yr").textContent = new Date().getFullYear();
loadGames(); loadPosts();
