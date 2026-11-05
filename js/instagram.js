// "Latest on Instagram": public, CORS-enabled Behold JSON feed of @thecopperandbluenews, fetched in the
// browser (never cached by the service worker; see sw.js). posts.html: grid + Follow button, and on any
// error/timeout just the Follow button. index.html: 3-post strip, hidden on error.
(() => {
  const FEED = "https://feeds.behold.so/KNXU6cCjkvZ3x9dQ0RgI";
  const IG = "https://www.instagram.com/thecopperandbluenews/";
  const TIMEOUT_MS = 4000;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const safeUrl = u => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : ""; } catch { return ""; } };
  const ICON = {
    VIDEO: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`,
    CAROUSEL_ALBUM: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11a2 2 0 0 1 2 2v11H6a2 2 0 0 1-2-2zM8 3h10a2 2 0 0 1 2 2v10h-2V5H8z"/></svg>`
  };
  const caption = s => {
    const chars = Array.from(String(s || "").replace(/\u2028|\u2029|\r\n?/g, "\n").trim());
    const cut = chars.length > 120 ? chars.slice(0, 120).join("").replace(/\s+\S*$/, "") + "…" : chars.join("");
    return esc(cut); // shown with white-space: pre-line, so \n (and U+2028) become line breaks
  };
  const img = p => safeUrl(p.mediaType === "VIDEO" ? (p.sizes?.medium?.mediaUrl || p.thumbnailUrl) : (p.sizes?.medium?.mediaUrl || p.mediaUrl || p.thumbnailUrl));
  const date = ts => { const d = new Date(String(ts || "").replace(/([+-]\d\d)(\d\d)$/, "$1:$2")); return isNaN(d) ? "" : d.toLocaleDateString("en-US", {timeZone: "America/Edmonton", month: "short", day: "numeric", year: "numeric"}); };
  const card = p => {
    const href = safeUrl(p.permalink) || IG, src = img(p), kind = ICON[p.mediaType] ? p.mediaType : "";
    const label = kind === "VIDEO" ? "Video" : kind === "CAROUSEL_ALBUM" ? "Carousel" : "Photo";
    return `<a class="ig-card" href="${esc(href)}" target="_blank" rel="noopener" aria-label="${label} on Instagram: ${esc(Array.from(String(p.caption || "")).slice(0, 80).join(""))}">
      <span class="ig-img">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}${kind ? `<span class="ig-badge ${kind === "VIDEO" ? "vid" : "car"}" title="${label}">${ICON[kind]}</span>` : ""}</span>
      <span class="ig-body"><span class="ig-date">${esc(date(p.timestamp))}</span><span class="ig-cap">${caption(p.caption)}</span></span></a>`;
  };
  async function load() {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(FEED, {signal: ctl.signal, cache: "no-store", credentials: "omit"});
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      return (Array.isArray(d.posts) ? d.posts : []).filter(p => p && p.permalink);
    } finally { clearTimeout(t); }
  }
  const follow = `<a class="btn ig-follow" href="${IG}" target="_blank" rel="noopener">Follow @thecopperandbluenews</a>`;
  const grid = document.getElementById("ig"), strip = document.getElementById("ig-strip");
  if (!grid && !strip) return;
  const feed = load();
  if (grid) {
    const box = grid.querySelector(".ig-grid"), foot = grid.querySelector(".ig-foot");
    foot.innerHTML = follow;
    feed.then(posts => {
      const n = +grid.dataset.limit || 12;
      if (!posts.length) throw new Error("empty");
      box.innerHTML = posts.slice(0, n).map(card).join("");
    }).catch(() => { box.remove(); });
  }
  if (strip) {
    feed.then(posts => {
      if (!posts.length) return;
      strip.querySelector(".ig-grid").innerHTML = posts.slice(0, +strip.dataset.limit || 3).map(card).join("");
      strip.hidden = false;
    }).catch(() => {});
  }
})();
