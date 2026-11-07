# Game alerts Worker (Cloudflare Workers + KV + Queues)

Stores Game alerts sign-ups and sends web push for **The Copper & Blue News** (copperandbluenews.com).
Code only; nothing here is deployed by GitHub Actions. Pages deploys skip this folder.

| Route | Who calls it | Auth | Body / result |
|---|---|---|---|
| `POST /subscribe` | the site (bell panel) | CORS: `https://copperandbluenews.com`, `https://www.copperandbluenews.com` | `{subscription, prefs, email?}` → upsert |
| `POST /unsubscribe` | the site | same CORS | `{endpoint}` → row deleted |
| `POST /notify` | GitHub Actions (`scripts/notify_alerts.py`) | `Authorization: Bearer NOTIFY_SECRET` | `{id?, type, title, body, url, to?, alt?}` → web push to everyone who opted into `type` (or only subscriber `to`, an id from `/export`, for a test). `alt: {pref, body}` swaps in `body` for subscribers who also opted into `pref` (used for the live moneyline on period ends, odds subscribers only) |
| `GET /stats?hours=24` | Mac / morning report (`/workspace/cbn-deploy/site_report.py`) | `Authorization: Bearer ADMIN_SECRET` | → JSON: subscribers (total, new in the window, count per alert type) and alerts sent in the window (events by type, push attempts, delivered, failed, expired subscriptions removed) |
| `GET /export` | Mac | `Authorization: Bearer ADMIN_SECRET` | all sign-ups as CSV |
| `GET /live/pbp?id=GAMEID` | Live tracker | same site CORS; public read-only | NHL play-by-play in the exact slim JSON format of `scripts/update_data.py`, edge-cached 2 seconds |
| `GET /live/now` | Home / Scores / tracker boot | same site CORS; public read-only | `{updated, game, goals}` for the current/recent Oilers game, edge-cached 2 seconds |
| `GET /alerts/log` | the site (Notifications inbox) | same site CORS; public read-only | `{updated, alerts}` newest first. Append-only `alog:<id>` plus the `alerts:log` array in KV. No subscriber data |
| `GET /health` | anyone | none | `{"ok":true}` |

