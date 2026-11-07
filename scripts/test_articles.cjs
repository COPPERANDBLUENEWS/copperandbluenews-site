// Headline, caption, markdown, media and static Open Graph page.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../js/article-render.js');
const {fillDocument} = require('./build_articles.cjs');

const gameDay = "GAME DAY! The Canucks visit Rogers Place tonight for Hockey Fights Cancer Night. Edmonton enters at 11–3–3, while Vancouver is 3–14–1 and looking to stop a four-game slide. #LetsGoOilers #NHL";
assert.equal(A.headline(gameDay), "GAME DAY! The Canucks visit Rogers Place tonight for Hockey Fights Cancer Night.");
assert.equal(A.headline("Never miss an Oilers goal again 🚨🛢️\nGame alerts are live."), "Never miss an Oilers goal again");
assert.equal(A.headline("GAME DAY: Canucks @ Oilers 🛢️\nTwo straight losses."), "GAME DAY: Canucks @ Oilers");
assert.equal(A.headline("5–4 DUCKS.\nIt was 1–1 after one."), "5–4 DUCKS.");
assert.equal(A.headline("4–2 DUCKS AFTER TWO.\nIt was 1–1 after one."), "4–2 DUCKS AFTER TWO.");
assert.equal(A.headline("#Oilers #LetsGoOilers\nOnly the second line."), "Only the second line.");
assert.equal(A.headline(""), "Oilers update");
assert.equal(A.headline("Goal. #Oilers #LetsGoOilers"), "Goal.");

