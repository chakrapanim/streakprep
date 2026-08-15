-- Dedup log so the daily reminder cron never double-sends the same
-- reminder to the same subscription (matters if the external scheduler
-- ever retries/fires twice in a day).
CREATE TABLE IF NOT EXISTS reminder_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  reminder_type   TEXT    NOT NULL,
  sent_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (subscription_id, reminder_type)
);
