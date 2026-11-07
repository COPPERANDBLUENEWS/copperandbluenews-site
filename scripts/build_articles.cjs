// Pull the public Behold feed and write data/articles.json plus articles/<id>.html.
// Runs from news.yml (hourly) and site.yml (every push and every 3 hours).
// A feed failure keeps the last good files so a deploy never wipes articles.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const A = require('../js/article-render.js');

const root = path.resolve(__dirname, '..');
const KEEP = 48;

function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escText(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function setMeta(html, attr, name, value) {
  const re = new RegExp('(<meta\\s+' + attr + '="' + name + '"\\s+content=")[^"]*(")');
  if (!re.test(html)) throw new Error('missing meta ' + attr + '=' + name);
  return html.replace(re, (_, a, b) => a + escAttr(value) + b);
}
function prefixRelative(html) {
  return html.replace(/(^|[\s])(href|src)="([^"]*)"/g, (m, pre, attr, url) => {
    if (!url || /^(https?:)?\/\//.test(url) || url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('../') || url.startsWith('/')) return m;
    const rest = url.startsWith('./') ? url.slice(2) : url;
    return pre + attr + '="../' + rest + '"';
  });
}
function fillDocument(template, post, override) {
  const model = A.articleModel(post, override, true);
  const inner = A.articleInner(post, override, model.url);
  const article = `<article class="art" id="article" data-static="1" data-id="${A.esc(model.id)}">\n${inner}\n</article>`;
  let html = template.replace(/<article class="art" id="article"[\s\S]*?<\/article>/, article);
  const full = model.title + ' | The Copper & Blue News';
  html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + escText(model.title) + ' | The Copper &amp; Blue News</title>');
  html = setMeta(html, 'name', 'description', model.description);
  html = setMeta(html, 'property', 'og:title', full);
  html = setMeta(html, 'property', 'og:description', model.description);
  html = setMeta(html, 'property', 'og:url', model.url);
  html = setMeta(html, 'property', 'og:image', model.image);
  html = setMeta(html, 'property', 'og:image:alt', model.title);
  html = setMeta(html, 'name', 'twitter:title', full);
  html = setMeta(html, 'name', 'twitter:description', model.description);
  html = setMeta(html, 'name', 'twitter:image', model.image);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, (_, a, b) => a + escAttr(model.url) + b);
  if (model.published && !html.includes('article:published_time')) {
    html = html.replace('</head>', '<meta property="article:published_time" content="' + escAttr(model.published) + '">\n</head>');
  }
  return prefixRelative(html);
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeIfChanged(file, text) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (prev === text) return false;
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, text);
  return true;
}

async function build() {
  let fresh = [];
  try {
    fresh = (await A.fetchFeed(15000)).map(A.normalizePost).filter(Boolean);
  } catch (err) {
    console.error('Behold feed unavailable, keeping existing articles.', err && err.message);
    return;
  }
  if (!fresh.length) {
    console.error('Behold feed empty, keeping existing articles.');
    return;
  }
  const dataPath = path.join(root, 'data', 'articles.json');
  const prev = readJSON(dataPath, {posts: []});
  const overrides = A.overridesFrom(readJSON(path.join(root, 'data', 'article-overrides.json'), {}));
  const map = new Map();
  for (const p of prev.posts || []) {
    const n = A.normalizePost(p);
    if (n) map.set(n.id, n);
  }
  for (const p of fresh) map.set(p.id, p);
  const posts = [...map.values()]
    .sort((a, b) => A.timeValue(b.timestamp) - A.timeValue(a.timestamp) || String(b.id).localeCompare(String(a.id)))
    .slice(0, KEEP);

  const template = fs.readFileSync(path.join(root, 'article.html'), 'utf8');
  const dir = path.join(root, 'articles');
  fs.mkdirSync(dir, {recursive: true});
  const keep = new Set(posts.map(p => p.id + '.html'));
  let pages = 0;
  for (const post of posts) {
    const html = fillDocument(template, post, overrides[post.id]);
    if (writeIfChanged(path.join(dir, post.id + '.html'), html)) pages++;
  }
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.html') && !keep.has(name)) fs.unlinkSync(path.join(dir, name));
  }
  const samePosts = JSON.stringify(prev.posts || []) === JSON.stringify(posts);
  if (!samePosts) {
    const data = {updated: new Date().toISOString(), posts};
    writeIfChanged(dataPath, JSON.stringify(data, null, 1) + '\n');
  }
  console.log(`Articles: ${posts.length} posts, ${pages} pages rewritten.`);
}

module.exports = {fillDocument, prefixRelative, build};
if (require.main === module) {
  build().catch(err => { console.error(err); process.exit(1); });
}
