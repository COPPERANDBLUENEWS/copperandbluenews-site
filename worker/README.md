# Game alerts Worker (Cloudflare Workers + KV + Queues)

Stores Game alerts sign-ups and sends web push for **The Copper & Blue News** (copperandbluenews.com).
Code only; nothing here is deployed by GitHub Actions. Pages deploys skip this folder.

| Route | Who calls it | Auth | Body / result |
|---|---|---|---|
| `POST /subscribe` | the site (bell panel) | CORS: `https://copperandbluenews.com`, `https://www.copperandbluenews.com` | `{subscription, prefs, email?}` → upsert |
| `POST /unsubscribe` | the site | same CORS | `{endpoint}` → row deleted |
| `POST /notify` | GitHub Actions (`scripts/notify_alerts.py`) | `Authorization: Bearer NOTIFY_SECRET` | `{id?, type, title, body, url, to?, alt?}` → web push to everyone who opted into `type` (or only subscriber `to`, an id from `/export`, for a test). `alt: {pref, body}` swaps in `body` for subscribers who also opted into `pref` (used for the live moneyline on period ends, odds subscribers only) |
| `GET /export` | Mac | `Authorization: Bearer ADMIN_SECRET` | all sign-ups as CSV |
| `GET /health` | anyone | none | `{"ok":true}` |

- `type` is one of `puck_drop`, `goal`, `period_end`, `final`, `lineup`, `odds`, `gameday` (same keys as the panel's checkboxes).
- Defaults when a sign-up leaves a key out: `odds` **off** (betting odds are opt-in, 19+), everything else on.
  Records saved before Nov 5, 2026 (no `v` field) read as `gameday` on and `odds` off; they're rewritten as `v: 2` on the next save.
- `id` (e.g. `2026020260:goal:211`) is stored in KV as `evt:<id>` for 45 days; a repeated id returns `{"duplicate":true}`
  and nothing is sent, so an event never goes out twice.
- Push: `src/webpush.js` implements RFC 8291 (aes128gcm) + RFC 8292 (VAPID, ES256) with WebCrypto only, no npm
  packages at runtime. Dead subscriptions (push service answers 404/410) are deleted automatically.
- Storage: Workers KV (`src/store.js`, binding `ALERTS_KV`). `sub:<id>` = one sign-up (endpoint, keys, optional
  name/email, prefs, timestamps); the record is also kept in the key's metadata, so fan-out and `/export` page through
  `list()` with a cursor (1000 keys per call) instead of reading every key. `evt:<id>` = sent event ids.
  Free-plan KV limits: 100,000 reads, 1,000 writes, 1,000 deletes and 1,000 lists per day. Each sign-up or
  preference change is 1 write, so more than ~1,000 sign-ups in one day needs Workers Paid ($5/mo).
  KV is eventually consistent (up to ~60 s); dedupe is also done by the pipeline's own sent-id state.
- Fan-out: `/notify` puts subscribers in batches of 40 on the `cbn-push` Queue; the queue consumer sends them. Each
  consumer run has its own subrequest budget, so this works on the **Workers Free** plan (50 outgoing requests per
  invocation; Queues has 10,000 free operations/day = ~3 per batch of 40, so roughly 130k pushes/day). Without the
  queue binding, `/notify` sends inline, capped at 45 pushes per alert (set `INLINE_LIMIT` higher on Workers Paid).
- Only push hosts of real browsers are accepted (FCM, Mozilla, Apple, Windows), so the Worker can't be used to
  POST to arbitrary URLs. Names/emails are trimmed to 120 chars; CSV export escapes formula-looking cells.

## Deploy (one time, about 10 minutes)

Needs: a free Cloudflare account and Node 18+. Run everything from this `worker/` folder.

```bash
cd worker
npm install
npx wrangler login                                   # opens Cloudflare in the browser

# 1. Storage
npx wrangler kv namespace create cbn-alerts          # copy the printed id into wrangler.toml [[kv_namespaces]]

# 2. Fan-out queue (free)
npx wrangler queues create cbn-push

# 3. Deploy the Worker (prints https://cbn-alerts.<your-subdomain>.workers.dev)
npx wrangler deploy

# 4. Secrets (each command prompts for the value; nothing is stored in the repo)
npx wrangler secret put VAPID_PRIVATE_KEY            # the "privateKey" value from the VAPID key file (see below)
npx wrangler secret put NOTIFY_SECRET                # a long random string, e.g. from: openssl rand -base64 32
npx wrangler secret put ADMIN_SECRET                 # a different long random string (for /export)
```

`VAPID_PUBLIC_KEY` is already in `wrangler.toml` `[vars]` and in `../js/config.js`; it is public and must match the
private key. The private key was generated with the public one and is kept outside the repo (on the Grok Bot box at
`/home/box/secrets/cbn-vapid.json`). Never commit it. If you ever replace the keypair, update both public-key
spots; existing subscribers then have to tap the bell again.
`VAPID_SUBJECT` defaults to `https://copperandbluenews.com`; a `mailto:` address works too.

### 5. Check it

```bash
W=https://cbn-alerts.<your-subdomain>.workers.dev
curl $W/health                                                         # {"ok":true}
curl -X POST $W/notify -H "Authorization: Bearer $NOTIFY_SECRET" -H "Content-Type: application/json" \
  -d '{"type":"final","title":"Test alert","body":"It works","url":"/tracker.html"}'
# -> {"ok":true,"recipients":N,"queued":...}   (no "id" in a test, so it is not recorded as sent)
```

### 6. Turn it on in the site and the live pipeline

1. `../js/config.js`: set `WORKER_URL: "https://cbn-alerts.<your-subdomain>.workers.dev"` (no trailing slash), commit, push.
   The bell switches from "Alerts coming soon" to the real sign-up.
2. GitHub repo **Settings > Secrets and variables > Actions**: add `WORKER_URL` (same URL) and `NOTIFY_SECRET`
   (same value as the Worker secret). Or: `gh secret set WORKER_URL` / `gh secret set NOTIFY_SECRET`.
   Until both exist the alert steps in `live.yml` / `lineup.yml` / `news.yml` are skipped.

Optional: if copperandbluenews.com's DNS is on Cloudflare, add a Custom Domain (Workers > cbn-alerts > Settings >
Domains & Routes), e.g. `alerts.copperandbluenews.com`, and use that as `WORKER_URL`.

