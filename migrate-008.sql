-- Self-hosted click-stream/funnel telemetry. No analytics existed anywhere in the
-- product before this — see the customer-experience QA pass that flagged the gap.
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT    NOT NULL,
  anon_id    TEXT,
  session_id TEXT,
  parent_id  INTEGER,
  student_id INTEGER,
  props      TEXT,
  path       TEXT,
  referrer   TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_events_name   ON events(event_name, created_at);
CREATE INDEX IF NOT EXISTS idx_events_anon   ON events(anon_id);
CREATE INDEX IF NOT EXISTS idx_events_parent ON events(parent_id);