const credited = {
  id: "17876886240637345",
  permalink: "https://www.instagram.com/p/Dfch2rCBaR0/",
  timestamp: "2026-11-07T15:45:01+0000",
  mediaType: "IMAGE",
  caption: "Night at Rogers Place.\nPhoto credit: Alex Morgan\n#Oilers #LetsGoOilers",
  prunedCaption: "Night at Rogers Place.\nPhoto credit: Alex Morgan",
  hashtags: ["Oilers", "LetsGoOilers"],
  sizes: {large: {mediaUrl: "https://behold.pictures/example.jpg?class=originalLarge", width: 800, height: 1000}}
};
assert.equal(A.photoCredit(credited.caption), "Alex Morgan");
const auto = A.articleInner(credited, null, "https://copperandbluenews.com/articles/17876886240637345.html");
assert.match(auto, /Photo: Alex Morgan/);
assert.match(auto, /Night at Rogers Place\./);
assert.match(auto, /class="art-tags">#Oilers #LetsGoOilers/);
assert.doesNotMatch(auto.split("art-tags")[0], /#Oilers/);
assert.match(auto, /behold\.pictures\/example\.jpg/);
assert.match(auto, /View on Instagram/);
assert.match(auto, /data-share-url="https:\/\/copperandbluenews\.com\/articles\/17876886240637345\.html"/);

const nasty = {...credited, caption: "<script>alert(1)</script>\nPhoto: Sam", prunedCaption: "<script>alert(1)</script>\nPhoto: Sam", hashtags: []};
assert.match(A.articleInner(nasty, null, "https://copperandbluenews.com/article.html?id=17876886240637345"), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(A.articleInner(nasty, null, "https://copperandbluenews.com/a"), /<script>alert/);

const writeup = {
  title: "SAMPLE: Ducks take Rogers Place",
  summary: "SAMPLE deck for the feature card.",
  feature: true,
  body: "Opening paragraph.\n\n## The second period\n\nThey chased the game.\n\n> SAMPLE pull quote stays in the article.\n\n- McDavid had four points\n- The kill was 6-for-8\n\nSee [the site](https://copperandbluenews.com/news.html) and [nope](javascript:alert(1))."
};
const featured = A.articleInner(credited, writeup, "https://copperandbluenews.com/articles/17876886240637345.html");
assert.match(featured, /<h1>SAMPLE: Ducks take Rogers Place<\/h1>/);
assert.match(featured, /class="badge feature"/);
assert.match(featured, /<h2>The second period<\/h2>/);
assert.match(featured, /<blockquote class="art-pull">SAMPLE pull quote stays in the article\.<\/blockquote>/);
assert.match(featured, /<li>McDavid had four points<\/li>/);
assert.match(featured, /href="https:\/\/copperandbluenews\.com\/news\.html"/);
assert.doesNotMatch(featured, /javascript:/);
assert.match(featured, /Photo: Alex Morgan/);
assert.doesNotMatch(featured, /Night at Rogers Place/);
assert.match(A.featureCardHtml(credited, writeup, "articles/17876886240637345.html"), /SAMPLE: Ducks take Rogers Place/);
assert.match(A.featureCardHtml(credited, writeup, "articles/17876886240637345.html"), /SAMPLE deck/);

const carousel = {
  ...credited,
  mediaType: "CAROUSEL_ALBUM",
  children: [
    {id: "c1", mediaType: "IMAGE", sizes: {large: {mediaUrl: "https://behold.pictures/one.jpg", width: 800, height: 800}}, altText: "First"},
    {id: "c2", mediaType: "VIDEO", mediaUrl: "https://scontent.cdninstagram.com/v/video.mp4", sizes: {large: {mediaUrl: "https://behold.pictures/two.jpg", width: 800, height: 800}}}
  ]
};
const slides = A.articleInner(carousel, null, "https://copperandbluenews.com/articles/17876886240637345.html");
assert.match(slides, /art-carousel/);
assert.match(slides, /behold\.pictures\/one\.jpg/);
assert.match(slides, /behold\.pictures\/two\.jpg/);
assert.match(slides, /<video[^>]*data-ig-video="c2"/);
assert.match(slides, /src="https:\/\/scontent\.cdninstagram\.com\/v\/video\.mp4"/);
assert.match(slides, /Previous photo/);

const video = {...credited, mediaType: "VIDEO", mediaUrl: "https://evil.example/v.mp4"};
assert.doesNotMatch(A.articleInner(video, null, "https://copperandbluenews.com/a"), /evil\.example/);
assert.match(A.articleInner({...video, mediaUrl: "https://scontent-ord5-2.cdninstagram.com/v/clip.mp4"}, null, "https://copperandbluenews.com/a"), /cdninstagram\.com\/v\/clip\.mp4/);

const norm = A.normalizePost({...carousel, mediaUrl: "https://scontent.cdninstagram.com/pic.jpg"});
assert.equal(norm.mediaUrl, undefined);
assert.equal(norm.children[1].mediaUrl, undefined);
assert.equal(norm.sizes.large.mediaUrl, credited.sizes.large.mediaUrl);
assert.equal(A.normalizePost({id: "12", permalink: "https://www.instagram.com/p/x/"}), null);
assert.equal(A.normalizePost({id: "17876886240637345", permalink: "javascript:alert(1)"}), null);
assert.deepEqual(A.overridesFrom({"note": {title: "no"}, "17876886240637345": {title: "Yes", feature: "yes", body: 5}}), {"17876886240637345": {title: "Yes", summary: "", feature: false, body: ""}});
assert.equal(A.cardHref("17876886240637345", new Set(["17876886240637345"])), "articles/17876886240637345.html");
assert.equal(A.cardHref("17876886240637345", new Set()), "article.html?id=17876886240637345");
assert.equal(A.dateShort("2026-11-07T15:45:01+0000"), "Nov 7, 2026");
assert.equal(A.dateLong("2026-11-07T15:45:01+0000"), "November 7, 2026 · 8:45 AM MT");
assert.equal(A.dateLong("2026-07-15T18:00:00+0000"), "July 15, 2026 · 12:00 PM MT");
assert.equal(A.dateLong("2026-03-08T08:30:00+0000"), "March 8, 2026 · 1:30 AM MT");
assert.equal(A.dateLong("2026-03-08T09:00:00+0000"), "March 8, 2026 · 3:00 AM MT");
assert.equal(A.dateLong("2026-11-01T07:30:00+0000"), "November 1, 2026 · 1:30 AM MT");
assert.equal(A.dateLong("2026-11-01T08:00:00+0000"), "November 1, 2026 · 1:00 AM MT");

const template = fs.readFileSync(path.join(__dirname, "..", "article.html"), "utf8");
const page = fillDocument(template, credited, writeup);
assert.match(page, /<title>SAMPLE: Ducks take Rogers Place \| The Copper &amp; Blue News<\/title>/);
assert.match(page, /property="og:title" content="SAMPLE: Ducks take Rogers Place \| The Copper &amp; Blue News"/);
assert.match(page, /property="og:description" content="SAMPLE deck for the feature card\."/);
assert.match(page, /property="og:url" content="https:\/\/copperandbluenews\.com\/articles\/17876886240637345\.html"/);
assert.match(page, /property="og:image" content="https:\/\/behold\.pictures\/example\.jpg\?class=originalLarge"/);
assert.match(page, /name="twitter:card" content="summary_large_image"/);
assert.match(page, /name="twitter:image" content="https:\/\/behold\.pictures\/example\.jpg\?class=originalLarge"/);
assert.match(page, /rel="canonical" href="https:\/\/copperandbluenews\.com\/articles\/17876886240637345\.html"/);
assert.match(page, /article:published_time/);
assert.match(page, /href="\.\.\/css\/style\.css\?v=45"/);
assert.match(page, /src="\.\.\/js\/article\.js\?v=45"/);
assert.match(page, /href="\.\.\/posts\.html"/);
assert.match(page, /href="\.\.\/#newsletter"/);
assert.doesNotMatch(page, /href="\.\.\/https/);
assert.match(page, /data-static="1"/);
assert.match(page, /63f156cfaaad47ffac9a9a15053e67a8/);
assert.match(page, /class="tabbar"/);

console.log("article tests ok");