## Export the sign-up list (you own the data)

```bash
curl -H "Authorization: Bearer $ADMIN_SECRET" $W/export -o cbn-alerts-signups.csv
```

Columns: `id, email, puck_drop, goal, period_end, final, lineup, odds, gameday, created_at, updated_at, endpoint, p256dh, auth`
(the last three let you move the subscriptions to another push sender with the same VAPID keys).

## Local testing

```bash
npm install
npm i --no-save http_ece && npm test        # encryption + VAPID JWT checked against an independent implementation
node test/integration.test.mjs --setup      # writes .dev.vars with a throwaway VAPID key (git-ignored)
npx wrangler dev --port 8787                # local KV + local queue (other terminal)
npm run test:integration                    # subscribe/CORS/notify/dedupe/410 cleanup/export/unsubscribe via a mock push service
```

## How alerts are triggered

`scripts/notify_alerts.py` (standard library only) runs in GitHub Actions:
- `live.yml`, every live-loop cycle (about every 2-3 min during games, and every 10 min otherwise), after
  `update_data.py`: puck drop, every goal (both teams; scorer, season total, assists, score, PP/SH/EN), each period
  end with the score, and the final (shootout attempts are not sent; the final says "(SO)").
- `live.yml` + `lineup.yml`, after `update_lineup.py`: starting goalie confirmed and official lineup confirmed.
- `--morning` (`lineup.yml` 16:00 UTC = 9 AM PT; `news.yml` hourly as backup): `gameday`, once per game, 8:50-11:30 AM PT.
- `--pregame` (`live.yml` every 10 min, `lineup.yml` :11): `odds`, once per game, 20-75 min before puck drop, from
  `https://api-web.nhle.com/v1/partner-game/CA/now` (FanDuel). Skipped silently if the feed fails or the game isn't listed.
  The puck-drop alert gets a short moneyline for everyone when odds exist; period ends get the live moneyline for
  odds subscribers only if the feed is seen updating after puck drop. Every odds text ends with `19+ · Play responsibly`.
- Test without sending: `python3 scripts/notify_alerts.py --pregame --dry-run --now 2026-11-06T00:00:00Z` prints the payloads.
Sent ids are kept in the Actions cache and again in KV, so nothing is sent twice. Alerts follow the site's data, so
they arrive about 2-4 minutes after the moment on the ice.
