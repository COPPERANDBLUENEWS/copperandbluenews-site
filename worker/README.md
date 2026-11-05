# Game alerts Worker (Cloudflare)

Stores Game alerts sign-ups and sends web push for **The Copper & Blue News** (copperandbluenews.com).
Code only; nothing here is deployed by GitHub Actions. Pages deploys skip this folder.

| Route | Who calls it | Auth | Body / result |
|---|---|---|---|
| `POST /subscribe` | the site (bell panel) | CORS: `https://copperandbluenews.com`, `https://www.copperandbluenews.com` | `{subscription, prefs, email?}` → upsert |
| `POST /unsubscribe` | the site | same CORS | `{endpoint}` → row deleted |
| `POST /notify` | GitHub Actions (`scripts/notify_alerts.py`) | `Authorization: Bearer NOTIFY_SECRET` | `{id?, type, title, body, url}` → web push to everyone who opted into `type` |
| `GET /export` | Mac | `Authorization: Bearer ADMIN_SECRET` | all sign-ups as CSV |
| `GET /health` | anyone | none | `{"ok":true}` |

- `type` is one of `puck_drop`, `goal`, `period_end`, `final`, `lineup` (same keys as the panel's checkboxes).
- `id` (e.g. `2026020260:goal:211`) is stored in D1 `sent_events`; a repeated id returns `{"duplicate":true}`
  and nothing is sent, so an event can never go out twice.
- Push: `src/webpush.js` implements RFC 8291 (aes128gcm) + RFC 8292 (VAPID, ES256) with WebCrypto only, no npm
  packages at runtime. Dead subscriptions (push service answers 404/410) are deleted automatically.
- Storage: D1 (`schema.sql`): `subscribers` (endpoint, keys, optional name/email, 5 pref columns, timestamps) and `sent_events`.
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

# 1. Database
npx wrangler d1 create cbn-alerts                    # copy the printed database_id into wrangler.toml
npx wrangler d1 execute cbn-alerts --remote --file=schema.sql

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
   Until both exist the alert steps in `live.yml` / `lineup.yml` are skipped.

Optional: if copperandbluenews.com's DNS is on Cloudflare, add a Custom Domain (Workers > cbn-alerts > Settings >
Domains & Routes), e.g. `alerts.copperandbluenews.com`, and use that as `WORKER_URL`.

## Export the sign-up list (you own the data)

```bash
curl -H "Authorization: Bearer $ADMIN_SECRET" $W/export -o cbn-alerts-signups.csv
```

Columns: `id, email, puck_drop, goal, period_end, final, lineup, created_at, updated_at, endpoint, p256dh, auth`
(the last three let you move the subscriptions to another push sender with the same VAPID keys).

## Local testing

```bash
cp .dev.vars.example .dev.vars        # fill in; .dev.vars is git-ignored
npx wrangler d1 execute cbn-alerts --local --file=schema.sql
npx wrangler dev                      # http://localhost:8787 (local D1 + local queue)
npm i --no-save http_ece && npm test  # encryption + VAPID JWT checked against an independent implementation
```

## How alerts are triggered

`scripts/notify_alerts.py` (standard library only) runs in GitHub Actions:
- `live.yml`, every live-loop cycle (about every 2-3 min during games, and every 10 min otherwise), after
  `update_data.py`: puck drop, every goal (both teams; scorer, season total, assists, score, PP/SH/EN), each period
  end with the score, and the final (shootout attempts are not sent; the final says "(SO)").
- `live.yml` + `lineup.yml`, after `update_lineup.py`: starting goalie confirmed and official lineup confirmed.
Sent ids are kept in the Actions cache and again in D1, so nothing is sent twice. Alerts follow the site's data, so
they arrive about 2-4 minutes after the moment on the ice.