- `type` is one of `puck_drop`, `goal`, `period_end`, `final`, `lineup`, `odds`, `gameday` (same keys as the panel's checkboxes).
- Defaults when a sign-up leaves a key out: `odds` **off** (betting odds are opt-in, 19+), everything else on.
  Records saved before Nov 5, 2026 (no `v` field) read as `gameday` on and `odds` off; they're rewritten as `v: 2` on the next save.
- `id` (e.g. `2026020260:goal:211`) is stored in KV as `evt:<id>` for 45 days; a repeated id returns `{"duplicate":true}`
  and nothing is sent. This suppresses sequential repeats; KV is not an atomic lock for concurrent producers.
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

## Live relay

`src/live.js` reads the public NHL feed with a User-Agent and an 8-second upstream timeout.
Cache keys ignore arbitrary query parameters and Origin; CORS is applied after lookup so cached responses
cannot leak another origin’s header. Browser responses are `no-store`; only `caches.default` keeps a
2-second copy. Failed upstream requests are not cached. No KV reads/writes or push sends occur on live routes.
The browser uses a 5-second timeout before falling back to the generated site JSON, and pauses polling
while hidden. Tests: `npm test` (push crypto plus isolated relay schema/cache/CORS/transition tests).

The Free plan’s 100,000 daily request allowance is shared by live and alerts routes. At one request every
3 seconds, a visible page uses ~3,600 requests per three-hour game, before pre-game and other traffic.
A minute cron now drives game alerts through a SQLite-backed Durable Object; see below.
Lineup/final alert click URLs are untouched (`/players.html` and `/game.html?id=`). The service worker opens the inbox from the alert id, not by rewriting those urls.

## Alert log (Notifications inbox)

Each alert that is actually handed to the push sender is also appended to KV. Game events (puck drop, goals, period ends, finals) are written from the Durable Object after the delivery plan is committed, without changing the 15-second poll or the push payload. Lineup, confirmed-starter, gameday and odds alerts are written from `POST /notify`, which is still what GitHub Actions calls. A repeated id does not add a second row.

- `alog:<id>` is write-once. `alerts:log` is the newest-first array (capped at 400) that `GET /alerts/log` returns in one read.
- That is two KV writes per new alert, on top of the existing `evt:` / `snd:` writes. A game night stays inside the Free plan's 1,000 writes/day.
- `GET /alerts/log` is public and read-only. CORS matches the rest of the site routes. It does not wake the Durable Object.
- Deploy this Worker yourself (`npx wrangler deploy` from `worker/`). GitHub Pages does not deploy it. Nothing new to create: same KV namespace, same Durable Object, no new secrets. Alerts sent before the deploy are not backfilled. The inbox stays empty until the next one is sent. `notifications.html?sample=1` shows labeled examples.

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

## How alerts are triggered (v33)

### Game events: single durable Worker producer

- `* * * * *` cron calls the **same** SQLite-backed `GameAlerts` Durable Object each minute. The outer
  Worker does one binding fetch, staying inside Free's 10 ms CPU budget. The actor has its own 30-second
  CPU budget and polls with 15-second sleeps until its roughly 55-second cron window closes. Its recovery
  alarm is a second watchdog. Off-game checks make at most one schedule request (cached five minutes in
  durable storage), send nothing and return immediately. No browser needs to be open.
- The active window is five minutes before puck drop through final (at most eight hours after scheduled
  start). The first eligible game is **2026020276, VAN@EDM, Nov 7 at 8 PM PT**. `GAME_ALERTS_SINCE` is that
  scheduled start in UTC. Every older game is excluded, regardless of old Actions cache or KV visibility.
- `src/game-events.js` ports Python `game_events` and `add_odds`: identical titles, bodies, IDs, URLs,
  scorer/assist formatting, PP/SH/EN, shootout exclusions, final result and optional odds variants.
  Stable event IDs are never re-sent after scorer edits, goal removal or reappearance, matching Python.
- `notify_alerts.py --game` sends nothing (dry-run generation remains for testing). `live.yml` calls only
  `--pregame` at that step. The Worker's authenticated `/notify` also refuses the four managed game types,
  fencing even an old Actions run already in flight. Lineup/gameday/pregame odds remain unchanged.

### Dedupe and failure recovery

KV is **not** used as a lock: it is eventually consistent and cannot safely arbitrate overlapping cron runs.
One Durable Object identity and an in-flight producer promise serialize cron/alarm loops. For each stable
ID, an atomic SQLite storage write records both the claim and a complete recoverable delivery plan before
any queue call. Previously sent legacy KV IDs are also checked at first claim as a compatibility safeguard.

Queue messages contain only `{gameAlert: {id, batch}}`; the payload/subscriber snapshot stays in durable
storage. Batches contain up to 20 subscribers (headroom for deleting expired subscriptions). A queue
acceptance timeout can enqueue the same reference again: event-scoped consumer serialization and durable
per-recipient success checkpoints suppress repeats. Only failed recipients retry, while accepted/gone
recipients are never intentionally sent again. Pending outbox entries remain until all recipients have
been accepted by a push service or their subscription is confirmed expired (404/410). Queue retry
exhaustion does not silently discard the outbox: alarms/cron can enqueue outstanding work again.

**Web Push limitation:** no server can atomically commit its database together with Apple/Google/Mozilla's
HTTP receipt or guarantee a phone displays a notification. If a provider accepts a push and the process
or connection dies before the durable success checkpoint, a retry is ambiguous. Stable Web Push Topic,
notification tag/event ID and `renotify: false` coalesce/quiet those rare transport retries. This is not
a mathematical exactly-once or guaranteed-device-delivery claim. Reopening the PWA installs v33's
quiet-replacement behavior; existing subscriptions/preferences remain valid.

Ordinary expected game-alert relay lag is about **0–15 seconds plus NHL/network/queue/device delay**,
versus roughly 2–4 minutes before. Optional odds lookups can add up to eight seconds at puck drop/period
ends. A provider outage is retried, not called a successful delivery. No paid plan is required; the existing
100k Worker requests/day and 1k KV writes/day limits still apply. SQLite has its own free quotas; active
polling/journal work is small for one team. The live page's 3-second polling is independent.

### Other alerts and tests

GitHub Actions still runs `--lineup`, `--morning` and `--pregame` as before, including their existing URLs,
preferences and responsible-gambling text. Final alerts still open `/game.html?id=GAMEID`; lineup alerts
still open `/players.html`.

- `npm test`: push crypto, live relay, and game producer tests. Replays **296 incremental snapshots** of
  real EDM game 2026020260 and compares against actual Python output: **14 exact alerts**, once each.
  Also tests scorer corrections/reversals, legacy cutover, overlapping runs, enqueue ambiguity, partial
  delivery failure, durable restart and crash-after-last-checkpoint recovery. Sending is stubbed.
- `npm run test:game-runtime`: bundles locally, then runs real workerd SQLite DO + KV + Queue and actual
  push encryption against an entirely mocked provider. Decrypts/compares all 14 game alerts and checks
  duplicate redelivery, the legacy producer fence and unchanged lineup/odds HTTP paths. No real pushes.
- The older `test:integration` exercises the legacy HTTP producer; use a local config with
  `GAME_ALERTS_ENABLED=0` for its game-type assertions, never disable the production producer to run it.

Rollback requires a coordinated change: stop the durable game producer (`GAME_ALERTS_ENABLED=0`) and
restore the Python/workflow `--game` path together. Keep the Durable Object namespace/data and activation
floor: do not delete or rename the actor, because that would discard dedupe/checkpoint history.

## Send stats (KV)

Each delivery batch (one queue message of up to 40 subscribers, or one inline send) writes one key
`snd:<ms>:<rand>` with metadata `{i: event id, t: type, n: attempts, s: sent, g: gone, f: failed}`, kept 8 days.
`evt:<id>` keys carry `{t, at, r}` metadata. `/stats` only uses `list()` (no per-key reads). That's one extra
KV write per batch, so a full game night (~30 events) is ~30 writes with today's list size, well inside the
Free plan's 1,000 writes/day.
