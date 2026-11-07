# The Copper & Blue News

Static fan site for [@copperandbluenews](https://www.instagram.com/copperandbluenews/). Plain HTML/CSS/JS, no build step.
Fan run. Not affiliated with the Edmonton Oilers or the NHL. Don't add official NHL/Oilers logos.

## Files
- `index.html`, `schedule.html`, `scores.html`, `players.html`, `cap.html`, `player.html?id=PLAYERID`, `game.html?id=GAMEID` (box score), `tracker.html` (Live rink tracker, see below), `play.html` (AirHockey with Copper), `stats.html`, `posts.html`, `history.html` (timeline from `data/history.json`, hand-curated with a source link per entry), `about.html`: pages
- `css/style.css`, `js/main.js`: styles and scripts
- `posts.json`: the posts feed (newest first by `date`)
- `data.json`: next game, latest result and standings (generated)
- `scripts/update_data.py`: rebuilds `data.json` from the NHL API
- `.nojekyll` turns off Jekyll.

> **Custom domain:** the `CNAME` file was removed until copperandbluenews.com is bought. Once DNS is set up, add back a file named `CNAME` containing `copperandbluenews.com` (or set it in Settings > Pages).
- `logo.jpg`, `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`, `images/`

## Adding a post
Put the graphic in `images/`, then add an entry to `posts.json`:
```json
{"title": "Final: Oilers 4, Ducks 2", "date": "2026-11-05", "type": "final",
 "image": "images/final-2026-11-05.jpg", "caption": "..."}
```
`type` is `gameday`, `final`, or `recap`.

## Game data (CORS)
The NHL API (`api-web.nhle.com`) sends **no `Access-Control-Allow-Origin` header** (tested Nov 4, 2026), so
browsers can't call it. `scripts/update_data.py` (standard library only) fetches it and writes static JSON:
`data.json` (home cards), `data/schedule.json`, `data/stats.json`, `data/standings.json` (league table), `data/leaders.json` (NHL skater and goalie leaders), `data/roster.json`, `data/players/<id>.json`, `data/live.json` and `data/games/<id>.json`
(box scores: boxscore + landing + right-rail). Finished games are cached in the repo and not refetched.

Pages are deployed by GitHub Actions (Settings > Pages > Source: **GitHub Actions**):
- `.github/workflows/site.yml`: on every push, every 3 hours and on demand. It refreshes the data, commits
  changes to `data/`, and deploys.
- `.github/workflows/live.yml`: cron every 10 minutes. If an Oilers game is live or starts within 30 min, it
  refreshes the data and deploys to Pages **without committing**, then re-dispatches itself, so a new deploy
  goes out roughly every 2 minutes until the final. Off game days each run exits in about 20 seconds.
  Public repos get free Actions minutes, and each job is far below the 6-hour job limit.

**Real delay:** the home live card and game page re-read the JSON every 30 s, bypassing cache. A change from the
NHL shows on the site after one cycle (about 2 to 3 min: run, deploy, Pages CDN). Scheduled cron can start
5 to 15+ min late, so the first live update may lag at puck drop. This is near-live, not pitch-by-pitch.
For true real-time (~10 s), a free Cloudflare Worker proxy could relay the NHL API with CORS headers
(needs a free Cloudflare account).

Refresh locally: `python3 scripts/update_data.py`
Times are shown in MT (America/Edmonton) and PT (America/Vancouver), converted from the API's UTC
`startTimeUTC`. Check: the Nov 5 Ducks game is `2026-11-06T01:00Z` = 7 PM MT = 6 PM PT.

## Game-Day Lineup (players.html)
`scripts/update_lineup.py` writes `data/lineup.json` for the Oilers' current or next game (shown at the top of players.html).
- **Projected:** lines (L-C-R x4), D pairs x3, PP units and injuries from DailyFaceoff's Oilers line combinations page
  (embedded `__NEXT_DATA__` JSON); starting goalie + Confirmed/Likely/Unconfirmed from DailyFaceoff's starting-goalies page.
- **Confirmed (official):** once the game starts (or ends) the NHL gamecenter boxscore lists who dressed and the starting goalie.
  Dressed players replace the projection (DailyFaceoff's combos are kept for those who played; the NHL publishes no lines).
- Names map to NHL roster ids (sweater number + last name, then full name) so chips link to `player.html?id=...`.
  Scratches = roster players not in the lineup and not injured.
- Safety: on a fetch error or failed sanity check (not EDM, too few players, <85% on the current roster, stale >21 days)
  the last good file is kept. The file is only rewritten when content changes.
- Schedule: hourly at :41 (news.yml) + 3:11-8:11 PM PT game-day runs (lineup.yml, exits early on non-game days) +
  every live-loop deploy (live.yml) + site.yml runs.

## Live rink tracker (`tracker.html`, the "Live" tab)
Animated SVG rink (200 x 85 ft) that plots every NHL play-by-play event with x/y coordinates: goals (copper burst +
goal banner with scorer/assists), shots on goal, missed and blocked shots, hits, faceoffs, penalties, takeaways and
giveaways, plus a scorebug (score, SOG, period, clock, live/intermission/final) and a newest-first play-by-play feed.
- **Live data:** the Cloudflare Worker relays NHL `/gamecenter/<id>/play-by-play` through
  `GET /live/pbp?id=GAMEID`, matching `scripts/update_data.py`’s slim JSON schema including `fetched`.
  `GET /live/now` supplies the home and Scores live scores plus goal scorers. Both use `caches.default`
  with a **2-second** TTL, canonical cache keys, a User-Agent upstream and site-only browser CORS.
  Browsers poll every **3 seconds**, never overlap requests, pause while hidden and refresh on return.
  Replay and relay failures use the generated JSON files; older fallback timestamps cannot roll live data back.
- **Latency:** previously the Actions/Pages loop added ~2–4 minutes. The relay adds roughly 0–5 seconds
  (2-second edge cache + up to 3-second poll), plus network and the NHL’s own publishing delay.
  Expect roughly 10–30 seconds behind the NHL feed in practice, not a measured broadcast guarantee.
  The tracker shows the last NHL fetch age and explicitly labels the slower backup feed.
- **Free-plan budget:** 100,000 Worker requests/day across all routes. One visible page at 3 seconds
  for a three-hour game uses ~3,600 requests: about 27 viewer-sessions maximum before other traffic.
  Home, Scores and Live each use one live request per poll, not continuous half-second polling.
  Hidden tabs stop polling; pre-game live cards also consume requests while open.
- **Push alerts:** the Worker now owns puck drop, goals, period ends and final scores. A minute cron
  wakes one SQLite-backed Durable Object, which polls the NHL directly every 15 seconds near/during games.
  A strongly consistent event journal, recoverable queue outbox and per-recipient delivery checkpoints
  fence overlapping runs/retries. GitHub still handles lineup, gameday and pregame odds, not game events.
  The activation floor starts at VAN@EDM on Nov 7 (8 PM PT); no old Actions-cache game can replay at cutover.
  See `worker/README.md` for retry semantics, tests and the unavoidable Web Push last-mile limitation.
- **Ends:** in the default "EDM →" view coordinates are rotated per period (using `homeTeamDefendingSide`) so the
  Oilers always attack the right-hand net; "Arena" shows the raw NHL coordinates (teams switch ends each period).
- **Modes:** current game if live, otherwise next game (pre-game, puck drop in PT) with "Replay last game" and a picker
  for any finished game. Replay runs in game time (10x-600x), with play/pause, restart and a timeline scrubber (goal
  ticks). URL: `tracker.html?mode=replay&id=GAMEID&t=SECONDS&speed=60&autoplay=0`.
- **Puck tracer:** a puck glides between discrete play-by-play `xCoord`/`yCoord` points in time order (live and replay),
  leaving a copper trail. Involved players for the current/latest play (shooter, scorer, hitter/hittee, faceoff winner,
  etc.) get simple roster-name markers at that event — no continuous skating paths and no NHL EDGE scrape.
- **Full-screen rink:** expand control on the rink uses the Fullscreen API when available; on iPhone / when that API is
  missing, a viewport-filling CSS fallback still enlarges the rink (easy exit via the control or Escape). Works in the PWA.
- Team abbreviations and CSS colours only, no logos. Credits "Data: NHL".
- `news.yml` and `lineup.yml` run `update_data.py` (LIVE_RUN=1, ~15 s) right before they deploy, so their
  deploys never put older live score / box score / play-by-play back on the site mid-game.

## App (PWA) and Game alerts
- `manifest.webmanifest` (name "The Copper & Blue News", short name "C&B News", standalone, navy theme) with icons in
  `icons/` generated from `logo.jpg` with PIL: `icon-192/512.png` (any), `maskable-192/512.png` (logo at 80% on navy,
  inside the maskable safe zone), `badge-96.png` (monochrome drop for Android's status bar) and the root
  `apple-touch-icon.png` (180). Every page links the manifest plus the `apple-mobile-web-app-*` meta tags.
- `sw.js` (root scope): network-first for pages and data JSON (`data/`, `data.json`, `posts.json`, `js/config.js`),
  so live scores and the tracker are never stale online; cache-first for versioned CSS/JS, images and fonts;
  `offline.html` fallback. Bump `VERSION` in `sw.js` when the precache list changes (old caches are deleted).
  Push + notificationclick handlers open the inbox at `/notifications.html?id=` when the payload has an alert id.
  The payload `url` is unchanged: lineup still points at `/players.html`, finals at `/game.html?id=`.
  Notifications with no id (ones sent before this) still open that url.
- `js/pwa.js`: registers the SW, shows the "Install the app" banner (Android/desktop `beforeinstallprompt`; iOS one-time
  "Tap Share then Add to Home Screen" tip; dismissal is remembered in localStorage), and the bell / Game alerts panel.
- `js/config.js`: `WORKER_URL` (empty = "Alerts coming soon", nothing is sent) and the public `VAPID_PUBLIC_KEY`.
  The VAPID private key is never in this repo; it goes into the Worker as a secret (see `worker/README.md`).
- `privacy.html`: what alerts collect (push subscription, alert prefs, optional name/email) and how to unsubscribe/delete.
- Game alerts backend: `worker/` (Cloudflare Worker + KV + Queue; see `worker/README.md`, not deployed by Actions).
  `scripts/notify_alerts.py` runs in `live.yml` (puck drop, goals, period ends, final) and `live.yml`/`lineup.yml`
  (lineup confirmed) and POSTs new events to `WORKER_URL/notify`. It is skipped until the `WORKER_URL` and
  `NOTIFY_SECRET` repo secrets exist; sent ids persist in the Actions cache and in KV, so nothing is sent twice.
- "Latest on Instagram" (`js/instagram.js`): posts.html grid (up to 12) + Follow button and a 3-post strip on Home, read in the browser from the public Behold JSON feed (4 s timeout; on failure posts.html shows only the Follow button and Home hides the strip). The service worker never handles feeds.behold.so / behold.pictures / cdninstagram requests.
- Cache-bust: CSS/JS URLs use `?v=41`. Bump it in every HTML page and the `PRECACHE` list in `sw.js` together.
- **Standings and leaders** (Scores tab): `standings.html` and `leaders.html`. `update_data.py` writes `data/standings.json` and `data/leaders.json` from the public NHL API (`standings/now`, `skater-stats-leaders/current`, `goalie-stats-leaders/current`) on the same schedule as the other JSON. The browser still cannot call the NHL API. These are not on the live Worker relay: they change a few times a day, and the relay's request budget is for the rink.
- **Notifications inbox:** the header bell (top left) opens `notifications.html`. Unread ids are in `localStorage` key `cbn-alerts-read`. The list is `GET /alerts/log` on the alerts Worker. That Worker change is in `worker/` and is **not** deployed by GitHub Pages. See `worker/README.md`. Until it is deployed the page is empty; `?sample=1` shows labeled examples.

## Cap & contracts (manual, sources: public reports)
The NHL API has no contract data. `data/contracts.json` is filled by hand from **public reports**:
official NHL.com / EdmontonOilers.com signing releases first, then TSN, Sportsnet, Edmonton Journal, The Athletic, CBC or AP.
Wikipedia is only a pointer; cite the original article. Do **not** copy from PuckPedia, CapWages or Spotrac
(the site shows "See also: PuckPedia" as a link only). It is **not auto-updated**.

Per player: `capHit` (2026-27), `aav`, `total`, `years`, `signed`, `firstSeason`, `lastSeason`, `status` (UFA/RFA, only if
reported), `clauses` (only if reported), `sourceName`, `sourceUrl`, `note`. Leave anything unverified as `null`; never estimate.

Refresh:
1. `python3 scripts/update_data.py && python3 scripts/make_contracts_template.py` (adds new roster players, keeps entered data).
2. Fill new or changed rows from a cited report; set `asOf` to today's date.
3. `team.capHit`/`capSpace` are only set when every roster player has a verified `capHit`; otherwise set
   `coveredCapHit`, `coveredCount`, `rosterCount` and `missing` (the Cap page then shows a "covered so far" total).
4. Commit and push.

## Run locally
`python3 -m http.server 8000` then open http://localhost:8000

## Deploy: GitHub Pages
1. Create a public repo (e.g. `copperandbluenews-site`) and push these files to `main`.
2. Repo **Settings > Pages**: Source "GitHub Actions" (the workflows deploy the site).
3. Custom domain: `copperandbluenews.com`. Set it in Settings > Pages (with Actions deploys the `CNAME` file isn't used, but keep it too). Turn on **Enforce HTTPS** after DNS works.
4. DNS at your registrar:

| Type  | Name | Value |
|-------|------|-------|
| A     | @    | 185.199.108.153 |
| A     | @    | 185.199.109.153 |
| A     | @    | 185.199.110.153 |
| A     | @    | 185.199.111.153 |
| AAAA  | @    | 2606:50c0:8000::153 (also 8001, 8002, 8003) |
| CNAME | www  | `copperandbluenews.github.io` |

Optional: verify the domain under GitHub **Settings > Pages > Verified domains** (adds a TXT record).

## Deploy: Cloudflare Pages
1. Cloudflare dashboard > **Workers & Pages > Create > Pages > Connect to Git**, pick the repo.
2. Framework preset: None. Build command: (blank). Output directory: `/`.
3. **Custom domains > Set up a domain**: `copperandbluenews.com` and `www.copperandbluenews.com`.
4. DNS: easiest is to add the domain to Cloudflare (change the registrar's nameservers to Cloudflare's), and Cloudflare creates the records:
   - `CNAME @ -> <project>.pages.dev` (proxied, flattened at the apex)
   - `CNAME www -> <project>.pages.dev` (proxied)
   An apex domain on Cloudflare Pages requires Cloudflare nameservers. Without them only `www` (CNAME) works.

Live URL: https://copperandbluenews.com/

## News & injuries (automatic)
`scripts/update_news.py` runs hourly (`.github/workflows/news.yml`, :41 past each hour, plus a 15:05 UTC ≈ 8 AM PT daily run) and on every site build.
- **News** (`data/news.json`, 36 newest, deduped by URL and similar title): NHL.com/EdmontonOilers.com (NHL's public content API, Oilers tag),
  Edmonton Journal Oilers RSS, Sportsnet RSS (Oilers-filtered), Google News RSS for "Edmonton Oilers". Headline + ≤2-line snippet + link only.
- **Injuries** (`data/injuries.json`): who is injured and the injury come from the "Injured:" line of the latest NHL.com projected-lineups preview
  (auto). IR/LTIR status, expected return and extra sources come from `data/injuries_manual.json`, entered by hand from cited reports;
  a manual entry only shows while NHL.com still lists that player. Remove stale entries when a player returns.

## Fantasy (News tab → Fantasy, Stats tab → Fantasy Points)

- `scripts/update_fantasy.py` builds `data/fantasy.json`: Oilers fantasy news (RotoWire RSS, RotoWire/CBS Sports
  player blurbs and "Oilers fantasy" via Google News RSS; DailyFaceoff and Yahoo RSS checked too), filtered to
  current roster names and deduped (headline, source, time, link; no article text), plus a data-driven
  Fantasy Outlook from the regular-season box scores in `data/games`, `data/lineup.json` and NHL standings.
- Scoring: skaters G 3, A 2, PPP 1, SOG 0.5, HIT 0.5, BLK 0.5; goalies W 4, SV 0.2, GA -1, SO 3.
- Projection: 50/50 blend of season and last-10 per-game rates, G/A/PPP scaled by the opponent's GA/GP vs league
  (half strength, capped at ±15%). Fan projections, not guarantees.
- Runs in news.yml (hourly, full) and site.yml; `--outlook` (no feeds) in lineup.yml and live.yml.

## Analytics

Cloudflare Web Analytics (cookieless). `python3 scripts/set_analytics.py <site_token>` adds the beacon to every page
and the matching paragraph to privacy.html (`--remove` undoes both). The service worker never handles
cloudflareinsights.com requests.

## Game Day Matchup

`scripts/update_lineup.py` also writes the opponent's DailyFaceoff lines, pairs, goalie (+ status from the
starting-goalies page) and injuries under `"opponent"` in `data/lineup.json` (all 32 DailyFaceoff team slugs are in
`SLUGS`), flipping to "Confirmed · official" from the NHL boxscore like EDM. `js/matchup.js` renders it on
players.html (side by side on desktop; tabs on mobile) and in the Live tracker's pre-game view. If the opponent
part fails, only the Oilers half shows.


## Game day email list (no email delivery yet)
Home (after Pick'em) and News have an unchecked consent box and separate signup form. Optional
email entered for web-push alerts is never copied into this list. `POST /newsletter` requires
`email`, `consent:true`, `consentVersion:2026-11-06-v1`, `source:home|news`, and an empty `website`
honeypot. It normalizes email, stores one deterministic `nl:<sha256(email)>` record in ALERTS_KV,
and preserves the consent timestamp, exact wording/version, method and source. Native
NEWSLETTER_RATE limits attempts approximately to 5/IP/minute per Cloudflare location, without
KV counter writes or raw IPs in subscriber records. Existing site/www CORS rules apply.

Admin-only `GET /stats` adds `newsletter:{total,new_24h}` (always a fixed last 24h).
Admin-only `GET /export?list=newsletter` exports email, consent evidence and a signed unsubscribe
URL as CSV; bare `/export` still exports push subscriptions. Use the existing ADMIN_SECRET bearer
header; never put it in a URL. Unsubscribe URLs use domain-separated HMAC-SHA256 with ADMIN_SECRET,
are bound to the signup timestamp, have no expiry, require no login, and remove only that
newsletter record. Rotating ADMIN_SECRET invalidates old links: preserve it or arrange an old-key
verification transition before sending any newsletter. KV changes can take about 60s to propagate.

No sender, campaign, confirmation email or automatic newsletter is enabled. Before sending,
add Mac's approved public business mailing/contact address to the consent request and messages
(a PO box is fine; never publish a private home address), complete the mailing/provider setup and
CASL/PIPEDA review, and ensure every email has its per-recipient unsubscribe link. Consent by
itself does not certify legal compliance. Run `npm --prefix worker test` for isolated list/route tests.


## AirHockey with Copper
`play.html` + dependency-free `js/play.js`: vertical canvas rink, touch/mouse/keyboard,
first to seven vs Copper (original hand-drawn oil-drop character in `copper.svg`).
Rookie Copper / Copper / Playoff Copper vary reaction, speed and aim error. Both mallets
are circular with a 34-unit radius (1.62× the original 21-unit radius); the visible outer
edge and collision radius match exactly. Your mallet is orange/copper; Copper's is navy
with his bare-headed, black-eyed, gap-toothed face. Touch uses a gentle 24 CSS pixel
upward offset instead of the previous stick-only offset; mouse controls the centre directly.
Goals are retuned to 176 units wide and CPU approach distances use the enlarged circle.
Rounded rink corners reflect the puck from the same arcs shown in the artwork.
A genuinely pinned puck gets a neutral faceoff, never an invented goal. Fixed 120 Hz
physics with capped 930-unit/s puck speed and 60fps requestAnimationFrame rendering;
DPR-scaled canvas and cached rink drawing. Best win, wins/losses and streaks stay in
localStorage only. No accounts, scores service or network dependencies.

Play opens a safe-area-aware fixed 100dvh overlay; requests native fullscreen and portrait
orientation where available. iPhone Safari uses the overlay fallback, and standalone PWA
uses the same layout. Navigation, footer and install banners are hidden while playing.
Exit/Esc restores the page and pauses; hidden tabs stop rendering and require explicit
Resume. Sound defaults off. Sharing is only triggered by the player's Share button.
The page, JS, config and Copper SVG are precached for offline play in cbn-v41.

Local checks: `node --check js/play.js` and `node scripts/test_airhockey.cjs` plus `node scripts/test_airhockey_ui.cjs`.
The v39 regression runs 80 seeds per mood (240 full matches), all ending at seven in
28–127 simulated seconds. Normal-autoplay wins 70/80 against Rookie, 35/80 against
Copper and 12/80 against Playoff Copper. Circular contacts and touch offset have direct tests.
`play.html?demo=1&seed=42` runs two CPU paddles, with no record saved. Optional
`&speed=20` accelerates real simulation for development/demo captures; never changes
scores directly and still ends at seven. `&at=15` replays actual seeded physics to a
specified simulated second before display; `&at=300&seed=2` reaches a genuine demo win (scores come from the physics, not a fixture). The mascot's transparent 1024px PNG export
for Instagram is `/workspace/reels/copper-mascot.png` (outside the repository).

Copper artwork v3: bare pointed oil-drop top, chunky navy hockey gloves with copper cuffs,
padded finger rolls and a natural stick grip. The black eye, determined brows and missing
front tooth remain. The canvas paddle face uses the same bare-headed design.
The previous transparent PNG is preserved at `/workspace/reels/copper-mascot-v1.png`.

The helmet-era PNG is preserved at `/workspace/reels/copper-mascot-v2.png`; the current
transparent 1024px export remains `/workspace/reels/copper-mascot.png`.
