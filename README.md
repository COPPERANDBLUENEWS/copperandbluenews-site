# The Copper & Blue News

Static fan site for [@thecopperandbluenews](https://www.instagram.com/thecopperandbluenews/). Plain HTML/CSS/JS, no build step.
Fan run. Not affiliated with the Edmonton Oilers or the NHL. Don't add official NHL/Oilers logos.

## Files
- `index.html`, `schedule.html`, `scores.html`, `players.html`, `cap.html`, `player.html?id=PLAYERID`, `game.html?id=GAMEID` (box score), `stats.html`, `posts.html`, `about.html`: pages
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
`data.json` (home cards), `data/schedule.json`, `data/stats.json`, `data/roster.json`, `data/players/<id>.json`, `data/live.json` and `data/games/<id>.json`
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
