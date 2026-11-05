# The Copper & Blue News

Static fan site for [@thecopperandbluenews](https://www.instagram.com/thecopperandbluenews/). Plain HTML/CSS/JS, no build step.
Fan run. Not affiliated with the Edmonton Oilers or the NHL. Don't add official NHL/Oilers logos.

## Files
- `index.html`, `posts.html`, `about.html`: pages
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
Tested Nov 4, 2026: `api-web.nhle.com` sends **no `Access-Control-Allow-Origin` header**, so browsers block
direct calls. `js/main.js` tries the API first and falls back to `data.json`. To refresh the data:
```
python3 scripts/update_data.py   # standard library only, Python 3.9+
```
Then commit and push. This is automated by `.github/workflows/update-data.yml` (every 3 hours + manual run). It looks like:
```yaml
on: { schedule: [{ cron: "0 */3 * * *" }], workflow_dispatch: {} }
permissions: { contents: write }
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: python3 scripts/update_data.py
      - run: |
          git config user.name bot; git config user.email bot@users.noreply.github.com
          git add data.json; git commit -m "Update game data" || exit 0; git push
```
Times are shown in MT (America/Edmonton) and PT (America/Vancouver), converted from the API's UTC
`startTimeUTC`. Check: the Nov 5 Ducks game is `2026-11-06T01:00Z` = 7 PM MT = 6 PM PT.

## Run locally
`python3 -m http.server 8000` then open http://localhost:8000

## Deploy: GitHub Pages
1. Create a public repo (e.g. `copperandbluenews-site`) and push these files to `main`.
2. Repo **Settings > Pages**: Source "Deploy from a branch", branch `main`, folder `/ (root)`.
3. Custom domain: `copperandbluenews.com` (add the `CNAME` file back, see above). Turn on **Enforce HTTPS** after DNS works.
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

Live (temporary) URL: https://copperandbluenews.github.io/copperandbluenews-site/
