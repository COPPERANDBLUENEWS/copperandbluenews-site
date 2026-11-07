// Shared Instagram-article helpers (browser + scripts/build_articles.cjs).
// Headline, caption, markdown and media HTML stay in one place so the live
// article.html?id= page and the generated articles/<id>.html files match.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CBN_ARTICLE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const FEED = "https://feeds.behold.so/KNXU6cCjkvZ3x9dQ0RgI";
  const SITE = "https://copperandbluenews.com";
  const IG = "https://www.instagram.com/copperandbluenews/";
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));

  function stripEmoji(s) {
    return String(s || "")
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/[\uFE0F\u200D\u20E3\u200B\uFEFF]/g, "");
  }
  function cleanLine(line) {
    return stripEmoji(String(line || "").replace(/#[\p{L}\p{N}_]+/gu, " ")).replace(/\s+/g, " ").trim();
  }
  function clip(line, max) {
    if (line.length <= max) return line;
    const cut = line.slice(0, max).replace(/\s+\S*$/, "").trim();
    return (cut || line.slice(0, max).trim()) + "…";
  }
  // First line of the caption. A long line keeps the first sentence, and the
  // sentence after it when the first one is only a short kicker ("GAME DAY!").
  function headline(caption) {
    const lines = String(caption || "").replace(/\u2028|\u2029|\r\n?/g, "\n").split("\n").map(cleanLine).filter(Boolean);
    let h = lines[0] || "";
    if (!h) return "Oilers update";
    if (h.length > 100) {
      const parts = h.match(/.*?[.!?](?=\s|$)/g);
      if (!parts) h = clip(h, 140);
      else {
        let built = "";
        for (const part of parts) {
          const next = (built + part).trim();
          if (!built) { built = part.trim(); if (built.length >= 28) break; continue; }
          if (next.length > 150) break;
          built = next;
          if (built.length >= 28) break;
        }
        h = built || clip(h, 140);
      }
    }
    h = h.replace(/^[\s\-–—|:·•]+/, "").replace(/[\s\-–—|:·•]+$/, "").trim();
    return h || "Oilers update";
  }
  function clampText(s, max) {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max - 1).replace(/\s+\S*$/, "").trim();
    return (cut || t.slice(0, max - 1).trim()) + "…";
  }
  function summary(post, override) {
    const custom = override && override.summary ? stripEmoji(override.summary) : "";
    if (custom.trim()) return clampText(custom, 200);
    const raw = (post && (post.prunedCaption || post.caption)) || "";
    return clampText(cleanLine(String(raw).replace(/\n+/g, " ")), 180);
  }

  function photoCredit(caption) {
    const text = String(caption || "").replace(/\u2028|\u2029|\r\n?/g, "\n");
    const patterns = [
      /(?:photo|image|pic)\s*credit\s*[:\-–]\s*([^\n#]{2,80})/i,
      /(?:^|\n)\s*(?:photo|image|pic)\s*(?:by|:)\s*([^\n#]{2,80})/i,
      /(?:^|\n)\s*credit\s*[:\-–]\s*([^\n#]{2,80})/i,
      /📷\s*([^\n#]{2,80})/,
      /\(\s*(?:photo|pic|image)\s*(?:credit|by|:)\s*([^)#]{2,80})\)/i
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (!m) continue;
      const name = cleanLine(m[1]).replace(/[.,;:\s]+$/, "").trim();
      if (name && name.split(/\s+/).length <= 8) return name;
    }
    return "";
  }

  function parseTime(ts) {
    const d = new Date(String(ts || "").replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
    return isNaN(d.getTime()) ? null : d;
  }
  function timeValue(ts) { const d = parseTime(ts); return d ? d.getTime() : 0; }
  // America/Edmonton: MST (UTC−7) and MDT (UTC−6), second Sunday in March
  // through the first Sunday in November. Computed here so a stale zoneinfo
  // file cannot shift the printed game time by an hour.
  function nthSunday(year, monthIndex, n) {
    const dow = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
    return 1 + ((7 - dow) % 7) + (n - 1) * 7;
  }
  function edmontonOffsetMs(utc) {
    const y = utc.getUTCFullYear();
    const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 9, 0, 0);
    const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 8, 0, 0);
    const t = utc.getTime();
    return (t >= start && t < end) ? -6 * 3600000 : -7 * 3600000;
  }
  function zonedParts(ts) {
    const utc = parseTime(ts);
    if (!utc) return null;
    const local = new Date(utc.getTime() + edmontonOffsetMs(utc));
    return {
      year: String(local.getUTCFullYear()),
      month: String(local.getUTCMonth() + 1).padStart(2, "0"),
      day: String(local.getUTCDate()).padStart(2, "0"),
      hour: String(local.getUTCHours()).padStart(2, "0"),
      minute: String(local.getUTCMinutes()).padStart(2, "0")
    };
  }
  function dateLong(ts) {
    const p = zonedParts(ts);
    if (!p) return "";
    let h = Number(p.hour);
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${MONTHS[Number(p.month) - 1]} ${Number(p.day)}, ${p.year} · ${h}:${p.minute} ${ap} MT`;
  }
  function dateShort(ts) {
    const p = zonedParts(ts);
    if (!p) return "";
    return `${MONTHS_SHORT[Number(p.month) - 1]} ${Number(p.day)}, ${p.year}`;
  }
  function dateISO(ts) { const d = parseTime(ts); return d ? d.toISOString() : ""; }

  function isBehold(u) {
    try {
      const x = new URL(u);
      return x.protocol === "https:" && (x.hostname === "behold.pictures" || x.hostname.endsWith(".behold.pictures"));
    } catch { return false; }
  }
  function allowedVideo(u) {
    try {
      const x = new URL(u);
      if (x.protocol !== "https:") return "";
      const h = x.hostname;
      const ok = h === "behold.pictures" || h.endsWith(".behold.pictures") || h.endsWith(".cdninstagram.com") || h === "cdninstagram.com" || h.endsWith(".fbcdn.net") || h === "instagram.com" || h.endsWith(".instagram.com");
      return ok ? x.href : "";
    } catch { return ""; }
  }
  function safeInstagram(u) {
    try {
      const x = new URL(u);
      if (x.protocol !== "https:") return "";
      if (x.hostname !== "www.instagram.com" && x.hostname !== "instagram.com") return "";
      return x.href;
    } catch { return ""; }
  }
  function imageUrl(obj) {
    const sizes = obj && obj.sizes || {};
    for (const key of ["large", "full", "medium", "small"]) {
      const u = sizes[key] && sizes[key].mediaUrl;
      if (isBehold(u)) return u;
    }
    return "";
  }
  function coverImage(post) {
    return imageUrl(post) || (Array.isArray(post && post.children) && post.children.map(imageUrl).find(Boolean)) || "";
  }
  function beholdSizes(sizes) {
    const out = {};
    if (!sizes || typeof sizes !== "object") return out;
    for (const key of ["small", "medium", "large", "full"]) {
      const s = sizes[key];
      if (!s || !isBehold(s.mediaUrl)) continue;
      out[key] = {mediaUrl: s.mediaUrl, width: Number(s.width) || null, height: Number(s.height) || null};
    }
    return out;
  }
  function normalizeChild(c) {
    if (!c || typeof c !== "object") return null;
    const sizes = beholdSizes(c.sizes);
    const video = c.mediaType === "VIDEO";
    if (!video && !Object.keys(sizes).length) return null;
    return {id: String(c.id || ""), mediaType: video ? "VIDEO" : "IMAGE", altText: String(c.altText || ""), sizes};
  }
  function normalizePost(p) {
    if (!p || !/^\d{8,20}$/.test(String(p.id || ""))) return null;
    const permalink = safeInstagram(p.permalink);
    if (!permalink) return null;
    const type = ["IMAGE", "VIDEO", "CAROUSEL_ALBUM"].includes(p.mediaType) ? p.mediaType : "IMAGE";
    return {
      id: String(p.id),
      timestamp: String(p.timestamp || ""),
      permalink,
      mediaType: type,
      isReel: p.isReel === true,
      caption: String(p.caption || ""),
      prunedCaption: String(p.prunedCaption || ""),
      hashtags: Array.isArray(p.hashtags) ? p.hashtags.map(h => String(h).replace(/^#/, "").trim()).filter(Boolean).slice(0, 40) : [],
      altText: String(p.altText || ""),
      sizes: beholdSizes(p.sizes),
      children: Array.isArray(p.children) ? p.children.map(normalizeChild).filter(Boolean) : []
    };
  }
  function overridesFrom(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw)) {
      if (!/^\d{8,20}$/.test(k) || !v || typeof v !== "object" || Array.isArray(v)) continue;
      out[k] = {
        title: typeof v.title === "string" ? v.title.trim() : "",
        summary: typeof v.summary === "string" ? v.summary.trim() : "",
        feature: v.feature === true,
        body: typeof v.body === "string" ? v.body : ""
      };
    }
    return out;
  }
  function cleanOverride(override) {
    if (!override || typeof override !== "object") return {title: "", summary: "", feature: false, body: ""};
    return {
      title: typeof override.title === "string" ? override.title.trim() : "",
      summary: typeof override.summary === "string" ? override.summary.trim() : "",
      feature: override.feature === true,
      body: typeof override.body === "string" ? override.body : ""
    };
  }

  function inline(raw) {
    const links = [];
    let s = String(raw).replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
      let href = "";
      try {
        const u = new URL(url);
        if (u.protocol === "http:" || u.protocol === "https:") href = u.href;
      } catch { /* ignore bad urls */ }
      if (!href) return text;
      const token = "\u0000L" + links.length + "\u0000";
      links.push(`<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`);
      return token;
    });
    s = esc(s);
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<em>$2</em>");
    s = s.replace(/\u0000L(\d+)\u0000/g, (m, i) => links[Number(i)] || "");
    return s;
  }
  function markdownHtml(md) {
    const blocks = String(md || "").replace(/\r\n?/g, "\n").trim().split(/\n{2,}/);
    return blocks.filter(b => b.trim()).map(block => {
      const lines = block.split("\n");
      if (lines.every(l => /^\s*>\s?/.test(l))) {
        const t = lines.map(l => l.replace(/^\s*>\s?/, "")).join(" ");
        return `<blockquote class="art-pull">${inline(t)}</blockquote>`;
      }
      const h = lines.length === 1 && block.match(/^(#{2,3})\s+(.+)$/);
      if (h) {
        const tag = h[1].length === 2 ? "h2" : "h3";
        return `<${tag}>${inline(h[2].trim())}</${tag}>`;
      }
      if (lines.every(l => /^\s*[-*]\s+\S/.test(l))) {
        return `<ul class="art-list">${lines.map(l => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      return `<p>${inline(lines.join(" ").trim())}</p>`;
    }).join("");
  }
  function captionHtml(post) {
    const source = (post.prunedCaption && String(post.prunedCaption).trim()) ? post.prunedCaption : String(post.caption || "");
    const paras = [];
    for (const line of String(source).replace(/\u2028|\u2029|\r\n?/g, "\n").split("\n")) {
      const t = line.replace(/#[\p{L}\p{N}_]+/gu, " ").replace(/[ \t]{2,}/g, " ").trim();
      if (t) paras.push(`<p>${esc(t)}</p>`);
    }
    const tags = (post.hashtags || []).map(h => "#" + String(h).replace(/^#/, "")).filter(h => h.length > 1);
    const tagHtml = tags.length ? `<p class="art-tags">${esc(tags.join(" "))}</p>` : "";
    return (paras.join("") || "<p>Posted on Instagram.</p>") + tagHtml;
  }

  function slidesOf(post) {
    if (post.mediaType === "CAROUSEL_ALBUM" && Array.isArray(post.children) && post.children.length) {
      return post.children.map(c => ({
        id: String(c.id || ""),
        mediaType: c.mediaType === "VIDEO" ? "VIDEO" : "IMAGE",
        alt: c.altText || post.altText || "",
        poster: imageUrl(c) || imageUrl(post),
        video: c.mediaType === "VIDEO" ? allowedVideo(c.mediaUrl) : ""
      }));
    }
    return [{
      id: String(post.id || ""),
      mediaType: post.mediaType === "VIDEO" ? "VIDEO" : "IMAGE",
      alt: post.altText || "",
      poster: imageUrl(post),
      video: post.mediaType === "VIDEO" ? allowedVideo(post.mediaUrl) : ""
    }];
  }
  function mediaInner(slide, title) {
    const alt = esc(slide.alt || title || "");
    if (slide.mediaType === "VIDEO") {
      const src = slide.video ? ` src="${esc(slide.video)}"` : "";
      const poster = slide.poster ? ` poster="${esc(slide.poster)}"` : "";
      return `<video controls playsinline preload="metadata"${poster}${src} data-ig-video="${esc(slide.id)}"></video>`;
    }
    if (!slide.poster) return `<div class="art-missing">Photo unavailable</div>`;
    return `<img src="${esc(slide.poster)}" alt="${alt}">`;
  }
  function mediaHtml(post, title) {
    const slides = slidesOf(post);
    if (slides.length <= 1) return `<div class="art-media">${mediaInner(slides[0], title)}</div>`;
    const figs = slides.map((s, i) => `<figure class="art-slide${i === 0 ? " on" : ""}">${mediaInner(s, title)}</figure>`).join("");
    return `<div class="art-carousel" data-count="${slides.length}"><div class="art-slides">${figs}</div><div class="art-car-nav"><button type="button" data-car="prev" aria-label="Previous photo">Prev</button><span class="art-car-count">1 / ${slides.length}</span><button type="button" data-car="next" aria-label="Next photo">Next</button></div></div>`;
  }
  function shareHtml(url, title) {
    const tweet = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(title) + "&url=" + encodeURIComponent(url);
    const fb = "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(url);
    return `<div class="art-share" data-share-url="${esc(url)}" data-share-title="${esc(title)}"><button type="button" class="art-share-btn" data-share="native" hidden>Share</button><button type="button" class="art-share-btn" data-share="copy">Copy link</button><a class="art-share-btn" href="${esc(tweet)}" target="_blank" rel="noopener">Post on X</a><a class="art-share-btn" href="${esc(fb)}" target="_blank" rel="noopener">Facebook</a></div>`;
  }

  function articleModel(post, override, preferStatic) {
    const ov = cleanOverride(override);
    const id = String(post.id || "");
    const title = ov.title || headline(post.caption || post.prunedCaption || "");
    const description = summary(post, ov) || "An Edmonton Oilers post from The Copper & Blue News.";
    const image = coverImage(post) || (SITE + "/logo.jpg");
    const url = preferStatic ? `${SITE}/articles/${encodeURIComponent(id)}.html` : `${SITE}/article.html?id=${encodeURIComponent(id)}`;
    return {id, title, description, image, url, published: dateISO(post.timestamp)};
  }
  function articleInner(post, override, shareUrl) {
    const ov = cleanOverride(override);
    const title = ov.title || headline(post.caption || post.prunedCaption || "");
    const when = dateLong(post.timestamp);
    const iso = dateISO(post.timestamp);
    const credit = photoCredit(post.caption || post.prunedCaption || "");
    const body = ov.body.trim() ? markdownHtml(ov.body) : captionHtml(post);
    const dek = ov.summary ? `<p class="art-dek">${esc(clampText(ov.summary, 240))}</p>` : "";
    const feature = ov.feature ? `<span class="badge feature">Feature</span>` : "";
    const permalink = safeInstagram(post.permalink) || IG;
    const time = when ? `<time datetime="${esc(iso)}">${esc(when)}</time>` : "";
    return `<p class="art-kicker"><a class="art-back" href="posts.html">← News</a></p><div class="art-meta">${feature}${time}</div><h1>${esc(title)}</h1>${dek}${mediaHtml(post, title)}${credit ? `<p class="art-credit">Photo: ${esc(credit)}</p>` : ""}<div class="art-body">${body}</div><div class="art-actions"><a class="btn" href="${esc(permalink)}" target="_blank" rel="noopener">View on Instagram</a></div>${shareHtml(shareUrl || (SITE + "/article.html?id=" + encodeURIComponent(post.id || "")), title)}`;
  }
  function featureCardHtml(post, override, href) {
    const ov = cleanOverride(override);
    const title = ov.title || headline(post.caption || post.prunedCaption || "");
    const dek = summary(post, ov);
    const img = coverImage(post);
    const when = dateShort(post.timestamp);
    return `<a class="art-feature-card" href="${esc(href)}"><span class="art-feature-media">${img ? `<img src="${esc(img)}" alt="">` : ""}<span class="badge feature">Feature</span></span><span class="art-feature-body"><span class="ig-date">${esc(when)}</span><h2>${esc(title)}</h2><p>${esc(dek)}</p><span class="more">Read the article →</span></span></a>`;
  }
  function cardHref(id, known) {
    const s = String(id || "");
    if (known && typeof known.has === "function" && known.has(s)) return `articles/${encodeURIComponent(s)}.html`;
    return `article.html?id=${encodeURIComponent(s)}`;
  }
  async function fetchFeed(timeoutMs = 4000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(FEED, {signal: ctl.signal, cache: "no-store", credentials: "omit"});
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      return (Array.isArray(d.posts) ? d.posts : []).filter(p => p && p.id && p.permalink);
    } finally { clearTimeout(t); }
  }

  return {
    FEED, SITE, IG, esc, headline, summary, photoCredit, dateLong, dateShort, dateISO, timeValue,
    imageUrl, coverImage, allowedVideo, normalizePost, overridesFrom, markdownHtml, captionHtml,
    articleModel, articleInner, featureCardHtml, cardHref, fetchFeed
  };
});
