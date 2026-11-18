// "Latest on Instagram" / Home "Latest posts": public Behold JSON feed of
// @copperandbluenews, same source as the News → Posts grid.
// Cards open that post's article. Once scripts/build_articles.cjs has published
// articles/<id>.html, the card uses that URL (Open Graph preview). Until then
// the card uses article.html?id=<id>, which renders the live feed. A featured
// write-up in data/article-overrides.json gets the large card on News.
// Home: six newest posts under Next Game (image + caption snippet). The section
// stays hidden when both the live feed and data/articles.json fail. Both reads
// use cache: "no-store"; the service worker treats data/articles.json as
// network-first, so a new post is not stuck on an old app cache.
(() => {
  const A = globalThis.CBN_ARTICLE;
  if (!A) return;
  const IG = "https://www.instagram.com/copperandbluenews/";
  const esc = A.esc;
  const ICON = {
    VIDEO: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`,
    CAROUSEL_ALBUM: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11a2 2 0 0 1 2 2v11H6a2 2 0 0 1-2-2zM8 3h10a2 2 0 0 1 2 2v10h-2V5H8z"/></svg>`
  };
  const follow = `<a class="btn ig-follow" href="${IG}" target="_blank" rel="noopener">Follow @copperandbluenews</a>`;
  async function loadJSON(url) {
    try {
      const r = await fetch(url + "?t=" + Date.now(), {cache: "no-store"});
      if (!r.ok) throw new Error(String(r.status));
      return await r.json();
    } catch { return null; }
  }
  function card(p, overrides, known, mode) {
    const ov = overrides[String(p.id)] || {};
    const title = ov.title || A.headline(p.caption || p.prunedCaption || "");
    const text = mode === "snippet" ? (ov.title || A.summary(p, ov) || title) : title;
    const href = A.cardHref(p.id, known);
    const src = A.coverImage(p);
    const kind = ICON[p.mediaType] ? p.mediaType : "";
    const label = kind === "VIDEO" ? "Video" : kind === "CAROUSEL_ALBUM" ? "Carousel" : "Photo";
    const feature = ov.feature ? `<span class="badge feature ig-feature-badge">Feature</span>` : "";
    const loading = mode === "snippet" ? "eager" : "lazy";
    return `<a class="ig-card" href="${esc(href)}"><span class="ig-img">${src ? `<img src="${esc(src)}" alt="" loading="${loading}" decoding="async" referrerpolicy="no-referrer">` : ""}${feature}${kind ? `<span class="ig-badge ${kind === "VIDEO" ? "vid" : "car"}" title="${label}">${ICON[kind]}</span>` : ""}</span><span class="ig-body"><span class="ig-date">${esc(A.dateShort(p.timestamp))}</span><span class="ig-cap">${esc(text)}</span></span></a>`;
  }

  const grid = document.getElementById("ig");
  const strip = document.getElementById("ig-strip");
  const featureEl = document.getElementById("ig-feature");
  if (!grid && !strip && !featureEl) return;
  if (grid) {
    const foot = grid.querySelector(".ig-foot");
    if (foot) foot.innerHTML = follow;
  }

  (async () => {
    const overrides = A.overridesFrom(await loadJSON("data/article-overrides.json"));
    const wantFeature = !!(featureEl && Object.values(overrides).some(o => o.feature));
    if (!grid && !strip && !wantFeature) return;
    const [live, snap] = await Promise.all([
      A.fetchFeed(4000).catch(() => null),
      loadJSON("data/articles.json")
    ]);
    const known = new Set(((snap && snap.posts) || []).map(p => String(p.id)));
    const snapPosts = ((snap && snap.posts) || []).map(A.normalizePost).filter(Boolean);
    const livePosts = Array.isArray(live) ? live.filter(p => p && p.id && p.permalink) : [];
    const gridSource = livePosts.length ? livePosts : snapPosts;
    const seen = new Set();
    const heroPool = [];
    for (const p of [...livePosts, ...snapPosts]) {
      const id = String(p.id);
      if (seen.has(id)) continue;
      seen.add(id);
      heroPool.push(p);
    }
    const hero = heroPool
      .filter(p => overrides[String(p.id)] && overrides[String(p.id)].feature)
      .sort((a, b) => A.timeValue(b.timestamp) - A.timeValue(a.timestamp))[0] || null;

    if (featureEl) {
      if (hero) {
        featureEl.innerHTML = A.featureCardHtml(hero, overrides[String(hero.id)], A.cardHref(hero.id, known));
        featureEl.hidden = false;
      } else {
        featureEl.hidden = true;
        featureEl.innerHTML = "";
      }
    }
    const byNewest = (a, b) => A.timeValue(b.timestamp) - A.timeValue(a.timestamp) || String(b.id).localeCompare(String(a.id));
    const paint = (el, limit, mode) => {
      const box = el.querySelector(".ig-grid");
      if (!box) return;
      let list = gridSource;
      if (hero && featureEl && el.id === "ig") list = list.filter(p => String(p.id) !== String(hero.id));
      list = list.slice().sort(byNewest);
      if (!list.length) {
        if (el.id === "ig") box.remove();
        return;
      }
      box.innerHTML = list.slice(0, limit).map(p => card(p, overrides, known, mode)).join("");
      if (el.hidden) el.hidden = false;
    };
    if (grid) paint(grid, +grid.dataset.limit || 12);
    if (strip && gridSource.length) paint(strip, +strip.dataset.limit || 6, "snippet");
  })();
})();
