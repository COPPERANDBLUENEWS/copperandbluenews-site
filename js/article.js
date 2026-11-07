// Article page. article.html?id=<post id> renders from the live Behold feed so a
// new Instagram post is readable immediately. articles/<id>.html is the static
// copy (Open Graph tags for link previews); this script only wires share,
// carousels and a fresh video URL there.
(() => {
  const A = globalThis.CBN_ARTICLE;
  const art = document.getElementById("article");
  if (!A || !art) return;

  function bind(root) {
    if (navigator.share) root.querySelectorAll("[data-share=native]").forEach(b => { b.hidden = false; });
    root.querySelectorAll(".art-carousel").forEach(car => {
      const slides = [...car.querySelectorAll(".art-slide")];
      if (slides.length < 2) return;
      let i = Math.max(0, slides.findIndex(s => s.classList.contains("on")));
      const count = car.querySelector(".art-car-count");
      const show = n => {
        i = (n + slides.length) % slides.length;
        slides.forEach((s, idx) => s.classList.toggle("on", idx === i));
        if (count) count.textContent = `${i + 1} / ${slides.length}`;
      };
      car.querySelector("[data-car=prev]")?.addEventListener("click", () => show(i - 1));
      car.querySelector("[data-car=next]")?.addEventListener("click", () => show(i + 1));
    });
    const box = root.querySelector(".art-share");
    if (!box) return;
    const url = box.getAttribute("data-share-url") || location.href;
    const title = box.getAttribute("data-share-title") || document.title;
    box.querySelector("[data-share=copy]")?.addEventListener("click", async e => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = "Copied";
      } catch { btn.textContent = "Copy failed"; }
      setTimeout(() => { btn.textContent = "Copy link"; }, 1600);
    });
    box.querySelector("[data-share=native]")?.addEventListener("click", async () => {
      try { await navigator.share({title, text: title, url}); } catch { /* dismissed */ }
    });
  }

  async function hydrateVideos(root) {
    const nodes = [...root.querySelectorAll("video[data-ig-video]")].filter(v => !v.getAttribute("src"));
    if (!nodes.length) return;
    let posts = [];
    try { posts = await A.fetchFeed(5000); } catch { return; }
    const map = new Map();
    for (const p of posts) {
      if (p.mediaType === "VIDEO" && p.mediaUrl) map.set(String(p.id), p.mediaUrl);
      for (const c of p.children || []) if (c && c.mediaType === "VIDEO" && c.mediaUrl) map.set(String(c.id), c.mediaUrl);
    }
    for (const node of nodes) {
      const src = A.allowedVideo(map.get(node.getAttribute("data-ig-video")));
      if (src) node.src = src;
    }
  }

  async function loadJSON(url) {
    try {
      const r = await fetch(url + "?t=" + Date.now(), {cache: "no-store"});
      if (!r.ok) throw new Error(String(r.status));
      return await r.json();
    } catch { return null; }
  }

  function applyMeta(model) {
    const full = model.title + " | The Copper & Blue News";
    document.title = full;
    const set = (sel, attr, val) => { const el = document.head.querySelector(sel); if (el) el.setAttribute(attr, val); };
    set('meta[name="description"]', "content", model.description);
    set('meta[property="og:title"]', "content", full);
    set('meta[property="og:description"]', "content", model.description);
    set('meta[property="og:url"]', "content", model.url);
    set('meta[property="og:image"]', "content", model.image);
    set('meta[property="og:image:alt"]', "content", model.title);
    set('meta[name="twitter:title"]', "content", full);
    set('meta[name="twitter:description"]', "content", model.description);
    set('meta[name="twitter:image"]', "content", model.image);
    set('link[rel="canonical"]', "href", model.url);
  }

  if (art.hasAttribute("data-static")) {
    bind(art);
    hydrateVideos(art);
    return;
  }

  const id = new URLSearchParams(location.search).get("id") || "";
  const missing = html => { art.innerHTML = html; art.removeAttribute("aria-busy"); };
  if (!/^\d{8,20}$/.test(id)) {
    missing(`<p class="art-kicker"><a class="art-back" href="posts.html">← News</a></p><h1>Article not found</h1><p>That link is missing an Instagram post id.</p>`);
    return;
  }

  (async () => {
    const [livePosts, ovRaw, snap] = await Promise.all([
      A.fetchFeed(6000).catch(() => []),
      loadJSON("data/article-overrides.json"),
      loadJSON("data/articles.json")
    ]);
    const overrides = A.overridesFrom(ovRaw);
    const saved = ((snap && snap.posts) || []).find(p => String(p.id) === id);
    const live = (livePosts || []).find(p => String(p.id) === id);
    const post = live || saved;
    if (!post) {
      missing(`<p class="art-kicker"><a class="art-back" href="posts.html">← News</a></p><h1>Article not found</h1><p>That Instagram post isn't in the feed right now.</p><p><a class="btn" href="https://www.instagram.com/copperandbluenews/" target="_blank" rel="noopener">View on Instagram</a></p>`);
      return;
    }
    const known = new Set(((snap && snap.posts) || []).map(p => String(p.id)));
    const model = A.articleModel(post, overrides[id], known.has(id));
    art.innerHTML = A.articleInner(post, overrides[id], model.url);
    applyMeta(model);
    art.removeAttribute("aria-busy");
    bind(art);
    hydrateVideos(art);
  })();
})();
