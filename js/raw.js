// Pre-Raw / Post-Raw interviews (data/interviews.json).
// The embed iframe is created on click, from a checked video id, on youtube-nocookie.com.
(() => {
  const {$, esc, getJSON} = CBN;
  const YT_ID = /^[A-Za-z0-9_-]{11}$/;
  let playing = null;

  const when = v => {
    if (!v.published) return "Date unavailable";
    const d = new Date(v.published);
    if (Number.isNaN(d.getTime())) return "Date unavailable";
    const date = d.toLocaleDateString("en-US", {timeZone: "America/Edmonton", month: "short", day: "numeric", year: "numeric"});
    if (v.publishedSource !== "rss") return date;
    const time = d.toLocaleTimeString("en-US", {timeZone: "America/Edmonton", hour: "numeric", minute: "2-digit"});
    return `${date} · ${time} MT`;
  };
  const thumb = id => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const watch = id => `https://www.youtube.com/watch?v=${id}`;
  const embed = id => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
  const playIcon = `<span class="raw-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span>`;

  function thumbButton(v) {
    return `<button type="button" class="raw-hit" data-play aria-label="Play ${esc(v.title)}"><span class="raw-thumb"><img alt="" width="480" height="360" loading="lazy" src="${thumb(v.id)}">${playIcon}</span></button>`;
  }

  function stop(card) {
    if (!card || playing !== card) return;
    const media = card.querySelector(".raw-media");
    if (media && card._video) media.innerHTML = thumbButton(card._video);
    playing = null;
  }

  function play(card) {
    const v = card._video;
    if (!v) return;
    if (playing && playing !== card) stop(playing);
    const media = card.querySelector(".raw-media");
    media.innerHTML = `<div class="raw-embed"><iframe title="${esc(v.title)}" src="${embed(v.id)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
    playing = card;
  }

  function cardHTML(v, link) {
    const badge = v.type === "Pre-Raw" ? "pre-raw" : v.type === "Post-Raw" ? "post-raw" : "raw";
    const open = link
      ? `<a class="raw-hit" href="news.html?v=${v.id}#raw"><span class="raw-thumb"><img alt="" width="480" height="360" loading="lazy" src="${thumb(v.id)}">${playIcon}</span></a>`
      : thumbButton(v);
    return `<article class="raw-card" data-type="${esc(v.type)}" data-id="${esc(v.id)}">
      <div class="raw-media">${open}</div>
      <div class="raw-body"><span class="badge ${badge}">${esc(v.type)}</span>
      <h3>${link ? `<a href="news.html?v=${v.id}#raw">${esc(v.title)}</a>` : `<button type="button" class="raw-titlebtn" data-play>${esc(v.title)}</button>`}</h3>
      <time datetime="${esc(v.published || "")}">${esc(when(v))}</time>
      ${link ? "" : `<a class="raw-yt" href="${watch(v.id)}" target="_blank" rel="noopener noreferrer">Watch on YouTube</a>`}
      </div></article>`;
  }

  function bind(grid) {
    grid.querySelectorAll(".raw-card").forEach(card => {
      card.querySelectorAll("[data-play]").forEach(btn => { btn.onclick = () => play(card); });
    });
  }

  function applyFilter(filter) {
    const grid = $("rawGrid"); if (!grid) return;
    let shown = 0;
    grid.querySelectorAll(".raw-card").forEach(card => {
      const show = filter === "all" || card.dataset.type === filter;
      card.hidden = !show;
      if (show) shown++;
      else stop(card);
    });
    const empty = $("rawEmpty");
    if (empty) {
      empty.hidden = shown > 0;
      empty.textContent = filter === "all" ? "No interviews right now." : `No ${filter} interviews in the latest set.`;
    }
    document.querySelectorAll("#rawFilters button").forEach(btn => {
      const on = btn.dataset.filter === filter;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function filterFromHash() {
    if (location.hash === "#pre-raw") return "Pre-Raw";
    if (location.hash === "#post-raw") return "Post-Raw";
    if (location.hash === "#scrum") return "Raw";
    return "all";
  }

  function renderNews(videos) {
    const grid = $("rawGrid");
    const pre = videos.filter(v => v.type === "Pre-Raw").length;
    const post = videos.filter(v => v.type === "Post-Raw").length;
    const raw = videos.filter(v => v.type === "Raw").length;
    const buttons = {all: `All (${videos.length})`, "Pre-Raw": `Pre-Raw (${pre})`, "Post-Raw": `Post-Raw (${post})`, "Raw": `Raw (${raw})`};
    document.querySelectorAll("#rawFilters button").forEach(btn => {
      const label = buttons[btn.dataset.filter];
      if (label) btn.textContent = label;
      btn.onclick = () => {
        const next = btn.dataset.filter === "Pre-Raw" ? "#pre-raw" : btn.dataset.filter === "Post-Raw" ? "#post-raw" : btn.dataset.filter === "Raw" ? "#scrum" : "#raw";
        if (location.hash !== next) location.hash = next;
        else applyFilter(btn.dataset.filter);
      };
    });
    grid.innerHTML = videos.map(v => cardHTML(v, false)).join("");
    grid.querySelectorAll(".raw-card").forEach((card, i) => { card._video = videos[i]; });
    bind(grid);
    applyFilter(filterFromHash());
    const meta = $("rawMeta");
    if (meta) meta.textContent = "Official Edmonton Oilers YouTube channel. Oilers+ is the club’s streaming site; these interviews are the public uploads. Tap a video to play it here.";
    const want = new URLSearchParams(location.search).get("v");
    if (want && YT_ID.test(want)) {
      const card = grid.querySelector(`.raw-card[data-id="${want}"]`);
      if (card) {
        if (card.hidden) applyFilter("all");
        play(card);
        card.scrollIntoView({block: "nearest"});
      }
    }
    window.addEventListener("hashchange", () => {
      if (location.hash === "#fantasy") return;
      applyFilter(filterFromHash());
    });
  }

  function rawOk(title, type) {
    const t = String(title || "");
    const prepost = /(?:^|[^A-Za-z0-9])(pre|post)[\s\-\u2010-\u2015]+raw(?:[^A-Za-z0-9]|$)/i.exec(t);
    if (prepost) return (prepost[1].toLowerCase() === "pre" ? "Pre-Raw" : "Post-Raw") === type;
    const plain = /(?:^|[^A-Za-z0-9])raw[\s]*[|:\-\u2010-\u2015]/i.test(t);
    return plain && type === "Raw";
  }

  function renderHome(videos) {
    const home = $("rawHome"); const grid = $("rawHomeGrid");
    if (!home || !grid || !videos.length) return;
    grid.innerHTML = videos.map(v => cardHTML(v, true)).join("");
    home.hidden = false;
  }

  (async () => {
    const grid = $("rawGrid"); const home = $("rawHomeGrid");
    if (!grid && !home) return;
    let d;
    try { d = await getJSON("data/interviews.json"); }
    catch { if (grid) grid.textContent = "Couldn't load interviews."; return; }
    const videos = (d.videos || []).filter(v => v && YT_ID.test(v.id) && (v.type === "Pre-Raw" || v.type === "Post-Raw" || v.type === "Raw") && rawOk(v.title, v.type));
    if (grid) renderNews(videos);
    if (home) renderHome(videos.slice(0, 3));
  })();

})();
