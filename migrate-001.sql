-- Migration 001: PIN auth + trusted devices + admin settings

ALTER TABLE parents ADD COLUMN password_hash TEXT;
ALTER TABLE parents ADD COLUMN password_salt TEXT;

CREATE TABLE IF NOT EXISTS trusted_devices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER NOT NULL REFERENCES parents(id),
  token      TEXT    NOT NULL UNIQUE,
  user_agent TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_trusted_token  ON trusted_devices(token);
CREATE INDEX IF NOT EXISTS idx_trusted_parent ON trusted_devices(parent_id);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('otp_max_per_hour',      '3'),
  ('otp_cooldown_seconds',  '60'),
  ('otp_expiry_seconds',    '600'),
  ('trusted_device_days',   '90');
