-- D1 schema for the Game alerts Worker. Apply with:
--   npx wrangler d1 execute cbn-alerts --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS subscribers (
  id          TEXT PRIMARY KEY,            -- first 16 bytes of SHA-256(endpoint), hex
  endpoint    TEXT NOT NULL UNIQUE,        -- browser push service URL
  p256dh      TEXT NOT NULL,               -- subscription public key (base64url)
  auth        TEXT NOT NULL,               -- subscription auth secret (base64url)
  email       TEXT,                        -- optional name or email typed by the fan
  puck_drop   INTEGER NOT NULL DEFAULT 1,
  goal        INTEGER NOT NULL DEFAULT 1,
  period_end  INTEGER NOT NULL DEFAULT 1,
  final       INTEGER NOT NULL DEFAULT 1,
  lineup      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  fail_count  INTEGER NOT NULL DEFAULT 0
);
-- Every event id that was fanned out (dedupe: the same id is never sent twice).
CREATE TABLE IF NOT EXISTS sent_events (
  id          TEXT PRIMARY KEY,            -- e.g. 2026020260:goal:211
  type        TEXT NOT NULL,
  title       TEXT,
  created_at  TEXT NOT NULL,
  recipients  INTEGER
);
