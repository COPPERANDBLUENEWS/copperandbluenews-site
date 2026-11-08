// Pre-game pushes: one at 60 minutes and one at 15 minutes before scheduled puck drop.
// Each window is open only briefly. A wake after it closes (or after the game has started) does not send.

export const PREGAME_TYPES = ["pregame_60", "pregame_15"];
// slack: how long after the mark a slightly late alarm/cron may still send. 2 minutes covers the
// once-a-minute cron. 16 minutes before start is already too late for the hour alert.
export const PREGAME_WINDOWS = [
  {type: "pregame_60", minutes: 60, slack: 2, title: "1 hour to puck drop"},
  {type: "pregame_15", minutes: 15, slack: 2, title: "15 minutes to puck drop"},
];
const STARTED = new Set(["LIVE", "CRIT", "OFF", "FINAL"]);

// Same clock text as js/main.js fmtTime + bothTimes (drop :00, MT then PT).
export function viewerTime(iso) {
  const fmt = (tz, label) => new Date(iso).toLocaleTimeString("en-US", {timeZone: tz, hour: "numeric", minute: "2-digit"}).replace(":00", "") + " " + label;
  return `${fmt("America/Edmonton", "MT")} | ${fmt("America/Vancouver", "PT")}`;
}

export function pregameCandidate(g, sinceMs) {
  const start = Date.parse(g?.startTimeUTC);
  if (!Number.isFinite(sinceMs) || !Number.isFinite(start) || start < sinceMs) return false;
  if (g.gameScheduleState !== "OK") return false;
  if (g.homeTeam?.abbrev !== "EDM" && g.awayTeam?.abbrev !== "EDM") return false;
  if (STARTED.has(g.gameState)) return false;
  return true;
}

// state is "early" (window not open yet), "due" (send once), or "late" (skip, including after puck drop).
export function pregameDecision(startMs, now) {
  const remaining = startMs - now;
  return PREGAME_WINDOWS.map(w => {
    let state;
    if (!(remaining > 0)) state = "late";
    else {
      const min = remaining / 60000;
      if (min > w.minutes) state = "early";
      else if (min >= w.minutes - w.slack) state = "due";
      else state = "late";
    }
    return {type: w.type, title: w.title, state};
  });
}

export function dueWindow(startMs, now) {
  const hit = pregameDecision(startMs, now).find(d => d.state === "due");
  return hit ? PREGAME_WINDOWS.find(w => w.type === hit.type) : null;
}

// Next moment the actor must wake so a window is not missed on an otherwise idle day.
export function nextPregameAt(games, sinceMs, now) {
  let next = null;
  for (const g of games || []) {
    if (!pregameCandidate(g, sinceMs)) continue;
    const start = Date.parse(g.startTimeUTC);
    for (const w of PREGAME_WINDOWS) {
      const at = start - w.minutes * 60000;
      if (at > now && (next == null || at < next)) next = at;
    }
  }
  return next;
}

export function pregameEvent(game, window, starter) {
  const away = game.awayTeam?.abbrev || "", home = game.homeTeam?.abbrev || "";
  const matchup = away && home ? `${away} @ ${home}` : "";
  const venue = game.venue?.default || (typeof game.venue === "string" ? game.venue : "");
  const when = viewerTime(game.startTimeUTC);
  const goalie = starter?.name
    ? (starter.status === "Likely" ? `Likely starter: ${starter.name}.` : `Starting goalie: ${starter.name}.`)
    : "";
  return {
    id: `${game.id}:${window.type}`,
    type: window.type,
    title: `${window.title}: ${matchup}`,
    body: `${matchup}${venue ? ` at ${venue}` : ""}. Puck drop ${when}.${goalie ? " " + goalie : ""}`,
    url: `/tracker.html?id=${game.id}`,
    when, starter: starter?.name || "", starterStatus: starter?.status || "", abbrev: matchup,
  };
}

function lastWord(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return parts[parts.length - 1] || "";
}

export function starterFromBox(box) {
  if (!box) return null;
  for (const key of ["homeTeam", "awayTeam"]) {
    if (box[key]?.abbrev !== "EDM") continue;
    const goalies = box.playerByGameStats?.[key]?.goalies || [];
    const st = goalies.find(g => g && g.starter);
    const raw = st?.name?.default || (typeof st?.name === "string" ? st.name : "");
    if (raw.trim()) return {name: raw.trim(), status: "Confirmed"};
  }
  return null;
}

export function starterFromLineup(lineup, gameId) {
  const g = lineup?.game;
  if (!g || String(g.id) !== String(gameId)) return null;
  const gl = lineup.goalie || {};
  const name = gl.starter?.name;
  if (!name || (gl.status !== "Confirmed" && gl.status !== "Likely")) return null;
  return {name, status: gl.status};
}

// NHL boxscore starter flag is official. The site lineup (Confirmed/Likely) fills in before that exists,
// and supplies a full name when it matches the official starter.
export function knownStarter({box, lineup, gameId} = {}) {
  const nhl = starterFromBox(box);
  const projected = starterFromLineup(lineup, gameId);
  if (nhl) {
    const last = lastWord(nhl.name).toLowerCase();
    if (projected && last && projected.name.toLowerCase().includes(last)) return {name: projected.name, status: "Confirmed"};
    return nhl;
  }
  return projected;
}
