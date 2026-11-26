// Pre-Raw / Post-Raw interview pushes.
// The news job POSTs the whole data/interviews.json list. Video ids already in KV
// (iv:seen) are never sent again. The first time that key is missing, a large
// list is the library already on the site: it is recorded and nothing is sent.
// One new upload is its own alert. Several of the same type in one batch are
// one alert, so a post-game scrum does not stack a notification per player.

export const INTERVIEW_TYPE = "interviews";
export const MAX_AGE_MS = 72 * 3600 * 1000;
export const BASELINE_CAP = 8;
export const SEEN_CAP = 400;

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const RAW_PREFIX = /^(?:(?:pre|post)[\s\-\u2010-\u2015]+)?raw\b\s*[:|\u2013\u2014-]?\s*/i;
const TITLE_DATE = /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g;

export function interviewName(title, full = false) {
  let s = String(title || "").replace(RAW_PREFIX, "");
  s = s.replace(TITLE_DATE, "").replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "Oilers";
  const parts = s.split(" ");
  return full ? parts.join(" ") : parts[parts.length - 1];
}

export function normalizeVideos(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [], seen = new Set();
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const id = typeof v.id === "string" ? v.id.trim() : "";
    if (!YT_ID.test(id) || seen.has(id)) continue;
    if (v.type !== "Pre-Raw" && v.type !== "Post-Raw" && v.type !== "Raw") continue;
    const title = String(v.title || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
    if (!title) continue;
    seen.add(id);
    out.push({
      id, type: v.type, title,
      published: typeof v.published === "string" ? v.published.slice(0, 40) : "",
    });
    if (out.length >= 80) break;
  }
  return out;
}

function freshEnough(video, now, maxAgeMs) {
  const t = Date.parse(video.published || "");
  if (Number.isNaN(t)) return false;
  const age = now - t;
  return age >= -5 * 60 * 1000 && age <= maxAgeMs;
}

export function nextSeenIds(previous, videos, cap = SEEN_CAP) {
  const out = [], have = new Set();
  const add = id => {
    if (!id || have.has(id) || out.length >= cap) return;
    have.add(id);
    out.push(id);
  };
  for (const v of videos) add(v.id);
  for (const id of previous || []) add(id);
  return out;
}

function fnv32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function oneAlert(v) {
  const name = interviewName(v.title, true);
  return {
    id: `interview:${v.id}`,
    type: INTERVIEW_TYPE,
    title: `${v.type}: ${name}`.slice(0, 120),
    body: v.title.slice(0, 300),
    url: `/news.html?v=${v.id}#raw-${v.id}`,
    matchup: "Interviews",
    detail: {
      kind: "interview", interviewType: v.type, videoId: v.id, name,
      youtube: `https://www.youtube.com/watch?v=${v.id}`, count: 1,
    },
  };
}

function groupAlert(type, list) {
  const names = list.map(v => interviewName(v.title, false));
  const shown = names.slice(0, 8);
  const more = names.length - shown.length;
  const who = shown.join(", ") + (more > 0 ? ` +${more}` : "");
  const line = `${list.length} new ${type} interviews: ${who}`;
  const ids = list.map(v => v.id).sort();
  const kind = type === "Pre-Raw" ? "pre" : type === "Post-Raw" ? "post" : "raw";
  return {
    id: `interview:${kind}:${list.length}:${fnv32(ids.join(","))}`,
    type: INTERVIEW_TYPE,
    title: (line.length <= 120 ? line : `${list.length} new ${type} interviews`).slice(0, 120),
    body: who.slice(0, 300),
    url: "/news.html#raw",
    matchup: "Interviews",
    detail: {kind: "interview_batch", interviewType: type, count: list.length, names: shown},
  };
}

export function buildAlerts(videos) {
  const groups = new Map();
  for (const v of videos) {
    if (!groups.has(v.type)) groups.set(v.type, []);
    groups.get(v.type).push(v);
  }
  const alerts = [];
  for (const [type, list] of groups) alerts.push(list.length === 1 ? oneAlert(list[0]) : groupAlert(type, list));
  return alerts;
}

export function sameIds(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * seenIds null: the Worker has never stored interview ids.
 * notifyIds: ids the pipeline believes are new. null means "diff against seen"
 * (and, on first contact, send nothing).
 */
export function planInterviewAlerts(videos, seenIds, opts = {}) {
  const now = opts.now ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? MAX_AGE_MS;
  const baselineCap = opts.baselineCap ?? BASELINE_CAP;
  const bootstrapping = !Array.isArray(seenIds);
  const seenList = bootstrapping ? [] : seenIds;
  const seen = new Set(seenList);
  let requested;
  if (Array.isArray(opts.notifyIds)) {
    const want = new Set(opts.notifyIds.filter(id => typeof id === "string"));
    requested = videos.filter(v => want.has(v.id) && !seen.has(v.id));
  } else if (bootstrapping) {
    requested = [];
  } else {
    requested = videos.filter(v => !seen.has(v.id));
  }
  const recent = requested.filter(v => freshEnough(v, now, maxAgeMs));
  const suppress = bootstrapping && recent.length >= baselineCap;
  const fresh = suppress ? [] : recent;
  return {
    bootstrap: bootstrapping && fresh.length === 0,
    suppressed: suppress ? recent.length : 0,
    fresh,
    alerts: buildAlerts(fresh),
    nextSeen: nextSeenIds(seenList, videos),
  };
}
