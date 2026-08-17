-- Backing store for the lightweight D1-based fixed-window rate limiter
-- (functions/_lib/rate-limit.js). Used to throttle admin auth, telemetry
-- ingestion, OTP sends, and login attempts per-IP.
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_key_created ON rate_limit_events (key, created_at);
