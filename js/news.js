(async () => {
  const {$, esc, getJSON} = CBN;
  let d; try { d = await getJSON("data/news.json"); } catch { $("news").textContent = "Couldn't load news."; return; }
  const ago = t => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const when = t => new Date(t).toLocaleString(undefined, {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"});
  $("nUpdated").textContent = `Updated ${ago(d.updated)} · refreshed hourly`;
  $("news").innerHTML = d.items.length ? d.items.map(x => `<a class="card news-item" href="${esc(x.url)}" target="_blank" rel="noopener">
    <div class="meta"><b>${esc(x.source)}</b> · <time datetime="${esc(x.published)}">${when(x.published)}</time></div>
    <h3>${esc(x.title)}</h3>${x.snippet ? `<p class="snip">${esc(x.snippet)}</p>` : ""}</a>`).join("") : "<p>No news right now.</p>";
})();
